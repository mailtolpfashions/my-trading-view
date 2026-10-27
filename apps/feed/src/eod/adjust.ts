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

/** Adjustments (and actions that could not be applied) for bars in date order. Actions are matched by the symbol each bar traded under. */
export function findAdjustments(bars: RawBar[], actions: CorporateAction[]): { adjustments: Adjustment[]; unhandled: UnhandledAction[] } {
  const adjustments: Adjustment[] = [];
  const unhandled: UnhandledAction[] = [];
  const seen = new Set<string>();
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
