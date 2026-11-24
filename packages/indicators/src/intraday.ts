// Intraday market-structure indicators for scalping (from the "Long and the Short" scalping series, part 4).
// Bars must be intraday candles of one instrument in time order (any timeframe); each IST trading day is a session.
// Segments: S1 9:15–11:30, S2 11:30–13:30, S3 13:30–15:30 (IST, by bar open time).

import type { Candle } from '@mtv/shared';
import { ema, type Series } from './index';

const IST = 5.5 * 3600;
/** IST calendar day number of a bar. */
export const istDay = (t: number) => Math.floor((t + IST) / 86400);
/** IST time of day as hhmm (e.g. 915, 1330). */
export const istHm = (t: number) => { const s = (t + IST) % 86400; return Math.floor(s / 3600) * 100 + Math.floor((s % 3600) / 60); };
/** Intraday segment of a bar: 1 (before 11:30), 2 (11:30–13:30), 3 (13:30 on). */
export const segmentOf = (t: number): 1 | 2 | 3 => { const h = istHm(t); return h < 1130 ? 1 : h < 1330 ? 2 : 3; };

/**
 * Time-weighted average price since the session open: the running mean of `source` over the day's bars so far
 * (equal weight per bar). Default source ohlc4. For instruments without volume (the NIFTY index), in place of VWAP.
 */
export function twap(c: Candle[], source: (b: Candle) => number = (b) => (b.open + b.high + b.low + b.close) / 4): Series {
  let sum = 0, n = 0, day = -1;
  return c.map((b) => {
    const d = istDay(b.time);
    if (d !== day) { day = d; sum = 0; n = 0; }
    sum += source(b); n++;
    return sum / n;
  });
}

/**
 * EMA band trend state: an EMA of highs and an EMA of lows (`period` bars, continuous across days, as on a chart).
 * Close above the high EMA = 2 (long strong); below the low EMA = -2 (short strong); inside the band = weak, keeping
 * the side of the last strong close: 1 (long weak) / -1 (short weak); 0 before any strong close.
 */
export function emaBandState(c: Candle[], period = 9) {
  const hi = ema(c.map((b) => b.high), period), lo = ema(c.map((b) => b.low), period);
  let side = 0;
  const state = c.map((b, i): -2 | -1 | 0 | 1 | 2 => {
    const h = hi[i], l = lo[i];
    if (h == null || l == null) return 0;
    if (b.close > h) { side = 1; return 2; }
    if (b.close < l) { side = -1; return -2; }
    return side as -1 | 0 | 1;
  });
  return { high: hi, low: lo, state };
}

export type SessionStat = {
  /** Day high / low / range (high − low) so far, including this bar. */
  high: number; low: number; range: number;
  /** Mean range of the previous `avgDays` complete sessions (null until there are that many). */
  avgRange: number | null;
  /** range ÷ avgRange (1 = an average day's full range already done). */
  rangeVsAvg: number | null;
  /** Points from the close to the day high / low, and the close's position in the range: 0 = at low, 1 = at high. */
  fromHigh: number; fromLow: number; position: number;
  segment: 1 | 2 | 3;
  /** Day range as it stood at the end of S1 / S2 / S3 (running: S2 includes S1). null until that segment starts. */
  segRange: [number, number | null, number | null];
  /** The same for the previous `avgDays` sessions, averaged (null until available). */
  segAvg: [number | null, number | null, number | null];
};

/** Live intraday range table, bar by bar: what the series' "intraday range indicator" shows. */
export function sessionStats(c: Candle[], avgDays = 5): SessionStat[] {
  const past: { range: number; seg: [number, number, number] }[] = [];
  const out: SessionStat[] = [];
  let day = -1, high = 0, low = 0, seg: [number, number | null, number | null] = [0, null, null];
  const finish = () => { if (day >= 0) past.push({ range: high - low, seg: [seg[0], seg[1] ?? seg[0], seg[2] ?? seg[1] ?? seg[0]] }); };
  for (const b of c) {
    const d = istDay(b.time);
    if (d !== day) { finish(); day = d; high = b.high; low = b.low; seg = [0, null, null]; }
    high = Math.max(high, b.high); low = Math.min(low, b.low);
    const range = high - low, s = segmentOf(b.time);
    seg[s - 1] = range;
    const recent = past.slice(-avgDays), full = recent.length === avgDays;
    const avg = (k: (p: (typeof past)[number]) => number) => (full ? recent.reduce((a, p) => a + k(p), 0) / avgDays : null);
    const avgRange = avg((p) => p.range);
    out.push({
      high, low, range, avgRange, rangeVsAvg: avgRange ? range / avgRange : null,
      fromHigh: high - b.close, fromLow: b.close - low, position: range > 0 ? (b.close - low) / range : 0.5,
      segment: s, segRange: [seg[0], seg[1], seg[2]], segAvg: [avg((p) => p.seg[0]), avg((p) => p.seg[1]), avg((p) => p.seg[2])],
    });
  }
  return out;
}
