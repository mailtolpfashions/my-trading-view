// Corporate-action adjustment from NSE's own corporate-action file. Bars before an ex-date are multiplied by that
// action's factor (and every later one's), so the series is continuous, as on TradingView (splits and bonuses;
// dividends are not adjusted). Every applied adjustment is reported, with a check against the actual price gap.

import type { Candle } from '@mtv/shared';
import { parsePurpose } from './corporate';

export type RawBar = {
  date: string; // YYYY-MM-DD
  symbol: string;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  prevClosePaise: number;
  volume: number;
};

export type CorporateAction = { symbol: string; exDate: string; purpose: string };

export type Adjustment = {
  /** First trading day on or after the ex-date: bars before it are adjusted. */
  date: string;
  exDate: string;
  symbol: string;
  purpose: string;
  factor: number;
  /** Ex-day open ÷ previous close, as traded: should be near `factor`. */
  impliedRatio: number;
  /** True when the actual price gap disagrees with the factor by more than 30%: worth a manual look. */
  check: boolean;
};

export type UnhandledAction = CorporateAction & { reason: string };

const IST = 5.5 * 3600;
/** Daily bars are stamped 09:15 IST, like the rest of the platform. */
export const dayTime = (date: string) => Date.parse(`${date}T09:15:00Z`) / 1000 - IST;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Adjustments (and actions that could not be applied) for bars in date order. Actions are matched by the symbol each
 * bar traded under. `faceValue` is the stock's face value today (NSE equity list); rights issues need the face value
 * on their ex-date, which is the "from" value of the first later split or consolidation, if any.
 */
export function findAdjustments(bars: RawBar[], actions: CorporateAction[], faceValue: number | null = null): { adjustments: Adjustment[]; unhandled: UnhandledAction[] } {
  const adjustments: Adjustment[] = [];
  const unhandled: UnhandledAction[] = [];
  const seen = new Set<string>();
  const fvChanges = actions
    .flatMap((a) => parsePurpose(a.purpose).flatMap((p) => (p.kind === 'adjust' && p.type !== 'bonus' ? [{ exDate: a.exDate, fromFv: p.fromFv }] : [])))
    .sort((x, y) => (x.exDate < y.exDate ? -1 : 1));
  const faceValueOn = (exDate: string) => fvChanges.find((c) => c.exDate > exDate)?.fromFv ?? faceValue;
  for (const a of actions) {
    const key = `${a.symbol}|${a.exDate}|${a.purpose}`;
    if (seen.has(key)) continue; // the file lists EQ and BE rows, and the same action on several days
    seen.add(key);
    const i = bars.findIndex((b) => b.date >= a.exDate);
    // Only actions inside the history, on the symbol the stock traded under at that time.
    if (i <= 0 || bars[i - 1].date >= a.exDate || bars[i].symbol !== a.symbol) continue;
    let factor = 1;
    for (const p of parsePurpose(a.purpose)) {
      if (p.kind === 'adjust') factor *= p.factor;
      else if (p.kind === 'unhandled') unhandled.push({ ...a, reason: p.reason });
      else if (p.kind === 'rights') {
        const fv = faceValueOn(a.exDate);
        if (fv == null) { unhandled.push({ ...a, reason: `rights issue: face value unknown: ${a.purpose}` }); continue; }
        factor *= rightsFactor(bars[i - 1].closePaise / 100, fv + p.premium, p.newShares, p.held);
      }
    }
    if (factor === 1) continue;
    const implied = bars[i].openPaise / bars[i - 1].closePaise;
    const existing = adjustments.find((x) => x.date === bars[i].date);
    if (existing) { existing.factor *= factor; existing.purpose += ` + ${a.purpose}`; continue; }
    adjustments.push({ date: bars[i].date, exDate: a.exDate, symbol: a.symbol, purpose: a.purpose, factor, impliedRatio: implied, check: false });
  }
  for (const a of adjustments) a.check = Math.abs(a.impliedRatio / a.factor - 1) > 0.3;
  adjustments.sort((x, y) => (x.date < y.date ? -1 : 1));
  // NSE sometimes lists one action twice with ex-dates a few days apart (e.g. HAL's 2023 split). Applying both would
  // double the adjustment, so keep only the copy whose actual price gap matches the factor best.
  const miss = (a: Adjustment) => Math.abs(a.impliedRatio / a.factor - 1);
  const days = (x: string, y: string) => Math.abs(Date.parse(y) - Date.parse(x)) / 86400_000;
  const kept = adjustments.filter((a) => !adjustments.some((o) => o !== a && o.purpose === a.purpose && days(o.exDate, a.exDate) <= 10 && (miss(o) < miss(a) || (miss(o) === miss(a) && o.date < a.date))));
  return { adjustments: kept, unhandled };
}

/**
 * NSE's rights adjustment (as for F&O contracts): P = close on the last cum-rights day, S = issue price, a new shares
 * per b held. Benefit E = (P − S)·a/(a+b); factor = (P − E)/P, the theoretical ex-rights price over P. No benefit when
 * S ≥ P, so no adjustment.
 */
export function rightsFactor(cumClose: number, issuePrice: number, newShares: number, held: number): number {
  if (!(cumClose > 0) || issuePrice >= cumClose) return 1;
  const benefit = ((cumClose - issuePrice) * newShares) / (newShares + held);
  return (cumClose - benefit) / cumClose;
}

/**
 * Adjusted daily candles (rupees, rounded to paise) from raw bars in date order. Volume is divided by the same factor,
 * so a 1:2 split doubles earlier volumes, as on TradingView.
 */
export function adjustedCandles(bars: RawBar[], adjustments: Adjustment[]): Candle[] {
  const factorOn = new Map<string, number>(adjustments.map((a) => [a.date, a.factor]));
  const out: Candle[] = new Array(bars.length);
  let factor = 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    out[i] = {
      time: dayTime(b.date),
      open: r2((b.openPaise / 100) * factor),
      high: r2((b.highPaise / 100) * factor),
      low: r2((b.lowPaise / 100) * factor),
      close: r2((b.closePaise / 100) * factor),
      volume: Math.round(b.volume / factor),
    };
    const ex = factorOn.get(b.date);
    if (ex !== undefined) factor *= ex; // bars before this ex-date take this action's factor
  }
  return out;
}

/** A trading day where the adjusted series is not continuous with the day before (see findBreaks). */
export type DataBreak = { date: string; reason: string };

const MAX_GAP = 0.5;
/** See DailyHistory.breaks. One entry per break day, with every reason found. */
export function findBreaks(bars: (RawBar & { isin: string })[], candles: Candle[], adjustments: Adjustment[], unhandled: UnhandledAction[]): DataBreak[] {
  const adjusted = new Set(adjustments.map((a) => a.date));
  const reasons = new Map<string, string[]>();
  const add = (date: string, why: string) => (reasons.get(date) ?? reasons.set(date, []).get(date)!).push(why);
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].isin !== bars[i - 1].isin && !adjusted.has(bars[i].date)) add(bars[i].date, `ISIN changed ${bars[i - 1].isin} → ${bars[i].isin} with no recorded split or bonus`);
    const gap = candles[i].open / candles[i - 1].close - 1;
    if (Math.abs(gap) > MAX_GAP) add(bars[i].date, `opening gap ${(gap * 100).toFixed(1)}% after adjustments`);
  }
  for (const u of unhandled) {
    const day = bars.find((b) => b.date >= u.exDate);
    if (day && day !== bars[0]) add(day.date, `not adjusted: ${u.purpose}`);
  }
  return [...reasons].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, why]) => ({ date, reason: why.join('; ') }));
}
