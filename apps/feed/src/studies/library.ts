// TradingView-equivalent indicators from lightweight-charts-indicators (MIT, see THIRD_PARTY_NOTICES.md): Pine Script v6
// ports whose results we measured equal to our TradingView-verified indicators. Only the standard indicators and
// candlestick patterns are offered; the community ports are excluded because their licences are unclear.
// The library is ~15 MB, so it runs here on the server and the browser only draws the results.

import type { Candle } from '@mtv/shared';

type Entry = {
  id: string; group: 'standard' | 'community' | 'candlestick'; name: string; shortName: string; description?: string;
  category: string; overlay: boolean; inputConfig: unknown[]; plotConfig: unknown[];
  calculate: (bars: unknown[], inputs?: Record<string, unknown>) => unknown;
  [k: string]: unknown;
};

/** Measured equal to our TradingView-verified indicators on NSE data (scripts/compare-lci.ts). */
export const VERIFIED = new Set(['sma', 'ema', 'rsi', 'macd', 'bb', 'atr', 'supertrend']);

let registry: Entry[] | null = null;
async function load(): Promise<Entry[]> {
  if (!registry) {
    const lib = (await import('lightweight-charts-indicators')) as unknown as { indicatorRegistry: Entry[] };
    registry = lib.indicatorRegistry.filter((e) => e.group !== 'community');
  }
  return registry;
}

/** Everything the browser needs to list, configure and draw each indicator (no functions). */
export async function catalog() {
  return (await load()).map(({ calculate: _calc, ...rest }) => ({ ...rest, verified: VERIFIED.has(rest.id) }));
}

export class StudyError extends Error {}

const IST = 5.5 * 3600;

/**
 * Calculates one indicator on candles. Bar times are shifted to IST wall-clock time, as the chart displays them, so
 * the result lines up with the chart's bars.
 */
export async function computeStudy(id: string, candles: Candle[], inputs: Record<string, unknown> = {}) {
  const entry = (await load()).find((e) => e.id === id);
  if (!entry) throw new StudyError('Unknown indicator');
  const bars = candles.map((c) => ({ time: c.time + IST, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  try {
    return entry.calculate(bars, inputs);
  } catch (e) {
    throw new StudyError(`Could not calculate ${entry.shortName}: ${(e as Error).message}`);
  }
}

/** JSON cannot carry NaN or ±Infinity (gaps in a plot); send them as markers the browser turns back into numbers. */
export const NUMERIC_MARKER = '__num__';
export function encodeNonFinite(_key: string, v: unknown) {
  if (typeof v === 'number' && !Number.isFinite(v)) return `${NUMERIC_MARKER}${Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf'}`;
  return v;
}
