// Published signal strategies. Rules are fixed once published: changing anything here requires a new version
// (the runner refuses a strategy whose stored rules hash no longer matches). All are long-only, end-of-day,
// delivery (CNC): decided at NSE's official close, acted on at the next session's open.

import type { Condition, Operand, Strategy } from '@mtv/backtest';

const ind = (name: Extract<Operand, { kind: 'indicator' }>['name'], ...params: number[]): Operand => ({ kind: 'indicator', name, params });
const close: Operand = { kind: 'price', field: 'close' };
const volume: Operand = { kind: 'price', field: 'volume' };
const num = (value: number): Operand => ({ kind: 'number', value });
const cond = (left: Operand, op: Condition['op'], right: Operand): Condition => ({ left, op, right });

/** Liquidity filter, measured on that day's data only: average traded value ≥ ₹10 crore over 20 days and price ≥ ₹50. */
const LIQUID: Condition[] = [cond(ind('VALUE_SMA', 20), '>=', num(10)), cond(close, '>=', num(50))];

const base = { direction: 'LONG' as const, product: 'CNC' as const, sizing: { mode: 'capital' as const, pct: 100 }, initialCapitalPaise: 10_00_000_00 };

export type SignalDefinition = { slug: string; version: number; name: string; description: string; rules: Strategy };

export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    slug: 'breakout-52w', version: 1,
    name: '52-week high breakout',
    description: 'Close above the highest high of the previous 252 sessions, on above-average volume. Exits on a close below the 50-day SMA, an 8% stop loss, or after 120 sessions.',
    rules: {
      ...base, name: '52-week high breakout', stopLossPct: 8, maxBars: 120,
      entry: { match: 'all', conditions: [cond(close, '>', ind('HIGHEST', 252)), cond(volume, '>', ind('VOL_SMA', 50)), ...LIQUID] },
      exit: { match: 'all', conditions: [cond(close, 'crossesBelow', ind('SMA', 50))] },
    },
  },
  {
    slug: 'trend-ema-20-50', version: 1,
    name: 'EMA 20/50 trend crossover',
    description: 'EMA 20 crosses above EMA 50 while the close is above the 200-day SMA. Exits when EMA 20 crosses back below EMA 50, or on a 10% stop loss.',
    rules: {
      ...base, name: 'EMA 20/50 trend crossover', stopLossPct: 10,
      entry: { match: 'all', conditions: [cond(ind('EMA', 20), 'crossesAbove', ind('EMA', 50)), cond(close, '>', ind('SMA', 200)), ...LIQUID] },
      exit: { match: 'all', conditions: [cond(ind('EMA', 20), 'crossesBelow', ind('EMA', 50))] },
    },
  },
  {
    slug: 'rsi-pullback-uptrend', version: 1,
    name: 'RSI pullback in an uptrend',
    description: 'RSI 14 crosses back above 30 while the close is above the 200-day SMA. Exits when RSI 14 crosses above 60, on a 7% stop loss, or after 20 sessions.',
    rules: {
      ...base, name: 'RSI pullback in an uptrend', stopLossPct: 7, maxBars: 20,
      entry: { match: 'all', conditions: [cond(ind('RSI', 14), 'crossesAbove', num(30)), cond(close, '>', ind('SMA', 200)), ...LIQUID] },
      exit: { match: 'all', conditions: [cond(ind('RSI', 14), 'crossesAbove', num(60))] },
    },
  },
  {
    slug: 'supertrend-flip', version: 1,
    name: 'Supertrend 10,3 flip',
    description: 'Close crosses above Supertrend (10, 3). Exits when the close crosses back below it, or on a 10% stop loss.',
    rules: {
      ...base, name: 'Supertrend 10,3 flip', stopLossPct: 10,
      entry: { match: 'all', conditions: [cond(close, 'crossesAbove', ind('SUPERTREND', 10, 3)), ...LIQUID] },
      exit: { match: 'all', conditions: [cond(close, 'crossesBelow', ind('SUPERTREND', 10, 3))] },
    },
  },
];
