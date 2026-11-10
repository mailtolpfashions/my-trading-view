// What each Screener preset did on our NSE history (scripts/research/preset-evidence.ts writes the file): the
// average move after a match against the average stock over the same window, and in how many years (or months)
// that was better. Shown next to each preset so a ready-made screen comes with its test result.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type PresetEvidence = {
  horizon: string; signals: number; stock: number; crowd: number; excess: number; t: number;
  better: number; periods: number; period: 'years' | 'months'; from: string; to: string; bearish: boolean;
};

const FILE = path.resolve(import.meta.dirname, '../../.data/research/preset-evidence.json');
let cached: { at: number; presets: Record<string, PresetEvidence>; built: string | null } | null = null;

/** The evidence per preset id (re-read at most every 10 minutes; empty when the study has not been run). */
export async function presetEvidence(): Promise<{ presets: Record<string, PresetEvidence>; built: string | null }> {
  if (cached && Date.now() - cached.at < 600_000) return cached;
  const doc = await readFile(FILE, 'utf8').then((t) => JSON.parse(t) as { built: string; presets: Record<string, PresetEvidence> }, () => null);
  cached = { at: Date.now(), presets: doc?.presets ?? {}, built: doc?.built ?? null };
  return cached;
}

/** The same test for each candlestick pattern, by pattern name (scripts/research/pattern-evidence.ts writes it). */
export type PatternEvidence = PresetEvidence & { neutral: boolean };
const PATTERN_FILE = path.resolve(import.meta.dirname, '../../.data/research/pattern-evidence.json');
let patternCache: { at: number; patterns: Record<string, PatternEvidence>; built: string | null } | null = null;

export async function patternEvidence(): Promise<{ patterns: Record<string, PatternEvidence>; built: string | null }> {
  if (patternCache && Date.now() - patternCache.at < 600_000) return patternCache;
  const doc = await readFile(PATTERN_FILE, 'utf8').then((t) => JSON.parse(t) as { built: string; patterns: Record<string, PatternEvidence> }, () => null);
  patternCache = { at: Date.now(), patterns: doc?.patterns ?? {}, built: doc?.built ?? null };
  return patternCache;
}
