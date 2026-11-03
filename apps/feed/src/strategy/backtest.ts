// Runs an equity strategy (packages/backtest runPortfolio) on NSE end-of-day history and says plainly what limits the
// result: survivorship in today's index lists, history that starts after the chosen dates, and data breaks.

import { StrategyError, runPortfolio, type EquityStrategy, type Instrument } from '@mtv/backtest';
import { dailyHistory, eodComplete } from '../eod/store';
import { cachedHistory } from '../screener/screener';
import { baseSymbols, type UniverseSpec } from '../screener/universe';

export { StrategyError };

export type BacktestRequest = { strategy: EquityStrategy; universe: UniverseSpec; strategyId?: string };

const MAX_STOCKS = 4000;
const MAX_TRADES = 20000;

export async function runStrategyBacktest(req: BacktestRequest) {
  const started = performance.now();
  if (!req?.strategy) throw new StrategyError('The strategy settings are missing');
  const universe = req.universe ?? { kind: 'all' };
  const symbols = await baseSymbols(universe, true);
  if (!symbols.length) throw new StrategyError('This stock list is empty');

  // Only stocks that traded at some point in the test window take part (delisted ones included, up to their last day).
  const fromT = Date.parse(`${req.strategy.from}T00:00:00+05:30`) / 1000, toT = Date.parse(`${req.strategy.to}T23:59:59+05:30`) / 1000;
  const instruments: Instrument[] = [];
  for (let k = 0; k < symbols.length; k++) {
    if (k % 200 === 0) await new Promise((r) => setImmediate(r));
    const h = cachedHistory(symbols[k]);
    const c = h?.candles;
    if (!c?.length || c[c.length - 1].time < fromT || c[0].time > toT) continue;
    instruments.push({ symbol: symbols[k], daily: c, breaks: h!.breaks.map((b) => b.date) });
  }
  if (!instruments.length) throw new StrategyError('None of these stocks traded in the test period');
  if (instruments.length > MAX_STOCKS) throw new StrategyError(`That is ${instruments.length.toLocaleString('en-IN')} stocks; pick a list of at most ${MAX_STOCKS.toLocaleString('en-IN')}`);
  const nifty = dailyHistory('NIFTY');
  const result = runPortfolio(instruments, req.strategy, nifty?.candles ?? null);

  const warnings: string[] = [];
  if (universe.kind === 'index' || universe.kind === 'fno') warnings.push(`This uses today's ${universe.kind === 'index' ? `${universe.name} members` : 'F&O stock list'}. Stocks that left it, often after falling, are missing from the past, so results can look better than they were. "All NSE stocks" includes delisted ones.`);
  const lastDay = nifty?.to;
  if (lastDay && req.strategy.to > lastDay) warnings.push(`NSE's end-of-day file after ${lastDay} is not in yet (it is published in the evening), so the test ends on ${lastDay}.`);
  const bars = result.equity.length;
  const per = { D: 'trading days', W: 'weeks', M: 'months' }[req.strategy.tf];
  if (bars < { D: 60, W: 26, M: 12 }[req.strategy.tf]) warnings.push(`The test covers only ${bars} ${per}. A signal at one bar's close trades at the next bar's open, so very short tests show few or no trades; test at least a year for a meaningful result.`);
  const earliest = nifty?.from;
  if (earliest && req.strategy.from < earliest) warnings.push(`NSE history held here starts on ${earliest}; the test effectively starts then, not on ${req.strategy.from}.`);
  if (!eodComplete()) warnings.push('Older NSE history is still downloading, so some stocks have less history than they should.');
  if (result.metrics.dataBreakTrades) warnings.push(`${result.metrics.dataBreakTrades} trade${result.metrics.dataBreakTrades === 1 ? '' : 's'} span a corporate action that could not be adjusted (marked in the trade list); their P&L may be off.`);
  if (result.metrics.openAtEnd) warnings.push(`${result.metrics.openAtEnd} position${result.metrics.openAtEnd === 1 ? ' was' : 's were'} still open at the end and are valued at the last close.`);

  return {
    ...result,
    trades: result.trades.slice(0, MAX_TRADES),
    tradesTruncated: result.trades.length > MAX_TRADES,
    stocks: instruments.length,
    warnings,
    ms: Math.round(performance.now() - started),
  };
}
