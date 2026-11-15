// Trade lab weekly premium rule: the paper trade behind the research lead (docs/quant/02-results-phase5-11.md, A3b / P12).
// Every Monday at the set time, if NIFTY's ATM IV is above its one-year median (the last end-of-day reading), sell one
// lot each of the call and put nearest 0.16 delta on the next weekly expiry (never today's), overnight (NRML), and hold
// to expiry: the engine settles at intrinsic value. Its purpose is to MEASURE live fills against NSE's close of the same
// day, which the backtests assumed cost ₹1 an option. Every decision is logged with its reason. One attempt a week.
// Rule, log and entries live in .userdata/tradelab-premium.json (git-ignored).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { deltaOf, ivAboveMedian, parityForward, yearsBetween, type IvPoint } from '@mtv/options';
import { live } from '../intraday/instance';
import { ivHistory } from '../selling/books';
import { istDate, istMinute, type TradeLab } from './engine';
import { kiteMarket, prismaRepo } from './live';
import { LabError } from './types';

export type PremiumRule = {
  id: string; name: string; enabled: boolean;
  underlying: 'NIFTY';
  /** 1 = Monday … 5 = Friday (IST). */
  weekday: number;
  /** Entry time, IST HH:MM. The backtests entered at the 15:30 close; 15:25 is the nearest a market order can get. */
  time: string;
  delta: number; lots: number;
  iv: 'high' | 'any';
  updatedAt: string;
};
export type PremiumLeg = { symbol: string; kind: 'CE' | 'PE'; strikePaise: number; delta: number; bidPaise: number; askPaise: number; ltpPaise: number; orderId: string | null; fillPaise: number | null };
export type PremiumEntry = { date: string; expiry: string; at: number; ivHigh: boolean | null; ivAsOf: string | null; spotPaise: number; forwardPaise: number; legs: PremiumLeg[] };
export type PremiumEvent = { at: number; action: 'placed' | 'skipped' | 'error' | 'checked'; text: string };
type Doc = { rule: PremiumRule; events: PremiumEvent[]; entries: PremiumEntry[] };

export const DEFAULT_PREMIUM_RULE: PremiumRule = { id: 'weekly-nifty', name: 'Weekly NIFTY premium (research lead)', enabled: false, underlying: 'NIFTY', weekday: 1, time: '15:25', delta: 0.16, lots: 1, iv: 'high', updatedAt: '' };
export const PREMIUM_SOURCE = 'PREMIUM:weekly-nifty';
const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/tradelab-premium.json');
const MAX_EVENTS = 2000;
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

let doc: Doc | null = null;
let writing: Promise<void> = Promise.resolve();
async function load(): Promise<Doc> {
  if (doc) return doc;
  doc = await readFile(FILE, 'utf8').then((t) => ({ rule: { ...DEFAULT_PREMIUM_RULE, ...(JSON.parse(t) as Partial<Doc>).rule }, events: [], entries: [], ...(JSON.parse(t) as Partial<Doc>) }) as Doc, () => ({ rule: { ...DEFAULT_PREMIUM_RULE }, events: [], entries: [] }));
  return doc;
}
function save() {
  const snapshot = JSON.stringify(doc, null, 1);
  writing = writing.then(async () => { await mkdir(path.dirname(FILE), { recursive: true }); await writeFile(`${FILE}.tmp`, snapshot); await rename(`${FILE}.tmp`, FILE); }).catch(() => undefined);
  return writing;
}
function log(action: PremiumEvent['action'], text: string, at = Math.floor(Date.now() / 1000)) {
  doc!.events.push({ at, action, text });
  if (doc!.events.length > MAX_EVENTS) doc!.events.splice(0, doc!.events.length - MAX_EVENTS);
}

export class PremiumError extends Error {}

export async function premiumRule() { return (await load()).rule; }
export async function premiumEvents(limit = 200) { return (await load()).events.slice(-limit).reverse(); }

export async function savePremiumRule(input: Partial<PremiumRule>): Promise<PremiumRule> {
  const d = await load();
  const r: PremiumRule = { ...d.rule, enabled: input.enabled ?? d.rule.enabled, weekday: Number(input.weekday ?? d.rule.weekday), time: String(input.time ?? d.rule.time), delta: Number(input.delta ?? d.rule.delta), lots: Math.round(Number(input.lots ?? d.rule.lots)), iv: input.iv === 'any' ? 'any' : input.iv === 'high' ? 'high' : d.rule.iv, updatedAt: new Date().toISOString() };
  if (!(r.weekday >= 1 && r.weekday <= 5)) throw new PremiumError('Pick a weekday, Monday to Friday');
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(r.time) || hm(r.time) < 9 * 60 + 30 || hm(r.time) > 15 * 60 + 28) throw new PremiumError('Entry time must be between 09:30 and 15:28');
  if (!(r.delta >= 0.05 && r.delta <= 0.45)) throw new PremiumError('Delta must be between 0.05 and 0.45');
  if (!(r.lots >= 1 && r.lots <= 10)) throw new PremiumError('Lots must be 1 to 10');
  d.rule = r;
  await save();
  return r;
}

// ---------------------------------------------------------------- pure parts (tested)

export type ChainQuote = { symbol: string; kind: 'CE' | 'PE'; strikePaise: number; bidPaise: number; askPaise: number; ltpPaise: number };

/** The price a seller is quoted: the bid, or the last trade when the book is empty. */
export const sellPrice = (q: { bidPaise: number; ltpPaise: number }) => (q.bidPaise > 0 ? q.bidPaise : q.ltpPaise);

/**
 * The call and the put nearest `delta`, out of the money against the forward, from live quotes (the way the lab picked
 * them from closes). Returns the two legs or why it could not.
 */
export function pickStrikes(chain: ChainQuote[], forwardPaise: number, T: number, delta: number): { CE: PremiumLeg; PE: PremiumLeg } | string {
  if (!(T > 0)) return 'The expiry is not ahead';
  const out: Partial<Record<'CE' | 'PE', PremiumLeg>> = {};
  for (const kind of ['CE', 'PE'] as const) {
    const sgn = kind === 'CE' ? 1 : -1;
    let best: PremiumLeg | null = null, gap = Infinity;
    for (const q of chain) {
      if (q.kind !== kind || sgn * (q.strikePaise - forwardPaise) <= 0) continue;
      const px = sellPrice(q);
      if (!(px > 0)) continue;
      const d = deltaOf(kind, px, forwardPaise, q.strikePaise, T);
      if (d == null) continue;
      const g = Math.abs(Math.abs(d) - delta);
      if (g < gap) { gap = g; best = { symbol: q.symbol, kind, strikePaise: q.strikePaise, delta: Math.round(Math.abs(d) * 1000) / 1000, bidPaise: q.bidPaise, askPaise: q.askPaise, ltpPaise: q.ltpPaise, orderId: null, fillPaise: null }; }
    }
    if (!best) return `No quoted ${kind} out of the money`;
    if (gap > 0.08) return `No ${kind} near ${delta} delta (nearest ${best.delta})`;
    out[kind] = best;
  }
  return out as { CE: PremiumLeg; PE: PremiumLeg };
}

/** Is the entry due now: the rule's weekday, at or after its time, not yet attempted today. */
export function entryDue(rule: PremiumRule, today: string, minute: number, attemptedToday: boolean): boolean {
  return rule.enabled && !attemptedToday && weekdayOf(today) === rule.weekday && minute >= hm(rule.time);
}

/** High-IV decision from the end-of-day ATM IV history: the latest reading against the median of the year before it. */
export function ivDecision(history: IvPoint[]): { high: boolean | null; asOf: string | null } {
  const last = history.at(-1);
  if (!last) return { high: null, asOf: null };
  return { high: ivAboveMedian(history, last.date), asOf: last.date };
}

// ---------------------------------------------------------------- the runner

let armedOn: string | null = null, armedAt = 0;
const ARM_WAIT_SEC = 20, GIVE_UP_SEC = 240;

/** Called every 15 seconds beside the automatic rules. */
export async function premiumTick(lab: TradeLab, now = Math.floor(Date.now() / 1000)) {
  const d = await load();
  const rule = d.rule;
  if (!rule.enabled || !kiteMarket.isOpen(now)) return;
  const today = istDate(now), min = istMinute(now);
  const attempted = d.entries.some((e) => e.date === today) || d.events.some((e) => istDate(e.at) === today && e.action !== 'checked');
  if (!entryDue(rule, today, min, attempted)) return;
  const k = live.kite();
  if (!k) { log('error', 'Kite is not connected', now); await save(); return; }

  // the next weekly expiry, never today's
  const all = k.nfoContracts(rule.underlying).filter((c) => c.kind !== 'FUT' && c.expiry > today);
  const expiry = [...new Set(all.map((c) => c.expiry))].sort()[0];
  if (!expiry) { log('skipped', 'No NIFTY option expiry ahead', now); await save(); return; }
  const spot = kiteMarket.underlyingPrice(rule.underlying);
  if (spot == null) { log('error', 'No live NIFTY price', now); await save(); return; }

  // first pass: make sure the strikes near the money are streaming, then come back on the next tick
  const band = all.filter((c) => c.expiry === expiry && Math.abs(c.strike * 100 - spot) <= spot * 0.06);
  const instruments = band.map((c) => kiteMarket.instrument(c.tradingsymbol)).filter((i): i is NonNullable<typeof i> => !!i);
  if (armedOn !== today) {
    armedOn = today; armedAt = now;
    kiteMarket.watch(instruments);
    log('checked', `${WD[weekdayOf(today)]} ${rule.time}: watching ${instruments.length} ${rule.underlying} strikes of ${expiry}, placing on the next tick`, now);
    await save();
    return;
  }
  if (now - armedAt < ARM_WAIT_SEC) return;

  const chain: ChainQuote[] = [];
  for (const c of band) {
    const i = kiteMarket.instrument(c.tradingsymbol), q = i && kiteMarket.quote(i);
    if (i && q && q.at >= armedAt - 60) chain.push({ symbol: c.tradingsymbol, kind: c.kind as 'CE' | 'PE', strikePaise: c.strike * 100, bidPaise: q.bidPaise, askPaise: q.askPaise, ltpPaise: q.ltpPaise });
  }
  if (chain.length < 6) {
    if (now - armedAt < GIVE_UP_SEC) return;
    log('error', `Only ${chain.length} live quotes for ${expiry} after ${GIVE_UP_SEC} s; no trade this week`, now); await save(); return;
  }
  const T = yearsBetween(today, expiry);
  const quotes = (kind: 'CE' | 'PE') => chain.filter((c) => c.kind === kind).map((c) => ({ strikePaise: c.strikePaise, pricePaise: sellPrice(c), traded: sellPrice(c) > 0 }));
  const forward = parityForward(quotes('CE'), quotes('PE'), spot, T) ?? spot;
  const iv = ivDecision(await ivHistory(rule.underlying));
  if (rule.iv === 'high' && iv.high !== true) {
    log('skipped', `IV not high (ATM IV as of ${iv.asOf ?? 'unknown'} is ${iv.high === false ? 'at or below' : 'unknown against'} its one-year median); no trade this week`, now);
    await save(); return;
  }
  const picked = pickStrikes(chain, forward, T, rule.delta);
  if (typeof picked === 'string') { log('error', `${picked}; no trade this week`, now); await save(); return; }

  const entry: PremiumEntry = { date: today, expiry, at: now, ivHigh: iv.high, ivAsOf: iv.asOf, spotPaise: spot, forwardPaise: Math.round(forward), legs: [picked.CE, picked.PE] };
  for (const leg of entry.legs) {
    const i = kiteMarket.instrument(leg.symbol);
    if (!i) { log('error', `${leg.symbol} is not tradable`, now); continue; }
    try {
      const o = await lab.place({ symbol: leg.symbol, side: 'SELL', product: 'NRML', type: 'MARKET', qty: rule.lots * i.lot, source: PREMIUM_SOURCE, reason: `${rule.name}: ${WD[weekdayOf(today)]} entry, ${leg.kind} ${leg.delta} delta, expiry ${expiry}${iv.high == null ? '' : `, IV ${iv.high ? 'high' : 'normal'}`}` });
      leg.orderId = o.id; leg.fillPaise = o.avgFillPaise;
      log('placed', `Sold ${rule.lots} lot${rule.lots > 1 ? 's' : ''} ${i.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} (bid ₹${(leg.bidPaise / 100).toFixed(2)}, ask ₹${(leg.askPaise / 100).toFixed(2)}, delta ${leg.delta})`, now);
    } catch (e) {
      log('error', e instanceof LabError ? `Not placed: ${e.message}` : `Error: ${(e as Error).message}`, now);
    }
  }
  d.entries.push(entry);
  await save();
}

// ---------------------------------------------------------------- the report: fills against NSE's close

export type PremiumReport = {
  rule: PremiumRule;
  entries: (PremiumEntry & { legs: (PremiumLeg & { closePaise: number | null; slipPaise: number | null; settlePaise: number | null })[]; netPaise: number | null; done: boolean })[];
  /** Across every filled leg with a close: how much worse than the close a seller was filled, ₹ per option (positive = worse). */
  slippage: { legs: number; avgPaise: number | null; worstPaise: number | null; medianPaise: number | null };
  totals: { weeks: number; traded: number; skippedIv: number; realisedPaise: number; chargesPaise: number };
};

export async function premiumReport(): Promise<PremiumReport> {
  const d = await load();
  const trades = (await prismaRepo.trades());
  const orders = await prismaRepo.orders();
  const mine = new Set(orders.filter((o) => o.source === PREMIUM_SOURCE).map((o) => o.id));
  const entries: PremiumReport['entries'] = [];
  const slips: number[] = [];
  let realised = 0, charges = 0;
  for (const e of d.entries) {
    const legs = [];
    let net: number | null = 0, done = true;
    for (const l of e.legs) {
      const i = kiteMarket.instrument(l.symbol);
      const row = await prisma.fnoEod.findFirst({ where: { date: e.date, underlying: 'NIFTY', expiry: e.expiry, kind: l.kind, strikePaise: l.strikePaise }, select: { closePaise: true, traded: true } });
      const closePaise = row?.traded ? row.closePaise : null;
      const slipPaise = closePaise != null && l.fillPaise != null ? closePaise - l.fillPaise : null;
      if (slipPaise != null) slips.push(slipPaise);
      const meta = e.expiry <= istDate(Math.floor(Date.now() / 1000)) ? await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date: e.expiry, underlying: 'NIFTY' } }, select: { spotPaise: true } }) : null;
      const settlePaise = meta?.spotPaise != null ? Math.max(0, l.kind === 'CE' ? meta.spotPaise - l.strikePaise : l.strikePaise - meta.spotPaise) : null;
      // realised from the lab's own trades of this contract (entry sell and its settlement or exit)
      const own = trades.filter((t) => t.symbol === l.symbol && (mine.has(t.orderId) || orders.some((o) => o.id === t.orderId && o.symbol === l.symbol && o.createdAt >= e.at)));
      const cash = own.reduce((a, t) => a + (t.side === 'SELL' ? 1 : -1) * t.qty * t.pricePaise - t.chargesPaise, 0);
      const flat = own.reduce((a, t) => a + (t.side === 'SELL' ? -t.qty : t.qty), 0) === 0 && own.length > 0;
      if (!flat) { done = false; net = null; } else if (net != null) net += cash;
      if (flat) { realised += cash; charges += own.reduce((a, t) => a + t.chargesPaise, 0); }
      legs.push({ ...l, closePaise, slipPaise, settlePaise, label: i?.label });
    }
    entries.push({ ...e, legs, netPaise: net, done });
  }
  const sorted = [...slips].sort((a, b) => a - b);
  const skippedIv = d.events.filter((x) => x.action === 'skipped' && x.text.startsWith('IV not high')).length;
  return {
    rule: d.rule, entries: entries.reverse(),
    slippage: { legs: slips.length, avgPaise: slips.length ? Math.round(slips.reduce((a, b) => a + b, 0) / slips.length) : null, worstPaise: slips.length ? Math.max(...slips) : null, medianPaise: slips.length ? sorted[Math.floor(sorted.length / 2)] : null },
    totals: { weeks: d.entries.length + skippedIv, traded: d.entries.length, skippedIv, realisedPaise: realised, chargesPaise: charges },
  };
}
