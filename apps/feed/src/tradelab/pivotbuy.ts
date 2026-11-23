// Trade lab "option pivot buy" forward paper test (the user's own rule, 2026-11-24; engine in pivot-core.ts).
// Every trading day from 09:29: the NIFTY strike nearest the index on the nearest expiry (expiry day included), its call
// and its put each on their own. Levels: Traditional daily pivots from each contract's previous-day high / low / close
// (NSE bhavcopy). Two versions run side by side on the same live ticks: "fixed" (+15 / -20 points) and "ladder" (stop
// one pivot level below, trailing up level by level). Simulated fills (buy at the ask, sell at the bid) with charges;
// no Trade lab orders, so the two versions do not net against each other in one account. Out by 15:00.
// A day the app was off at the exit time is closed at its last seen price and left out of the results.
// Rule, days and log: .userdata/tradelab-pivotbuy.json (git-ignored).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { live } from '../intraday/instance';
import { istDate, istMinute } from './engine';
import { kiteMarket } from './live';
import { atmStrike } from './straddle920';
import { forceClose, newSim, pivotLevels, stepSim, type Level, type PivotCfg, type PivotTrade, type SimState, type Version } from './pivot-core';

export type PivotRule = { id: string; name: string; enabled: boolean; lots: number; targetPts: number; stopPts: number; maxTrades: number; entryFrom: string; entryTo: string; exit: string; updatedAt: string };
export type PivotLeg = {
  kind: 'CE' | 'PE'; symbol: string; label: string; token: number; lot: number;
  prev: { date: string; highPaise: number; lowPaise: number; closePaise: number };
  levels: Level[]; sims: Record<Version, SimState>; lastPaise: number | null; lastAt: number | null;
};
export type PivotDay = { date: string; expiry: string; at: number; spotPaise: number; strikePaise: number; legs: PivotLeg[]; closedAt: number | null; clean: boolean; note: string | null };
export type PivotEvent = { at: number; action: 'bought' | 'sold' | 'skipped' | 'error' | 'started'; text: string };
type Doc = { rule: PivotRule; events: PivotEvent[]; days: PivotDay[] };

export const DEFAULT_PIVOT_RULE: PivotRule = { id: 'option-pivot', name: 'Option pivot buy', enabled: false, lots: 1, targetPts: 15, stopPts: 20, maxTrades: 3, entryFrom: '09:30', entryTo: '15:00', exit: '15:00', updatedAt: '' };
const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/tradelab-pivotbuy.json');
const MAX_EVENTS = 3000, LAST_START = '14:30';
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
export const cfgOf = (r: PivotRule): PivotCfg => ({ targetPts: r.targetPts, stopPts: r.stopPts, maxTrades: r.maxTrades, entryFrom: hm(r.entryFrom), entryTo: hm(r.entryTo), exitAt: hm(r.exit) });

let doc: Doc | null = null;
let writing: Promise<void> = Promise.resolve();
async function load(): Promise<Doc> {
  if (doc) return doc;
  doc = await readFile(FILE, 'utf8').then((t) => { const j = JSON.parse(t) as Partial<Doc>; return { events: [], days: [], ...j, rule: { ...DEFAULT_PIVOT_RULE, ...j.rule } } as Doc; }, () => ({ rule: { ...DEFAULT_PIVOT_RULE }, events: [], days: [] }));
  return doc;
}
function save() {
  const snapshot = JSON.stringify(doc);
  writing = writing.then(async () => { await mkdir(path.dirname(FILE), { recursive: true }); await writeFile(`${FILE}.tmp`, snapshot); await rename(`${FILE}.tmp`, FILE); }).catch(() => undefined);
  return writing;
}
function log(action: PivotEvent['action'], text: string, at = Math.floor(Date.now() / 1000)) {
  doc!.events.push({ at, action, text });
  if (doc!.events.length > MAX_EVENTS) doc!.events.splice(0, doc!.events.length - MAX_EVENTS);
}

export class PivotError extends Error {}
export async function savePivotRule(input: Partial<PivotRule>): Promise<PivotRule> {
  const d = await load();
  const r: PivotRule = { ...d.rule, enabled: input.enabled ?? d.rule.enabled, lots: Math.round(Number(input.lots ?? d.rule.lots)), targetPts: Number(input.targetPts ?? d.rule.targetPts), stopPts: Number(input.stopPts ?? d.rule.stopPts), maxTrades: Math.round(Number(input.maxTrades ?? d.rule.maxTrades)), updatedAt: new Date().toISOString() };
  if (!(r.lots >= 1 && r.lots <= 10)) throw new PivotError('Lots must be 1 to 10');
  if (!(r.targetPts > 0 && r.targetPts <= 500) || !(r.stopPts > 0 && r.stopPts <= 500)) throw new PivotError('Target and stop must be 1 to 500 points');
  if (!(r.maxTrades >= 1 && r.maxTrades <= 10)) throw new PivotError('Trades a day must be 1 to 10');
  d.rule = r;
  await save();
  return r;
}

// ---------------------------------------------------------------- live ticks

let hooked: object | null = null;
/** Feeds one price into both versions of a leg; logs entries and exits. */
function feedLeg(d: Doc, day: PivotDay, leg: PivotLeg, now: number, ltp: number, bid: number, ask: number): boolean {
  const cfg = cfgOf(d.rule), minute = istMinute(now);
  leg.lastPaise = ltp; leg.lastAt = now;
  let changed = false;
  for (const v of ['fixed', 'ladder'] as const) {
    const s = leg.sims[v], before = s.trades.length, wasOpen = !!s.open;
    if (!stepSim(s, leg.levels, cfg, { time: now, minute, open: ltp, high: ltp, low: ltp, last: ltp, bid, ask, tick: true })) continue;
    changed = true;
    for (const t of s.trades.slice(before)) log('sold', `${v === 'fixed' ? 'Fixed' : 'Ladder'} ${leg.label}: sold at ${rs(t.exitPaise!)} (${t.why}${v === 'ladder' ? `, reached ${t.reached}` : ''}), ${((t.exitPaise! - t.entryPaise) / 100).toFixed(2)} points`, now);
    if (s.open && (!wasOpen || s.trades.length > before)) log('bought', `${v === 'fixed' ? 'Fixed' : 'Ladder'} ${leg.label}: bought at ${rs(s.open.entryPaise)}, crossed ${s.open.level}; stop ${rs(s.open.stopPaise)}${s.open.targetPaise ? `, target ${rs(s.open.targetPaise)}` : ''}`, now);
  }
  void day;
  return changed;
}
function hook(d: Doc) {
  const k = live.kite();
  if (!k || hooked === k) return;
  hooked = k;
  k.tickListeners.push((ticks) => {
    const today = d.days.find((x) => x.closedAt == null && x.date === istDate(Math.floor(Date.now() / 1000)));
    if (!today) return;
    const now = Math.floor(Date.now() / 1000);
    let changed = false;
    for (const t of ticks) {
      const leg = today.legs.find((l) => l.token === t.token);
      if (leg && t.ltpPaise > 0) changed = feedLeg(d, today, leg, now, t.ltpPaise, t.bidPaise ?? 0, t.askPaise ?? 0) || changed;
    }
    if (changed) void save();
  });
}

// ---------------------------------------------------------------- the runner (every 15 seconds)

export async function pivotTick(now = Math.floor(Date.now() / 1000)) {
  const d = await load();
  if (!kiteMarket.isOpen(now)) return;
  const today = istDate(now), min = istMinute(now), rule = d.rule;
  hook(d);

  // 1. An older day still open (the app was off at the exit): close at the last seen price, leave it out.
  for (const day of d.days.filter((x) => x.closedAt == null && x.date !== today)) {
    for (const l of day.legs) for (const v of ['fixed', 'ladder'] as const) if (l.sims[v].open) forceClose(l.sims[v], l.lastAt ?? now, l.lastPaise ?? l.sims[v].open!.entryPaise, 'time');
    day.closedAt = now; day.clean = false; day.note = `The app was not running at ${rule.exit} on ${day.date}: closed at the last price seen and left out of the results.`;
    await save();
  }
  // 2. Today's day: feed the latest quote (time exit even with no ticks), close at the exit time.
  const cur = d.days.find((x) => x.date === today);
  if (cur && cur.closedAt == null) {
    let changed = false;
    for (const l of cur.legs) {
      const i = kiteMarket.instrument(l.symbol), q = i && kiteMarket.quote(i);
      if (q && q.ltpPaise > 0) changed = feedLeg(d, cur, l, now, q.ltpPaise, q.bidPaise, q.askPaise) || changed;
    }
    if (min >= hm(rule.exit) && cur.legs.every((l) => !l.sims.fixed.open && !l.sims.ladder.open)) { cur.closedAt = now; changed = true; }
    if (changed) await save();
    return;
  }
  if (cur) return;

  // 3. Start the day from 09:29 (until LAST_START): pick the strike, read the levels, watch the two contracts.
  if (!rule.enabled || min < hm(rule.entryFrom) - 1) return;
  if (min > hm(LAST_START)) { if (!d.events.some((e) => istDate(e.at) === today)) { log('skipped', `The app was not running by ${LAST_START}; no test today`, now); await save(); } return; }
  const k = live.kite();
  if (!k) return;
  const all = k.nfoContracts('NIFTY').filter((c) => c.kind !== 'FUT' && c.expiry >= today);
  const expiry = [...new Set(all.map((c) => c.expiry))].sort()[0];
  const spot = kiteMarket.underlyingPrice('NIFTY');
  if (!expiry || spot == null) return;
  const chain = all.filter((c) => c.expiry === expiry);
  const atm = atmStrike([...new Set(chain.map((c) => c.strike * 100))], spot);
  const prevDay = (await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY', date: { lt: today } }, orderBy: { date: 'desc' }, select: { date: true } }))?.date;
  if (atm == null || !prevDay) { log('error', 'No strike or no previous trading day stored; no test today', now); d.days.push({ date: today, expiry, at: now, spotPaise: spot, strikePaise: 0, legs: [], closedAt: now, clean: false, note: 'Not started' }); await save(); return; }
  const day: PivotDay = { date: today, expiry, at: now, spotPaise: spot, strikePaise: atm, legs: [], closedAt: null, clean: min <= hm(rule.entryFrom), note: min <= hm(rule.entryFrom) ? null : `Started late (${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}): crosses before then were missed. Left out of the results.` };
  for (const kind of ['CE', 'PE'] as const) {
    const c = chain.find((x) => x.kind === kind && x.strike * 100 === atm), i = c && kiteMarket.instrument(c.tradingsymbol);
    const prev = c && await prisma.fnoEod.findFirst({ where: { underlying: 'NIFTY', date: prevDay, expiry, kind, strikePaise: atm } });
    if (!c || !i || i.token == null) { log('error', `ATM ${atm / 100} ${kind} is not tradable`, now); continue; }
    if (!prev || !prev.traded) { log('skipped', `${i.label}: no traded candle on ${prevDay} to work out its pivots`, now); continue; }
    const levels = pivotLevels(prev.highPaise, prev.lowPaise, prev.closePaise);
    day.legs.push({ kind, symbol: i.symbol, label: i.label, token: i.token, lot: i.lot, prev: { date: prevDay, highPaise: prev.highPaise, lowPaise: prev.lowPaise, closePaise: prev.closePaise }, levels, sims: { fixed: newSim('fixed'), ladder: newSim('ladder') }, lastPaise: null, lastAt: null });
    kiteMarket.watch([i]);
    log('started', `${i.label}: levels from ${prevDay} (H ${rs(prev.highPaise)} L ${rs(prev.lowPaise)} C ${rs(prev.closePaise)}): ${levels.map((l) => `${l.name} ${(l.paise / 100).toFixed(2)}`).join(', ')}`, now);
  }
  if (!day.legs.length) { day.closedAt = now; day.clean = false; day.note = 'No contract to test'; }
  d.days.push(day);
  await save();
}

// ---------------------------------------------------------------- the report

export type PivotTradeRow = PivotTrade & { date: string; leg: string; kind: 'CE' | 'PE'; qty: number; grossPaise: number | null; chargesPaise: number; netPaise: number | null; clean: boolean };
export type PivotReport = {
  rule: PivotRule; events: PivotEvent[];
  days: (Omit<PivotDay, 'legs'> & { legs: { label: string; kind: 'CE' | 'PE'; prev: PivotLeg['prev']; levels: Level[]; lastPaise: number | null }[] })[];
  trades: PivotTradeRow[];
  totals: Record<Version, { trades: number; won: number; netPaise: number; chargesPaise: number; byKind: Record<'CE' | 'PE', { trades: number; won: number; netPaise: number }> }>;
  /** Clean days counted in the totals. */
  cleanDays: number;
};

export async function pivotReport(): Promise<PivotReport> {
  const d = await load();
  const trades: PivotTradeRow[] = [];
  for (const day of d.days) for (const l of day.legs) for (const v of ['fixed', 'ladder'] as const) {
    const s = l.sims[v];
    const all = [...s.trades, ...(s.open ? [{ ...s.open, exitAt: null, exitPaise: null, why: null } as PivotTrade] : [])];
    for (const t of all) {
      const qty = l.lot * d.rule.lots;
      const charges = computeOptionCharges({ side: 'BUY', qty, premiumPaise: t.entryPaise, date: day.date }).total + (t.exitPaise != null ? computeOptionCharges({ side: 'SELL', qty, premiumPaise: t.exitPaise, date: day.date }).total : 0);
      const gross = t.exitPaise != null ? (t.exitPaise - t.entryPaise) * qty : null;
      trades.push({ version: t.version, level: t.level, entryAt: t.entryAt, entryPaise: t.entryPaise, exitAt: t.exitAt, exitPaise: t.exitPaise, why: t.why, reached: t.reached, date: day.date, leg: l.label, kind: l.kind, qty, grossPaise: gross, chargesPaise: charges, netPaise: gross != null ? gross - charges : null, clean: day.clean });
    }
  }
  const empty = () => ({ trades: 0, won: 0, netPaise: 0 });
  const totals = { fixed: { trades: 0, won: 0, netPaise: 0, chargesPaise: 0, byKind: { CE: empty(), PE: empty() } }, ladder: { trades: 0, won: 0, netPaise: 0, chargesPaise: 0, byKind: { CE: empty(), PE: empty() } } };
  for (const t of trades) {
    if (!t.clean || t.netPaise == null) continue;
    const x = totals[t.version], k = x.byKind[t.kind];
    x.trades++; k.trades++; x.netPaise += t.netPaise; k.netPaise += t.netPaise; x.chargesPaise += t.chargesPaise;
    if (t.netPaise > 0) { x.won++; k.won++; }
  }
  return {
    rule: d.rule, events: d.events.slice(-200).reverse(), totals, cleanDays: d.days.filter((x) => x.clean && x.closedAt != null).length,
    days: d.days.map((x) => ({ ...x, legs: x.legs.map((l) => ({ label: l.label, kind: l.kind, prev: l.prev, levels: l.levels, lastPaise: l.lastPaise })) })).reverse(),
    trades: trades.sort((a, b) => b.entryAt - a.entryAt),
  };
}
