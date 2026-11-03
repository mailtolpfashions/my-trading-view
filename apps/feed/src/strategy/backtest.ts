// Runs an equity strategy (packages/backtest runPortfolio) on NSE end-of-day history, or on the stored Kite minutes for
// intraday timeframes, and says plainly what limits the result: survivorship in today's index lists, history that
// starts after the chosen dates, data breaks and minute-data gaps.

import { StrategyError, runPortfolio, type EquityStrategy, type Instrument } from '@mtv/backtest';
import { TF_MINUTES, isIntraday, parseFormula, timeframesOf, type Tf } from '@mtv/rules';
import { live } from '../intraday/instance';
import { dateOfIst } from '../intraday/store';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { dailyHistory, eodComplete } from '../eod/store';
import { cachedHistory } from '../screener/screener';
import { baseSymbols, type UniverseSpec } from '../screener/universe';
import { INDICES } from '../symbols';

export { StrategyError };

export type BacktestRequest = { strategy: EquityStrategy; universe: UniverseSpec; strategyId?: string };

const MAX_STOCKS = 4000;
const MAX_TRADES = 20000;
/** Instruments an intraday test may hold in memory, by its finest timeframe (a year of 1-minute bars is ~93,000 a stock). */
const MAX_INTRADAY: Record<string, number> = { '1m': 25, '3m': 60, '5m': 100, '15m': 250, '30m': 400, '1h': 500 };
/** Calendar days of minutes loaded before the test starts, for indicators to warm up. */
const INTRADAY_WARMUP_DAYS = 45;
/** Kite's own history has no minutes after 15:14 on these days (checked with Kite, 2026-11-03). */
const KITE_LATE_GAP = { from: '2026-08-03', to: '2026-10-30' };
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
  const intra = isIntraday(req.strategy.tf as Tf);
  // Intraday: the strategy's timeframe plus any intraday timeframe its rules name, all built from stored minutes.
  const ruleTfs = [req.strategy.entry, req.strategy.exit, req.strategy.rank, req.strategy.stop.kind === 'formula' ? req.strategy.stop.formula : '']
    .flatMap((x) => { const p = x?.trim() ? parseFormula(x) : null; return p?.ok ? [...timeframesOf(p.node)] : []; });
  const minuteTfs = intra ? [...new Set<Tf>([req.strategy.tf as Tf, ...ruleTfs.filter(isIntraday)])] : [];
  const finest = minuteTfs.reduce<Tf | null>((a, t) => (a == null || TF_MINUTES[t]! < TF_MINUTES[a]! ? t : a), null);
  let firstMinuteDay: string | null = null;
  /** Intraday: days with minutes inside the test window, by instrument (to flag thin coverage). */
  const minuteDays = new Map<string, number>();
  const instruments: Instrument[] = [];
  // Every symbol that takes no part is reported with its reason, so nothing drops out silently.
  const left = new Map<string, string[]>();
  const leave = (reason: string, sym: string) => left.set(reason, [...(left.get(reason) ?? []), sym]);
  // Intraday: only instruments with recorded minutes take part; too many would not fit in memory, so the test asks for fewer.
  const recorded = intra ? new Set(symbols.filter((x) => existsSync(path.join(live.store.dir, x)))) : null;
  if (recorded && !recorded.size) throw new StrategyError('No minute data is stored for these yet. Connect Kite (top right): the first connection downloads about a year of minutes for NIFTY 500, F&O stocks and the main indices.');
  if (recorded && recorded.size > MAX_INTRADAY[finest!]) throw new StrategyError(`That is ${recorded.size} instruments with minute data; on ${finest} bars the limit is ${MAX_INTRADAY[finest!]}. Pick fewer (NIFTY 50 stocks, a watchlist or a few stocks), or a longer timeframe.`);
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
    if (intra) {
      if (!recorded!.has(sym)) { leave('with no minute data (only NIFTY 500, F&O stocks and the main indices are recorded)', sym); continue; }
      const bars = await live.history(sym, minuteTfs, fromT - INTRADAY_WARMUP_DAYS * 86400);
      const own = bars.get(req.strategy.tf as Tf) ?? [];
      if (!own.some((b) => b.time >= fromT && b.time <= toT)) { leave('with no minute data in the test period', sym); continue; }
      minuteDays.set(sym, new Set(own.filter((b) => b.time >= fromT && b.time <= toT).map((b) => dateOfIst(b.time))).size);
      const d = dateOfIst(own[0].time);
      if (firstMinuteDay == null || d < firstMinuteDay) firstMinuteDay = d;
      instruments.push({ symbol: sym, daily: c, breaks: h!.breaks.map((b) => b.date), kind: index ? 'index' : 'equity', intraday: bars });
      continue;
    }
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
  if (intra) {
    const sessions = new Set(result.equity.map((e) => dateOfIst(e.time))).size;
    // Sessions the test window should hold (from NIFTY's daily closes, from the first minute day, before today).
    const today = dateOfIst(Date.now() / 1000), start = firstMinuteDay && firstMinuteDay > req.strategy.from ? firstMinuteDay : req.strategy.from;
    const expected = (nifty?.candles ?? []).map((c) => dateOfIst(c.time)).filter((d) => d >= start && d <= req.strategy.to && d < today).length;
    const thin = [...minuteDays].filter(([, n]) => expected > 0 && n < expected * 0.5);
    if (thin.length) warnings.push(`Little minute data for ${thin.slice(0, 8).map(([x, n]) => `${TRADABLE_INDICES.get(x) ?? x} (${n} of ${expected} days)`).join(', ')}${thin.length > 8 ? ` and ${thin.length - 8} more` : ''}, so ${thin.length === 1 ? 'it' : 'they'} barely took part. Indices fill in on the next Kite connection.`);
    if (firstMinuteDay && req.strategy.from < firstMinuteDay) warnings.push(`Minute data held here starts on ${firstMinuteDay} (about a year of Kite history), so the test effectively starts then, not on ${req.strategy.from}.`);
    if (sessions < 20) warnings.push(`The test covers only ${sessions} trading day${sessions === 1 ? '' : 's'}; test a few months for a meaningful result.`);
    if (req.strategy.from <= KITE_LATE_GAP.to && req.strategy.to >= KITE_LATE_GAP.from) warnings.push(`From ${KITE_LATE_GAP.from} to ${KITE_LATE_GAP.to} Kite's history has no minutes after 15:14, so positions on those days were squared off at the 15:14 close.`);
    warnings.push('Today is not included until the day is complete. Intraday liquidity is checked on the previous day\'s 20-day average traded value.');
  } else {
    const bars = result.equity.length;
    const tf = req.strategy.tf as 'D' | 'W' | 'M';
    const per = { D: 'trading days', W: 'weeks', M: 'months' }[tf];
    if (bars < { D: 60, W: 26, M: 12 }[tf]) warnings.push(`The test covers only ${bars} ${per}. A signal at one bar's close trades at the next bar's open, so very short tests show few or no trades; test at least a year for a meaningful result.`);
    const earliest = nifty?.from;
    if (earliest && req.strategy.from < earliest) warnings.push(`NSE history held here starts on ${earliest}; the test effectively starts then, not on ${req.strategy.from}.`);
  }
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
