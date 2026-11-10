// TradingView-equivalent indicator library: the list and the calculations come from the feed service (the library is
// too large for the browser); the chart draws results with the library's own renderer.

import type { Timeframe } from '@mtv/shared';
import { FEED_URL, feedFetch } from '@/lib/feed';

export type LibInput = {
  id: string; type: 'int' | 'float' | 'bool' | 'string' | 'text_area' | 'source' | 'color' | 'timeframe' | 'session' | 'time' | 'symbol';
  defval: unknown; title?: string; min?: number; max?: number; step?: number; options?: string[]; group?: string; tooltip?: string;
};
export type LibIndicator = {
  id: string; group: 'standard' | 'candlestick'; name: string; shortName: string; description?: string; category: string;
  overlay: boolean; inputConfig: LibInput[]; plotConfig: { id: string; title?: string; color?: string }[];
  hlineConfig?: unknown[]; fillConfig?: unknown[]; arrowConfig?: unknown[];
  /** Measured equal to our TradingView-verified implementation. */
  verified: boolean;
  [k: string]: unknown;
};
/** One library indicator on the chart. */
export type LibStudy = { uid: string; id: string; inputs: Record<string, unknown> };

let catalogPromise: Promise<LibIndicator[]> | null = null;
export function fetchCatalog(): Promise<LibIndicator[]> {
  catalogPromise ??= feedFetch(`${FEED_URL}/api/studies/catalog`).then(async (r) => {
    if (!r.ok) throw new Error('Indicator list unavailable');
    return ((await r.json()) as { indicators: LibIndicator[] }).indicators;
  }).catch((e) => { catalogPromise = null; throw e; });
  return catalogPromise;
}

const MARKER = '__num__';
const revive = (_k: string, v: unknown) =>
  typeof v === 'string' && v.startsWith(MARKER) ? (v === `${MARKER}NaN` ? NaN : v === `${MARKER}Inf` ? Infinity : -Infinity) : v;

export async function computeLib(symbol: string, tf: Timeframe, id: string, inputs: Record<string, unknown>, signal?: AbortSignal) {
  const res = await feedFetch(`${FEED_URL}/api/studies/compute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, tf, id, inputs }), signal,
  });
  const text = await res.text();
  const body = JSON.parse(text, revive) as { result?: unknown; message?: string };
  if (!res.ok) throw new Error(body.message ?? 'Indicator could not be calculated');
  return body.result as { plots: Record<string, { time: number; value: number; color?: string }[]> } & Record<string, unknown>;
}

/** Level lines (RSI 70 / 30, stochastic 80 / 20…) are kept with the inputs under this prefix, by the line's id. */
export const LEVEL = '__level:';
type HLine = { id: string; price: number; title?: string };
/** The indicator's level lines (hlineConfig), for its settings form. */
export const levelLines = (ind: LibIndicator) => ((ind.hlineConfig ?? []) as HLine[]).filter((h) => h && typeof h.price === 'number' && typeof h.id === 'string');
/** The indicator with the owner's level prices in place of its defaults, for drawing. */
export function withLevels(ind: LibIndicator, inputs: Record<string, unknown>): LibIndicator {
  if (!ind.hlineConfig?.length) return ind;
  return { ...ind, hlineConfig: (ind.hlineConfig as HLine[]).map((h) => (typeof inputs[LEVEL + h.id] === 'number' ? { ...h, price: inputs[LEVEL + h.id] as number } : h)) };
}
/** The inputs the calculation needs (level prices only change the drawing). */
export const calcInputs = (inputs: Record<string, unknown>) => Object.fromEntries(Object.entries(inputs).filter(([k]) => !k.startsWith(LEVEL)));

export const CATEGORY_ORDER = ['Moving Averages', 'Trend', 'Oscillators', 'Momentum', 'Volatility', 'Channels & Bands', 'Volume', 'Candlestick Patterns'];
export const newUid = () => Math.random().toString(36).slice(2, 10);
