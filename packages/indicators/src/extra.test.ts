// Every indicator in extra.ts against oakscriptjs, an independent PineScript-compatible library, on 1,423 real NIFTY
// 5-minute bars. Agreement to 1e-6 on every bar (after both warm-ups) means the formula, warm-up and na rules match
// Pine's built-ins. TradingView screenshot values still go in golden.test.ts when available.

import { readFileSync } from 'node:fs';
import { taCore as ta } from 'oakscriptjs';
import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import {
  aroon, bbWidth, cci, change, choppiness, dmi, highest, historicalVolatility, ichimoku, lowest, meanDev, mfi, obv,
  percentB, pivotHigh, pivotLow, pivotPoints, psar, roc, stdev, stochastic, stochRsi, sum, tsi, williamsR,
  type Series,
} from './index';

const bars: Candle[] = JSON.parse(readFileSync(new URL('../fixtures/nifty-5m-2026-10-26.json', import.meta.url), 'utf8')).candles;
// The index fixture has no volume; give each bar a deterministic, varying volume for the volume-based indicators.
const c = bars.map((b, i) => ({ ...b, volume: 1000 + ((i * 7919) % 5000) + Math.round((b.high - b.low) * 10) }));
const close = c.map((b) => b.close), high = c.map((b) => b.high), low = c.map((b) => b.low), vol = c.map((b) => b.volume);
const hlc3 = c.map((b) => (b.high + b.low + b.close) / 3);

/** Compares on every bar: both na, or both numbers within tolerance. Reports the first mismatch. */
function same(ours: Series, ref: ArrayLike<number>, tol = 1e-6, from = 0) {
  expect(ours.length).toBe(ref.length);
  for (let i = from; i < ours.length; i++) {
    const r = ref[i], o = ours[i];
    const rNa = r == null || Number.isNaN(r);
    if (rNa || o == null) {
      expect({ i, ours: o, ref: rNa ? null : r }).toEqual({ i, ours: rNa ? null : o, ref: o == null ? null : r });
      continue;
    }
    if (Math.abs(o - r) > tol * Math.max(1, Math.abs(r))) expect({ i, ours: o }).toEqual({ i, ours: r });
  }
}

describe('basic series functions match Pine', () => {
  it('stdev, highest, lowest, sum, change, roc, dev', () => {
    same(stdev(close, 20), ta.stdev(close, 20));
    same(highest(high, 20), ta.highest(high, 20));
    same(lowest(low, 20), ta.lowest(low, 20));
    same(sum(close, 10), close.map((_, i) => (i >= 9 ? close.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) : NaN)));
    same(change(close, 3), ta.change(close, 3));
    same(roc(close, 9), ta.roc(close, 9));
    same(meanDev(close, 20), ta.dev(close, 20));
  });
});

describe('oscillators match Pine built-ins', () => {
  it('Stochastic %K/%D (14, 1, 3)', () => {
    const s = stochastic(c, 14, 1, 3);
    const k = ta.sma(ta.stoch(close, high, low, 14), 1);
    same(s.k, k);
    same(s.d, ta.sma(k, 3));
  });
  // Pine fills ta.stoch's window with however many RSI values exist, so TradingView shows partial values from bar 17.
  // We stay null until the window holds 14 RSI values (bar 27, then the two SMAs): only listings younger than about
  // 32 bars are affected. From there on the values must agree exactly.
  it('Stochastic RSI (14, 14, 3, 3), after the full warm-up', () => {
    const r = ta.rsi(close, 14);
    const k = ta.sma(ta.stoch(r, r, r, 14), 3);
    const s = stochRsi(close, 14, 14, 3, 3);
    expect(s.k.findIndex((v) => v != null)).toBe(14 + 13 + 2);
    same(s.k, k, 1e-6, 29);
    same(s.d, ta.sma(k, 3), 1e-6, 31);
  });
  it('Williams %R, CCI, MFI, TSI', () => {
    same(williamsR(c, 14), ta.wpr(high, low, close, 14));
    same(cci(hlc3, 20), ta.cci(hlc3, 20));
    same(mfi(c, 14), ta.mfi(hlc3, 14, vol));
    same(tsi(close, 25, 13), ta.tsi(close, 13, 25).map((v) => v * 100));
  });
});

describe('trend indicators match Pine built-ins', () => {
  it('DMI / ADX (14, 14)', () => {
    const [plus, minus, adx] = ta.dmi(14, 14, high, low, close);
    const d = dmi(c, 14, 14);
    same(d.plus, plus);
    same(d.minus, minus);
    same(d.adx, adx);
  });
  it('Aroon (14): 100 × (highestbars(high, 15) + 14) / 14', () => {
    const a = aroon(c, 14);
    same(a.up, ta.highestbars(high, 15).map((o) => (100 * (o + 14)) / 14));
    same(a.down, ta.lowestbars(low, 15).map((o) => (100 * (o + 14)) / 14));
  });
  it('Parabolic SAR (0.02, 0.02, 0.2)', () => {
    same(psar(c, 0.02, 0.02, 0.2), ta.sar(0.02, 0.02, 0.2, high, low, close));
  });
  it('Ichimoku lines (9, 26, 52, 26)', () => {
    const [tenkan, kijun] = ta.ichimoku(9, 26, 52, 26, high, low, close);
    const i = ichimoku(c);
    same(i.conversion, tenkan);
    same(i.base, kijun);
    // The cloud over bar i was computed displacement - 1 bars earlier.
    same(i.spanA, i.leadA.map((_, k) => (k >= 25 && i.leadA[k - 25] != null ? i.leadA[k - 25]! : NaN)));
  });
  it('Choppiness (14)', () => {
    const atr1 = ta.atr(1, high, low, close);
    const ref = close.map((_, k) => {
      if (k < 13) return NaN;
      const s = atr1.slice(k - 13, k + 1).reduce((a, b) => a + b, 0);
      return (100 * Math.log10(s / (ta.highest(high, 14)[k] - ta.lowest(low, 14)[k]))) / Math.log10(14);
    });
    same(choppiness(c, 14), ref);
  });
});

describe('volatility and bands match Pine', () => {
  it('Bollinger BandWidth and %B (20, 2)', () => {
    same(bbWidth(close, 20, 2), ta.bbw(close, 20, 2));
    const [, upper, lower] = ta.bb(close, 20, 2);
    same(percentB(close, 20, 2), close.map((v, i) => (v - lower[i]) / (upper[i] - lower[i])));
  });
  it('Historical volatility (10) on daily-style bars', () => {
    const lr = close.map((v, i) => (i ? Math.log(v / close[i - 1]) : NaN));
    same(historicalVolatility(close, 10, 1), ta.stdev(lr, 10).map((v) => 100 * v * Math.sqrt(365)));
  });
  it('OBV from bar 1 (Pine gives na on bar 0)', () => {
    same(obv(c), ta.obv(close, vol), 1e-6, 1);
  });
});

describe('pivots match Pine', () => {
  it('pivot highs and lows (5, 5)', () => {
    same(pivotHigh(high, 5, 5), ta.pivothigh(high, 5, 5));
    same(pivotLow(low, 5, 5), ta.pivotlow(low, 5, 5));
  });
  it('every pivot method and level, anchored on each bar', () => {
    const anchor = c.map(() => true);
    const names = ['TRADITIONAL', 'FIBONACCI', 'CLASSIC', 'WOODIE', 'CAMARILLA', 'DM'] as const;
    const pine = { TRADITIONAL: 'Traditional', FIBONACCI: 'Fibonacci', CLASSIC: 'Classic', WOODIE: 'Woodie', CAMARILLA: 'Camarilla', DM: 'DM' };
    const levels = ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3', 'R4', 'S4', 'R5', 'S5'] as const;
    for (const m of names) {
      const ref = ta.pivot_point_levels(pine[m], anchor, false, high, low, close, c.map((b) => b.open));
      levels.forEach((lv, k) => same(pivotPoints(c, m, lv), ref[k], 1e-9, 1));
    }
  });
});
