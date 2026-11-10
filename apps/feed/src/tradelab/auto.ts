// Trade lab automatic rules: a scan (ready-made, saved, or written) on a list of stocks; when a stock matches, trade
// it on paper, as the stock, its future, or a call / put near the money, with a stop and target. Runs only inside the
// owner's window (no entries before firstEntry, none from squareOff), checks each scan once per closed candle (daily
// scans once a day, at firstEntry, on yesterday's close), and logs every decision with its reason.
// Rules and the log live in .userdata/tradelab-auto.json (git-ignored), written safely like the owner's other data.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLedger } from '@mtv/paper';
import { isIntraday, type Tf } from '@mtv/rules';
import { live } from '../intraday/instance';
import { runScreen } from '../screener/screener';
import type { UniverseSpec } from '../screener/universe';
import { istDate, istMinute, type TradeLab } from './engine';
import { kiteMarket, prismaRepo } from './live';
import { DEFAULT_SETTINGS, LabError } from './types';

export type AutoRule = {
  id: string;
  name: string;
  enabled: boolean;
  /** The scan: its name (for the log), formula and candle timeframe. */
  scan: { name: string; formula: string; tf: Tf };
  universe: UniverseSpec;
  /** Bullish: buy the stock / future, or buy a call. Bearish: sell the stock (intraday) / future, or buy a put. */
  direction: 'BULLISH' | 'BEARISH';
  instrument: 'STOCK' | 'FUTURE' | 'OPTION';
  /** Options: strikes away from the money (0 = ATM, 1 = one strike out of the money, -1 = one in the money). */
  optionStrikes: number;
  product: 'MIS' | 'NRML' | 'CNC';
  /** Shares for a stock, lots for F&O. */
  size: number;
  /** Stop and target as % of the entry price of what is traded (empty = none). */
  stopPct: number | null;
  targetPct: number | null;
  maxTradesPerDay: number;
  maxOpen: number;
  createdAt: string;
  updatedAt: string;
};
export type AutoEvent = { at: number; ruleId: string; ruleName: string; symbol: string | null; action: 'placed' | 'skipped' | 'error' | 'checked'; text: string };

const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/tradelab-auto.json');
const MAX_EVENTS = 3000;
const TF_MIN: Record<string, number> = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 };
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** A basket: orders kept together and placed in one go (the owner's own, like a broker's basket order). */
export type BasketItem = { id: string; symbol: string; label: string; side: 'BUY' | 'SELL'; product: 'MIS' | 'NRML' | 'CNC'; type: 'MARKET' | 'LIMIT' | 'SL' | 'SLM'; qty: number; pricePaise: number | null; triggerPaise: number | null };
export type Basket = { id: string; name: string; items: BasketItem[]; updatedAt: string };
type Doc = { rules: AutoRule[]; events: AutoEvent[]; baskets?: Basket[] };
let doc: Doc | null = null;
let writing: Promise<void> = Promise.resolve();
async function load(): Promise<Doc> {
  if (doc) return doc;
  doc = await readFile(FILE, 'utf8').then((t) => JSON.parse(t) as Doc, () => ({ rules: [], events: [] }));
  return doc;
}
function save() {
  const snapshot = JSON.stringify(doc, null, 1);
  writing = writing.then(async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(`${FILE}.tmp`, snapshot);
    await rename(`${FILE}.tmp`, FILE);
  }).catch(() => undefined);
  return writing;
}
function log(e: Omit<AutoEvent, 'at'>, at = Math.floor(Date.now() / 1000)) {
  doc!.events.push({ at, ...e });
  if (doc!.events.length > MAX_EVENTS) doc!.events.splice(0, doc!.events.length - MAX_EVENTS);
}

// ---------------------------------------------------------------- the rules themselves

export class AutoError extends Error {}

export async function rules() { return (await load()).rules; }
export async function events(limit = 300) { return (await load()).events.slice(-limit).reverse(); }

export async function saveRule(input: Partial<AutoRule>): Promise<AutoRule> {
  const d = await load();
  const now = new Date().toISOString();
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new AutoError('Give the rule a name');
  if (!input.scan?.formula?.trim()) throw new AutoError('Pick a scan');
  if (!input.universe) throw new AutoError('Pick the stocks to scan');
  const instrument = input.instrument ?? 'STOCK';
  const product = input.product ?? 'MIS';
  if (instrument === 'STOCK' ? !['MIS', 'CNC'].includes(product) : !['MIS', 'NRML'].includes(product)) throw new AutoError(instrument === 'STOCK' ? 'Stocks: intraday (MIS) or delivery (CNC)' : 'F&O: intraday (MIS) or overnight (NRML)');
  if (instrument === 'STOCK' && input.direction === 'BEARISH' && product === 'CNC') throw new AutoError('A bearish stock rule sells short, which only works intraday (MIS)');
  const pct = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const r: AutoRule = {
    id: input.id ?? randomUUID(), name, enabled: input.enabled ?? false,
    scan: { name: String(input.scan.name ?? 'My rules').slice(0, 80), formula: input.scan.formula.trim(), tf: input.scan.tf ?? 'D' },
    universe: input.universe, direction: input.direction === 'BEARISH' ? 'BEARISH' : 'BULLISH', instrument,
    optionStrikes: Math.max(-5, Math.min(5, Math.round(Number(input.optionStrikes ?? 0)))), product,
    size: Math.max(1, Math.round(Number(input.size ?? 1))), stopPct: pct(input.stopPct), targetPct: pct(input.targetPct),
    maxTradesPerDay: Math.max(1, Math.min(50, Math.round(Number(input.maxTradesPerDay ?? 3)))), maxOpen: Math.max(1, Math.min(50, Math.round(Number(input.maxOpen ?? 3)))),
    createdAt: d.rules.find((x) => x.id === input.id)?.createdAt ?? now, updatedAt: now,
  };
  for (const v of [r.stopPct, r.targetPct]) if (v != null && !(v > 0 && v < 100)) throw new AutoError('Stop and target are percentages between 0 and 100');
  d.rules = [...d.rules.filter((x) => x.id !== r.id), r];
  await save();
  return r;
}
export async function deleteRule(id: string) {
  const d = await load();
  d.rules = d.rules.filter((x) => x.id !== id);
  await save();
}

// ---------------------------------------------------------------- what a match trades

/** The instrument a matched stock becomes, or why it can't. */
function pick(rule: AutoRule, stock: string, today: string): { symbol: string; lot: number; label: string } | string {
  if (rule.instrument === 'STOCK') {
    const i = kiteMarket.instrument(stock);
    return i ? { symbol: i.symbol, lot: 1, label: i.label } : `${stock} is not tradable`;
  }
  const k = live.kite();
  if (!k) return 'Kite is not connected';
  const all = k.nfoContracts(stock);
  if (!all.length) return `${stock} has no futures and options`;
  if (rule.instrument === 'FUTURE') {
    const f = all.filter((c) => c.kind === 'FUT' && c.expiry >= today).sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
    return f ? { symbol: f.tradingsymbol, lot: f.lot, label: kiteMarket.instrument(f.tradingsymbol)?.label ?? f.tradingsymbol } : `${stock} has no live future`;
  }
  const right = rule.direction === 'BULLISH' ? 'CE' : 'PE';
  // Nearest expiry, but not one expiring today (an option on its last day mostly decays).
  const exp = [...new Set(all.filter((c) => c.kind === right && c.expiry > today).map((c) => c.expiry))].sort()[0];
  const spot = kiteMarket.underlyingPrice(stock);
  if (!exp || spot == null) return `${stock}: no option expiry or no live price`;
  const strikes = [...new Set(all.filter((c) => c.kind === right && c.expiry === exp).map((c) => c.strike))].sort((a, b) => a - b);
  const atm = strikes.reduce((b, s, i) => (Math.abs(s * 100 - spot) < Math.abs(strikes[b] * 100 - spot) ? i : b), 0);
  const step = right === 'CE' ? rule.optionStrikes : -rule.optionStrikes; // out of the money: higher calls, lower puts
  const strike = strikes[Math.max(0, Math.min(strikes.length - 1, atm + step))];
  const c = all.find((x) => x.kind === right && x.expiry === exp && x.strike === strike);
  return c ? { symbol: c.tradingsymbol, lot: c.lot, label: kiteMarket.instrument(c.tradingsymbol)?.label ?? c.tradingsymbol } : `${stock}: no ${right} at ${strike}`;
}

const tick5 = (paise: number) => Math.round(paise / 5) * 5; // NSE tick: ₹0.05

// ---------------------------------------------------------------- the runner

const lastChecked = new Map<string, string>(); // rule id -> the bar (or day) last checked
let running = false;

/** Called every 15 seconds: checks each enabled rule when its candle has just closed, and trades its matches. */
export async function autoTick(lab: TradeLab, now = Math.floor(Date.now() / 1000)) {
  if (running) return;
  running = true;
  try {
    const d = await load();
    const on = d.rules.filter((r) => r.enabled);
    if (!on.length || !kiteMarket.isOpen(now)) return;
    const s = DEFAULT_SETTINGS, min = istMinute(now), today = istDate(now);
    if (min < hm(s.firstEntry) || min >= hm(s.squareOff)) return;
    const orders = await prismaRepo.orders();
    const trades = await prismaRepo.trades();
    let changed = false;
    for (const rule of on) {
      // When to check: a daily scan once a day (at the start of the window, on yesterday's close); an intraday scan
      // once per candle, 5 seconds after it closes (candles start at 09:15), on that candle.
      const intraday = isIntraday(rule.scan.tf);
      const step = TF_MIN[rule.scan.tf] ?? 1;
      let barKey = today, barStart = '';
      if (intraday) {
        const closed = Math.floor((min - 555) / step) - 1; // the last candle that has fully closed
        if (closed < 0) continue;
        const closeMin = 555 + (closed + 1) * step;
        if (min === closeMin && now % 60 < 5) continue; // its last minute may still be arriving
        const startMin = 555 + closed * step;
        barKey = `${today}|${closed}`;
        barStart = `${today} ${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
      }
      if (lastChecked.get(rule.id) === barKey) continue;
      lastChecked.set(rule.id, barKey);

      const mine = orders.filter((o) => o.source === `AUTO:${rule.id}` && !o.parentId);
      const entriesToday = mine.filter((o) => o.tradeDate === today && o.status !== 'REJECTED' && o.status !== 'CANCELLED');
      // Stocks this rule has already traded today (each entry's reason names the stock that matched).
      const tradedToday = new Set(entriesToday.map((o) => /matched (\S+) \(/.exec(o.reason ?? '')?.[1]).filter((x): x is string => !!x));
      const ruleTrades = trades.filter((t) => mine.some((o) => o.id === t.orderId) || orders.some((o) => o.id === t.orderId && o.source === `AUTO:${rule.id}`));
      const openNow = buildLedger(ruleTrades, 0).positions.filter((p) => p.qty !== 0).length;

      let r;
      try {
        r = await runScreen({ formula: rule.scan.formula, tf: rule.scan.tf, universe: rule.universe, candle: 'closed', limit: 300 }, now);
      } catch (e) {
        log({ ruleId: rule.id, ruleName: rule.name, symbol: null, action: 'error', text: `The scan could not run: ${(e as Error).message}` }, now);
        changed = true;
        continue;
      }
      // Intraday: only matches on the candle that has just closed (an older match is not a new signal).
      const fresh = intraday ? r.rows.filter((x) => x.barDate === barStart) : r.rows;
      log({ ruleId: rule.id, ruleName: rule.name, symbol: null, action: 'checked', text: `${rule.scan.name}: ${fresh.length} new match${fresh.length === 1 ? '' : 'es'} of ${r.scanned} stocks` }, now);
      changed = true;
      let placed = 0;
      for (const row of fresh) {
        const skip = (text: string) => log({ ruleId: rule.id, ruleName: rule.name, symbol: row.symbol, action: 'skipped', text }, now);
        if (tradedToday.has(row.symbol)) { skip('Already traded today by this rule'); continue; }
        if (entriesToday.length + placed >= rule.maxTradesPerDay) { skip(`Day limit reached (${rule.maxTradesPerDay} trades)`); continue; }
        if (openNow + placed >= rule.maxOpen) { skip(`Open-position limit reached (${rule.maxOpen})`); continue; }
        const what = pick(rule, row.symbol, today);
        if (typeof what === 'string') { skip(what); continue; }
        const inst = kiteMarket.instrument(what.symbol);
        if (!inst) { skip(`${what.label} is not tradable`); continue; }
        kiteMarket.watch([inst]);
        const q = kiteMarket.quote(inst);
        if (!q) { skip(`No live price yet for ${what.label}`); continue; }
        const side = rule.instrument === 'OPTION' || rule.direction === 'BULLISH' ? 'BUY' : 'SELL';
        const ref = side === 'BUY' ? q.askPaise || q.ltpPaise : q.bidPaise || q.ltpPaise;
        const dir = side === 'BUY' ? 1 : -1;
        const stopPaise = rule.stopPct != null ? tick5(ref * (1 - dir * rule.stopPct / 100)) : undefined;
        const targetPaise = rule.targetPct != null ? tick5(ref * (1 + dir * rule.targetPct / 100)) : undefined;
        try {
          const o = await lab.place({
            symbol: what.symbol, side, product: rule.product, type: 'MARKET', qty: rule.size * what.lot, stopPaise, targetPaise,
            source: `AUTO:${rule.id}`, reason: `${rule.name}: ${rule.scan.name} matched ${row.symbol} (${row.barDate})`,
          });
          placed++;
          tradedToday.add(row.symbol);
          log({ ruleId: rule.id, ruleName: rule.name, symbol: what.symbol, action: 'placed', text: `${side === 'BUY' ? 'Bought' : 'Sold'} ${rule.size}${what.lot > 1 ? ` lot${rule.size > 1 ? 's' : ''}` : ''} ${what.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} because ${rule.scan.name} matched ${row.symbol}${stopPaise ? `; stop ₹${(stopPaise / 100).toFixed(2)}` : ''}${targetPaise ? `, target ₹${(targetPaise / 100).toFixed(2)}` : ''}` }, now);
        } catch (e) {
          skip(e instanceof LabError ? `Not placed: ${e.message}` : `Error: ${(e as Error).message}`);
        }
      }
    }
    if (changed) await save();
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------- results per rule

/**
 * Each rule's record: its own entries and their exits (bracket exits carry the rule; a 3 pm close, an expiry
 * settlement or a manual exit of that position is counted to the rule whose entry opened it).
 */
export async function ruleResults() {
  const [orders, trades] = await Promise.all([prismaRepo.orders(), prismaRepo.trades()]);
  const byOrder = new Map(orders.map((o) => [o.id, o]));
  const owner = new Map<string, string>(); // symbol|product -> rule id of the latest auto entry
  const perRule = new Map<string, typeof trades>();
  for (const t of [...trades].sort((a, b) => a.time - b.time)) {
    const o = byOrder.get(t.orderId);
    const key = `${t.symbol}|${t.product}`;
    let rule: string | undefined;
    if (o?.source.startsWith('AUTO:')) { rule = o.source.slice(5); if (!o.parentId) owner.set(key, rule); }
    else rule = owner.get(key);
    if (!rule) continue;
    (perRule.get(rule) ?? perRule.set(rule, []).get(rule)!).push(t);
  }
  const today = istDate(Math.floor(Date.now() / 1000));
  const out: Record<string, { trades: number; tradesToday: number; open: number; realisedPaise: number; unrealisedPaise: number; chargesPaise: number; netPaise: number }> = {};
  for (const [rule, ts] of perRule) {
    const l = buildLedger(ts, 0);
    let unrealised = 0;
    for (const p of l.positions) if (p.qty) { const i = kiteMarket.instrument(p.symbol); const ltp = i ? kiteMarket.quote(i)?.ltpPaise : undefined; if (ltp != null) unrealised += p.qty * ltp - p.openCostPaise; }
    const entries = ts.filter((t) => { const o = byOrder.get(t.orderId); return o?.source === `AUTO:${rule}` && !o.parentId; });
    out[rule] = {
      trades: entries.length, tradesToday: entries.filter((t) => t.tradeDate === today).length, open: l.positions.filter((p) => p.qty !== 0).length,
      realisedPaise: l.realisedPaise, unrealisedPaise: unrealised, chargesPaise: l.chargesPaise, netPaise: l.realisedPaise + unrealised - l.chargesPaise,
    };
  }
  return out;
}

// ---------------------------------------------------------------- baskets

export async function baskets() { return (await load()).baskets ?? []; }

export async function saveBasket(input: Partial<Basket>): Promise<Basket> {
  const d = await load();
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new AutoError('Give the basket a name');
  const items = (input.items ?? []).slice(0, 40).map((x): BasketItem => {
    if (!x.symbol || !['BUY', 'SELL'].includes(x.side) || !['MIS', 'NRML', 'CNC'].includes(x.product) || !['MARKET', 'LIMIT', 'SL', 'SLM'].includes(x.type) || !(x.qty > 0)) throw new AutoError('A basket order is incomplete');
    return { id: x.id || randomUUID(), symbol: String(x.symbol).toUpperCase(), label: String(x.label ?? x.symbol).slice(0, 60), side: x.side, product: x.product, type: x.type, qty: Math.round(x.qty), pricePaise: x.pricePaise ?? null, triggerPaise: x.triggerPaise ?? null };
  });
  const b: Basket = { id: input.id ?? randomUUID(), name, items, updatedAt: new Date().toISOString() };
  d.baskets = [...(d.baskets ?? []).filter((x) => x.id !== b.id), b];
  await save();
  return b;
}

export async function deleteBasket(id: string) {
  const d = await load();
  d.baskets = (d.baskets ?? []).filter((x) => x.id !== id);
  await save();
}

/** Places every order of a basket, in order, and reports each one (a rejected order does not stop the rest). */
export async function executeBasket(lab: TradeLab, id: string) {
  const b = (await baskets()).find((x) => x.id === id);
  if (!b) throw new AutoError('That basket no longer exists');
  if (!b.items.length) throw new AutoError('The basket is empty');
  const out: { id: string; label: string; ok: boolean; text: string }[] = [];
  for (const x of b.items) {
    try {
      const o = await lab.place({ symbol: x.symbol, side: x.side, product: x.product, type: x.type, qty: x.qty, pricePaise: x.pricePaise ?? undefined, triggerPaise: x.triggerPaise ?? undefined, source: `BASKET:${b.id}`, reason: `Basket ${b.name}` });
      out.push({ id: x.id, label: x.label, ok: true, text: o.status === 'COMPLETE' ? `filled at ₹${((o.avgFillPaise ?? 0) / 100).toFixed(2)}` : o.status === 'TRIGGER_PENDING' ? 'waiting for its trigger' : 'placed, waiting for its price' });
    } catch (e) {
      out.push({ id: x.id, label: x.label, ok: false, text: (e as Error).message });
    }
  }
  return { basket: b.name, results: out };
}
