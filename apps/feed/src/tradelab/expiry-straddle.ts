// Trade lab "expiry-day straddle" forward paper test (docs/quant/05-intraday-selling.md, E-20261124-023/024).
// On NIFTY's expiry day only (the nearest expiry is today): at 09:30 IST sell 1 lot (or the set lots) each of the ATM
// call and put of today's expiry; each leg gets a stop-loss buy at `stopPct` (default 50%) above its own fill; whatever
// is open at 15:00 is bought back. The user's 09:30–15:00 window, so no window override.
// Beside it, on the same live quotes and without orders, the NO-STOP version: the same pair sold at the bid at entry and
// bought back at the ask at 15:00, with charges. The history study found 0 DTE no-stop and 50%-stop close; this
// compares them forward on real fills.
// Entries are NRML so the lab's 15:00 intraday square-off leaves them to this rule. If the app was off at 15:00, the
// lab settles the legs at expiry (15:30): that day is marked "not clean" and left out of the results.
// Rule, log and entries: .userdata/tradelab-expiry-straddle.json (git-ignored).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { computeOptionCharges } from '@mtv/paper';
import { live } from '../intraday/instance';
import { istDate, istMinute, type TradeLab } from './engine';
import { kiteMarket, prismaRepo } from './live';
import { atmStrike, stopFor } from './straddle920';
import { LabError } from './types';

export type ExpRule = { id: string; name: string; enabled: boolean; underlying: 'NIFTY'; entry: string; exit: string; stopPct: number; lots: number; updatedAt: string };
export type ExpLeg = { symbol: string; label: string; kind: 'CE' | 'PE'; qty: number; bidPaise: number; askPaise: number; orderId: string | null; fillPaise: number | null; stopPaise: number | null; stopOrderId: string | null };
/** The no-stop version on the same quotes: sold at the entry bid, bought back at the exit ask. */
export type ExpNoStop = { legs: { symbol: string; label: string; qty: number; sellPaise: number; buyPaise: number | null }[]; chargesPaise: number; netPaise: number | null };
export type ExpEntry = { date: string; expiry: string; at: number; spotPaise: number; strikePaise: number; legs: ExpLeg[]; closedAt: number | null; clean: boolean; note: string | null; noStop: ExpNoStop | null };
export type ExpEvent = { at: number; action: 'placed' | 'skipped' | 'error' | 'closed'; text: string };
type Doc = { rule: ExpRule; events: ExpEvent[]; entries: ExpEntry[] };

export const DEFAULT_EXP_RULE: ExpRule = { id: 'expiry-straddle', name: 'Expiry-day straddle', enabled: false, underlying: 'NIFTY', entry: '09:30', exit: '15:00', stopPct: 50, lots: 1, updatedAt: '' };
export const EXP_SOURCE = 'EXP:expiry-straddle';
const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/tradelab-expiry-straddle.json');
const MAX_EVENTS = 2000;
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const bidOf = (q: { bidPaise: number; ltpPaise: number }) => (q.bidPaise > 0 ? q.bidPaise : q.ltpPaise);
const askOf = (q: { askPaise: number; ltpPaise: number }) => (q.askPaise > 0 ? q.askPaise : q.ltpPaise);

/** Net of the no-stop version once both legs are bought back (null while any is open). */
export function noStopNet(n: ExpNoStop): number | null {
  if (n.legs.some((l) => l.buyPaise == null)) return null;
  return n.legs.reduce((a, l) => a + (l.sellPaise - l.buyPaise!) * l.qty, 0) - n.chargesPaise;
}

let doc: Doc | null = null;
let writing: Promise<void> = Promise.resolve();
async function load(): Promise<Doc> {
  if (doc) return doc;
  doc = await readFile(FILE, 'utf8').then((t) => { const j = JSON.parse(t) as Partial<Doc>; return { events: [], entries: [], ...j, rule: { ...DEFAULT_EXP_RULE, ...j.rule } } as Doc; }, () => ({ rule: { ...DEFAULT_EXP_RULE }, events: [], entries: [] }));
  return doc;
}
function save() {
  const snapshot = JSON.stringify(doc, null, 1);
  writing = writing.then(async () => { await mkdir(path.dirname(FILE), { recursive: true }); await writeFile(`${FILE}.tmp`, snapshot); await rename(`${FILE}.tmp`, FILE); }).catch(() => undefined);
  return writing;
}
function log(action: ExpEvent['action'], text: string, at = Math.floor(Date.now() / 1000)) {
  doc!.events.push({ at, action, text });
  if (doc!.events.length > MAX_EVENTS) doc!.events.splice(0, doc!.events.length - MAX_EVENTS);
}

export class ExpError extends Error {}
export async function expEvents(limit = 200) { return (await load()).events.slice(-limit).reverse(); }
export async function saveExpRule(input: Partial<ExpRule>): Promise<ExpRule> {
  const d = await load();
  const r: ExpRule = { ...d.rule, enabled: input.enabled ?? d.rule.enabled, stopPct: Number(input.stopPct ?? d.rule.stopPct), lots: Math.round(Number(input.lots ?? d.rule.lots)), updatedAt: new Date().toISOString() };
  if (!(r.stopPct >= 10 && r.stopPct <= 200)) throw new ExpError('Stop must be 10% to 200%');
  if (!(r.lots >= 1 && r.lots <= 10)) throw new ExpError('Lots must be 1 to 10');
  d.rule = r;
  await save();
  return r;
}

// ---------------------------------------------------------------- the runner

let armedOn: string | null = null, armedAt = 0;
const ARM_WAIT_SEC = 20, LATE_MIN = 10;

/** Called every 15 seconds beside the other rules. */
export async function expTick(lab: TradeLab, now = Math.floor(Date.now() / 1000)) {
  const d = await load();
  const rule = d.rule;
  if (!kiteMarket.isOpen(now)) return;
  const today = istDate(now), min = istMinute(now);

  // 1. Exit at 15:00: buy back the paper legs and price the no-stop version. A day missed (app off) is settled by
  //    the lab at expiry and left out.
  for (const e of d.entries.filter((x) => x.closedAt == null)) {
    if (e.date === today && min < hm(rule.exit)) continue;
    if (e.date !== today) { e.closedAt = now; e.clean = false; e.note = `The app was not running at ${rule.exit} on ${e.date}: the legs were settled at expiry. Left out of the results.`; await save(); continue; }
    for (const l of e.legs) {
      if (!l.fillPaise) continue;
      try {
        const o = await lab.exit(l.symbol, 'NRML', EXP_SOURCE, `${rule.name}: ${rule.exit} exit`);
        if (o) log('closed', `Bought back ${l.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} (${rule.exit} exit)`, now);
      } catch (err) { log('error', `Could not close ${l.label}: ${(err as Error).message}`, now); }
    }
    if (e.noStop) {
      for (const l of e.noStop.legs.filter((x) => x.buyPaise == null)) {
        const i = kiteMarket.instrument(l.symbol), q = i && kiteMarket.quote(i);
        if (!q) continue;
        l.buyPaise = askOf(q);
        e.noStop.chargesPaise += computeOptionCharges({ side: 'BUY', qty: l.qty, premiumPaise: l.buyPaise, date: today }).total;
      }
      e.noStop.netPaise = noStopNet(e.noStop);
      if (e.noStop.netPaise == null) continue; // a quote was missing: try again on the next tick
    }
    e.closedAt = now;
    if (min > hm(rule.exit) + 5) { e.clean = false; e.note = `Bought back late (${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}): the app was not running at ${rule.exit}. Left out of the results.`; }
    await save();
  }

  // 2. Entry: expiry day only.
  if (!rule.enabled) return;
  const attempted = d.entries.some((e) => e.date === today) || d.events.some((e) => istDate(e.at) === today);
  if (attempted || min < hm(rule.entry) - 1) return;
  const k = live.kite();
  if (!k) return; // nothing to say on most days; a Kite problem on an expiry day shows in the 9:20 test's log too
  const all = k.nfoContracts(rule.underlying).filter((c) => c.kind !== 'FUT' && c.expiry >= today);
  const expiry = [...new Set(all.map((c) => c.expiry))].sort()[0];
  if (expiry !== today) return; // not an expiry day
  if (min > hm(rule.entry) + LATE_MIN) { log('skipped', `Expiry day, but the app was not ready by ${rule.entry} (+${LATE_MIN} min); no trade today`, now); await save(); return; }
  const spot = kiteMarket.underlyingPrice(rule.underlying);
  if (spot == null) return; // wait for a price until the late limit
  const chain = all.filter((c) => c.expiry === expiry);
  const atm = atmStrike([...new Set(chain.map((c) => c.strike * 100))], spot);
  if (atm == null) { log('error', `No strikes for ${expiry}`, now); await save(); return; }
  const inst = (['CE', 'PE'] as const).map((kind) => { const c = chain.find((x) => x.kind === kind && x.strike * 100 === atm); return c ? kiteMarket.instrument(c.tradingsymbol) : null; });
  if (inst.some((i) => !i)) { log('error', `ATM ${atm / 100} call or put is not tradable`, now); await save(); return; }
  if (armedOn !== today) { armedOn = today; armedAt = now; kiteMarket.watch(inst as NonNullable<(typeof inst)[number]>[]); return; }
  if (min < hm(rule.entry) || now - armedAt < ARM_WAIT_SEC) return;

  const entry: ExpEntry = { date: today, expiry, at: now, spotPaise: spot, strikePaise: atm, legs: [], closedAt: null, clean: true, note: null, noStop: { legs: [], chargesPaise: 0, netPaise: null } };
  for (const i of inst as NonNullable<(typeof inst)[number]>[]) {
    const q = kiteMarket.quote(i), qty = rule.lots * i.lot;
    const leg: ExpLeg = { symbol: i.symbol, label: i.label, kind: i.kind as 'CE' | 'PE', qty, bidPaise: q?.bidPaise ?? 0, askPaise: q?.askPaise ?? 0, orderId: null, fillPaise: null, stopPaise: null, stopOrderId: null };
    entry.legs.push(leg);
    if (q && bidOf(q) > 0) {
      entry.noStop!.legs.push({ symbol: i.symbol, label: i.label, qty, sellPaise: bidOf(q), buyPaise: null });
      entry.noStop!.chargesPaise += computeOptionCharges({ side: 'SELL', qty, premiumPaise: bidOf(q), date: today }).total;
    }
    try {
      const o = await lab.place({ symbol: i.symbol, side: 'SELL', product: 'NRML', type: 'MARKET', qty, source: EXP_SOURCE, reason: `${rule.name}: ${rule.entry} entry, ATM ${atm / 100} ${leg.kind}, expiring today` });
      leg.orderId = o.id; leg.fillPaise = o.avgFillPaise;
      log('placed', `Sold ${rule.lots} lot${rule.lots > 1 ? 's' : ''} ${i.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} (bid ₹${(leg.bidPaise / 100).toFixed(2)}, ask ₹${(leg.askPaise / 100).toFixed(2)}; NIFTY ${(spot / 100).toFixed(2)})`, now);
      if (o.avgFillPaise) {
        leg.stopPaise = stopFor(o.avgFillPaise, rule.stopPct);
        try {
          const s = await lab.place({ symbol: i.symbol, side: 'BUY', product: 'NRML', type: 'SLM', qty, triggerPaise: leg.stopPaise, source: EXP_SOURCE, reason: `${rule.name}: ${rule.stopPct}% stop on ${leg.kind}` });
          leg.stopOrderId = s.id;
        } catch (err) {
          log('error', `Stop at ₹${(leg.stopPaise / 100).toFixed(2)} not placed (${(err as Error).message}); buying back now`, now);
          await lab.exit(i.symbol, 'NRML', EXP_SOURCE, `${rule.name}: stop hit at entry`).catch(() => undefined);
        }
      }
    } catch (err) {
      log('error', err instanceof LabError ? `Not placed: ${err.message}` : `Error: ${(err as Error).message}`, now);
    }
  }
  if (!entry.legs.some((l) => l.fillPaise)) { entry.closedAt = now; entry.clean = false; entry.note = 'Nothing filled'; }
  if (entry.noStop!.legs.length < 2) entry.noStop = null;
  d.entries.push(entry);
  await save();
}

// ---------------------------------------------------------------- the report

export type ExpReport = {
  rule: ExpRule;
  days: (Omit<ExpEntry, 'legs'> & { legs: (ExpLeg & { exitPaise: number | null; how: 'stop' | 'time' | 'open' | null })[]; netPaise: number | null; chargesPaise: number })[];
  totals: { days: number; clean: number; won: number; netPaise: number; worstPaise: number; chargesPaise: number; stopsHit: number };
  noStop: { days: number; won: number; netPaise: number; worstPaise: number };
};

export async function expReport(): Promise<ExpReport> {
  const d = await load();
  const orders = (await prismaRepo.orders()).filter((o) => o.source === EXP_SOURCE);
  const ids = new Set(orders.map((o) => o.id));
  const trades = (await prismaRepo.trades()).filter((t) => ids.has(t.orderId));
  const days: ExpReport['days'] = d.entries.map((e) => {
    let net = 0, charges = 0, done = e.closedAt != null;
    const legs = e.legs.map((l) => {
      const mine = trades.filter((t) => t.symbol === l.symbol && t.time >= e.at - 5 && (e.closedAt == null || t.time <= e.closedAt + 120));
      const sold = mine.filter((t) => t.side === 'SELL').reduce((a, t) => a + t.qty, 0), bought = mine.filter((t) => t.side === 'BUY').reduce((a, t) => a + t.qty, 0);
      const buy = mine.find((t) => t.side === 'BUY');
      const how = !l.fillPaise ? null : sold > bought ? 'open' : buy && l.stopOrderId && buy.orderId === l.stopOrderId ? 'stop' : 'time';
      if (how === 'open') done = false;
      net += mine.reduce((a, t) => a + (t.side === 'SELL' ? 1 : -1) * t.qty * t.pricePaise - t.chargesPaise, 0);
      charges += mine.reduce((a, t) => a + t.chargesPaise, 0);
      return { ...l, exitPaise: buy?.pricePaise ?? null, how: how as 'stop' | 'time' | 'open' | null };
    });
    return { ...e, legs, netPaise: done ? net : null, chargesPaise: charges };
  });
  const clean = days.filter((x) => x.clean && x.netPaise != null);
  const ns = clean.filter((x) => x.noStop?.netPaise != null).map((x) => x.noStop!.netPaise!);
  return {
    rule: d.rule, days: days.reverse(),
    totals: { days: days.length, clean: clean.length, won: clean.filter((x) => x.netPaise! > 0).length, netPaise: clean.reduce((a, x) => a + x.netPaise!, 0), worstPaise: Math.min(0, ...clean.map((x) => x.netPaise!)), chargesPaise: clean.reduce((a, x) => a + x.chargesPaise, 0), stopsHit: clean.flatMap((x) => x.legs).filter((l) => l.how === 'stop').length },
    noStop: { days: ns.length, won: ns.filter((n) => n > 0).length, netPaise: ns.reduce((a, n) => a + n, 0), worstPaise: Math.min(0, ...ns) },
  };
}
