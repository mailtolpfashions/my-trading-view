// Stock screener on NSE end-of-day history: one condition tree (packages/rules) evaluated on each stock of a universe,
// at its newest bar. Daily, weekly and monthly bars come from the same adjusted history as the chart, so values match
// it. Intraday timeframes need the live connection (a later step) and are refused clearly, never faked.

import {
  Evaluator, barEnd, resample, checkTimeframes, explain, isIntraday, lookback, parseFormula, print, timeframesOf, type Node, type Tf,
} from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, eodComplete, eodLatestDate, eodVersion, type DailyHistory } from '../eod/store';
import { findInstrument } from '../symbols';
import { resolveUniverse, type UniverseFilters, type UniverseSpec } from './universe';

export class ScreenError extends Error {}

export type ScreenRequest = {
  formula: string;
  /** The scan's own timeframe; conditions without [tf] use it. */
  tf?: Tf;
  universe?: UniverseSpec;
  filters?: UniverseFilters;
  /** Extra values to show per row, as formulas (e.g. "RSI(CLOSE, 14)"). */
  columns?: string[];
  /** closed: a weekly or monthly bar still forming is skipped; live: it is used as it stands. */
  candle?: 'closed' | 'live';
  limit?: number;
  /** Set when running a saved screen, so the run goes into its history. */
  screenId?: string;
  name?: string;
};

export type ScreenRow = {
  symbol: string;
  name: string;
  industry: string | null;
  close: number;
  changePct: number | null;
  volume: number;
  /** Average traded value of the last 20 sessions, ₹ crore. */
  avgValueCr: number | null;
  lowLiquidity: boolean;
  /** Latest data break inside the last year of history (indicator values across it may be off). */
  dataBreak: string | null;
  /** Date of the bar the condition was evaluated on. */
  barDate: string;
  columns: (number | null)[];
  conditions: { formula: string; value: number | null }[];
};

export type ScreenResult = {
  asOf: string | null;
  tf: Tf;
  formula: string;
  columns: string[];
  candle: 'closed' | 'live';
  eligible: number;
  scanned: number;
  matches: number;
  rows: ScreenRow[];
  /** False while NSE history is still downloading: long lookbacks can have too little data. */
  complete: boolean;
  excluded: { reason: string; count: number }[];
  ms: number;
};

const LOW_LIQUIDITY_CR = 1; // under ₹1 crore a day on average
const MAX_COLUMNS = 20;
const IST = 5.5 * 3600;
const dateOf = (c: Candle) => new Date((c.time + IST) * 1000).toISOString().slice(0, 10);

// Adjusted histories are rebuilt only when the store gains a day.
let cacheVersion = -1;
const histories = new Map<string, DailyHistory | null>();
export function cachedHistory(symbol: string): DailyHistory | null {
  if (eodVersion() !== cacheVersion) { histories.clear(); cacheVersion = eodVersion(); }
  if (!histories.has(symbol)) histories.set(symbol, dailyHistory(symbol));
  return histories.get(symbol)!;
}

/** Parses a condition or column formula, with a message fit for the user. */
function compile(formula: string, want: 'bool' | 'num', label: string): Node {
  const p = parseFormula(formula);
  if (!p.ok) throw new ScreenError(`${label}: ${p.error}`);
  if (want === 'bool' && p.type !== 'bool') throw new ScreenError(`${label} is a value, not a condition. Compare it, e.g. ${p.formula} > 50`);
  if (want === 'num' && p.type !== 'num') throw new ScreenError(`${label} must be a value, e.g. RSI(CLOSE, 14)`);
  try { checkTimeframes(p.node); } catch (e) { throw new ScreenError(`${label}: ${(e as Error).message}`); }
  return p.node;
}

export async function runScreen(req: ScreenRequest, now = Date.now() / 1000): Promise<ScreenResult> {
  const started = performance.now();
  const tf: Tf = req.tf ?? 'D';
  const candle = req.candle ?? 'closed';
  if (!req.formula?.trim()) throw new ScreenError('Add at least one condition');
  const node = compile(req.formula, 'bool', 'Condition');
  const columns = (req.columns ?? []).slice(0, MAX_COLUMNS);
  const colNodes = columns.map((c, i) => compile(c, 'num', `Column ${i + 1}`));
  const tfs = new Set<Tf>([tf, ...timeframesOf(node), ...colNodes.flatMap((n) => [...timeframesOf(n)])]);
  const intraday = [...tfs].filter(isIntraday);
  if (intraday.length) throw new ScreenError(`Intraday timeframes (${intraday.join(', ')}) need the live data connection, which comes in a later step. Use D, W or M for now.`);

  const { symbols, excluded, info } = await resolveUniverse(req.universe ?? { kind: 'all' }, req.filters ?? {}, cachedHistory);
  const back = lookback(node);
  const rows: ScreenRow[] = [];
  let scanned = 0, matches = 0;

  for (let n = 0; n < symbols.length; n++) {
    if (n % 100 === 0) await new Promise((r) => setImmediate(r)); // keep the service responsive during a scan
    const symbol = symbols[n];
    const h = cachedHistory(symbol);
    if (!h || h.candles.length < 2) continue;
    const daily = h.candles;
    const bars = new Map<Tf, Candle[]>([['D', daily]]);
    const source = (t: Tf) => {
      if (!bars.has(t)) bars.set(t, t === 'W' || t === 'M' ? resample(daily, t) : [] /* same bars as the chart (screener.test.ts) */);
      return bars.get(t)!.length ? bars.get(t)! : null;
    };
    const own = source(tf);
    if (!own) continue;
    let i = own.length - 1;
    if (candle === 'closed' && barEnd(own[i].time, tf) > now) i--; // the newest bar has not closed yet
    if (i < 1) continue;
    scanned++;
    const ev = new Evaluator(source, Number.isFinite(back) ? Math.max(0, i - back) : 0);
    if (ev.series(node, tf)[i] !== 1) continue;
    matches++;

    const last = daily[daily.length - 1], prev = daily[daily.length - 2];
    const recent = daily.slice(-20);
    const avgValueCr = recent.length ? recent.reduce((a, b) => a + b.close * b.volume, 0) / recent.length / 1e7 : null;
    const yearAgo = dateOf(daily[Math.max(0, daily.length - 252)]);
    const brk = h.breaks.filter((b) => b.date >= yearAgo).at(-1)?.date ?? null;
    rows.push({
      symbol,
      name: info.get(symbol)?.company ?? findInstrument(symbol)?.name ?? symbol,
      industry: info.get(symbol)?.industry ?? null,
      close: last.close,
      changePct: prev.close ? ((last.close - prev.close) / prev.close) * 100 : null,
      volume: last.volume,
      avgValueCr,
      lowLiquidity: avgValueCr != null && avgValueCr < LOW_LIQUIDITY_CR,
      dataBreak: brk,
      barDate: dateOf(own[i]),
      columns: colNodes.map((c) => ev.series(c, tf)[i] ?? null),
      conditions: explain(ev, node, tf, i),
    });
  }
  rows.sort((a, b) => (b.avgValueCr ?? 0) - (a.avgValueCr ?? 0)); // most actively traded first
  return {
    asOf: eodLatestDate(), tf, formula: print(node), columns: colNodes.map(print), candle,
    eligible: symbols.length, scanned, matches, rows: rows.slice(0, Math.min(req.limit ?? 2000, 5000)),
    complete: eodComplete(), excluded, ms: Math.round(performance.now() - started),
  };
}
