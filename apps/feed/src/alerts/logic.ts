// When alerts fire. Pure functions, so the rules are tested exactly as they run.
//
// - Price alerts fire on a CROSSING: the previous price checked was on one side of the level and the current one is
//   on the other (or touching it). An alert created with the price already beyond the level waits for a real cross.
// - Indicator alerts are evaluated on CLOSED bars only (a forming bar can still change), at most once per bar.

import { evalCondition, operandKey, operandSeries, type Operand, type RuleSet } from '@mtv/backtest';
import type { Candle, Timeframe } from '@mtv/shared';
import { barEnd } from '../access';

export type PriceOp = 'crossesAbove' | 'crossesBelow';
export type PriceParams = { op: PriceOp; valuePaise: number };
export type RulesParams = { tf: Timeframe; rules: RuleSet };
export const ALERT_TIMEFRAMES: Timeframe[] = ['5', '15', '60', 'D'];

/** True when the price moved from one side of the level to the other between two checks. */
export function priceCrossed(op: PriceOp, levelPaise: number, previousPaise: number | undefined, currentPaise: number): boolean {
  if (previousPaise === undefined) return false;
  return op === 'crossesAbove' ? previousPaise < levelPaise && currentPaise >= levelPaise : previousPaise > levelPaise && currentPaise <= levelPaise;
}

/**
 * The latest closed bar (closed by `asOfSec`) if the rules hold on it, else null. `asOfSec` is "now" for live data,
 * or the 15-minute cutoff for delayed data, so a bar only counts once its close is visible to the user.
 */
export function rulesFireOn(candles: Candle[], tf: Timeframe, rules: RuleSet, asOfSec: number): Candle | null {
  let i = candles.length - 1;
  while (i >= 0 && barEnd(candles[i], tf) > asOfSec) i--;
  if (i < 0) return null;
  const closed = candles.slice(0, i + 1);
  const cache = new Map<string, (number | null)[]>();
  const series = (o: Operand) => {
    const k = operandKey(o);
    if (!cache.has(k)) cache.set(k, operandSeries(o, closed));
    return cache.get(k)!;
  };
  const results = rules.conditions.map((c) => evalCondition(c, series(c.left), series(c.right), i));
  return (rules.match === 'all' ? results.every(Boolean) : results.some(Boolean)) ? closed[i] : null;
}
