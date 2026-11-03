// More of TradingView's built-in indicators, each following the PineScript built-in's formula (noted per function).
// extra.test.ts compares every one with oakscriptjs, an independent PineScript-compatible library, on real NIFTY bars.
// Same conventions as index.ts: arrays aligned with the input, null during warm-up and where Pine gives na.

import type { Candle } from '@mtv/shared';
import { ema, rma, rsi, sma, smaOfSeries, trueRange, bollinger, type Series } from './index';

const nulls = (n: number): Series => new Array(n).fill(null);

/**
 * Applies `fn` to each run of consecutive non-null values (positions outside a run stay null), so an indicator of an
 * indicator (EMA of RSI, Stoch of RSI) starts after the inner one's warm-up, as Pine's na-skipping does.
 */
export function onRuns(values: Series, fn: (run: number[]) => Series): Series {
  const out = nulls(values.length);
  let i = 0;
  while (i < values.length) {
    if (values[i] == null) { i++; continue; }
    let j = i;
    while (j < values.length && values[j] != null) j++;
    const r = fn(values.slice(i, j) as number[]);
    for (let k = 0; k < r.length; k++) out[i + k] = r[k];
    i = j;
  }
  return out;
}

/** Population standard deviation over `period` bars (Pine ta.stdev, biased). */
export function stdev(values: number[], period: number): Series {
  const out = nulls(values.length);
  const m = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const mean = m[i]!;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

// Sliding-window extreme INCLUDING the current bar (Pine ta.highest / ta.lowest), monotonic queue, O(n).
function extreme(values: number[], period: number, better: (a: number, b: number) => boolean): Series {
  const out = nulls(values.length);
  const q: number[] = [];
  let head = 0;
  for (let i = 0; i < values.length; i++) {
    while (q.length > head && better(values[i], values[q[q.length - 1]])) q.pop();
    q.push(i);
    while (q[head] <= i - period) head++;
    if (i >= period - 1) out[i] = values[q[head]];
  }
  return out;
}
/** Highest value of the last `period` bars, this bar included (Pine ta.highest). */
export const highest = (values: number[], period: number) => extreme(values, period, (a, b) => a >= b);
/** Lowest value of the last `period` bars, this bar included (Pine ta.lowest). */
export const lowest = (values: number[], period: number) => extreme(values, period, (a, b) => a <= b);

/** Sum of the last `period` values (Pine math.sum). */
export function sum(values: number[], period: number): Series {
  const out = nulls(values.length);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= period) s -= values[i - period];
    if (i >= period - 1) out[i] = s;
  }
  return out;
}

/** values[i] - values[i - n] (Pine ta.change, ta.mom). */
export function change(values: number[], n = 1): Series {
  return values.map((v, i) => (i >= n ? v - values[i - n] : null));
}

/** Rate of change in %: 100 × (v - v[n]) / v[n] (Pine ta.roc). */
export function roc(values: number[], n = 9): Series {
  return values.map((v, i) => (i >= n && values[i - n] !== 0 ? (100 * (v - values[i - n])) / values[i - n] : null));
}

/** Mean absolute deviation from the SMA (Pine ta.dev). */
export function meanDev(values: number[], period: number): Series {
  const out = nulls(values.length);
  const m = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    let d = 0;
    for (let j = i - period + 1; j <= i; j++) d += Math.abs(values[j] - m[i]!);
    out[i] = d / period;
  }
  return out;
}

/** Raw stochastic: 100 × (src - lowest(low)) / (highest(high) - lowest(low)) (Pine ta.stoch); null on a zero range. */
export function stochRaw(src: number[], high: number[], low: number[], period: number): Series {
  const hh = highest(high, period), ll = lowest(low, period);
  return src.map((v, i) => (hh[i] == null || ll[i] == null || hh[i] === ll[i] ? null : (100 * (v - ll[i]!)) / (hh[i]! - ll[i]!)));
}

/** Stochastic %K / %D (TradingView "Stochastic": %K length 14, %K smoothing 1, %D smoothing 3). */
export function stochastic(c: Candle[], kLen = 14, smoothK = 1, dLen = 3) {
  const raw = stochRaw(c.map((b) => b.close), c.map((b) => b.high), c.map((b) => b.low), kLen);
  const k = smaOfSeries(raw, smoothK);
  return { k, d: smaOfSeries(k, dLen) };
}

/** Stochastic RSI (TradingView "Stoch RSI": RSI 14, stochastic 14, K 3, D 3). */
export function stochRsi(closes: number[], rsiLen = 14, stochLen = 14, smoothK = 3, smoothD = 3) {
  const raw = onRuns(rsi(closes, rsiLen), (r) => stochRaw(r, r, r, stochLen));
  const k = smaOfSeries(raw, smoothK);
  return { k, d: smaOfSeries(k, smoothD) };
}

/** Williams %R, -100..0 (Pine ta.wpr). */
export function williamsR(c: Candle[], period = 14): Series {
  const hh = highest(c.map((b) => b.high), period), ll = lowest(c.map((b) => b.low), period);
  return c.map((b, i) => (hh[i] == null || hh[i] === ll[i] ? null : (100 * (b.close - hh[i]!)) / (hh[i]! - ll[i]!)));
}

/** Commodity Channel Index of `src` (TradingView "CCI": source hlc3, length 20). */
export function cci(src: number[], period = 20): Series {
  const m = sma(src, period), d = meanDev(src, period);
  return src.map((v, i) => (m[i] == null || !d[i] ? null : (v - m[i]!) / (0.015 * d[i]!)));
}

/**
 * Money Flow Index on hlc3 (Pine ta.mfi, TradingView "MFI" length 14). As in Pine, bar 0 (no change yet) adds its
 * money flow to both sides; a window with no down flow gives 100.
 */
export function mfi(c: Candle[], period = 14): Series {
  const src = c.map((b) => (b.high + b.low + b.close) / 3);
  const up = src.map((v, i) => (i > 0 && v - src[i - 1] <= 0 ? 0 : v * c[i].volume));
  const dn = src.map((v, i) => (i > 0 && v - src[i - 1] >= 0 ? 0 : v * c[i].volume));
  const u = sum(up, period), d = sum(dn, period);
  return u.map((uv, i) => {
    const dv = d[i];
    if (uv == null || dv == null) return null;
    if (Math.abs(dv) <= 1e-10) return 100;
    return 100 - 100 / (1 + uv / dv);
  });
}

/** True Strength Index × 100 (TradingView "TSI": long 25, short 13): double-smoothed momentum over its absolute value. */
export function tsi(closes: number[], long = 25, short = 13): Series {
  const pc = change(closes, 1);
  const ds = (s: Series) => onRuns(onRuns(s, (r) => ema(r, long)), (r) => ema(r, short));
  const num = ds(pc), den = ds(pc.map((v) => (v == null ? null : Math.abs(v))));
  return num.map((n, i) => (n == null || !den[i] ? null : (100 * n) / den[i]!));
}

/**
 * Directional Movement (TradingView "DMI": DI length 14, ADX smoothing 14). Uses Pine's ta.tr without na handling,
 * so everything starts on bar 1; a zero true range keeps the previous DI (Pine fixnan).
 */
export function dmi(c: Candle[], diLen = 14, adxLen = 14) {
  const n = c.length;
  const plusDM: Series = nulls(n), minusDM: Series = nulls(n), tr: Series = nulls(n);
  const tr0 = trueRange(c);
  for (let i = 1; i < n; i++) {
    const up = c[i].high - c[i - 1].high, down = c[i - 1].low - c[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = tr0[i];
  }
  const trur = onRuns(tr, (r) => rma(r, diLen));
  const di = (dm: Series) => {
    const s = onRuns(dm, (r) => rma(r, diLen));
    let last: number | null = null;
    return s.map((v, i) => {
      if (v != null && trur[i]) last = (100 * v) / trur[i]!;
      return v == null ? null : last;
    });
  };
  const plus = di(plusDM), minus = di(minusDM);
  const dx: Series = plus.map((p, i) => {
    const m = minus[i];
    if (p == null || m == null) return null;
    return Math.abs(p - m) / (p + m === 0 ? 1 : p + m);
  });
  const adx = onRuns(dx, (r) => rma(r, adxLen)).map((v) => (v == null ? null : 100 * v));
  return { plus, minus, adx };
}

/**
 * Aroon Up / Down, 0..100 (TradingView "Aroon" length 14): 100 × (length - bars since the highest high) / length over
 * the last length + 1 bars. On ties the most recent bar counts, as Pine's highestbars.
 */
export function aroon(c: Candle[], period = 14) {
  const n = c.length, w = period + 1;
  const up: Series = nulls(n), down: Series = nulls(n);
  for (let i = w - 1; i < n; i++) {
    let hi = i, lo = i;
    for (let j = i - 1; j > i - w; j--) {
      if (c[j].high > c[hi].high) hi = j;
      if (c[j].low < c[lo].low) lo = j;
    }
    up[i] = (100 * (period - (i - hi))) / period;
    down[i] = (100 * (period - (i - lo))) / period;
  }
  return { up, down };
}

/** Parabolic SAR (Pine ta.sar reference implementation; TradingView defaults start 0.02, increment 0.02, max 0.2). */
export function psar(c: Candle[], start = 0.02, inc = 0.02, max = 0.2): Series {
  const out = nulls(c.length);
  let result = 0, maxMin = 0, acc = start, isBelow = false;
  for (let i = 1; i < c.length; i++) {
    let first = false;
    if (i === 1) {
      if (c[1].close > c[0].close) { isBelow = true; maxMin = c[1].high; result = c[0].low; }
      else { isBelow = false; maxMin = c[1].low; result = c[0].high; }
      first = true;
      acc = start;
    }
    result = result + acc * (maxMin - result);
    if (isBelow) {
      if (result > c[i].low) { first = true; isBelow = false; result = Math.max(c[i].high, maxMin); maxMin = c[i].low; acc = start; }
    } else if (result < c[i].high) { first = true; isBelow = true; result = Math.min(c[i].low, maxMin); maxMin = c[i].high; acc = start; }
    if (!first) {
      if (isBelow) { if (c[i].high > maxMin) { maxMin = c[i].high; acc = Math.min(acc + inc, max); } }
      else if (c[i].low < maxMin) { maxMin = c[i].low; acc = Math.min(acc + inc, max); }
    }
    if (isBelow) { result = Math.min(result, c[i - 1].low); if (i > 1) result = Math.min(result, c[i - 2].low); }
    else { result = Math.max(result, c[i - 1].high); if (i > 1) result = Math.max(result, c[i - 2].high); }
    out[i] = result;
  }
  return out;
}

const donchian = (c: Candle[], period: number): Series => {
  const hh = highest(c.map((b) => b.high), period), ll = lowest(c.map((b) => b.low), period);
  return hh.map((h, i) => (h == null || ll[i] == null ? null : (h + ll[i]!) / 2));
};
const shiftForward = (s: Series, bars: number): Series => s.map((_, i) => (i >= bars ? s[i - bars] : null));

/**
 * Ichimoku (TradingView defaults 9, 26, 52, 26). `spanA` / `spanB` are the cloud values AT each bar: TradingView plots
 * the leading spans displacement - 1 bars ahead, so the cloud over bar i was computed on bar i - (displacement - 1).
 * The lagging span is just the close plotted back; compare CLOSE with REF(CLOSE, displacement - 1) for it.
 */
export function ichimoku(c: Candle[], conv = 9, base = 26, spanBLen = 52, displacement = 26) {
  const conversion = donchian(c, conv), baseLine = donchian(c, base);
  const leadA: Series = conversion.map((v, i) => (v == null || baseLine[i] == null ? null : (v + baseLine[i]!) / 2));
  const leadB = donchian(c, spanBLen);
  return { conversion, base: baseLine, leadA, leadB, spanA: shiftForward(leadA, displacement - 1), spanB: shiftForward(leadB, displacement - 1) };
}

/** Choppiness Index (TradingView "CHOP" length 14): near 100 choppy, near 0 trending. */
export function choppiness(c: Candle[], period = 14): Series {
  const s = sum(trueRange(c), period);
  const hh = highest(c.map((b) => b.high), period), ll = lowest(c.map((b) => b.low), period);
  return s.map((v, i) => (v == null || hh[i] == null || hh[i] === ll[i] ? null : (100 * Math.log10(v / (hh[i]! - ll[i]!))) / Math.log10(period)));
}

/**
 * Historical volatility in % (TradingView "HV" length 10): 100 × stdev(ln(close / close[1])) × √(annual / per), with
 * TradingView's constants: annual 365; per 1 on daily and intraday bars, 7 on weekly and longer ones.
 */
export function historicalVolatility(closes: number[], period = 10, per: 1 | 7 = 1): Series {
  const lr: Series = closes.map((v, i) => (i > 0 && closes[i - 1] > 0 && v > 0 ? Math.log(v / closes[i - 1]) : null));
  return onRuns(lr, (r) => stdev(r, period)).map((v) => (v == null ? null : 100 * v * Math.sqrt(365 / per)));
}

function pivot(values: number[], left: number, right: number, high: boolean): Series {
  const out = nulls(values.length);
  for (let i = left + right; i < values.length; i++) {
    const p = i - right, v = values[p];
    let ok = true;
    for (let j = p - left; j < p && ok; j++) ok = high ? values[j] <= v : values[j] >= v;
    for (let j = p + 1; j <= i && ok; j++) ok = high ? values[j] < v : values[j] > v;
    if (ok) out[i] = v;
  }
  return out;
}
/**
 * Pivot high confirmed `right` bars later (Pine ta.pivothigh): the value appears on bar i when bar i - right is the
 * highest, equal-or-higher than the `left` bars before it and strictly higher than the `right` bars after it.
 */
export const pivotHigh = (values: number[], left: number, right: number) => pivot(values, left, right, true);
/** Pivot low confirmed `right` bars later (Pine ta.pivotlow). */
export const pivotLow = (values: number[], left: number, right: number) => pivot(values, left, right, false);

export type PivotMethod = 'TRADITIONAL' | 'CLASSIC' | 'FIBONACCI' | 'WOODIE' | 'CAMARILLA' | 'DM';
export const PIVOT_LEVELS = ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3', 'R4', 'S4', 'R5', 'S5'] as const;
export type PivotLevel = (typeof PIVOT_LEVELS)[number];

/** The 11 levels from one period's H, L, C and open, in Pine's order and operations (ta.pivot_point_levels). */
export function pivotLevelValues(m: PivotMethod, h: number, l: number, c: number, o: number, nextOpen: number): (number | null)[] {
  const r = h - l, N = null;
  const p = (h + l + c) / 3;
  switch (m) {
    case 'TRADITIONAL':
      return [p, 2 * p - l, 2 * p - h, p + r, p - r, p * 2 + (h - 2 * l), p * 2 - (2 * h - l), p * 3 + (h - 3 * l), p * 3 - (3 * h - l), p * 4 + (h - 4 * l), p * 4 - (4 * h - l)];
    case 'FIBONACCI':
      return [p, p + 0.382 * r, p - 0.382 * r, p + 0.618 * r, p - 0.618 * r, p + 1 * r, p - 1 * r, N, N, N, N];
    case 'CLASSIC':
      return [p, 2 * p - l, 2 * p - h, p + r, p - r, p + 2 * r, p - 2 * r, p + 3 * r, p - 3 * r, N, N];
    case 'WOODIE': {
      const w = (h + l + 2 * nextOpen) / 4, r3 = h + 2 * (w - l), s3 = l - 2 * (h - w);
      return [w, 2 * w - l, 2 * w - h, w + r, w - r, r3, s3, r3 + r, s3 - r, N, N];
    }
    case 'DM': {
      const x = c < o ? h + 2 * l + c : c > o ? 2 * h + l + c : h + l + 2 * c;
      return [x / 4, x / 2 - l, x / 2 - h, N, N, N, N, N, N, N, N];
    }
    case 'CAMARILLA': {
      const r5 = (h / l) * c;
      return [p, c + (r * 1.1) / 12, c - (r * 1.1) / 12, c + (r * 1.1) / 6, c - (r * 1.1) / 6, c + (r * 1.1) / 4, c - (r * 1.1) / 4, c + (r * 1.1) / 2, c - (r * 1.1) / 2, r5, 2 * c - r5];
    }
  }
}

/**
 * Pivot level on each bar from the PREVIOUS bar of the same series. Run on daily bars for daily pivots, weekly bars
 * for weekly ones (the rules engine does this through the timeframe). Woodie uses this bar's open, as in Pine.
 */
export function pivotPoints(c: Candle[], method: PivotMethod, level: PivotLevel): Series {
  const k = PIVOT_LEVELS.indexOf(level);
  return c.map((b, i) => {
    if (i === 0) return null;
    const p = c[i - 1];
    return pivotLevelValues(method, p.high, p.low, p.close, p.open, b.open)[k];
  });
}

/** Bollinger BandWidth in % of the middle band (Pine ta.bbw). */
export function bbWidth(closes: number[], period = 20, mult = 2): Series {
  const b = bollinger(closes, period, mult);
  return b.middle.map((m, i) => (m == null || m === 0 ? null : ((b.upper[i]! - b.lower[i]!) / m) * 100));
}

/** Bollinger %B: 0 at the lower band, 1 at the upper band. */
export function percentB(closes: number[], period = 20, mult = 2): Series {
  const b = bollinger(closes, period, mult);
  return closes.map((v, i) => (b.upper[i] == null || b.upper[i] === b.lower[i] ? null : (v - b.lower[i]!) / (b.upper[i]! - b.lower[i]!)));
}

/** On-balance volume (Pine ta.obv), starting at 0. */
export function obv(c: Candle[]): Series {
  let acc = 0;
  return c.map((b, i) => {
    if (i > 0) acc += b.close > c[i - 1].close ? b.volume : b.close < c[i - 1].close ? -b.volume : 0;
    return acc;
  });
}
