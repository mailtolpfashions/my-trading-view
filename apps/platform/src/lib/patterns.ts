// Candlestick patterns on the chart: the feed gives each pattern's rule and its test on NSE daily history; the
// chart finds the patterns itself (packages/rules findPatterns, the same rules as the Scanner) on the bars it shows.

import { useEffect, useMemo, useState } from 'react';
import { findPatterns, patternLabel } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { verdictOf } from '@/components/screener/scan-gallery';
import { feed, keepAnswer, lastAnswer } from './feed';
import type { PresetEvidence } from './screener';

export type PatternMeta = { name: string; side: 'bullish' | 'bearish' | 'neutral'; bars: number; rule: string; evidence: PresetEvidence | null };
type MetaAnswer = { built: string | null; patterns: PatternMeta[] };

/** One marked pattern, ready for the chart: where, which way, and what to say about it. */
export type ChartPattern = {
  time: number; name: string; label: string; side: PatternMeta['side']; bars: number; rule: string;
  verdict: ReturnType<typeof verdictOf>;
  /** The candle closed locked at a price band: it could not be bought or sold at that close (left out of the test). */
  band: boolean;
};

/** The patterns' rules and test results (the last answer at once, then a fresh one). */
export function usePatternMeta() {
  const [meta, setMeta] = useState<MetaAnswer | null>(null);
  useEffect(() => {
    setMeta(lastAnswer<MetaAnswer>('patterns/meta')?.data ?? null);
    feed<MetaAnswer>('patterns/meta').then((m) => { keepAnswer('patterns/meta', m); setMeta(m); }, () => {});
  }, []);
  return meta;
}

const BANDS = [0.02, 0.05, 0.1, 0.2];
/** Closed at the day's high or low with the move on a 2/5/10/20% band (0.1% allows for rounding). */
const atBand = (c: Candle, prev?: Candle) => {
  if (!prev) return false;
  const move = Math.abs(c.close / prev.close - 1);
  return (c.close === c.high || c.close === c.low) && BANDS.some((b) => Math.abs(move - b) < 0.001);
};

/** Every pattern the owner picked, found on these candles. */
export function useChartPatterns(candles: Candle[], picked: readonly string[], meta: MetaAnswer | null): ChartPattern[] {
  return useMemo(() => {
    if (!picked.length || !candles.length) return [];
    const byName = new Map((meta?.patterns ?? []).map((p) => [p.name, p]));
    return findPatterns(candles, picked).map((h) => ({
      time: h.time, name: h.name, label: patternLabel(h.name), side: h.side, bars: h.bars, rule: h.rule,
      verdict: verdictOf(byName.get(h.name)?.evidence), band: atBand(candles[h.index], candles[h.index - 1]),
    }));
  }, [candles, picked, meta]);
}
