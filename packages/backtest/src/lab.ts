// Option strategy lab: the owner builds the option tests we ran as one-off studies (apps/feed/scripts/selling-*.ts) and
// runs them on NSE's official end-of-day F&O data. It follows the studies' rules exactly, so a template reproduces a
// study's figures:
// - One position at a time. A trade starts at a day's close and is checked at every later close.
// - Strikes come from traded closes only, after impossible ("stale") closes are set aside by the data layer. With
//   `missing: 'settlement'` a leg whose strike did not trade uses NSE's settlement price, capped (boundedMark), and the
//   trade is counted as model-priced.
// - While held, an option is valued at its close, or at its capped settlement price on a day it did not trade.
// - Slippage: a stated amount per option against us on every fill (never below 5 paise). Every charge is paid.
// - Expiry settles options at intrinsic value against the index's official close (and futures at that close).
// - Booking, stops and adjustments are seen at a close and filled at that same close: daily data cannot show what
//   happened inside a day, so a trade can close well past its stop.
// - Money is in rupees, either as it was or at today's index level and lot size (`money: 'today'`, the studies' way),
//   so 2012 and 2026 trades weigh the same.
// All prices inside are integer paise.

import { computeFuturesCharges, computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, deltaOf, ivAboveMedian, ivRank, parityForward, yearsBetween, type IvPoint } from '@mtv/options';

// ---------------------------------------------------------------- the strategy

/** How a leg's strike is chosen on the entry day. `pct` and `points` count from the ATM strike (+ above, − below). */
export type LabStrike =
  | { by: 'atm' }
  | { by: 'forward' }
  | { by: 'delta'; delta: number }
  /** `from: 'now'` (legs added in an adjustment): count from the index at that close instead of the entry. */
  | { by: 'pct'; pct: number; from?: 'entry' | 'now' }
  | { by: 'points'; points: number }
  | { by: 'premium'; rupees: number };

/** `expiry`: 0 = the trade's expiry, 1 = the next monthly after it, 2 = the one after that. Futures use monthly contracts. */
export type LabLeg = { side: 'BUY' | 'SELL'; kind: 'CE' | 'PE' | 'FUT'; lots: number; strike: LabStrike; expiry: 0 | 1 | 2 };

/** When trades start, and which expiry each one is built around. */
export type LabSchedule =
  /** Each expiry: start this many calendar days before it (the first trading day on or after that date). */
  | { every: 'expiry'; cycle: 'monthly' | 'weekly'; daysBefore: number }
  /** The first trading day after a monthly expiry, on the monthly expiry this many months later. */
  | { every: 'after-expiry'; months: number }
  /** Every week on this weekday (or the next trading day that week), on the next weekly or monthly expiry. */
  | { every: 'week'; weekday: 1 | 2 | 3 | 4 | 5; expiry: 'weekly' | 'monthly' }
  /** Once a year: in `month`, on its last Monday or first trading day, on the monthly expiry of `expiryMonth`. */
  | { every: 'year'; month: number; day: 'last-monday' | 'first-day'; expiryMonth: number };

export type LabAction = { close: number; lots: number } | { add: LabLeg };
/**
 * An adjustment, done once per trade, at the first close that reaches its level:
 * `when.leg` = that leg's strike; `when.pct` = this % from the entry's reference (see distanceFrom). `dir` = at or above (up) / at or below.
 * `after` = only once adjustment number `after` has been done. Leg numbers count the starting legs, then added ones.
 */
export type LabAdjust = { when: { leg: number } | { pct: number } | { swing: 'support' | 'resistance' }; dir: 'up' | 'down'; after?: number; actions: LabAction[] };

export type LabStrategy = {
  name: string;
  underlying: 'NIFTY' | 'BANKNIFTY';
  schedule: LabSchedule;
  legs: LabLeg[];
  /** Trade only when the ATM IV (25 to 60 days out) is: above its past-year median, in its top third, or at/below the median. */
  iv: 'any' | 'high' | 'top-third' | 'low';
  /** Trade only when India VIX at entry is above this percentile (0–100) of the previous 252 sessions. Off when unset. */
  vixAbove?: number;
  /** No `daysLeft`: hold to the trade's expiry. `bookPct`: % of the entry credit earned. `stopCredit`: a loss of this × credit. */
  exit: { daysLeft?: number; bookPct?: number; stopRupees?: number; stopCredit?: number };
  adjust?: LabAdjust[];
  /** When adjustments are checked: every close (default) or only the week's last close (a weekly chart). */
  check?: 'daily' | 'weekly';
  /** What % and point distances (and adjustment levels) count from: the index at entry, or the entry's ATM strike. */
  distanceFrom?: 'index' | 'atm';
  /** A strike that did not trade on the entry day: skip the trade, or use NSE's (capped) settlement price. */
  missing: 'skip' | 'settlement';
  /** ₹ per option, against us on every fill. */
  slippage: number;
  money: 'today' | 'actual';
  from?: string;
  to?: string;
};

// ---------------------------------------------------------------- data

export type LabQuote = { kind: 'CE' | 'PE'; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
export type LabDay = { date: string; spotPaise: number | null; lotSize: number | null };

/** What the lab reads. The feed implements it over Postgres; tests over memory. */
export interface LabData {
  /** Every trading day with F&O data, oldest first. */
  days: LabDay[];
  /** Real monthly expiries, past and still listed, sorted. */
  monthly: string[];
  /** Every real expiry (weekly too), past and still listed, sorted. */
  expiries: string[];
  /** One expiry's options from `from` to `to`, by date. Impossible closes already carry traded = false. */
  chains(expiry: string, from: string, to: string): Promise<Map<string, LabQuote[]>>;
  /** The monthly future's closes from `from` to `to`, by date. */
  futures(expiry: string, from: string, to: string): Promise<Map<string, number>>;
  /** ATM IV history (one reading a day), for the IV filter. */
  iv: IvPoint[];
  /** India VIX closes, for the VIX filter. */
  vix?: IvPoint[];
  /** The index's daily bars (paise), for weekly swing support and resistance. */
  bars?: { date: string; high: number; low: number; close: number }[];
}

// ---------------------------------------------------------------- results

export type LabTradeLeg = { side: 'BUY' | 'SELL'; kind: 'CE' | 'PE' | 'FUT'; strike: number; expiry: string; lots: number; entry: number; exit: number; model: boolean; added?: string; closed?: string };
export type LabExit = 'expiry' | 'days-left' | 'booked' | 'stop';
export type LabTrade = {
  entry: string; exit: string; expiry: string; reason: LabExit;
  spotIn: number; spotOut: number; ivHigh: boolean | null; ivRank: number | null;
  /** India VIX at entry and its percentile (0–1) against the previous 252 sessions. */
  vix?: number | null; vixRank?: number | null;
  legs: LabTradeLeg[]; events: { date: string; text: string }[];
  /** ₹: the entry credit (negative = a debit), money after charges, charges, and the worst close while open. */
  credit: number; net: number; charges: number; worstMtm: number; worstMtmOn: string;
  /** Legs priced from NSE's settlement price at entry or in an adjustment. */
  model: number;
  /** ₹ P&L (after charges so far) at each close while open, the exit day last. Lets a run build a daily equity curve. */
  daily: { date: string; mtm: number }[];
};
export type LabYear = { year: string; trades: number; won: number; net: number; worst: number };
export type LabSummary = {
  trades: number; won: number; winRatePct: number | null; total: number; perYear: number; years: number;
  avgWin: number | null; avgLoss: number | null; best: number | null; worst: number | null; worstMtm: number | null;
  losingYears: number; byYear: LabYear[]; modelPriced: number;
};
export type LabResult = {
  trades: LabTrade[];
  skipped: { date: string; reason: string }[];
  summary: LabSummary;
  from: string; to: string;
  /** For `money: 'today'`: the index close and lot size the money is scaled to. */
  today: { date: string; spot: number; lot: number };
  /** Random reorderings of the real trades (money at today's size, 20+ trades); null otherwise. */
  monteCarlo: LabMonteCarlo | null;
};

/** ₹ falls are negative. `capital`: money that keeps the 1-in-20 worst fall within 20%. */
export type LabMonteCarlo = {
  runs: number; trades: number; perYear: number;
  typicalFall: number; fall1in20: number; fall1in100: number;
  losingYearPct: number; capital: number; returnPct: number | null;
};

export class LabError extends Error {}

const DAY = 86_400_000;
const MIN_FILL = 5;
const R = Math.round;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/**
 * India VIX percentile (0–1) on `d` against the previous 252 readings, or null when those readings do not form about one
 * year (our VIX history has gaps: 2012 has 35 days, 2013 one), so the filter skips years it cannot judge.
 */
function vixRankOn(vix: IvPoint[], d: string): number | null {
  const i = vix.findIndex((p) => p.date >= d);
  if (i < 252 || vix[i].date !== d) return null;
  if (daysBetween(vix[i - 252].date, d) > 400) return null;
  return ivRank(vix, d, 252);
}

// ---------------------------------------------------------------- weekly swing support and resistance

/** A week's bar: the week's high, low and last close, ending on its last trading day. */
type Week = { end: string; high: number; low: number; close: number };
/**
 * A week is a swing low (high) when its low (high) is beyond the SWING_WEEKS weeks on each side; it is known only once
 * those later weeks have closed. Levels come from the last SWING_LOOKBACK weeks and must be SWING_GAP_PCT away.
 */
export const SWING_WEEKS = 3, SWING_LOOKBACK = 104, SWING_GAP_PCT = 3;
export function weeklyBars(bars: { date: string; high: number; low: number; close: number }[]): Week[] {
  const out: Week[] = [];
  let key = '';
  for (const b of bars) {
    const k = mondayOf(b.date);
    if (k !== key) { out.push({ end: b.date, high: b.high, low: b.low, close: b.close }); key = k; }
    else { const w = out[out.length - 1]; w.end = b.date; w.high = Math.max(w.high, b.high); w.low = Math.min(w.low, b.low); w.close = b.close; }
  }
  return out;
}
/** Swing highs and lows known on `asOf` (their confirming weeks have closed). */
export function swingsKnown(weeks: Week[], asOf: string): { end: string; price: number; kind: 'high' | 'low' }[] {
  const n = SWING_WEEKS, out: { end: string; price: number; kind: 'high' | 'low' }[] = [];
  let last = weeks.length - 1;
  while (last >= 0 && weeks[last].end > asOf) last--;
  for (let i = Math.max(n, last - SWING_LOOKBACK); i + n <= last; i++) {
    const w = weeks[i], around = [...weeks.slice(i - n, i), ...weeks.slice(i + 1, i + n + 1)];
    if (around.every((x) => w.high > x.high)) out.push({ end: w.end, price: w.high, kind: 'high' });
    if (around.every((x) => w.low < x.low)) out.push({ end: w.end, price: w.low, kind: 'low' });
  }
  return out;
}
/**
 * Support = the nearest swing level (a high or a low: old resistance counts) at least SWING_GAP_PCT below the index;
 * resistance = the nearest at least that far above. Null when there is none (e.g. at an all-time high).
 */
export function swingLevel(weeks: Week[], asOf: string, refPaise: number, side: 'support' | 'resistance'): { price: number; end: string; kind: 'high' | 'low' } | null {
  const gap = refPaise * (SWING_GAP_PCT / 100);
  let best: { price: number; end: string; kind: 'high' | 'low' } | null = null;
  for (const x of swingsKnown(weeks, asOf)) {
    if (side === 'support' ? x.price > refPaise - gap : x.price < refPaise + gap) continue;
    if (!best || (side === 'support' ? x.price > best.price : x.price < best.price)) best = x;
  }
  return best;
}
const mondayOf = (d: string) => { const t = Date.parse(`${d}T00:00:00Z`), w = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - w * DAY).toISOString().slice(0, 10); };

export function validateLab(s: LabStrategy): string | null {
  if (!s.legs.length) return 'Add at least one leg';
  if (s.legs.length > 6) return 'At most 6 legs';
  for (const l of s.legs) {
    if (!Number.isSafeInteger(l.lots) || l.lots < 1 || l.lots > 50) return 'Lots must be a whole number from 1 to 50';
    if (l.kind === 'FUT' && l.strike.by !== 'atm') return 'A future has no strike: leave it at ATM';
    if (l.strike.by === 'delta' && !(l.strike.delta > 0 && l.strike.delta < 1)) return 'Delta must be between 0 and 1 (0.16 = 16%)';
    if (l.strike.by === 'premium' && !(l.strike.rupees > 0)) return 'Premium must be above zero';
    if (l.strike.by === 'pct' && !(Math.abs(l.strike.pct) <= 40)) return 'Distance must be within 40% of the index';
  }
  const sc = s.schedule;
  if (sc.every === 'expiry' && !(Number.isSafeInteger(sc.daysBefore) && sc.daysBefore >= 1 && sc.daysBefore <= 400)) return 'Days before expiry must be from 1 to 400';
  if (sc.every === 'after-expiry' && !(Number.isSafeInteger(sc.months) && sc.months >= 1 && sc.months <= 12)) return 'Months must be from 1 to 12';
  if (sc.every === 'year' && !(sc.month >= 1 && sc.month <= 12 && sc.expiryMonth >= 1 && sc.expiryMonth <= 12)) return 'Pick the months';
  const e = s.exit;
  if (e.daysLeft != null && !(Number.isSafeInteger(e.daysLeft) && e.daysLeft >= 1)) return 'Days left must be a whole number of 1 or more';
  for (const v of [e.bookPct, e.stopRupees, e.stopCredit]) if (v != null && !(v > 0)) return 'Exit values must be above zero';
  if (s.vixAbove != null && !(s.vixAbove >= 0 && s.vixAbove < 100)) return 'VIX percentile must be from 0 to 99';
  if (!(s.slippage >= 0 && s.slippage <= 50)) return 'Slippage must be from ₹0 to ₹50';
  for (const a of s.adjust ?? []) {
    if (!a.actions.length) return 'An adjustment needs at least one action';
    if ('leg' in a.when && !(a.when.leg >= 0 && a.when.leg < s.legs.length + 6)) return 'An adjustment points at a leg that does not exist';
    if ('swing' in a.when && a.when.swing !== 'support' && a.when.swing !== 'resistance') return 'Pick support or resistance';
  }
  return null;
}

// ---------------------------------------------------------------- the run

type Open = {
  spec: LabLeg; kind: 'CE' | 'PE' | 'FUT'; expiry: string; strike: number; q: number; // q: signed lots held now
  entryPx: number; mark: number; model: boolean; added?: string; closed?: string; lastExit?: number;
};

export async function runLab(s: LabStrategy, data: LabData): Promise<LabResult> {
  const invalid = validateLab(s);
  if (invalid) throw new LabError(invalid);
  const all = data.days;
  const weeks = data.bars ? weeklyBars(data.bars) : null;
  if (all.length < 2) throw new LabError('Not enough F&O history');
  const dates = all.map((d) => d.date), idx = new Map(dates.map((d, i) => [d, i])), day = new Map(all.map((d) => [d.date, d]));
  const first = (d: string) => { let lo = 0, hi = dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; } return dates[lo] ?? null; };
  const lastDay = dates[dates.length - 1];
  const todayRow = [...all].reverse().find((d) => d.spotPaise && d.lotSize)!;
  const todayN = todayRow.spotPaise! * todayRow.lotSize!;
  // With the VIX filter, the test starts on the first day VIX can be ranked, so years it cannot judge don't dilute a year's profit.
  const vixStart = s.vixAbove != null && data.vix ? (dates.find((d) => vixRankOn(data.vix!, d) != null) ?? lastDay) : dates[0];
  const from0 = s.from ?? dates[0];
  const from = from0 < vixStart ? vixStart : from0, to = s.to && s.to < lastDay ? s.to : lastDay;
  const slip = Math.round(s.slippage * 100);

  // ---- planned trades: [entry day, the trade's expiry]
  const plans: { entry: string; expiry: string }[] = [];
  const sc = s.schedule;
  if (sc.every === 'expiry') {
    for (const e of sc.cycle === 'monthly' ? data.monthly : data.expiries) {
      const want = addDays(e, -sc.daysBefore), d = first(want);
      if (want < dates[0] || !d || d >= e || daysBetween(d, e) > sc.daysBefore + 5) continue;
      plans.push({ entry: d, expiry: e });
    }
  } else if (sc.every === 'after-expiry') {
    // The study's way: one position at a time, stepping by the frame after a trade and by one month after a skip.
    // Here every candidate is listed; the run below skips those inside an open trade.
    const m = data.monthly;
    for (let k = sc.months; k < m.length; k++) {
      const i = idx.get(m[k - sc.months]);
      if (i == null || i + 1 >= dates.length) continue;
      plans.push({ entry: dates[i + 1], expiry: m[k] });
    }
  } else if (sc.every === 'week') {
    const list = sc.expiry === 'weekly' ? data.expiries : data.monthly;
    const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
    let week = '';
    for (const d of dates) {
      const w = mondayOf(d);
      if (w === week || weekday(d) < sc.weekday) continue;
      week = w;
      const e = list.find((x) => x > d);
      if (e) plans.push({ entry: d, expiry: e });
    }
  } else {
    const y0 = Number(dates[0].slice(0, 4)), y1 = Number(lastDay.slice(0, 4)) + 1;
    for (let y = y0; y <= y1; y++) {
      const mm = String(sc.month).padStart(2, '0');
      let start = `${y}-${mm}-01`;
      if (sc.day === 'last-monday') {
        const last = new Date(Date.UTC(y, sc.month, 0)).getUTCDate();
        for (let dd = last; dd >= last - 6; dd--) { const t = `${y}-${mm}-${String(dd).padStart(2, '0')}`; if (weekday(t) === 1) { start = t; break; } }
      }
      const d = first(start);
      const ey = sc.expiryMonth >= sc.month ? y : y + 1;
      const e = data.monthly.find((x) => x.startsWith(`${ey}-${String(sc.expiryMonth).padStart(2, '0')}`));
      if (d && e && d < e && d.slice(0, 4) === String(y)) plans.push({ entry: d, expiry: e });
    }
  }

  const trades: LabTrade[] = [], skipped: LabResult['skipped'] = [];
  let busyUntil = '';

  for (const plan of plans) {
    const d = plan.entry, e = plan.expiry;
    if (d < from || d > to) continue;
    if (d < busyUntil) { if (sc.every !== 'after-expiry') skipped.push({ date: d, reason: 'Still in the previous trade' }); continue; }
    const exitPlanned = s.exit.daysLeft != null ? first(addDays(e, -s.exit.daysLeft)) : e;
    if (!exitPlanned || exitPlanned <= d) { skipped.push({ date: d, reason: 'Too close to expiry for the exit rule' }); continue; }
    if (exitPlanned > lastDay || !idx.has(exitPlanned)) { skipped.push({ date: d, reason: 'Not finished yet' }); continue; }
    if (exitPlanned > to) continue;
    const hi = ivAboveMedian(data.iv, d), rank = ivRank(data.iv, d);
    if (s.iv === 'high' && hi !== true) continue;
    if (s.iv === 'low' && hi !== false) continue;
    if (s.iv === 'top-third' && !((rank ?? 0) >= 0.67)) continue;
    const vixRank = data.vix ? vixRankOn(data.vix, d) : null;
    if (s.vixAbove != null && !((vixRank ?? -1) > s.vixAbove / 100)) continue;
    const meta = day.get(d)!;
    if (!meta.spotPaise || !meta.lotSize) { skipped.push({ date: d, reason: 'No index close that day' }); continue; }
    const r = await play(plan.entry, plan.expiry, exitPlanned, meta.spotPaise, meta.lotSize, hi, rank);
    if (typeof r === 'string') { skipped.push({ date: d, reason: r }); continue; }
    if (data.vix) { r.vix = data.vix.find((p) => p.date === d)?.iv ?? null; r.vixRank = vixRank; }
    trades.push(r);
    busyUntil = r.exit;
  }

  const summary = summarizeLab(trades, from, to);
  const monteCarlo = s.money === 'today' && trades.length >= 20 ? labMonteCarlo(trades.map((t) => t.net), summary.trades / summary.years, summary.perYear) : null;
  return { trades, skipped, summary, monteCarlo, from, to, today: { date: todayRow.date, spot: todayRow.spotPaise! / 100, lot: todayRow.lotSize! } };

  async function play(d: string, e: string, x0: string, spot: number, lot: number, hi: boolean | null, rank: number | null): Promise<LabTrade | string> {
    const scale = s.money === 'today' ? todayN / (spot * lot) : 1;
    const money = (p: number) => (p * scale) / 100;
    const end = x0 > e ? e : x0;
    const kit = await entryKit(s, data, d, e, end, spot);
    if (typeof kit === 'string') return kit;
    const { open, chainOn, futOn, pick, legExpiry, ref0 } = kit;
    let cash = 0, cashRaw = 0, charges = 0;
    const fill = (l: Open, lots: number, raw: number, t: string) => { // lots > 0 buys
      const px = lots > 0 ? raw + slip : Math.max(MIN_FILL, raw - slip);
      const qty = Math.abs(lots) * lot;
      cash -= lots * lot * px; cashRaw -= lots * lot * raw;
      charges += l.kind === 'FUT'
        ? computeFuturesCharges({ side: lots > 0 ? 'BUY' : 'SELL', qty, pricePaise: px, date: t }).total
        : computeOptionCharges({ side: lots > 0 ? 'BUY' : 'SELL', qty, premiumPaise: px, date: t }).total;
      return px;
    };
    for (const l of open) fill(l, l.q, l.entryPx, d);
    const credit = open.reduce((a, l) => a + (l.kind === 'FUT' ? 0 : -l.q * lot * l.entryPx), 0);
    const events: LabTrade['events'] = [];
    let model = open.filter((l) => l.model).length, worst = 0, worstOn = d, exit = end, reason: LabExit = end === e && !s.exit.daysLeft ? 'expiry' : 'days-left';
    const done = new Set<number>();
    const value = () => open.reduce((a, l) => a + l.q * lot * l.mark, 0);
    const daily: LabTrade['daily'] = [];

    // Swing levels: fixed when an adjustment becomes active (at entry, or when the adjustment it follows is done).
    const armed = new Map<number, { level: number; text: string } | null>();
    const arm = (a: number, t: string, ref: number) => {
      const w = s.adjust![a].when;
      if (!('swing' in w)) return;
      const lv = weeks ? swingLevel(weeks, t, ref, w.swing) : null;
      armed.set(a, lv ? { level: lv.price, text: `${w.swing} ${(lv.price / 100).toFixed(0)} (swing ${lv.kind} of the week to ${lv.end})` } : null);
      events.push({ date: t, text: lv ? `Watching ${w.swing} at ${(lv.price / 100).toFixed(0)} (weekly swing ${lv.kind}, week to ${lv.end})` : `No weekly swing ${w.swing} ${SWING_GAP_PCT}%+ away: that adjustment cannot fire` });
    };
    (s.adjust ?? []).forEach((x, a) => { if (x.after == null) arm(a, d, spot); });
    // ---- every close while open
    for (let j = idx.get(d)! + 1; j <= idx.get(end)!; j++) {
      const t = dates[j], sp = day.get(t)?.spotPaise;
      for (const l of open) {
        if (l.q === 0 || t > l.expiry) continue;
        const v = l.kind === 'FUT' ? await futOn(l.expiry, t) : boundedMark(await chainOn(l.expiry, t), l.kind, l.strike, sp ?? 0);
        if (v != null) l.mark = v;
      }
      const last = t === end;
      const weekEnd = j + 1 >= dates.length || mondayOf(dates[j + 1]) !== mondayOf(t);
      if (!last && sp && (s.check !== 'weekly' || weekEnd)) {
        for (let a = 0; a < (s.adjust ?? []).length; a++) {
          const adj = s.adjust![a];
          if (done.has(a) || (adj.after != null && !done.has(adj.after))) continue;
          let level: number | null;
          if ('leg' in adj.when) { const l = open[adj.when.leg]; level = l && l.q !== 0 && l.kind !== 'FUT' ? l.strike : null; }
          else if ('swing' in adj.when) level = armed.get(a)?.level ?? null;
          else level = ref0 * (1 + adj.when.pct / 100);
          if (level == null || !(adj.dir === 'up' ? sp >= level : sp <= level)) continue;
          done.add(a);
          if ('swing' in adj.when) events.push({ date: t, text: `${s.check === 'weekly' ? 'Weekly close' : 'Close'} ${(sp / 100).toFixed(0)} ${adj.dir === 'up' ? 'above' : 'below'} ${armed.get(a)!.text}` });
          (s.adjust ?? []).forEach((x, b) => { if (x.after === a) arm(b, t, sp); });
          for (const act of adj.actions) {
            if ('close' in act) {
              const l = open[act.close];
              if (!l || l.q === 0) continue;
              const n = Math.min(act.lots, Math.abs(l.q)) * Math.sign(l.q);
              const px = fill(l, -n, l.mark, t);
              l.q -= n; l.lastExit = px;
              if (l.q === 0) l.closed = t;
              events.push({ date: t, text: `${n > 0 ? 'Sold' : 'Bought back'} ${Math.abs(n)} lot${Math.abs(n) > 1 ? 's' : ''} of ${legName(l)} at ₹${(px / 100).toFixed(2)}` });
            } else {
              const spec = act.add, exp = legExpiry(spec);
              const p = exp ? await pick(spec, t, sp, exp) : 'The later expiry is not listed';
              if (typeof p === 'string') { events.push({ date: t, text: `Could not add a leg: ${p}` }); continue; }
              const l: Open = { spec, kind: spec.kind, expiry: exp!, strike: p.strike, q: 0, entryPx: p.px, mark: p.px, model: p.model, added: t };
              if (p.model) model++;
              const lots = (spec.side === 'BUY' ? 1 : -1) * spec.lots, px = fill(l, lots, p.px, t);
              l.q = lots; l.entryPx = p.px;
              open.push(l);
              events.push({ date: t, text: `${lots > 0 ? 'Bought' : 'Sold'} ${spec.lots} lot${spec.lots > 1 ? 's' : ''} of ${legName(l)} at ₹${(px / 100).toFixed(2)}` });
            }
          }
        }
      }
      const mtm = money(cash - charges + value());
      if (mtm < worst) { worst = mtm; worstOn = t; }
      daily.push({ date: t, mtm: R(mtm) });
      if (last) break;
      const pnlRaw = cashRaw + value(); // the studies' booking sum: closes, no slippage, no charges
      if (s.exit.bookPct && credit > 0 && pnlRaw >= (credit * s.exit.bookPct) / 100) { exit = t; reason = 'booked'; break; }
      if ((s.exit.stopCredit && credit > 0 && pnlRaw <= -credit * s.exit.stopCredit) || (s.exit.stopRupees && mtm <= -s.exit.stopRupees)) { exit = t; reason = 'stop'; break; }
    }

    // ---- exit
    const spotOut = day.get(exit)?.spotPaise ?? null;
    const settles = reason === 'expiry' && spotOut != null;
    for (const l of open) {
      if (l.q === 0) continue;
      if (settles && l.expiry === exit) {
        const iv = l.kind === 'FUT' ? spotOut! : Math.max(0, l.kind === 'CE' ? spotOut! - l.strike : l.strike - spotOut!);
        cash += l.q * lot * iv;
        charges += l.kind === 'FUT'
          ? computeFuturesCharges({ side: l.q > 0 ? 'SELL' : 'BUY', qty: Math.abs(l.q) * lot, pricePaise: iv, date: exit }).total
          : expirySettlementCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: Math.abs(l.q) * lot, intrinsicPaise: iv, date: exit });
        l.lastExit = iv;
      } else {
        l.lastExit = fill(l, -l.q, l.mark, exit);
      }
    }
    const net = money(cash - charges);
    // The exit day's point is the final result (the loop's mark was before the exit fills and slippage).
    if (daily.length && daily[daily.length - 1].date === exit) daily[daily.length - 1] = { date: exit, mtm: R(net) }; else daily.push({ date: exit, mtm: R(net) });
    return {
      entry: d, exit, expiry: e, reason, spotIn: spot / 100, spotOut: (spotOut ?? spot) / 100, ivHigh: hi, ivRank: rank,
      legs: open.map((l) => ({ side: l.spec.side, kind: l.kind, strike: l.strike / 100, expiry: l.expiry, lots: l.spec.lots, entry: l.entryPx / 100, exit: (l.lastExit ?? l.mark) / 100, model: l.model, ...(l.added ? { added: l.added } : {}), ...(l.closed ? { closed: l.closed } : {}) })),
      events, credit: R(money(credit)), net: R(net), charges: R(money(charges)), worstMtm: R(Math.min(worst, net)), worstMtmOn: worst < net ? worstOn : exit, model, daily,
    };
  }
}

/** Everything needed to open a trade on day d around expiry e (and to add legs while it runs), or why it cannot open. */
async function entryKit(s: LabStrategy, data: LabData, d: string, e: string, end: string, spot: number) {
  // Chains and futures over the trade's life, per expiry, loaded once.
  const chainCache = new Map<string, Map<string, LabQuote[]>>(), futCache = new Map<string, Map<string, number>>();
  const chainOn = async (exp: string, t: string) => {
    let c = chainCache.get(exp);
    if (!c) { c = await data.chains(exp, d, exp < end ? exp : end); chainCache.set(exp, c); }
    return c.get(t) ?? [];
  };
  const futOn = async (exp: string, t: string) => {
    let c = futCache.get(exp);
    if (!c) { c = await data.futures(exp, d, end); futCache.set(exp, c); }
    return c.get(t) ?? null;
  };
  const monthlyAfter = (x: string, n: number) => { const i = data.monthly.findIndex((m) => m >= x); return i < 0 ? null : data.monthly[i + n] ?? null; };
  const legExpiry = (spec: LabLeg) => (spec.kind === 'FUT' ? monthlyAfter(e, spec.expiry) : spec.expiry === 0 ? e : monthlyAfter(e, spec.expiry));

  // ATM reference: the traded call strike nearest the index (the studies' "ATM").
  const main = await chainOn(e, d);
  const tradedOf = (rows: LabQuote[], k: 'CE' | 'PE') => rows.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
  const nearest = (rows: LabQuote[], target: number) => rows.reduce<LabQuote | null>((b, x) => (!b || Math.abs(x.strikePaise - target) < Math.abs(b.strikePaise - target) ? x : b), null);
  // Like an ATM leg: a traded call near the index (1%, or 2.5% beyond 100 days, where strikes are wider apart), else
  // (with settlement prices allowed) a settled one.
  const atmTol = spot * (daysBetween(d, e) <= 100 ? 0.01 : 0.025);
  const near1 = (rows: LabQuote[]) => nearest(rows.filter((x) => Math.abs(x.strikePaise - spot) <= atmTol), spot);
  const atmRow = near1(tradedOf(main, 'CE')) ?? (s.missing === 'settlement' ? near1(main.filter((x) => x.kind === 'CE' && x.settlePaise > 0)) : null);
  const atmK = atmRow?.strikePaise ?? spot;
  const ref0 = s.distanceFrom === 'atm' ? atmK : spot;

  async function pick(spec: LabLeg, t: string, spotT: number, exp: string): Promise<{ strike: number; px: number; model: boolean } | string> {
    if (spec.kind === 'FUT') {
      const f = await futOn(exp, t);
      return f ? { strike: 0, px: f, model: false } : `No ${exp} future close`;
    }
    const rows = await chainOn(exp, t), k = spec.kind, usable = tradedOf(rows, k);
    const T = yearsBetween(t, exp);
    const tol = spotT * (daysBetween(t, exp) <= 100 ? 0.01 : 0.025);
    const asQuote = (x: LabQuote) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded });
    const fwd = () => parityForward(rows.filter((x) => x.kind === 'CE').map(asQuote), rows.filter((x) => x.kind === 'PE').map(asQuote), spotT, T) ?? spotT;
    const st = spec.strike;
    if (st.by === 'delta') {
      const F = fwd(), sgn = k === 'CE' ? 1 : -1;
      let best: LabQuote | null = null, gap = Infinity;
      for (const x of usable) {
        if (sgn * (x.strikePaise - F) <= 0) continue;
        const v = deltaOf(k, x.closePaise, F, x.strikePaise, T);
        if (v == null) continue;
        const g = Math.abs(Math.abs(v) - st.delta);
        if (g < gap) { gap = g; best = x; }
      }
      return best ? { strike: best.strikePaise, px: best.closePaise, model: false } : `No traded ${k} for the delta`;
    }
    if (st.by === 'forward') {
      const F = fwd(), other = new Set(tradedOf(rows, k === 'CE' ? 'PE' : 'CE').map((x) => x.strikePaise));
      const p = usable.filter((x) => other.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - F) - Math.abs(b.strikePaise - F))[0];
      return p && Math.abs(p.strikePaise - F) <= spotT * 0.02 ? { strike: p.strikePaise, px: p.closePaise, model: false } : 'No traded strike at the forward';
    }
    if (st.by === 'premium') {
      const target = Math.round(st.rupees * 100);
      const p = [...usable].sort((a, b) => Math.abs(a.closePaise - target) - Math.abs(b.closePaise - target) || (k === 'CE' ? b.strikePaise - a.strikePaise : a.strikePaise - b.strikePaise))[0];
      return p ? { strike: p.strikePaise, px: p.closePaise, model: false } : `No traded ${k}`;
    }
    // Distances count from the entry's reference (the index, or its ATM strike), also for legs added later.
    const target = st.by === 'atm' ? spotT : st.by === 'pct' ? (st.from === 'now' ? spotT : ref0) * (1 + st.pct / 100) : ref0 + st.points * 100;
    const p = nearest(usable.filter((x) => Math.abs(x.strikePaise - target) <= tol), target);
    if (p) return { strike: p.strikePaise, px: p.closePaise, model: false };
    if (s.missing === 'settlement') {
      const q = nearest(rows.filter((x) => x.kind === k && x.settlePaise > 0 && Math.abs(x.strikePaise - target) <= tol), target);
      const px = q && boundedMark(rows, k, q.strikePaise, spotT);
      if (q && px) return { strike: q.strikePaise, px, model: true };
    }
    return `${k} near ${Math.round(target / 100)} did not trade`;
  }

  const open: Open[] = [];
  for (const spec of s.legs) {
    const exp = legExpiry(spec);
    if (!exp) return 'The later expiry is not listed';
    const p = await pick(spec, d, spot, exp);
    if (typeof p === 'string') return p;
    open.push({ spec, kind: spec.kind, expiry: exp, strike: p.strike, q: (spec.side === 'BUY' ? 1 : -1) * spec.lots, entryPx: p.px, mark: p.px, model: p.model });
  }
  return { open, chainOn, futOn, pick, legExpiry, ref0, atmK };
}

const legName = (l: { kind: string; strike: number; expiry: string }) => (l.kind === 'FUT' ? `the ${l.expiry} future` : `${l.strike / 100} ${l.kind} (${l.expiry})`);

/** Totals, year by year. Profit a year = total ÷ the years tested (first to last trading day of the period). */
export function summarizeLab(trades: LabTrade[], from: string, to: string): LabSummary {
  const nets = trades.map((t) => t.net), w = nets.filter((x) => x > 0), l = nets.filter((x) => x <= 0);
  const total = nets.reduce((a, b) => a + b, 0), years = Math.max(daysBetween(from, to) / 365.25, 1 / 12);
  const by = new Map<string, LabYear>();
  for (const t of trades) {
    const y = t.exit.slice(0, 4), r = by.get(y) ?? { year: y, trades: 0, won: 0, net: 0, worst: 0 };
    r.trades++; if (t.net > 0) r.won++; r.net += t.net; r.worst = Math.min(r.worst, t.net);
    by.set(y, r);
  }
  const byYear = [...by.values()].sort((a, b) => a.year.localeCompare(b.year));
  return {
    trades: trades.length, won: w.length, winRatePct: trades.length ? (w.length / trades.length) * 100 : null, total, perYear: R(total / years), years: Math.round(years * 10) / 10,
    avgWin: w.length ? R(w.reduce((a, b) => a + b, 0) / w.length) : null, avgLoss: l.length ? R(l.reduce((a, b) => a + b, 0) / l.length) : null,
    best: nets.length ? Math.max(...nets) : null, worst: nets.length ? Math.min(...nets) : null, worstMtm: trades.length ? Math.min(...trades.map((t) => t.worstMtm)) : null,
    losingYears: byYear.filter((y) => y.net < 0).length, byYear, modelPriced: trades.filter((t) => t.model > 0).length,
  };
}

/**
 * Monte Carlo: build `runs` histories by drawing the real trade results at random (with repeats), as many as were
 * tested, and read the worst fall from a peak in each. Seeded, so the same trades always give the same answer.
 * It reorders what happened; it cannot invent a move bigger than the worst real trade.
 */
export function labMonteCarlo(nets: number[], tradesPerYear: number, perYear: number, runs = 10_000): LabMonteCarlo {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const n = nets.length, block = Math.max(1, Math.round(tradesPerYear));
  const falls: number[] = [];
  let years = 0, losing = 0;
  for (let k = 0; k < runs; k++) {
    let eq = 0, peak = 0, worst = 0, yr = 0;
    for (let i = 0; i < n; i++) {
      const x = nets[Math.floor(rnd() * n)];
      eq += x; peak = Math.max(peak, eq); worst = Math.min(worst, eq - peak);
      yr += x;
      if ((i + 1) % block === 0) { years++; if (yr < 0) losing++; yr = 0; }
    }
    falls.push(worst);
  }
  falls.sort((a, b) => a - b);
  const at = (p: number) => R(falls[Math.min(runs - 1, Math.floor(p * runs))]);
  const fall1in20 = at(0.05), capital = R(-fall1in20 / 0.2);
  return {
    runs, trades: n, perYear, typicalFall: at(0.5), fall1in20, fall1in100: at(0.01),
    losingYearPct: years ? Math.round((losing / years) * 1000) / 10 : 0, capital, returnPct: capital > 0 ? Math.round((perYear / capital) * 1000) / 10 : null,
  };
}

export type LabPreview = { date: string; expiry: string; spot: number; lot: number; legs: { side: 'BUY' | 'SELL'; kind: 'CE' | 'PE' | 'FUT'; strike: number; expiry: string; lots: number; price: number; model: boolean }[] };

/**
 * The position this strategy would open at the latest close, on the expiry its schedule would use now: for the margin
 * estimate and to show what a trade looks like today. A string says why it cannot be built.
 */
export async function previewLab(s: LabStrategy, data: LabData): Promise<LabPreview | string> {
  const invalid = validateLab(s);
  if (invalid) return invalid;
  const today = [...data.days].reverse().find((x) => x.spotPaise && x.lotSize);
  if (!today) return 'No index close';
  const d = today.date, sc = s.schedule;
  const ahead = (list: string[]) => list.filter((x) => x > d);
  let e: string | undefined;
  if (sc.every === 'expiry') e = ahead(sc.cycle === 'monthly' ? data.monthly : data.expiries).sort((a, b) => Math.abs(daysBetween(d, a) - sc.daysBefore) - Math.abs(daysBetween(d, b) - sc.daysBefore))[0];
  else if (sc.every === 'after-expiry') e = ahead(data.monthly)[sc.months - 1];
  else if (sc.every === 'week') e = ahead(sc.expiry === 'weekly' ? data.expiries : data.monthly)[0];
  else e = ahead(data.monthly).find((x) => Number(x.slice(5, 7)) === sc.expiryMonth);
  if (!e) return 'That expiry is not listed yet';
  const kit = await entryKit(s, data, d, e, d, today.spotPaise!);
  if (typeof kit === 'string') return kit;
  return {
    date: d, expiry: e, spot: today.spotPaise! / 100, lot: today.lotSize!,
    legs: kit.open.map((l) => ({ side: l.spec.side, kind: l.kind, strike: l.strike / 100, expiry: l.expiry, lots: l.spec.lots, price: l.entryPx / 100, model: l.model })),
  };
}
