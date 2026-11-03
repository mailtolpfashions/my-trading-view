// Research engine client: run a condition study on the feed and read its per-period counts.

import type { RuleSet } from '@mtv/backtest';
import type { EodTimeframe } from '@mtv/shared';
import { FEED_URL, feedFetch } from './feed';

export type Tally = { up: number; down: number; flat: number; best: { pct: number; date: string; symbol: string } | null; worst: { pct: number; date: string; symbol: string } | null };
export type PeriodStats = { period: string; events: number; outcomes: Tally[]; skipped: number[]; baseline: { up: number; down: number; total: number }[] };
export type StudyOutcome = { pct: number; maxUpPct: number; maxDownPct: number } | null;
export type StudyEvent = { symbol: string; time: number; date: string; close: number; out: StudyOutcome[]; broken: boolean[] };
export type StudyResult = { tf: EodTimeframe; horizons: number[]; symbols: number; totalEvents: number; years: PeriodStats[]; months: PeriodStats[]; events: StudyEvent[]; excluded: string[]; dataBreaks: { count: number; latest: { symbol: string; date: string; reason: string }[] } };
export type StudyRequest = { symbol: string; tf: EodTimeframe; rules: RuleSet; horizons?: number[]; fromYear?: string; toYear?: string; excludeEvents?: string[] };

export async function runStudy(req: StudyRequest, signal?: AbortSignal): Promise<StudyResult> {
  const res = await feedFetch(`${FEED_URL}/api/research/study`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Study failed');
  return body as StudyResult;
}

const price = (field: 'close' | 'high' | 'low') => ({ kind: 'price' as const, field });
const ind = (name: 'EMA' | 'SMA' | 'RSI' | 'HIGHEST' | 'LOWEST' | 'SUPERTREND' | 'CHANGE_PCT', ...params: number[]) => ({ kind: 'indicator' as const, name, params });
const num = (value: number) => ({ kind: 'number' as const, value });

/** Starting points, not recommendations. */
export const STUDY_PRESETS: { id: string; name: string; rules: RuleSet }[] = [
  { id: 'ema20-up', name: 'Close crosses above EMA 20', rules: { match: 'all', conditions: [{ left: price('close'), op: 'crossesAbove', right: ind('EMA', 20) }] } },
  { id: 'ema50-200', name: 'EMA 50 crosses above EMA 200', rules: { match: 'all', conditions: [{ left: ind('EMA', 50), op: 'crossesAbove', right: ind('EMA', 200) }] } },
  { id: 'rsi30', name: 'RSI 14 crosses below 30', rules: { match: 'all', conditions: [{ left: ind('RSI', 14), op: 'crossesBelow', right: num(30) }] } },
  { id: 'high52', name: 'Close above the previous 250-day high', rules: { match: 'all', conditions: [{ left: price('close'), op: '>', right: ind('HIGHEST', 250) }] } },
  { id: 'drop2', name: 'Day change of −2% or worse', rules: { match: 'all', conditions: [{ left: ind('CHANGE_PCT'), op: '<=', right: num(-2) }] } },
  { id: 'st-up', name: 'Close crosses above Supertrend 10,3', rules: { match: 'all', conditions: [{ left: price('close'), op: 'crossesAbove', right: ind('SUPERTREND', 10, 3) }] } },
];
