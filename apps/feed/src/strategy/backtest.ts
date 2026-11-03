// Runs an equity strategy (packages/backtest runPortfolio) on NSE end-of-day history and says plainly what limits the
// result: survivorship in today's index lists, history that starts after the chosen dates, and data breaks.

import { StrategyError, runPortfolio, type EquityStrategy, type Instrument } from '@mtv/backtest';
import { dailyHistory, eodComplete } from '../eod/store';
import { cachedHistory } from '../screener/screener';
import { baseSymbols, type UniverseSpec } from '../screener/universe';
import { INDICES } from '../symbols';

export { StrategyError };

export type BacktestRequest = { strategy: EquityStrategy; universe: UniverseSpec; strategyId?: string };

const MAX_STOCKS = 4000;
const MAX_TRADES = 20000;
/** Indices with NSE history that can stand in for index futures or an ETF. INDIA VIX isn't tradable; SENSEX is BSE's. */
const TRADABLE_INDICES = new Map(INDICES.filter((i) => i.nseName && i.symbol !== 'INDIAVIX').map((i) => [i.symbol, i.name]));
/** Rule words that read volume, which NSE's index files don't carry. */
const VOLUME_WORDS = /\b(VOLUME|RVOL|RVOL_TOD|RVOL_CUM|AVG_VOLUME|AVG_TURNOVER|OBV|MFI|VWAP)\b/;

export async function runStrategyBacktest(req: BacktestRequest) {
  const started = performance.now();
  if (!req?.strategy) throw new StrategyError('The strategy settings are missing');
  const universe = req.universe ?? { kind: 'all' };
  const symbols = await baseSymbols(universe, true);
  if (!symbols.length) throw new StrategyError('This stock list is empty');

  // Only stocks that traded at some point in the test window take part (delisted ones included, up to their last day).
  const fromT = Date.parse(`${req.strategy.from}T00:00:00+05:30`) / 1000, toT = Date.parse(`${req.strategy.to}T23:59:59+05:30`) / 1000;
  const instruments: Instrument[] = [];
  // Every symbol that takes no part is reported with its reason, so nothing drops out silently.
  const left = new Map<string, string[]>();
  const leave = (reason: string, sym: string) => left.set(reason, [...(left.get(reason) ?? []), sym]);
  for (let k = 0; k < symbols.length; k++) {
    if (k % 200 === 0) await new Promise((r) => setImmediate(r));
    const sym = symbols[k];
    const index = INDICES.find((i) => i.symbol === sym);
    if (index && !TRADABLE_INDICES.has(sym)) { leave(sym === 'INDIAVIX' ? 'not tradable (INDIA VIX is a volatility gauge)' : 'with no NSE history (a BSE index)', sym); continue; }
    const h = cachedHistory(sym);
    const c = h?.candles;
    if (!c?.length) { leave('with no NSE history held', sym); continue; }
    if (c[c.length - 1].time < fromT) { leave('stopped trading before the test period', sym); continue; }
    if (c[0].time > toT) { leave('listed after the test period', sym); continue; }
    instruments.push({ symbol: sym, daily: c, breaks: h!.breaks.map((b) => b.date), kind: index ? 'index' : 'equity' });
  }
  const excluded = [...left].map(([reason, list]) => ({ reason, count: list.length, symbols: list.slice(0, 50) }));
  if (!instruments.length) throw new StrategyError(`Nothing to test: ${excluded.map((e) => `${e.symbols.slice(0, 5).join(', ')}${e.count > 5 ? '…' : ''} (${e.reason})`).join('; ') || 'none of these traded in the test period'}`);
  const indices = instruments.filter((i) => i.kind === 'index').map((i) => TRADABLE_INDICES.get(i.symbol)!);
  // The rules that decide trades. Ranking only orders signals when slots are full, so a volume rank doesn't block an index.
  const rules = [req.strategy.entry, req.strategy.exit, req.strategy.stop.kind === 'formula' ? req.strategy.stop.formula : ''].join(' ');
  if (indices.length && indices.length === instruments.length && VOLUME_WORDS.test(rules)) {
    throw new StrategyError(`${indices.join(', ')} ${indices.length === 1 ? 'has' : 'have'} no volume in NSE's index files, so a rule using volume (${rules.match(VOLUME_WORDS)![1]}) can never be true. Remove it to test ${indices.length === 1 ? 'this index' : 'these indices'}.`);
  }
  if (instruments.length > MAX_STOCKS) throw new StrategyError(`That is ${instruments.length.toLocaleString('en-IN')} stocks; pick a list of at most ${MAX_STOCKS.toLocaleString('en-IN')}`);
  const nifty = dailyHistory('NIFTY');
  const result = runPortfolio(instruments, req.strategy, nifty?.candles ?? null);

  const warnings: string[] = [];
  if (indices.length) {
    warnings.push(`${indices.join(', ')} ${indices.length === 1 ? 'is' : 'are'} tested as a stand-in for index futures or an index ETF: quantity is in index units (1 unit gains ₹1 per point), charges are at futures rates, and futures premium, rollover and lot sizes are not included.`);
    if (VOLUME_WORDS.test(rules)) warnings.push(`Your rules use volume (${rules.match(VOLUME_WORDS)![1]}), which indices don't have: they never signal on ${indices.join(', ')}.`);
  }
  if (universe.kind === 'index' || universe.kind === 'fno') warnings.push(`This uses today's ${universe.kind === 'index' ? `${universe.name} members` : 'F&O stock list'}. Stocks that left it, often after falling, are missing from the past, so results can look better than they were. "All NSE stocks" includes delisted ones.`);
  const lastDay = nifty?.to;
  if (lastDay && req.strategy.to > lastDay) warnings.push(`NSE's end-of-day file after ${lastDay} is not in yet (it is published in the evening), so the test ends on ${lastDay}.`);
  const bars = result.equity.length;
  const per = { D: 'trading days', W: 'weeks', M: 'months' }[req.strategy.tf];
  if (bars < { D: 60, W: 26, M: 12 }[req.strategy.tf]) warnings.push(`The test covers only ${bars} ${per}. A signal at one bar's close trades at the next bar's open, so very short tests show few or no trades; test at least a year for a meaningful result.`);
  const earliest = nifty?.from;
  if (earliest && req.strategy.from < earliest) warnings.push(`NSE history held here starts on ${earliest}; the test effectively starts then, not on ${req.strategy.from}.`);
  if (!eodComplete()) warnings.push('Older NSE history is still downloading, so some stocks have less history than they should.');
  if (result.metrics.dataBreakTrades) warnings.push(`${result.metrics.dataBreakTrades} trade${result.metrics.dataBreakTrades === 1 ? ' spans' : 's span'} a corporate action that could not be adjusted (marked in the trade list); ${result.metrics.dataBreakTrades === 1 ? 'its' : 'their'} P&L may be off.`);
  if (result.metrics.openAtEnd) warnings.push(`${result.metrics.openAtEnd} position${result.metrics.openAtEnd === 1 ? ' was still open at the end and is' : 's were still open at the end and are'} valued at the last close.`);

  return {
    ...result,
    trades: result.trades.slice(0, MAX_TRADES),
    tradesTruncated: result.trades.length > MAX_TRADES,
    stocks: instruments.length,
    excluded,
    warnings,
    ms: Math.round(performance.now() - started),
  };
}
