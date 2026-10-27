import type { BacktestResult, Condition, IndicatorName, Operand, Strategy } from '@mtv/backtest';
import type { Candle, DataQuality, DataStatus, Instrument, Timeframe } from '@mtv/shared';
import { FEED_URL, feedFetch } from './feed';

export type BacktestResponse = { instrument: Instrument; tf: Timeframe; status: DataStatus; quality: DataQuality; result: BacktestResult; candles: Candle[] };

export async function runBacktestApi(symbol: string, tf: Timeframe, strategy: Strategy): Promise<BacktestResponse> {
  const res = await feedFetch(`${FEED_URL}/api/backtest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, tf, strategy }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Backtest failed');
  return body as BacktestResponse;
}

export const PARAM_LABELS: Record<IndicatorName, string[]> = {
  SMA: ['Length'], EMA: ['Length'], RSI: ['Length'], MACD: ['Fast', 'Slow', 'Signal'], MACD_SIGNAL: ['Fast', 'Slow', 'Signal'], MACD_HIST: ['Fast', 'Slow', 'Signal'],
  BB_UPPER: ['Length', 'StdDev'], BB_MIDDLE: ['Length', 'StdDev'], BB_LOWER: ['Length', 'StdDev'], SUPERTREND: ['ATR length', 'Factor'], VWAP: [], ATR: ['Length'],
  HIGHEST: ['Bars'], LOWEST: ['Bars'], VOL_SMA: ['Length'], CHANGE_PCT: [], VALUE_SMA: ['Length'],
};
export const INDICATOR_LABELS: Record<IndicatorName, string> = {
  SMA: 'SMA', EMA: 'EMA', RSI: 'RSI', MACD: 'MACD line', MACD_SIGNAL: 'MACD signal', MACD_HIST: 'MACD histogram',
  BB_UPPER: 'Bollinger upper', BB_MIDDLE: 'Bollinger basis', BB_LOWER: 'Bollinger lower', SUPERTREND: 'Supertrend', VWAP: 'VWAP', ATR: 'ATR',
  HIGHEST: 'Highest high (previous bars)', LOWEST: 'Lowest low (previous bars)', VOL_SMA: 'Average volume', CHANGE_PCT: 'Change % (from previous close)',
  VALUE_SMA: 'Average traded value (₹ crore)',
};

const ind = (name: IndicatorName, ...params: number[]): Operand => ({ kind: 'indicator', name, params });
const close: Operand = { kind: 'price', field: 'close' };
const num = (value: number): Operand => ({ kind: 'number', value });
const cond = (left: Operand, op: Condition['op'], right: Operand): Condition => ({ left, op, right });

const base = { initialCapitalPaise: 10_00_000_00, sizing: { mode: 'capital' as const, pct: 100 } };

/** Starting points, not recommendations: every result is shown with its full trade list and costs. */
export const PRESETS: { id: string; tf: Timeframe; strategy: Strategy }[] = [
  {
    id: 'ema', tf: 'D',
    strategy: {
      ...base, name: 'EMA 9/21 crossover (positional)', direction: 'LONG', product: 'CNC',
      entry: { match: 'all', conditions: [cond(ind('EMA', 9), 'crossesAbove', ind('EMA', 21))] },
      exit: { match: 'all', conditions: [cond(ind('EMA', 9), 'crossesBelow', ind('EMA', 21))] },
    },
  },
  {
    id: 'supertrend', tf: '15',
    strategy: {
      ...base, name: 'Supertrend 10,3 intraday', direction: 'LONG', product: 'MIS', stopLossPct: 1,
      entry: { match: 'all', conditions: [cond(close, 'crossesAbove', ind('SUPERTREND', 10, 3))] },
      exit: { match: 'all', conditions: [cond(close, 'crossesBelow', ind('SUPERTREND', 10, 3))] },
    },
  },
  {
    id: 'rsi', tf: 'D',
    strategy: {
      ...base, name: 'RSI 14 oversold bounce', direction: 'LONG', product: 'CNC', stopLossPct: 5, targetPct: 8,
      entry: { match: 'all', conditions: [cond(ind('RSI', 14), 'crossesAbove', num(30))] },
      exit: { match: 'all', conditions: [cond(ind('RSI', 14), 'crossesAbove', num(70))] },
    },
  },
  {
    id: 'vwap', tf: '5',
    strategy: {
      ...base, name: 'VWAP + RSI momentum intraday', direction: 'LONG', product: 'MIS', stopLossPct: 0.5, targetPct: 1,
      entry: { match: 'all', conditions: [cond(close, 'crossesAbove', ind('VWAP')), cond(ind('RSI', 14), '>', num(55))] },
      exit: { match: 'all', conditions: [cond(close, 'crossesBelow', ind('VWAP'))] },
    },
  },
];
