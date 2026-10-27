// Market scanner: evaluates a rule set on the latest NSE session for every stock that traded that day.
// Indicators are computed over each stock's full adjusted history, so values match the chart and the backtester.

import { evalCondition, operandKey, operandSeries, type Operand, type RuleSet } from '@mtv/backtest';
import { dailyHistory, eodComplete, eodLatestDate, eodUniverse } from '../eod/store';

export class ScanError extends Error {}

export type ScanRow = {
  symbol: string;
  close: number;
  changePct: number | null;
  volume: number;
  /** Traded value that day, ₹ crore. */
  valueCr: number;
  /** Each operand used in the rules, by its key (e.g. "RSI(14)"), at the latest session. */
  values: Record<string, number | null>;
};

/** `complete` is false while NSE history is still downloading: long-period indicators then have too little data. */
export async function runScan(rules: RuleSet, limit = 300): Promise<{ date: string | null; complete: boolean; scanned: number; matches: number; rows: ScanRow[] }> {
  if (!rules?.conditions?.length) throw new ScanError('Add at least one condition');
  if (rules.conditions.length > 10) throw new ScanError('Use at most 10 conditions');
  const date = eodLatestDate();
  const universe = eodUniverse();
  const rows: ScanRow[] = [];
  let matches = 0;
  for (let n = 0; n < universe.length; n++) {
    if (n % 100 === 0) await new Promise((r) => setImmediate(r)); // keep the price feed responsive
    const symbol = universe[n];
    const h = dailyHistory(symbol);
    if (!h || h.candles.length < 2) continue;
    const c = h.candles, i = c.length - 1;
    const cache = new Map<string, (number | null)[]>();
    const series = (o: Operand) => {
      const k = operandKey(o);
      if (!cache.has(k)) cache.set(k, operandSeries(o, c));
      return cache.get(k)!;
    };
    const results = rules.conditions.map((cond) => evalCondition(cond, series(cond.left), series(cond.right), i));
    if (!(rules.match === 'all' ? results.every(Boolean) : results.some(Boolean))) continue;
    matches++;
    const last = c[i], prev = c[i - 1];
    const values: Record<string, number | null> = {};
    for (const [k, s] of cache) if (!k.startsWith('#')) values[k] = s[i];
    rows.push({
      symbol, close: last.close, changePct: prev.close ? ((last.close - prev.close) / prev.close) * 100 : null,
      volume: last.volume, valueCr: (last.close * last.volume) / 1e7, values,
    });
  }
  rows.sort((a, b) => b.valueCr - a.valueCr); // most actively traded first
  return { date, complete: eodComplete(), scanned: universe.length, matches, rows: rows.slice(0, limit) };
}
