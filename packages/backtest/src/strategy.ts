// Rule-based strategies: conditions compare two operands (price, number or indicator), combined with all/any.

import { atr, bollinger, changePct, ema, highestBefore, lowestBefore, macd, rsi, sma, supertrend, vwap, type Series } from '@mtv/indicators';
import type { Candle } from '@mtv/shared';

export type IndicatorName =
  | 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'MACD_SIGNAL' | 'MACD_HIST' | 'BB_UPPER' | 'BB_MIDDLE' | 'BB_LOWER' | 'SUPERTREND' | 'VWAP' | 'ATR'
  /** Highest high / lowest low of the N bars before this one (breakouts), average volume, % change from previous close. */
  | 'HIGHEST' | 'LOWEST' | 'VOL_SMA' | 'CHANGE_PCT'
  /** Average daily traded value (close × volume) in ₹ crore: a point-in-time liquidity filter. */
  | 'VALUE_SMA';

export type Operand =
  | { kind: 'price'; field: 'open' | 'high' | 'low' | 'close' | 'volume' }
  | { kind: 'number'; value: number }
  | { kind: 'indicator'; name: IndicatorName; params: number[] };

export type Comparator = 'crossesAbove' | 'crossesBelow' | '>' | '<' | '>=' | '<=';
export type Condition = { left: Operand; op: Comparator; right: Operand };
export type RuleSet = { match: 'all' | 'any'; conditions: Condition[] };

export type Strategy = {
  name: string;
  direction: 'LONG' | 'SHORT';
  /** MIS: intraday, squared off by 15:20 IST. CNC: delivery (long only). */
  product: 'MIS' | 'CNC';
  entry: RuleSet;
  /** Optional signal-based exit, checked at each bar close. */
  exit?: RuleSet;
  stopLossPct?: number;
  targetPct?: number;
  /** Time exit: leave at the next open once the position has been held this many bars. */
  maxBars?: number;
  sizing: { mode: 'qty'; qty: number } | { mode: 'capital'; pct: number };
  initialCapitalPaise: number;
};

/** Default parameters, as on TradingView. */
export const INDICATOR_DEFAULTS: Record<IndicatorName, number[]> = {
  SMA: [20], EMA: [20], RSI: [14], MACD: [12, 26, 9], MACD_SIGNAL: [12, 26, 9], MACD_HIST: [12, 26, 9],
  BB_UPPER: [20, 2], BB_MIDDLE: [20, 2], BB_LOWER: [20, 2], SUPERTREND: [10, 3], VWAP: [], ATR: [14],
  HIGHEST: [20], LOWEST: [20], VOL_SMA: [20], CHANGE_PCT: [], VALUE_SMA: [20],
};

export const operandKey = (o: Operand) => (o.kind === 'price' ? o.field : o.kind === 'number' ? `#${o.value}` : `${o.name}(${o.params.join(',')})`);

/** Computes one operand's series over the candles (cached per key by the caller). */
export function operandSeries(o: Operand, c: Candle[]): Series {
  if (o.kind === 'number') return c.map(() => o.value);
  if (o.kind === 'price') return c.map((b) => b[o.field]);
  const closes = c.map((b) => b.close);
  const [a, b, d] = o.params;
  switch (o.name) {
    case 'SMA': return sma(closes, a);
    case 'EMA': return ema(closes, a);
    case 'RSI': return rsi(closes, a);
    case 'MACD': return macd(closes, a, b, d).macd;
    case 'MACD_SIGNAL': return macd(closes, a, b, d).signal;
    case 'MACD_HIST': return macd(closes, a, b, d).histogram;
    case 'BB_UPPER': return bollinger(closes, a, b).upper;
    case 'BB_MIDDLE': return bollinger(closes, a, b).middle;
    case 'BB_LOWER': return bollinger(closes, a, b).lower;
    case 'SUPERTREND': return supertrend(c, a, b).value;
    case 'VWAP': return vwap(c);
    case 'ATR': return atr(c, a);
    case 'HIGHEST': return highestBefore(c.map((b) => b.high), a);
    case 'LOWEST': return lowestBefore(c.map((b) => b.low), a);
    case 'VOL_SMA': return sma(c.map((b) => b.volume), a);
    case 'CHANGE_PCT': return changePct(closes);
    case 'VALUE_SMA': return sma(c.map((b) => (b.close * b.volume) / 1e7), a);
  }
}

/** True when the condition holds at bar i. Crosses follow TradingView: x > y now and x <= y on the previous bar. */
export function evalCondition(cond: Condition, left: Series, right: Series, i: number): boolean {
  const l = left[i], r = right[i];
  if (l == null || r == null) return false;
  switch (cond.op) {
    case '>': return l > r;
    case '<': return l < r;
    case '>=': return l >= r;
    case '<=': return l <= r;
    case 'crossesAbove':
    case 'crossesBelow': {
      if (i === 0) return false;
      const pl = left[i - 1], pr = right[i - 1];
      if (pl == null || pr == null) return false;
      return cond.op === 'crossesAbove' ? l > r && pl <= pr : l < r && pl >= pr;
    }
  }
}

/** Returns a reason the strategy is invalid for this timeframe, or null. */
export function validateStrategy(s: Strategy, intraday: boolean): string | null {
  if (!s.entry.conditions.length) return 'Add at least one entry condition';
  if (s.product === 'CNC' && s.direction === 'SHORT') return 'Delivery (CNC) cannot short. Use intraday (MIS) for short strategies.';
  if (s.product === 'MIS' && !intraday) return 'Intraday (MIS) strategies need an intraday timeframe (1m–1h)';
  if (s.sizing.mode === 'qty' && (!Number.isSafeInteger(s.sizing.qty) || s.sizing.qty <= 0)) return 'Quantity must be a whole number above zero';
  if (s.sizing.mode === 'capital' && !(s.sizing.pct > 0 && s.sizing.pct <= 100)) return 'Capital per trade must be between 0 and 100%';
  if (!Number.isSafeInteger(s.initialCapitalPaise) || s.initialCapitalPaise <= 0) return 'Starting capital must be above zero';
  for (const v of [s.stopLossPct, s.targetPct]) if (v != null && !(v > 0 && v < 100)) return 'Stop loss and target must be between 0 and 100%';
  if (s.maxBars != null && !(Number.isSafeInteger(s.maxBars) && s.maxBars > 0)) return 'Maximum holding period must be a whole number of bars above zero';
  const all = [...s.entry.conditions, ...(s.exit?.conditions ?? [])];
  for (const c of all) for (const o of [c.left, c.right]) {
    if (o.kind === 'indicator' && o.params.some((p) => !(p > 0) || (o.name !== 'BB_UPPER' && o.name !== 'BB_MIDDLE' && o.name !== 'BB_LOWER' && o.name !== 'SUPERTREND' && !Number.isInteger(p)))) {
      return `Invalid parameters for ${o.name}`;
    }
  }
  return null;
}
