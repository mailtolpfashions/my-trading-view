// Every field and function the formula language knows, with its parameters, defaults and help text. The parser
// checks calls against this table, the formula editor shows it as help, and the evaluator runs `compute`. Indicator
// math lives in @mtv/indicators (checked against PineScript built-ins); this file only wires it up.

import {
  aroon, atr, bbWidth, bollinger, cci, change, choppiness, dmi, ema, highest, historicalVolatility, ichimoku, lowest,
  macd, mfi, obv, onRuns, percentB, pivotHigh, pivotLevelValues, pivotLow, psar, rma, roc, rsi, sma, stdev, stochastic,
  stochRsi, sum, supertrend, trueRange, tsi, vwap, williamsR, wma, PIVOT_LEVELS, type PivotLevel, type PivotMethod,
  type Series,
} from '@mtv/indicators';
import type { Candle } from '@mtv/shared';
import { isIntraday, type Tf, type ValueType } from './ast';
import { PATTERNS, patternSeries } from './patterns';

export type ArgKind = 'series' | 'bool' | 'int' | 'number' | { oneOf: readonly string[] };
export type Param = { name: string; kind: ArgKind; def?: number | string };
export type Arg = Series | number | string;
export type Group =
  | 'Price' | 'Moving averages' | 'Momentum' | 'Trend' | 'Volume' | 'Volatility' | 'Price action'
  | 'Candlestick patterns' | 'Support and resistance' | 'Math' | 'Logic';

export type FnDef = {
  name: string;
  group: Group;
  returns: ValueType;
  params: Param[];
  summary: string;
  compute: (c: Candle[], args: Arg[], tf: Tf) => Series;
};

export type FieldDef = { name: string; summary: string; get: (c: Candle[]) => Series };

export const FIELDS: FieldDef[] = [
  { name: 'OPEN', summary: 'Open of the bar', get: (c) => c.map((b) => b.open) },
  { name: 'HIGH', summary: 'High of the bar', get: (c) => c.map((b) => b.high) },
  { name: 'LOW', summary: 'Low of the bar', get: (c) => c.map((b) => b.low) },
  { name: 'CLOSE', summary: 'Close of the bar (the last price while a live bar is forming)', get: (c) => c.map((b) => b.close) },
  { name: 'VOLUME', summary: 'Shares traded in the bar', get: (c) => c.map((b) => b.volume) },
  { name: 'HL2', summary: '(High + Low) / 2', get: (c) => c.map((b) => (b.high + b.low) / 2) },
  { name: 'HLC3', summary: '(High + Low + Close) / 3, the typical price', get: (c) => c.map((b) => (b.high + b.low + b.close) / 3) },
  { name: 'OHLC4', summary: '(Open + High + Low + Close) / 4', get: (c) => c.map((b) => (b.open + b.high + b.low + b.close) / 4) },
  { name: 'TURNOVER', summary: 'Traded value in ₹: Close × Volume', get: (c) => c.map((b) => b.close * b.volume) },
];
export const FIELD_BY_NAME = new Map(FIELDS.map((f) => [f.name, f]));
/** Accepted alternative spellings, mapped to the canonical name. */
export const ALIASES: Record<string, string> = {
  LTP: 'CLOSE', PRICE: 'CLOSE', VOL: 'VOLUME', CROSSES_ABOVE: 'CROSSOVER', CROSSES_BELOW: 'CROSSUNDER',
  SUPERTREND_DIRECTION: 'SUPERTREND_DIR', MACD: 'MACD_LINE',
};

// ---- helpers ----
const S = (a: Arg) => a as Series;
const N = (a: Arg) => a as number;
const E = (a: Arg) => a as string;
/** Runs a number[] indicator on a series that may hold nulls (e.g. the warm-up of an inner indicator). */
const on = (s: Series, f: (v: number[]) => Series): Series => (s.every((v) => v != null) ? f(s as number[]) : onRuns(s, f));
const zip = (a: Series, b: Series, f: (x: number, y: number) => number | null): Series => a.map((x, i) => (x == null || b[i] == null ? null : f(x, b[i]!)));
const bool = (v: boolean | null): number | null => (v == null ? null : v ? 1 : 0);
const shift = (s: Series, n: number): Series => s.map((_, i) => (i >= n ? s[i - n] : null));

const src = (def = 'CLOSE'): Param => ({ name: 'source', kind: 'series', def });
const len = (def: number, name = 'length'): Param => ({ name, kind: 'int', def });
const numP = (name: string, def: number): Param => ({ name, kind: 'number', def });

function fn(name: string, group: Group, returns: ValueType, params: Param[], summary: string, compute: FnDef['compute']): FnDef {
  return { name, group, returns, params, summary, compute };
}

/** Bars since `cond` was last 1 (0 on a bar where it is 1), null before it first is. */
function barsSince(cond: Series): Series {
  let last = -1;
  return cond.map((v, i) => {
    if (v === 1) last = i;
    return last < 0 ? null : i - last;
  });
}

/** Last confirmed pivot value carried forward. */
function lastPivot(p: Series): Series {
  let v: number | null = null;
  return p.map((x) => (x != null ? (v = x) : v));
}

/** Pivot on a series that can hold nulls (an oscillator's warm-up): any null in the window means no pivot. */
function pivotSeries(s: Series, left: number, right: number, high: boolean): Series {
  return s.map((_, i) => {
    if (i < left + right) return null;
    const p = i - right, v = s[p];
    if (v == null) return null;
    for (let j = p - left; j <= i; j++) {
      const w = s[j];
      if (w == null || j === p) { if (w == null) return null; continue; }
      if (j < p ? (high ? w > v : w < v) : (high ? w >= v : w <= v)) return null;
    }
    return v;
  });
}

/**
 * Regular divergence as TradingView's "RSI Divergence" indicator finds it: pivots are found on the oscillator (left
 * and right bars), the previous pivot must be 5 to 60 bars before (min/max), and the signal appears on the bar that
 * confirms the pivot, `right` bars after it, so nothing looks ahead.
 * Bullish: price makes a lower low while the oscillator makes a higher low. Bearish: a higher high with a lower high.
 */
function divergence(c: Candle[], osc: Series, left: number, right: number, minBars: number, maxBars: number, bull: boolean): Series {
  const piv = pivotSeries(osc, left, right, !bull);
  let prev = -1;
  return c.map((_, i) => {
    if (piv[i] == null) return osc[i] == null ? null : 0;
    let hit = false;
    if (prev >= 0) {
      const gap = i - prev - 1, a = i - right, b = prev - right;
      const inRange = gap >= minBars && gap <= maxBars;
      hit = inRange && (bull
        ? osc[a]! > osc[b]! && c[a].low < c[b].low
        : osc[a]! < osc[b]! && c[a].high > c[b].high);
    }
    prev = i;
    return hit ? 1 : 0;
  });
}

/** Fibonacci level in the swing between the highest high and lowest low of the last `n` bars. */
function fib(c: Candle[], level: number, n: number, extension: boolean): Series {
  return c.map((_, i) => {
    if (i < n - 1) return null;
    let hi = i, lo = i;
    for (let j = i - n + 1; j <= i; j++) {
      if (c[j].high > c[hi].high) hi = j;
      if (c[j].low < c[lo].low) lo = j;
    }
    const hh = c[hi].high, ll = c[lo].low, r = hh - ll, up = hi >= lo, k = level / 100;
    if (extension) return up ? ll + r * k : hh - r * k;
    return up ? hh - r * k : ll + r * k;
  });
}

/**
 * Volume against the same time of day in earlier sessions. `cumulative`: the day's volume up to this bar against the
 * volume earlier days had traded by the same time. Only earlier sessions count, never the current one.
 */
function timeOfDayRatio(c: Candle[], sessions: number, cumulative: boolean): Series {
  const past = new Map<number, number[]>(); // time of day → that slot's values on earlier sessions, oldest first
  const pending: [number, number][] = []; // today's slots, added to `past` when the day ends
  let day = -1, cum = 0;
  return c.map((b) => {
    const d = Math.floor((b.time + IST) / 86400), key = (b.time + IST) % 86400;
    if (d !== day) {
      for (const [k, v] of pending) { const l = past.get(k) ?? []; l.push(v); if (l.length > sessions) l.shift(); past.set(k, l); }
      pending.length = 0;
      day = d;
      cum = 0;
    }
    cum += b.volume;
    const v = cumulative ? cum : b.volume;
    pending.push([key, v]);
    const prev = past.get(key);
    if (!prev || prev.length < sessions) return null;
    const avg = prev.reduce((a, x) => a + x, 0) / prev.length;
    return avg > 0 ? v / avg : null;
  });
}

const PIVOT_METHODS: readonly PivotMethod[] = ['CLASSIC', 'TRADITIONAL', 'FIBONACCI', 'WOODIE', 'CAMARILLA', 'DM'];
const IST = 5.5 * 3600;

/** Which day, week (Monday) or month a bar belongs to, in IST. */
function periodKey(time: number, anchor: string): number {
  const d = new Date((time + IST) * 1000);
  if (anchor === 'M') return d.getUTCFullYear() * 12 + d.getUTCMonth();
  const day = Math.floor((time + IST) / 86400);
  return anchor === 'W' ? day - ((d.getUTCDay() + 6) % 7) : day;
}

/**
 * Pivot levels in force on each bar for the period that contains it, from the previous period's high, low, close and
 * open, computed on the scan's own bars (Pine's ta.pivot_point_levels with a period anchor). Daily bars with anchor W
 * get this week's levels from last week; 15-minute bars with anchor D get today's from yesterday.
 */
function pivotAnchored(c: Candle[], method: PivotMethod, level: PivotLevel, anchor: string): Series {
  const k = PIVOT_LEVELS.indexOf(level);
  type Period = { h: number; l: number; o: number; c: number };
  let key = NaN, cur: Period | null = null, prev: Period | null = null, levels: (number | null)[] | null = null;
  return c.map((b) => {
    const p = periodKey(b.time, anchor);
    if (p !== key) {
      key = p;
      prev = cur;
      cur = { h: b.high, l: b.low, o: b.open, c: b.close };
      levels = prev ? pivotLevelValues(method, prev.h, prev.l, prev.c, prev.o, b.open) : null;
    } else {
      cur!.h = Math.max(cur!.h, b.high);
      cur!.l = Math.min(cur!.l, b.low);
      cur!.c = b.close;
    }
    return levels ? levels[k] : null;
  });
}

export const FUNCTIONS: FnDef[] = [
  // ---- Math ----
  fn('ABS', 'Math', 'num', [{ name: 'x', kind: 'series' }], 'Absolute value', (_c, [x]) => S(x).map((v) => (v == null ? null : Math.abs(v)))),
  fn('MAX', 'Math', 'num', [{ name: 'a', kind: 'series' }, { name: 'b', kind: 'series' }], 'Larger of two values on each bar', (_c, [a, b]) => zip(S(a), S(b), Math.max)),
  fn('MIN', 'Math', 'num', [{ name: 'a', kind: 'series' }, { name: 'b', kind: 'series' }], 'Smaller of two values on each bar', (_c, [a, b]) => zip(S(a), S(b), Math.min)),

  // ---- Moving averages and series tools ----
  fn('SMA', 'Moving averages', 'num', [src(), len(20)], 'Simple moving average', (_c, [s, n]) => on(S(s), (v) => sma(v, N(n)))),
  fn('EMA', 'Moving averages', 'num', [src(), len(20)], 'Exponential moving average, seeded with an SMA (as TradingView)', (_c, [s, n]) => on(S(s), (v) => ema(v, N(n)))),
  fn('WMA', 'Moving averages', 'num', [src(), len(20)], 'Weighted moving average', (_c, [s, n]) => on(S(s), (v) => wma(v, N(n)))),
  fn('RMA', 'Moving averages', 'num', [src(), len(14)], "Wilder's moving average (used inside RSI and ATR)", (_c, [s, n]) => on(S(s), (v) => rma(v, N(n)))),
  fn('SUM', 'Math', 'num', [src(), len(10)], 'Sum over the last N bars', (_c, [s, n]) => on(S(s), (v) => sum(v, N(n)))),
  fn('HIGHEST', 'Price action', 'num', [src('HIGH'), len(20)], 'Highest value of the last N bars, this bar included. For a breakout above the previous N bars use HIGHEST(HIGH, N)[1].', (_c, [s, n]) => on(S(s), (v) => highest(v, N(n)))),
  fn('LOWEST', 'Price action', 'num', [src('LOW'), len(20)], 'Lowest value of the last N bars, this bar included. For a breakdown use LOWEST(LOW, N)[1].', (_c, [s, n]) => on(S(s), (v) => lowest(v, N(n)))),
  fn('STDEV', 'Volatility', 'num', [src(), len(20)], 'Standard deviation (population, as TradingView)', (_c, [s, n]) => on(S(s), (v) => stdev(v, N(n)))),
  fn('CHANGE', 'Price', 'num', [src(), len(1, 'bars')], 'Change from N bars ago: source − source[N]', (_c, [s, n]) => on(S(s), (v) => change(v, N(n)))),
  fn('CHANGE_PCT', 'Price', 'num', [src(), len(1, 'bars')], 'Change from N bars ago in %', (_c, [s, n]) => on(S(s), (v) => roc(v, N(n)))),
  fn('GAP_PCT', 'Price action', 'num', [], 'Opening gap in %: (Open − previous Close) / previous Close × 100. Positive = gap up.', (c) => c.map((b, i) => (i ? ((b.open - c[i - 1].close) / c[i - 1].close) * 100 : null))),
  fn('RANGE', 'Price action', 'num', [], 'High − Low of the bar', (c) => c.map((b) => b.high - b.low)),

  // ---- Momentum ----
  fn('RSI', 'Momentum', 'num', [src(), len(14)], 'Relative Strength Index, 0–100 (Wilder smoothing, as TradingView)', (_c, [s, n]) => on(S(s), (v) => rsi(v, N(n)))),
  fn('MACD_LINE', 'Momentum', 'num', [src(), len(12, 'fast'), len(26, 'slow'), len(9, 'signal')], 'MACD line: EMA(fast) − EMA(slow)', (_c, [s, f, sl, sg]) => on(S(s), (v) => macd(v, N(f), N(sl), N(sg)).macd)),
  fn('MACD_SIGNAL', 'Momentum', 'num', [src(), len(12, 'fast'), len(26, 'slow'), len(9, 'signal')], 'MACD signal line: EMA of the MACD line', (_c, [s, f, sl, sg]) => on(S(s), (v) => macd(v, N(f), N(sl), N(sg)).signal)),
  fn('MACD_HIST', 'Momentum', 'num', [src(), len(12, 'fast'), len(26, 'slow'), len(9, 'signal')], 'MACD histogram: MACD line − signal line', (_c, [s, f, sl, sg]) => on(S(s), (v) => macd(v, N(f), N(sl), N(sg)).histogram)),
  fn('STOCH_K', 'Momentum', 'num', [len(14, 'k length'), len(1, 'k smoothing')], 'Stochastic %K, 0–100', (c, [k, sk]) => stochastic(c, N(k), N(sk), 1).k),
  fn('STOCH_D', 'Momentum', 'num', [len(14, 'k length'), len(1, 'k smoothing'), len(3, 'd smoothing')], 'Stochastic %D: SMA of %K', (c, [k, sk, d]) => stochastic(c, N(k), N(sk), N(d)).d),
  fn('STOCHRSI_K', 'Momentum', 'num', [src(), len(14, 'rsi length'), len(14, 'stoch length'), len(3, 'k smoothing')], 'Stochastic RSI %K, 0–100', (_c, [s, r, st, k]) => on(S(s), (v) => stochRsi(v, N(r), N(st), N(k), 1).k)),
  fn('STOCHRSI_D', 'Momentum', 'num', [src(), len(14, 'rsi length'), len(14, 'stoch length'), len(3, 'k smoothing'), len(3, 'd smoothing')], 'Stochastic RSI %D', (_c, [s, r, st, k, d]) => on(S(s), (v) => stochRsi(v, N(r), N(st), N(k), N(d)).d)),
  fn('WILLR', 'Momentum', 'num', [len(14)], 'Williams %R, −100 to 0', (c, [n]) => williamsR(c, N(n))),
  fn('CCI', 'Momentum', 'num', [src('HLC3'), len(20)], 'Commodity Channel Index', (_c, [s, n]) => on(S(s), (v) => cci(v, N(n)))),
  fn('MFI', 'Momentum', 'num', [len(14)], 'Money Flow Index, 0–100, on the typical price', (c, [n]) => mfi(c, N(n))),
  fn('ROC', 'Momentum', 'num', [src(), len(9)], 'Rate of change in %', (_c, [s, n]) => on(S(s), (v) => roc(v, N(n)))),
  fn('MOM', 'Momentum', 'num', [src(), len(10)], 'Momentum: source − source[N]', (_c, [s, n]) => on(S(s), (v) => change(v, N(n)))),
  fn('TSI', 'Momentum', 'num', [src(), len(25, 'long'), len(13, 'short')], 'True Strength Index, −100 to 100', (_c, [s, l, sh]) => on(S(s), (v) => tsi(v, N(l), N(sh)))),

  // ---- Trend ----
  fn('SUPERTREND', 'Trend', 'num', [len(10, 'atr length'), numP('factor', 3)], 'Supertrend line', (c, [n, f]) => supertrend(c, N(n), N(f)).value),
  fn('SUPERTREND_DIR', 'Trend', 'num', [len(10, 'atr length'), numP('factor', 3)], 'Supertrend direction: 1 = bullish (line below price), −1 = bearish', (c, [n, f]) => supertrend(c, N(n), N(f)).direction),
  fn('ADX', 'Trend', 'num', [len(14, 'di length'), len(14, 'adx smoothing')], 'Average Directional Index, trend strength 0–100', (c, [d, a]) => dmi(c, N(d), N(a)).adx),
  fn('PLUS_DI', 'Trend', 'num', [len(14, 'di length')], '+DI, upward directional movement', (c, [d]) => dmi(c, N(d), N(d)).plus),
  fn('MINUS_DI', 'Trend', 'num', [len(14, 'di length')], '−DI, downward directional movement', (c, [d]) => dmi(c, N(d), N(d)).minus),
  fn('AROON_UP', 'Trend', 'num', [len(14)], 'Aroon Up, 0–100: how recently the highest high was made', (c, [n]) => aroon(c, N(n)).up),
  fn('AROON_DOWN', 'Trend', 'num', [len(14)], 'Aroon Down, 0–100: how recently the lowest low was made', (c, [n]) => aroon(c, N(n)).down),
  fn('PSAR', 'Trend', 'num', [numP('start', 0.02), numP('increment', 0.02), numP('max', 0.2)], 'Parabolic SAR', (c, [s, i, m]) => psar(c, N(s), N(i), N(m))),
  fn('ICHIMOKU_CONVERSION', 'Trend', 'num', [len(9, 'conversion')], 'Ichimoku conversion line (Tenkan-sen)', (c, [n]) => ichimoku(c, N(n)).conversion),
  fn('ICHIMOKU_BASE', 'Trend', 'num', [len(26, 'base')], 'Ichimoku base line (Kijun-sen)', (c, [n]) => ichimoku(c, 9, N(n)).base),
  fn('ICHIMOKU_SPAN_A', 'Trend', 'num', [len(9, 'conversion'), len(26, 'base'), len(26, 'displacement')], 'Cloud edge A at this bar (leading span A as plotted)', (c, [cv, b, d]) => ichimoku(c, N(cv), N(b), 52, N(d)).spanA),
  fn('ICHIMOKU_SPAN_B', 'Trend', 'num', [len(52, 'span b'), len(26, 'displacement')], 'Cloud edge B at this bar (leading span B as plotted)', (c, [sb, d]) => ichimoku(c, 9, 26, N(sb), N(d)).spanB),
  fn('CHOP', 'Trend', 'num', [len(14)], 'Choppiness Index: above ~61.8 choppy, below ~38.2 trending', (c, [n]) => choppiness(c, N(n))),
  fn('VWAP', 'Trend', 'num', [], 'Volume-weighted average price, reset each session (intraday timeframes)', (c) => vwap(c)),

  // ---- Volatility and bands ----
  fn('ATR', 'Volatility', 'num', [len(14)], 'Average True Range (Wilder)', (c, [n]) => atr(c, N(n))),
  fn('ATR_PCT', 'Volatility', 'num', [len(14)], 'ATR as % of the close', (c, [n]) => zip(atr(c, N(n)), c.map((b) => b.close), (a, cl) => (cl ? (a / cl) * 100 : null))),
  fn('TR', 'Volatility', 'num', [], 'True range of the bar', (c) => trueRange(c)),
  fn('HV', 'Volatility', 'num', [len(10)], 'Historical volatility in %, annualised (TradingView method)', (c, [n], tf) => historicalVolatility(c.map((b) => b.close), N(n), isIntraday(tf) || tf === 'D' ? 1 : 7)),
  fn('BB_UPPER', 'Volatility', 'num', [src(), len(20), numP('stdev', 2)], 'Upper Bollinger Band', (_c, [s, n, k]) => on(S(s), (v) => bollinger(v, N(n), N(k)).upper)),
  fn('BB_MIDDLE', 'Volatility', 'num', [src(), len(20), numP('stdev', 2)], 'Middle Bollinger Band (the SMA)', (_c, [s, n, k]) => on(S(s), (v) => bollinger(v, N(n), N(k)).middle)),
  fn('BB_LOWER', 'Volatility', 'num', [src(), len(20), numP('stdev', 2)], 'Lower Bollinger Band', (_c, [s, n, k]) => on(S(s), (v) => bollinger(v, N(n), N(k)).lower)),
  fn('BB_WIDTH', 'Volatility', 'num', [src(), len(20), numP('stdev', 2)], 'Bollinger BandWidth: (upper − lower) / middle × 100', (_c, [s, n, k]) => on(S(s), (v) => bbWidth(v, N(n), N(k)))),
  fn('BB_PCTB', 'Volatility', 'num', [src(), len(20), numP('stdev', 2)], 'Bollinger %B: 0 at the lower band, 1 at the upper band', (_c, [s, n, k]) => on(S(s), (v) => percentB(v, N(n), N(k)))),

  // ---- Volume ----
  fn('AVG_VOLUME', 'Volume', 'num', [len(20)], 'Average volume of the last N bars, this bar included', (c, [n]) => sma(c.map((b) => b.volume), N(n))),
  fn('RVOL', 'Volume', 'num', [len(20)], 'Relative volume: this bar\'s volume ÷ the average of the N bars BEFORE it. On intraday bars this compares with whole bars, not the same time of day.', (c, [n]) => zip(c.map((b) => b.volume), shift(sma(c.map((b) => b.volume), N(n)), 1), (v, a) => (a ? v / a : null))),
  fn('AVG_TURNOVER', 'Volume', 'num', [len(20)], 'Average traded value in ₹ (Close × Volume) over N bars', (c, [n]) => sma(c.map((b) => b.close * b.volume), N(n))),
  fn('OBV', 'Volume', 'num', [], 'On-balance volume', (c) => obv(c)),
  fn('RVOL_TOD', 'Volume', 'num', [len(20, 'sessions')], 'Relative volume at the same time of day: this bar\'s volume ÷ the average volume of the bars that started at the same time in the previous N sessions. The fair comparison on intraday bars (10:00 against earlier 10:00 bars, not against whole days).', (c, [n]) => timeOfDayRatio(c, N(n), false)),
  fn('RVOL_CUM', 'Volume', 'num', [len(20, 'sessions')], 'Volume so far today ÷ the average volume traded by the same time of day in the previous N sessions. Above 1 = busier than usual for this point of the day.', (c, [n]) => timeOfDayRatio(c, N(n), true)),

  // ---- Price action ----
  fn('INSIDE_BAR', 'Price action', 'bool', [], 'High below the previous high and low above the previous low', (c) => c.map((b, i) => (i ? bool(b.high < c[i - 1].high && b.low > c[i - 1].low) : null))),
  fn('OUTSIDE_BAR', 'Price action', 'bool', [], 'High above the previous high and low below the previous low', (c) => c.map((b, i) => (i ? bool(b.high > c[i - 1].high && b.low < c[i - 1].low) : null))),
  fn('NR', 'Price action', 'bool', [len(7, 'bars')], 'Narrowest range of the last N bars, this bar included (NR4, NR7)', (c, [n]) => { const r = c.map((b) => b.high - b.low); const lo = lowest(r, N(n)); return r.map((v, i) => (lo[i] == null ? null : bool(v <= lo[i]!))); }),

  // ---- Support and resistance ----
  fn('PIVOT', 'Support and resistance', 'num', [{ name: 'method', kind: { oneOf: PIVOT_METHODS }, def: 'CLASSIC' }, { name: 'level', kind: { oneOf: PIVOT_LEVELS }, def: 'P' }, { name: 'period', kind: { oneOf: ['D', 'W', 'M'] }, def: 'D' }], 'Pivot level for the current day, week or month, from the previous one: PIVOT(CLASSIC, R1, W) is this week\'s R1 from last week. Methods CLASSIC, TRADITIONAL, FIBONACCI, WOODIE, CAMARILLA, DM; levels P, R1–R5, S1–S5 (R4 and beyond only where the method has them).', (c, [m, l, a]) => pivotAnchored(c, E(m) as PivotMethod, E(l) as PivotLevel, E(a))),
  fn('PIVOT_HIGH', 'Support and resistance', 'num', [src('HIGH'), len(5, 'left'), len(5, 'right')], 'Swing high value on the bar that confirms it (right bars later), empty elsewhere', (_c, [s, l, r]) => on(S(s), (v) => pivotHigh(v, N(l), N(r)))),
  fn('PIVOT_LOW', 'Support and resistance', 'num', [src('LOW'), len(5, 'left'), len(5, 'right')], 'Swing low value on the bar that confirms it, empty elsewhere', (_c, [s, l, r]) => on(S(s), (v) => pivotLow(v, N(l), N(r)))),
  fn('RESISTANCE', 'Support and resistance', 'num', [len(5, 'left'), len(5, 'right')], 'The most recent confirmed swing high (pivot of HIGH)', (c, [l, r]) => lastPivot(pivotHigh(c.map((b) => b.high), N(l), N(r)))),
  fn('SUPPORT', 'Support and resistance', 'num', [len(5, 'left'), len(5, 'right')], 'The most recent confirmed swing low (pivot of LOW)', (c, [l, r]) => lastPivot(pivotLow(c.map((b) => b.low), N(l), N(r)))),
  fn('FIB', 'Support and resistance', 'num', [numP('level %', 61.8), len(50, 'bars')], 'Fibonacci retracement price in the swing of the last N bars (from the latest extreme back toward the other)', (c, [lv, n]) => fib(c, N(lv), N(n), false)),
  fn('FIB_EXT', 'Support and resistance', 'num', [numP('level %', 161.8), len(50, 'bars')], 'Fibonacci extension price beyond the swing of the last N bars, in the swing\'s direction', (c, [lv, n]) => fib(c, N(lv), N(n), true)),
  fn('BULL_DIV', 'Momentum', 'bool', [{ name: 'oscillator', kind: 'series' }, len(5, 'left'), len(5, 'right'), len(5, 'min bars'), len(60, 'max bars')], 'Bullish divergence: price lower low, oscillator higher low (pivots on the oscillator, signalled `right` bars after the pivot)', (c, [o, l, r, mn, mx]) => divergence(c, S(o), N(l), N(r), N(mn), N(mx), true)),
  fn('BEAR_DIV', 'Momentum', 'bool', [{ name: 'oscillator', kind: 'series' }, len(5, 'left'), len(5, 'right'), len(5, 'min bars'), len(60, 'max bars')], 'Bearish divergence: price higher high, oscillator lower high', (c, [o, l, r, mn, mx]) => divergence(c, S(o), N(l), N(r), N(mn), N(mx), false)),

  // ---- Logic over time ----
  fn('CROSSOVER', 'Logic', 'bool', [{ name: 'a', kind: 'series' }, { name: 'b', kind: 'series' }], 'a crosses above b: a > b on this bar and a ≤ b on the previous one', (_c, [a, b]) => S(a).map((x, i) => { const y = S(b)[i], px = S(a)[i - 1], py = S(b)[i - 1]; return x == null || y == null || px == null || py == null ? null : bool(x > y && px <= py); })),
  fn('CROSSUNDER', 'Logic', 'bool', [{ name: 'a', kind: 'series' }, { name: 'b', kind: 'series' }], 'a crosses below b: a < b on this bar and a ≥ b on the previous one', (_c, [a, b]) => S(a).map((x, i) => { const y = S(b)[i], px = S(a)[i - 1], py = S(b)[i - 1]; return x == null || y == null || px == null || py == null ? null : bool(x < y && px >= py); })),
  fn('RISING', 'Logic', 'bool', [{ name: 'x', kind: 'series' }, len(1, 'bars')], 'x went up on each of the last N bars (x > x[1] > … > x[N])', (_c, [x, n]) => S(x).map((_, i) => { if (i < N(n)) return null; for (let k = i; k > i - N(n); k--) { const a = S(x)[k], b = S(x)[k - 1]; if (a == null || b == null) return null; if (!(a > b)) return 0; } return 1; })),
  fn('FALLING', 'Logic', 'bool', [{ name: 'x', kind: 'series' }, len(1, 'bars')], 'x went down on each of the last N bars', (_c, [x, n]) => S(x).map((_, i) => { if (i < N(n)) return null; for (let k = i; k > i - N(n); k--) { const a = S(x)[k], b = S(x)[k - 1]; if (a == null || b == null) return null; if (!(a < b)) return 0; } return 1; })),
  fn('BETWEEN', 'Logic', 'bool', [{ name: 'x', kind: 'series' }, { name: 'low', kind: 'series' }, { name: 'high', kind: 'series' }], 'low ≤ x ≤ high', (_c, [x, lo, hi]) => S(x).map((v, i) => { const a = S(lo)[i], b = S(hi)[i]; return v == null || a == null || b == null ? null : bool(v >= a && v <= b); })),
  fn('EVERY', 'Logic', 'bool', [{ name: 'condition', kind: 'bool' }, len(3, 'bars')], 'The condition held on each of the last N bars', (_c, [x, n]) => S(x).map((_, i) => { if (i < N(n) - 1) return null; let r: number | null = 1; for (let k = i - N(n) + 1; k <= i; k++) { const v = S(x)[k]; if (v === 0) return 0; if (v == null) r = null; } return r; })),
  fn('ANY', 'Logic', 'bool', [{ name: 'condition', kind: 'bool' }, len(3, 'bars')], 'The condition held on at least one of the last N bars', (_c, [x, n]) => S(x).map((_, i) => { if (i < N(n) - 1) return null; let r: number | null = 0; for (let k = i - N(n) + 1; k <= i; k++) { const v = S(x)[k]; if (v === 1) return 1; if (v == null) r = null; } return r; })),
  fn('COUNT', 'Logic', 'num', [{ name: 'condition', kind: 'bool' }, len(10, 'bars')], 'How many of the last N bars met the condition', (_c, [x, n]) => on(S(x), (v) => sum(v, N(n)))),
  fn('BARS_SINCE', 'Logic', 'num', [{ name: 'condition', kind: 'bool' }], 'Bars since the condition was last true (0 = this bar)', (_c, [x]) => barsSince(S(x))),

  // ---- Candlestick patterns ----
  ...PATTERNS.map((p) => fn(p.name, 'Candlestick patterns', 'bool', [], `${p.side === 'neutral' ? 'Neutral' : p.side === 'bullish' ? 'Bullish' : 'Bearish'} ${p.bars}-candle pattern. ${p.rule}`, (c) => patternSeries(c, p.test))),
];

export const FN_BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));
