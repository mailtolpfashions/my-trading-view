// Technical indicators, written to match TradingView's built-in formulas so values agree with what traders see there.
// Every function returns an array aligned with its input; warm-up positions are null.

import type { Candle, Timeframe } from '@mtv/shared';

export type Series = (number | null)[];

const IST_OFFSET = 5.5 * 3600;

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** SMA of a series that has null warm-up values (e.g. RSI's moving average). Null until `period` consecutive values exist. */
export function smaOfSeries(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0, run = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { sum = 0; run = 0; continue; }
    sum += v;
    run++;
    if (run > period) sum -= values[i - period]!;
    if (run >= period) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values (TradingView's ta.ema). */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) out[i] = e = values[i] * k + e * (1 - k);
  return out;
}

export function wma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += values[i - j] * (period - j);
    out[i] = s / denom;
  }
  return out;
}

/** Wilder's moving average (TradingView's ta.rma), seeded with an SMA. */
export function rma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = r;
  for (let i = period; i < values.length; i++) out[i] = r = (r * (period - 1) + values[i]) / period;
  return out;
}

export function rsi(closes: number[], period = 14): Series {
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gains.push(Math.max(ch, 0));
    losses.push(Math.max(-ch, 0));
  }
  const g = rma(gains, period), l = rma(losses, period);
  return [null, ...g.map((gv, i) => {
    const lv = l[i];
    if (gv == null || lv == null) return null;
    if (lv === 0) return gv === 0 ? 50 : 100;
    return 100 - 100 / (1 + gv / lv);
  })];
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line: Series = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v != null);
  const sig: Series = new Array(closes.length).fill(null);
  if (start >= 0) ema(line.slice(start) as number[], signal).forEach((v, i) => (sig[start + i] = v));
  const hist: Series = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i]! : null));
  return { macd: line, signal: sig, histogram: hist };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: Series = [], lower: Series = [];
  closes.forEach((_, i) => {
    const m = mid[i];
    if (m == null) return (upper.push(null), lower.push(null));
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - m) ** 2;
    const sd = Math.sqrt(v / period); // population stdev, as TradingView's ta.stdev
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  });
  return { upper, middle: mid, lower };
}

export function trueRange(c: Candle[]): number[] {
  return c.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close))));
}

export const atr = (c: Candle[], period = 14): Series => rma(trueRange(c), period);

/** Supertrend as in TradingView's ta.supertrend: direction 1 = up (line below price), -1 = down. */
export function supertrend(c: Candle[], period = 10, mult = 3) {
  const a = atr(c, period);
  const value: Series = new Array(c.length).fill(null);
  const direction: (1 | -1 | null)[] = new Array(c.length).fill(null);
  let up = 0, dn = 0, dir: 1 | -1 = 1, started = false;
  for (let i = 0; i < c.length; i++) {
    const av = a[i];
    if (av == null) continue;
    const hl2 = (c[i].high + c[i].low) / 2;
    let u = hl2 - mult * av, d = hl2 + mult * av;
    if (started) {
      const prevClose = c[i - 1].close;
      u = prevClose > up ? Math.max(u, up) : u;
      d = prevClose < dn ? Math.min(d, dn) : d;
      if (dir === -1 && c[i].close > dn) dir = 1;
      else if (dir === 1 && c[i].close < up) dir = -1;
    } else {
      dir = c[i].close >= hl2 ? 1 : -1;
      started = true;
    }
    up = u;
    dn = d;
    value[i] = dir === 1 ? up : dn;
    direction[i] = dir;
  }
  return { value, direction };
}

/** Session VWAP that resets at each IST trading day. */
export function vwap(c: Candle[]): Series {
  let pv = 0, vol = 0, day = -1;
  return c.map((b) => {
    const d = Math.floor((b.time + IST_OFFSET) / 86400);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    vol += b.volume;
    return vol > 0 ? pv / vol : null;
  });
}

const SESSION_OPEN = (9 * 60 + 15) * 60; // 09:15 IST, seconds after midnight

/**
 * Open time (UTC seconds) of the bar that a trade at `time` belongs to. Intraday bars are aligned to the
 * 09:15 IST session open, like NSE charts on TradingView. Returns null for pre-open trades on intraday charts.
 */
export function barStart(time: number, tf: Timeframe): number | null {
  const local = time + IST_OFFSET;
  const open = local - (local % 86400) + SESSION_OPEN;
  if (tf === 'D') return open - IST_OFFSET;
  if (tf === 'W') {
    const dow = new Date(local * 1000).getUTCDay(); // 0 = Sunday
    return open - ((dow + 6) % 7) * 86400 - IST_OFFSET;
  }
  if (local < open) return null;
  const span = Number(tf) * 60;
  return open + Math.floor((local - open) / span) * span - IST_OFFSET;
}

/** Applies a live trade price to a candle series: updates the current bar, or opens a new one when the bucket rolls over. */
export function mergeTick(candles: Candle[], tf: Timeframe, price: number, time: number): Candle[] {
  const last = candles.at(-1);
  const start = barStart(time, tf);
  if (!last || start == null || start < last.time) return candles;
  if (start === last.time) {
    if (price === last.close && price <= last.high && price >= last.low) return candles;
    return [...candles.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }];
  }
  return [...candles, { time: start, open: price, high: price, low: price, close: price, volume: 0 }];
}

export function heikinAshi(c: Candle[]): Candle[] {
  const out: Candle[] = [];
  c.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume });
  });
  return out;
}
