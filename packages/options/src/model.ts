// Model P&L of a multi-leg, multi-expiry option position at a future time: legs that have expired settle at
// intrinsic value; legs still alive are valued with Black-76 on each leg's own IV and remaining time. Used for
// calendars and diagonals (where "P&L at expiry" depends on the later legs' time value) and for the "today" curve.
// All prices in paise per unit; quantities in units.

import { black76 } from './pricing';
import type { Leg } from './payoff';
import fitData from './data/spot-vol-fit.json';

export type ModelLeg = Leg & {
  /** Years from now to this leg's expiry. */
  years: number;
  /** Annualised implied volatility; null when the contract did not trade. */
  iv: number | null;
  /** Today's IV smile of this leg's expiry (out-of-the-money side per strike), for IV models that follow the skew. */
  smile?: { k: number; iv: number }[];
};

// ---- IV after a move ("what if") ----
// Price is exact for a given IV; the IV after a move is the market's choice. Each model starts from the contract's
// own IV today and applies only the change it predicts, so an unchanged spot, today and no shift give today's price.
// - strike:    every strike keeps today's IV (sticky strike).
// - moneyness: the skew moves with the forward: a strike takes the IV change of the strike at the same moneyness.
// - spotvol:   moneyness, plus the ATM IV change NIFTY options showed for such a move (fitted on NSE closes,
//              apps/feed/scripts/research-whatif.ts): ΔIV = a·(days elapsed, ≤ 1) + bUp·r⁺ + bDown·r⁻.
export type IvModel = 'strike' | 'moneyness' | 'spotvol';
export type SpotVolFit = Record<string, { a: number; bUp: number; bDown: number }>;
export type Scenario = { model: IvModel; /** today's spot, paise */ spot0: number; /** added to every IV, e.g. 0.02 = +2 vol points */ shift: number; fit?: SpotVolFit };

/** The fitted spot-vol coefficients (regenerate with apps/feed/scripts/research-whatif.ts). */
export const SPOT_VOL_FIT: { generated: string; from: string; to: string; buckets: SpotVolFit } = { generated: fitData.generated, from: fitData.from, to: fitData.to, buckets: fitData.dteBuckets };

/** Days-to-expiry bucket used by the spot-vol fit. */
export const dteBucket = (days: number) => (days <= 1 ? '0-1' : days <= 3 ? '2-3' : days <= 7 ? '4-7' : '8+');

export function smileAt(sm: { k: number; iv: number }[], k: number): number {
  if (k <= sm[0].k) return sm[0].iv;
  if (k >= sm[sm.length - 1].k) return sm[sm.length - 1].iv;
  let i = 1;
  while (sm[i].k < k) i++;
  const a = sm[i - 1], b = sm[i];
  return a.iv + ((b.iv - a.iv) * (k - a.k)) / (b.k - a.k);
}

/** IV of a leg at underlying S, `t` years from now, under a scenario; null when the leg has no IV today. */
export function scenarioIv(l: ModelLeg, S: number, t: number, carry: number, sc: Scenario): number | null {
  if (l.iv == null || !(l.iv > 0)) return null;
  let iv = l.iv;
  if (sc.model !== 'strike' && l.smile && l.smile.length >= 2) {
    const f0 = sc.spot0 * Math.exp(carry * l.years), f1 = S * Math.exp(carry * Math.max(0, l.years - t));
    iv += smileAt(l.smile, (l.strikePaise * f0) / f1) - smileAt(l.smile, l.strikePaise);
  }
  if (sc.model === 'spotvol' && sc.fit) {
    const c = sc.fit[dteBucket((l.years - t) * 365)];
    const r = S / sc.spot0 - 1;
    if (c) iv += c.a * Math.min(1, t * 365) + c.bUp * Math.max(r, 0) + c.bDown * Math.min(r, 0);
  }
  return Math.max(0.01, iv + sc.shift);
}

/**
 * Value of one unit of a leg at underlying price S, `t` years from now. `carry` is the annual rate at which the
 * forward exceeds spot (from the market's own futures/forward), so F = S × e^(carry × time left).
 * Uses the leg's own IV, or the scenario's IV for it. Null when a live leg has no IV.
 */
export function legValue(l: ModelLeg, S: number, t: number, rate: number, carry: number, sc?: Scenario): number | null {
  const left = l.years - t;
  if (l.kind === 'FUT') return S * Math.exp(carry * Math.max(0, left));
  if (left <= 1e-9) return Math.max(0, l.kind === 'CE' ? S - l.strikePaise : l.strikePaise - S);
  const iv = sc ? scenarioIv(l, S, t, carry, sc) : l.iv;
  if (iv == null || !(iv > 0)) return null;
  return black76(l.kind, (S * Math.exp(carry * left)) / 100, l.strikePaise / 100, left, rate, iv).price * 100;
}

/** Position P&L (paise) at underlying price S, `t` years from now; null if a live leg has no IV. */
export function pnlAt(legs: ModelLeg[], S: number, t: number, rate: number, carry: number, sc?: Scenario): number | null {
  let sum = 0;
  for (const l of legs) {
    const v = legValue(l, S, t, rate, carry, sc);
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
