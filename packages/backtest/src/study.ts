// Event study ("research engine"): every bar where a condition holds, and what happened next. For each event, the
// close-to-close move after each horizon (bars) and the largest rise and fall in between, taken from highs and lows.
// Results are grouped by year and month as counts and extremes with their dates, never averages, with the same
// counts for every bar as a baseline. Events close together have overlapping windows; they are all counted.

import type { Candle } from '@mtv/shared';
import { evalCondition, operandKey, operandSeries, type RuleSet } from './strategy';
import type { Series } from '@mtv/indicators';

export const STUDY_HORIZONS = [1, 5, 10, 20];

export type StudyOutcome = { pct: number; maxUpPct: number; maxDownPct: number } | null;
/** `broken[k]`: horizon k's window crosses a data break (see breakIndices), so its outcome is not measured. */
export type StudyEvent = { symbol: string; time: number; date: string; close: number; out: StudyOutcome[]; broken: boolean[] };

const IST = 5.5 * 3600;
export const dateOf = (time: number) => new Date((time + IST) * 1000).toISOString().slice(0, 10);

/** Bars (indices) where the rule set holds. */
export function ruleMask(candles: Candle[], rules: RuleSet): boolean[] {
  const cache = new Map<string, Series>();
  const series = (o: RuleSet['conditions'][number]['left']) => {
    const k = operandKey(o);
    if (!cache.has(k)) cache.set(k, operandSeries(o, candles));
    return cache.get(k)!;
  };
  return candles.map((_, i) => {
    const results = rules.conditions.map((cond) => evalCondition(cond, series(cond.left), series(cond.right), i));
    return rules.match === 'all' ? results.every(Boolean) : results.some(Boolean);
  });
}

/**
 * Bar indices that start after a data break (a day where the series is not continuous with the one before), from
 * the break dates. For weekly / monthly bars, the bar whose period contains the break date.
 */
export function breakIndices(c: Candle[], breakDates: string[]): Set<number> {
  const out = new Set<number>();
  for (const d of breakDates) {
    let i = c.length - 1;
    while (i >= 0 && dateOf(c[i].time) > d) i--;
    if (i > 0) out.add(i);
  }
  return out;
}

const crosses = (breaks: Set<number> | undefined, i: number, h: number) => { if (!breaks?.size) return false; for (let k = i + 1; k <= i + h; k++) if (breaks.has(k)) return true; return false; };

/** What happened `h` bars after bar i: close-to-close %, and the largest rise / fall (from highs / lows) on the way. */
export function outcome(c: Candle[], i: number, h: number, breaks?: Set<number>): StudyOutcome {
  if (i + h >= c.length || crosses(breaks, i, h)) return null;
  const base = c[i].close;
  let hi = -Infinity, lo = Infinity;
  for (let k = i + 1; k <= i + h; k++) { hi = Math.max(hi, c[k].high); lo = Math.min(lo, c[k].low); }
  return { pct: ((c[i + h].close - base) / base) * 100, maxUpPct: ((hi - base) / base) * 100, maxDownPct: ((lo - base) / base) * 100 };
}

export function findEvents(symbol: string, candles: Candle[], rules: RuleSet, horizons = STUDY_HORIZONS, breaks?: Set<number>): StudyEvent[] {
  const mask = ruleMask(candles, rules);
  const out: StudyEvent[] = [];
  mask.forEach((on, i) => {
    if (!on) return;
    out.push({ symbol, time: candles[i].time, date: dateOf(candles[i].time), close: candles[i].close, out: horizons.map((h) => outcome(candles, i, h, breaks)), broken: horizons.map((h) => i + h < candles.length && crosses(breaks, i, h)) });
  });
  return out;
}

export type Tally = { up: number; down: number; flat: number; best: { pct: number; date: string; symbol: string } | null; worst: { pct: number; date: string; symbol: string } | null };
/** `skipped[k]`: events whose horizon-k window crossed a data break (not counted in outcomes). */
export type PeriodStats = { period: string; events: number; outcomes: Tally[]; skipped: number[]; baseline: { up: number; down: number; total: number }[] };

const blankTally = (): Tally => ({ up: 0, down: 0, flat: 0, best: null, worst: null });

/**
 * Accumulates events and baseline bars into per-period counts. `periodOf` maps a date to its group ('YYYY' or
 * 'YYYY-MM'); `keep` filters dates (year range, excluded event periods).
 */
export class StudyTally {
  private periods = new Map<string, PeriodStats>();
  constructor(private horizons: number[], private periodOf: (date: string) => string, private keep: (date: string) => boolean) {}
  private at(date: string) {
    const p = this.periodOf(date);
    return this.periods.get(p) ?? this.periods.set(p, { period: p, events: 0, outcomes: this.horizons.map(blankTally), skipped: this.horizons.map(() => 0), baseline: this.horizons.map(() => ({ up: 0, down: 0, total: 0 })) }).get(p)!;
  }
  addEvent(e: StudyEvent) {
    if (!this.keep(e.date)) return;
    const p = this.at(e.date);
    p.events++;
    e.out.forEach((o, k) => {
      if (e.broken[k]) p.skipped[k]++;
      if (!o) return;
      const t = p.outcomes[k];
      if (o.pct > 0) t.up++; else if (o.pct < 0) t.down++; else t.flat++;
      if (!t.best || o.pct > t.best.pct) t.best = { pct: o.pct, date: e.date, symbol: e.symbol };
      if (!t.worst || o.pct < t.worst.pct) t.worst = { pct: o.pct, date: e.date, symbol: e.symbol };
    });
  }
  /** Every bar of a series, as the "any day" baseline (windows crossing a data break are left out). */
  addBaseline(c: Candle[], breaks?: Set<number>) {
    for (let i = 0; i < c.length; i++) {
      const date = dateOf(c[i].time);
      if (!this.keep(date)) continue;
      const p = this.at(date);
      this.horizons.forEach((h, k) => {
        if (i + h >= c.length || crosses(breaks, i, h)) return;
        const d = c[i + h].close - c[i].close;
        const b = p.baseline[k];
        b.total++;
        if (d > 0) b.up++; else if (d < 0) b.down++;
      });
    }
  }
  rows(): PeriodStats[] {
    return [...this.periods.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
  }
}
