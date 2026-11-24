// Trade lab weekend theta test (2026-11-24, user idea from "The Long and the Short" theta episode; research in
// apps/feed/scripts/research/theta/weekend.ts). Two parts:
//
// 1. The paper rule (off by default). Every Friday at the set time, sell one lot each of the NIFTY call and put
//    nearest 0.30 delta on the nearest weekly expiry ahead (the coming Tuesday), and buy the 0.05-delta call and put as
//    wings so a Monday gap has a floor. Overnight (NRML), held to expiry: the engine settles at intrinsic value.
//    Wings are bought first. No IV filter (the backtest had none). Skipped when the expiry is more than 5 days away.
//
// 2. The Monday price check (always on while Kite is connected, rule on or off). The backtest's "Friday close → Monday
//    open" used NSE's daily file, whose open is the first trade of the day; the weekend drop it showed (~4%) was far
//    below the video's (~13.5%). So live quotes are taken: the ATM straddle on Friday at 15:25 and 15:29, and on
//    Monday at 09:15, 09:16, 09:20, 09:30, 10:00, 12:00, 15:00 and 15:25, both at Friday's strike and at Monday's own
//    ATM strike (the video re-centres), with bid and ask. The report sets these against NSE's daily close and open.
//
// State in .userdata/tradelab-weekend.json (git-ignored).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { parityForward, yearsBetween } from '@mtv/options';
import { live } from '../intraday/instance';
import { istDate, istMinute, type TradeLab } from './engine';
import { kiteMarket, prismaRepo } from './live';
import { pickStrikes, sellPrice, type ChainQuote, type PremiumLeg } from './premium';
import { atmStrike } from './straddle920';
import { LabError } from './types';

export type WeekendRule = { id: string; name: string; enabled: boolean; time: string; delta: number; wings: boolean; wingDelta: number; lots: number; updatedAt: string };
export type WeekendLeg = PremiumLeg & { side: 'SELL' | 'BUY' };
export type WeekendEntry = { date: string; expiry: string; at: number; spotPaise: number; forwardPaise: number; legs: WeekendLeg[]; marks: { time: string; at: number; valuePaise: number | null }[] };
export type Quote1 = { ltpPaise: number; bidPaise: number; askPaise: number };
export type StraddleSnap = { time: string; at: number; spotPaise: number | null; strikePaise: number; ce: Quote1 | null; pe: Quote1 | null };
export type WeekendCheck = { friday: string; expiry: string; strikePaise: number; fri: StraddleSnap[]; monday: string | null; fixed: StraddleSnap[]; rolled: StraddleSnap[] };
export type WeekendEvent = { at: number; action: 'placed' | 'skipped' | 'error' | 'checked'; text: string };
type Doc = { rule: WeekendRule; events: WeekendEvent[]; entries: WeekendEntry[]; checks: WeekendCheck[] };

export const DEFAULT_WEEKEND_RULE: WeekendRule = { id: 'weekend-nifty', name: 'Weekend theta (Friday → Tuesday expiry)', enabled: false, time: '15:25', delta: 0.3, wings: true, wingDelta: 0.05, lots: 1, updatedAt: '' };
export const WEEKEND_SOURCE = 'WEEKEND:weekend-nifty';
export const FRI_TIMES = ['15:25', '15:29'];
export const MON_TIMES = ['09:15', '09:16', '09:20', '09:30', '10:00', '12:00', '15:00', '15:25'];
const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/tradelab-weekend.json');
const MAX_EVENTS = 2000, LATE_MIN = 3;
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const dayGap = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

let doc: Doc | null = null;
let writing: Promise<void> = Promise.resolve();
async function load(): Promise<Doc> {
  if (doc) return doc;
  doc = await readFile(FILE, 'utf8').then((t) => { const p = JSON.parse(t) as Partial<Doc>; return { events: [], entries: [], checks: [], ...p, rule: { ...DEFAULT_WEEKEND_RULE, ...p.rule } } as Doc; }, () => ({ rule: { ...DEFAULT_WEEKEND_RULE }, events: [], entries: [], checks: [] }));
  return doc;
}
function save() {
  const snapshot = JSON.stringify(doc, null, 1);
  writing = writing.then(async () => { await mkdir(path.dirname(FILE), { recursive: true }); await writeFile(`${FILE}.tmp`, snapshot); await rename(`${FILE}.tmp`, FILE); }).catch(() => undefined);
  return writing;
}
function log(action: WeekendEvent['action'], text: string, at = Math.floor(Date.now() / 1000)) {
  doc!.events.push({ at, action, text });
  if (doc!.events.length > MAX_EVENTS) doc!.events.splice(0, doc!.events.length - MAX_EVENTS);
}

export class WeekendError extends Error {}
export async function weekendEvents(limit = 200) { return (await load()).events.slice(-limit).reverse(); }

export async function saveWeekendRule(input: Partial<WeekendRule>): Promise<WeekendRule> {
  const d = await load();
  const r: WeekendRule = {
    ...d.rule, enabled: input.enabled ?? d.rule.enabled, time: String(input.time ?? d.rule.time), delta: Number(input.delta ?? d.rule.delta),
    wings: input.wings ?? d.rule.wings, wingDelta: Number(input.wingDelta ?? d.rule.wingDelta), lots: Math.round(Number(input.lots ?? d.rule.lots)), updatedAt: new Date().toISOString(),
  };
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(r.time) || hm(r.time) < 9 * 60 + 30 || hm(r.time) > 15 * 60 + 28) throw new WeekendError('Entry time must be between 09:30 and 15:28');
  if (!(r.delta >= 0.05 && r.delta <= 0.5)) throw new WeekendError('Delta must be between 0.05 and 0.50');
  if (r.wings && !(r.wingDelta >= 0.01 && r.wingDelta < r.delta)) throw new WeekendError('Wing delta must be above 0 and below the sold delta');
  if (!(r.lots >= 1 && r.lots <= 10)) throw new WeekendError('Lots must be 1 to 10');
  d.rule = r;
  await save();
  return r;
}

// ---------------------------------------------------------------- pure parts (tested)

/** The price a straddle is worth: the mid when both sides are quoted, else the last trade. */
export const midOf = (q: Quote1 | null) => (!q ? null : q.bidPaise > 0 && q.askPaise > 0 ? (q.bidPaise + q.askPaise) / 2 : q.ltpPaise > 0 ? q.ltpPaise : null);
export const straddleOf = (s: StraddleSnap | undefined) => { const c = midOf(s?.ce ?? null), p = midOf(s?.pe ?? null); return c == null || p == null ? null : c + p; };

/** Which snapshot time is due now (first one not yet taken whose minute has come, within LATE_MIN), or null. */
export function dueTime(times: string[], minute: number, taken: Set<string>): string | null {
  for (const t of times) if (!taken.has(t) && minute >= hm(t) && minute < hm(t) + LATE_MIN) return t;
  return null;
}

/** Friday's entry is due: a Friday, at or after the rule's time, not yet attempted today. */
export const entryDue = (rule: WeekendRule, today: string, minute: number, attempted: boolean) => rule.enabled && !attempted && weekdayOf(today) === 5 && minute >= hm(rule.time) && minute < 15 * 60 + 29;

/** The position's value (paise, + = we would pay to close) from mids: sold legs count +, bought legs −. */
export function positionValue(legs: { side: 'SELL' | 'BUY'; qty: number; q: Quote1 | null }[]): number | null {
  let v = 0;
  for (const l of legs) { const m = midOf(l.q); if (m == null) return null; v += (l.side === 'SELL' ? 1 : -1) * m * l.qty; }
  return Math.round(v);
}

// ---------------------------------------------------------------- the runner

const k0 = () => live.kite();
const nearestExpiry = (today: string) => {
  const k = k0();
  const all = k ? k.nfoContracts('NIFTY').filter((c) => c.kind !== 'FUT' && c.expiry > today) : [];
  const expiry = [...new Set(all.map((c) => c.expiry))].sort()[0] ?? null;
  return { all, expiry };
};
function band(today: string, spot: number, expiry: string, pct = 0.06) {
  const { all } = nearestExpiry(today);
  return all.filter((c) => c.expiry === expiry && Math.abs(c.strike * 100 - spot) <= spot * pct);
}
const quoteOf = (symbol: string): Quote1 | null => {
  const i = kiteMarket.instrument(symbol), q = i && kiteMarket.quote(i);
  return q && q.at > 0 ? { ltpPaise: q.ltpPaise, bidPaise: q.bidPaise, askPaise: q.askPaise } : null;
};
const symbolOf = (expiry: string, strikePaise: number, kind: 'CE' | 'PE', today: string) =>
  nearestExpiry(today).all.find((c) => c.expiry === expiry && c.strike * 100 === strikePaise && c.kind === kind)?.tradingsymbol ?? null;

let watchedOn: string | null = null;
function watchBand(today: string, expiry: string, spot: number) {
  const key = `${today}|${expiry}|${Math.round(spot / 5000)}`;
  if (watchedOn === key) return;
  watchedOn = key;
  kiteMarket.watch(band(today, spot, expiry).map((c) => kiteMarket.instrument(c.tradingsymbol)).filter((i): i is NonNullable<typeof i> => !!i));
}

function snap(time: string, now: number, today: string, expiry: string, strikePaise: number): StraddleSnap {
  const c = symbolOf(expiry, strikePaise, 'CE', today), p = symbolOf(expiry, strikePaise, 'PE', today);
  return { time, at: now, spotPaise: kiteMarket.underlyingPrice('NIFTY'), strikePaise, ce: c ? quoteOf(c) : null, pe: p ? quoteOf(p) : null };
}

/** Called every 15 seconds beside the other rules. */
export async function weekendTick(lab: TradeLab, now = Math.floor(Date.now() / 1000)) {
  const d = await load();
  const k = k0();
  if (!k) return;
  const today = istDate(now), min = istMinute(now), wd = weekdayOf(today);
  if (wd !== 5 && wd !== 1) return;
  const spot = kiteMarket.underlyingPrice('NIFTY');
  if (spot == null) return;

  // keep the strikes near the money streaming a few minutes ahead of each check
  const soon = (wd === 5 ? FRI_TIMES : MON_TIMES).some((t) => min >= hm(t) - 4 && min < hm(t) + LATE_MIN) || (wd === 5 && d.rule.enabled && min >= hm(d.rule.time) - 4 && min < 15 * 60 + 30);
  if (!soon) return;
  let changed = false;

  if (wd === 5) {
    const { expiry } = nearestExpiry(today);
    if (!expiry) return;
    watchBand(today, expiry, spot);
    // the price check
    let c = d.checks.find((x) => x.friday === today);
    const t = dueTime(FRI_TIMES, min, new Set(c?.fri.map((s) => s.time) ?? []));
    if (t && kiteMarket.isOpen(now)) {
      const strikes = band(today, spot, expiry).filter((x) => x.kind === 'CE').map((x) => x.strike * 100);
      const k1 = c?.strikePaise ?? atmStrike(strikes, spot);
      if (k1 != null) {
        if (!c) { c = { friday: today, expiry, strikePaise: k1, fri: [], monday: null, fixed: [], rolled: [] }; d.checks.push(c); }
        c.fri.push(snap(t, now, today, expiry, c.strikePaise));
        changed = true;
      }
    }
    // the paper rule
    const attempted = d.entries.some((e) => e.date === today) || d.events.some((e) => istDate(e.at) === today && e.action !== 'checked');
    if (entryDue(d.rule, today, min, attempted) && kiteMarket.isOpen(now)) { await enter(lab, d, now, today, expiry, spot); changed = true; }
  }

  if (wd === 1) {
    // the Friday before (3 days back) must have a check, its expiry still ahead or today
    const c = d.checks.find((x) => dayGap(x.friday, today) === 3 && x.expiry >= today);
    if (c && kiteMarket.isOpen(now)) {
      watchBand(today, c.expiry, spot);
      const t = dueTime(MON_TIMES, min, new Set(c.fixed.map((s) => s.time)));
      if (t) {
        c.monday = today;
        const strikes = band(today, spot, c.expiry).filter((x) => x.kind === 'CE').map((x) => x.strike * 100);
        const kr = atmStrike(strikes, spot);
        c.fixed.push(snap(t, now, today, c.expiry, c.strikePaise));
        if (kr != null) c.rolled.push(snap(t, now, today, c.expiry, kr));
        // the open position's value at the same time
        const e = d.entries.find((x) => dayGap(x.date, today) === 3 && x.expiry >= today);
        if (e && !e.marks.some((m) => m.time === t)) {
          const lot = kiteMarket.instrument(e.legs[0].symbol)?.lot ?? 0;
          e.marks.push({ time: t, at: now, valuePaise: lot ? positionValue(e.legs.filter((l) => l.fillPaise != null).map((l) => ({ side: l.side, qty: d.rule.lots * lot, q: quoteOf(l.symbol) }))) : null });
        }
        changed = true;
      }
    }
  }
  if (changed) await save();
}

let armedAt = 0, armedFor: string | null = null;
async function enter(lab: TradeLab, d: Doc, now: number, today: string, expiry: string, spot: number) {
  const rule = d.rule;
  if (dayGap(today, expiry) > 5) { log('skipped', `Nearest expiry ${expiry} is more than 5 days away (holiday week); no trade this weekend`, now); return; }
  if (armedFor !== today) { armedFor = today; armedAt = now; log('checked', `Friday ${rule.time}: watching NIFTY strikes of ${expiry}, placing on the next tick`, now); return; }
  if (now - armedAt < 20) return;
  const chain: ChainQuote[] = [];
  for (const c of band(today, spot, expiry, 0.1)) {
    const q = quoteOf(c.tradingsymbol);
    if (q) chain.push({ symbol: c.tradingsymbol, kind: c.kind as 'CE' | 'PE', strikePaise: c.strike * 100, ...q });
  }
  if (chain.length < 8) { if (now - armedAt < 240) return; log('error', `Only ${chain.length} live quotes for ${expiry}; no trade this weekend`, now); return; }
  const T = yearsBetween(today, expiry);
  const quotes = (kind: 'CE' | 'PE') => chain.filter((c) => c.kind === kind).map((c) => ({ strikePaise: c.strikePaise, pricePaise: sellPrice(c), traded: sellPrice(c) > 0 }));
  const forward = parityForward(quotes('CE'), quotes('PE'), spot, T) ?? spot;
  const body = pickStrikes(chain, forward, T, rule.delta);
  if (typeof body === 'string') { log('error', `${body}; no trade this weekend`, now); return; }
  const legs: WeekendLeg[] = [];
  if (rule.wings) {
    const w = pickStrikes(chain, forward, T, rule.wingDelta);
    if (typeof w === 'string' || w.CE.strikePaise <= body.CE.strikePaise || w.PE.strikePaise >= body.PE.strikePaise) { log('error', `No wing near ${rule.wingDelta} delta beyond the sold strikes; no trade this weekend`, now); return; }
    legs.push({ ...w.CE, side: 'BUY' }, { ...w.PE, side: 'BUY' });
  }
  legs.push({ ...body.CE, side: 'SELL' }, { ...body.PE, side: 'SELL' });
  const entry: WeekendEntry = { date: today, expiry, at: now, spotPaise: spot, forwardPaise: Math.round(forward), legs, marks: [] };
  for (const leg of legs) {
    const i = kiteMarket.instrument(leg.symbol);
    if (!i) { log('error', `${leg.symbol} is not tradable`, now); continue; }
    try {
      const o = await lab.place({ symbol: leg.symbol, side: leg.side, product: 'NRML', type: 'MARKET', qty: rule.lots * i.lot, source: WEEKEND_SOURCE, reason: `${rule.name}: Friday ${leg.side === 'BUY' ? 'wing' : 'sold'} ${leg.kind} ${leg.delta} delta, expiry ${expiry}` });
      leg.orderId = o.id; leg.fillPaise = o.avgFillPaise;
      log('placed', `${leg.side === 'BUY' ? 'Bought' : 'Sold'} ${rule.lots} lot${rule.lots > 1 ? 's' : ''} ${i.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} (bid ₹${(leg.bidPaise / 100).toFixed(2)}, ask ₹${(leg.askPaise / 100).toFixed(2)}, delta ${leg.delta})`, now);
    } catch (e) {
      log('error', e instanceof LabError ? `Not placed: ${e.message}` : `Error: ${(e as Error).message}`, now);
    }
  }
  d.entries.push(entry);
}

// ---------------------------------------------------------------- the report

export type WeekendReport = {
  rule: WeekendRule;
  entries: (WeekendEntry & { labels: (string | null)[]; settlePaise: (number | null)[]; creditPaise: number | null; netPaise: number | null; done: boolean })[];
  checks: (WeekendCheck & {
    /** Friday 15:29 straddle (mid), the reference for every Monday change. */ basePaise: number | null;
    nse: { friClosePaise: number | null; monOpenPaise: number | null; monClosePaise: number | null };
    rows: { time: string; fixedPaise: number | null; rolledPaise: number | null; fixedPct: number | null; rolledPct: number | null; spreadPaise: number | null }[];
  })[];
  /** Median % change from Friday 15:29 across weekends, per Monday time, plus NSE's daily open. */
  medians: { time: string; weekends: number; fixedPct: number | null; rolledPct: number | null }[];
  totals: { weekends: number; traded: number; netPaise: number };
  events: WeekendEvent[];
};

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (v: number | null, base: number | null) => (v == null || base == null || base <= 0 ? null : Math.round(((v - base) / base) * 1000) / 10);

export async function weekendReport(): Promise<WeekendReport> {
  const d = await load();
  const trades = await prismaRepo.trades(), orders = await prismaRepo.orders();
  const mine = new Set(orders.filter((o) => o.source === WEEKEND_SOURCE).map((o) => o.id));
  const todayIst = istDate(Math.floor(Date.now() / 1000));
  const entries: WeekendReport['entries'] = [];
  let total = 0;
  for (const e of d.entries) {
    const meta = e.expiry <= todayIst ? await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date: e.expiry, underlying: 'NIFTY' } }, select: { spotPaise: true } }) : null;
    let net: number | null = 0, done = true, credit: number | null = 0;
    for (const l of e.legs) {
      if (l.fillPaise == null) credit = null; else if (credit != null) credit += (l.side === 'SELL' ? 1 : -1) * l.fillPaise;
      const own = trades.filter((t) => t.symbol === l.symbol && (mine.has(t.orderId) || orders.some((o) => o.id === t.orderId && o.symbol === l.symbol && o.createdAt >= e.at)));
      const flat = own.length > 0 && own.reduce((a, t) => a + (t.side === 'SELL' ? -t.qty : t.qty), 0) === 0;
      const cash = own.reduce((a, t) => a + (t.side === 'SELL' ? 1 : -1) * t.qty * t.pricePaise - t.chargesPaise, 0);
      if (!flat) { done = false; net = null; } else if (net != null) net += cash;
    }
    if (net != null) total += net;
    entries.push({
      ...e, labels: e.legs.map((l) => kiteMarket.instrument(l.symbol)?.label ?? null),
      settlePaise: e.legs.map((l) => (meta?.spotPaise == null ? null : Math.max(0, l.kind === 'CE' ? meta.spotPaise - l.strikePaise : l.strikePaise - meta.spotPaise))),
      creditPaise: credit, netPaise: net, done,
    });
  }
  const checks: WeekendReport['checks'] = [];
  for (const c of d.checks) {
    const base = straddleOf(c.fri.find((s) => s.time === '15:29')) ?? straddleOf(c.fri.at(-1));
    const eod = async (date: string | null) => {
      if (!date) return null;
      const rows = await prisma.fnoEod.findMany({ where: { date, underlying: 'NIFTY', expiry: c.expiry, strikePaise: c.strikePaise, kind: { in: ['CE', 'PE'] } }, select: { openPaise: true, closePaise: true, traded: true } });
      return rows.length === 2 && rows.every((r) => r.traded) ? { open: rows[0].openPaise + rows[1].openPaise, close: rows[0].closePaise + rows[1].closePaise } : null;
    };
    const f = await eod(c.friday), m = await eod(c.monday);
    const rows = MON_TIMES.map((t) => {
      const fx = c.fixed.find((s) => s.time === t), rl = c.rolled.find((s) => s.time === t);
      const fixedPaise = straddleOf(fx), rolledPaise = straddleOf(rl);
      const spread = fx?.ce && fx?.pe && fx.ce.askPaise > 0 && fx.pe.askPaise > 0 ? fx.ce.askPaise - fx.ce.bidPaise + fx.pe.askPaise - fx.pe.bidPaise : null;
      return { time: t, fixedPaise, rolledPaise, fixedPct: pct(fixedPaise, base), rolledPct: pct(rolledPaise, base), spreadPaise: spread };
    });
    rows.unshift({ time: 'NSE open', fixedPaise: m?.open ?? null, rolledPaise: null, fixedPct: pct(m?.open ?? null, f?.close ?? null), rolledPct: null, spreadPaise: null });
    checks.push({ ...c, basePaise: base, nse: { friClosePaise: f?.close ?? null, monOpenPaise: m?.open ?? null, monClosePaise: m?.close ?? null }, rows });
  }
  const medians = ['NSE open', ...MON_TIMES].map((t) => {
    const r = checks.map((c) => c.rows.find((x) => x.time === t)).filter((x) => x && x.fixedPct != null);
    return { time: t, weekends: r.length, fixedPct: med(r.map((x) => x!.fixedPct!)), rolledPct: med(r.filter((x) => x!.rolledPct != null).map((x) => x!.rolledPct!)) };
  });
  return { rule: d.rule, entries: entries.reverse(), checks: checks.reverse(), medians, totals: { weekends: d.checks.length, traded: d.entries.length, netPaise: total }, events: await weekendEvents(200) };
}
