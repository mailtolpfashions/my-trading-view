// Model P&L of a multi-leg, multi-expiry option position at a future time: legs that have expired settle at
// intrinsic value; legs still alive are valued with Black-76 on each leg's own IV and remaining time. Used for
// calendars and diagonals (where "P&L at expiry" depends on the later legs' time value) and for the "today" curve.
// All prices in paise per unit; quantities in units.

import { black76 } from './pricing';
import type { Leg } from './payoff';

export type ModelLeg = Leg & {
  /** Years from now to this leg's expiry. */
  years: number;
  /** Annualised implied volatility; null when the contract did not trade. */
  iv: number | null;
};

/**
 * Value of one unit of a leg at underlying price S, `t` years from now. `carry` is the annual rate at which the
 * forward exceeds spot (from the market's own futures/forward), so F = S × e^(carry × time left).
 * Null when a live leg has no IV.
 */
export function legValue(l: ModelLeg, S: number, t: number, rate: number, carry: number): number | null {
  const left = l.years - t;
  if (l.kind === 'FUT') return S * Math.exp(carry * Math.max(0, left));
  if (left <= 1e-9) return Math.max(0, l.kind === 'CE' ? S - l.strikePaise : l.strikePaise - S);
  if (l.iv == null || !(l.iv > 0)) return null;
  return black76(l.kind, (S * Math.exp(carry * left)) / 100, l.strikePaise / 100, left, rate, l.iv).price * 100;
}

/** Position P&L (paise) at underlying price S, `t` years from now; null if a live leg has no IV. */
export function pnlAt(legs: ModelLeg[], S: number, t: number, rate: number, carry: number): number | null {
  let sum = 0;
  for (const l of legs) {
    const v = legValue(l, S, t, rate, carry);
    if (v == null) return null;
    sum += (l.side === 'BUY' ? 1 : -1) * l.qty * (v - l.pricePaise);
  }
  return sum;
}

export type CurveSummary = { maxProfitPaise: number; maxLossPaise: number; breakevens: number[]; lo: number; hi: number };

/**
 * Max profit, max loss and breakevens of a P&L curve over underlying prices [lo, hi], sampled every `step` paise
 * with breakevens interpolated between samples. For model curves, so results hold only inside the range.
 */
export function summariseCurve(f: (S: number) => number, lo: number, hi: number, step: number): CurveSummary {
  let prevS = lo, prev = f(lo), max = prev, min = prev;
  const breakevens: number[] = [];
  for (let S = lo + step; S <= hi + 1e-9; S += step) {
    const v = f(S);
    if (v > max) max = v;
    if (v < min) min = v;
    if ((prev < 0 && v >= 0) || (prev > 0 && v <= 0)) breakevens.push(prevS + (-prev * (S - prevS)) / (v - prev));
    prevS = S; prev = v;
  }
  return { maxProfitPaise: Math.round(max), maxLossPaise: Math.round(Math.min(0, min)), breakevens, lo, hi };
}
