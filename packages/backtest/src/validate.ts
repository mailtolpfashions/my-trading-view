// Validation tools for the research programme: the fixed periods, walk-forward selection, parameter plateaus,
// block-bootstrap Monte Carlo and placebo percentiles. Pure functions; the experiment scripts supply the numbers.

/** Chronological periods, fixed on 2026-11-11 before any experiment ran. The holdout is not read until the final phase. */
export const PERIODS = {
  train: { from: '2011-01-01', to: '2018-12-31' },
  validation: { from: '2019-01-01', to: '2023-12-31' },
  holdout: { from: '2024-01-01', to: '2026-12-31' },
} as const;
export const DEV_END = PERIODS.validation.to;

/** Throws when a script tries to read past the development window without HOLDOUT_UNLOCK=1 in the environment. */
export function guardHoldout(to: string, env: Record<string, string | undefined> = process.env): string {
  if (to > DEV_END && env.HOLDOUT_UNLOCK !== '1') throw new Error(`The holdout (${PERIODS.holdout.from} on) is locked until the final phase; asked for data to ${to}`);
  return to;
}

export const periodOf = (date: string): 'train' | 'validation' | 'holdout' | null =>
  date <= PERIODS.train.to ? (date >= PERIODS.train.from ? 'train' : null) : date <= PERIODS.validation.to ? 'validation' : 'holdout';

// ---------------------------------------------------------------- walk-forward

export type Candidate<T> = { id: string; params: T; byYear: Map<string, { net: number; worst: number; trades: number }> };
export type Pick<T> = { year: string; chosen: string; params: T; fitScore: number; net: number; trades: number; worst: number };

/**
 * For each test year, choose the candidate with the best `score` over the `fitYears` years before it, and record what that
 * candidate then did in the test year. `score` sees the fit years' rows only. Returns the picks and how often the choice changed.
 */
export function walkForward<T>(cands: Candidate<T>[], years: string[], fitYears: number, score: (rows: { net: number; worst: number; trades: number }[]) => number): { picks: Pick<T>[]; changes: number; total: number; worst: number } {
  const picks: Pick<T>[] = [];
  let changes = 0, prev: string | null = null;
  for (let i = fitYears; i < years.length; i++) {
    const fit = years.slice(i - fitYears, i), y = years[i];
    let best: Candidate<T> | null = null, bestScore = -Infinity;
    for (const c of cands) {
      const rows = fit.map((f) => c.byYear.get(f)).filter((r): r is NonNullable<typeof r> => !!r);
      if (rows.length < fit.length) continue; // a candidate must have traded in every fit year
      const s = score(rows);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best) continue;
    const r = best.byYear.get(y) ?? { net: 0, worst: 0, trades: 0 };
    picks.push({ year: y, chosen: best.id, params: best.params, fitScore: Math.round(bestScore), net: r.net, trades: r.trades, worst: r.worst });
    if (prev != null && prev !== best.id) changes++;
    prev = best.id;
  }
  return { picks, changes, total: Math.round(picks.reduce((a, p) => a + p.net, 0)), worst: Math.min(0, ...picks.map((p) => p.worst)) };
}

// ---------------------------------------------------------------- plateaus

/**
 * How a result holds when each numeric parameter moves one step either way. `grid` maps each key to its ordered values.
 * Returns the neighbours found and the share of the chosen result each one kept (1 = same, 0.5 = half).
 */
export function plateau<T extends Record<string, number | string>>(chosen: T, all: { params: T; value: number }[], grid: Partial<Record<keyof T, (number | string)[]>>): { neighbours: { key: keyof T; value: number | string; result: number; kept: number }[]; minKept: number | null; meanKept: number | null } {
  const base = all.find((x) => Object.keys(chosen).every((k) => x.params[k] === chosen[k]))?.value;
  const out: { key: keyof T; value: number | string; result: number; kept: number }[] = [];
  if (base == null) return { neighbours: out, minKept: null, meanKept: null };
  for (const key of Object.keys(grid) as (keyof T)[]) {
    const vals = grid[key]!, i = vals.indexOf(chosen[key]);
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= vals.length) continue;
      const hit = all.find((x) => Object.keys(chosen).every((k) => (k === key ? x.params[k] === vals[j] : x.params[k] === chosen[k])));
      if (hit) out.push({ key, value: vals[j], result: hit.value, kept: base !== 0 ? Math.round((hit.value / base) * 100) / 100 : 0 });
    }
  }
  const kept = out.map((o) => o.kept);
  return { neighbours: out, minKept: kept.length ? Math.min(...kept) : null, meanKept: kept.length ? Math.round((kept.reduce((a, b) => a + b, 0) / kept.length) * 100) / 100 : null };
}

// ---------------------------------------------------------------- Monte Carlo

/** Small seeded generator (mulberry32) so every Monte Carlo run is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type Bootstrap = {
  draws: number; blockLen: number; length: number;
  total: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  maxDd: { p50: number; p75: number; p95: number; p99: number; max: number };
  /** Share of draws whose worst drawdown reached each threshold (₹). */
  ddAtLeast: { threshold: number; share: number }[];
  /** Share of draws that ended at a loss. */
  lossShare: number;
};

/**
 * Stationary block bootstrap of a P&L series (per trade or per day): resamples blocks of about `blockLen` with
 * replacement to the same length, `draws` times, and reports the spread of totals and of the worst drawdown.
 */
export function blockBootstrap(pnl: number[], opts: { draws?: number; blockLen?: number; seed?: number; ddThresholds?: number[] } = {}): Bootstrap {
  const draws = opts.draws ?? 2000, blockLen = Math.max(1, opts.blockLen ?? 5), n = pnl.length, rand = rng(opts.seed ?? 7);
  const th = opts.ddThresholds ?? [];
  const totals: number[] = [], dds: number[] = [];
  const hits = th.map(() => 0);
  for (let d = 0; d < draws; d++) {
    let sum = 0, peak = 0, dd = 0, i = 0;
    while (i < n) {
      let start = Math.floor(rand() * n);
      const len = 1 + Math.floor(-Math.log(1 - rand()) * blockLen); // geometric block length, mean ≈ blockLen
      for (let k = 0; k < len && i < n; k++, i++) { sum += pnl[start++ % n]; if (sum > peak) peak = sum; dd = Math.max(dd, peak - sum); }
    }
    totals.push(sum); dds.push(dd);
    th.forEach((t, k) => { if (dd >= t) hits[k]++; });
  }
  totals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => Math.round(arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]);
  return {
    draws, blockLen, length: n,
    total: { p5: q(totals, 0.05), p25: q(totals, 0.25), p50: q(totals, 0.5), p75: q(totals, 0.75), p95: q(totals, 0.95), mean: Math.round(totals.reduce((a, b) => a + b, 0) / draws) },
    maxDd: { p50: q(dds, 0.5), p75: q(dds, 0.75), p95: q(dds, 0.95), p99: q(dds, 0.99), max: Math.round(dds[dds.length - 1]) },
    ddAtLeast: th.map((t, k) => ({ threshold: t, share: Math.round((hits[k] / draws) * 1000) / 1000 })),
    lossShare: Math.round((totals.filter((t) => t < 0).length / draws) * 1000) / 1000,
  };
}

/** Where `actual` sits among placebo results: the share of placebo draws it beats. 0.95 or more passes. */
export function placeboPercentile(actual: number, placebo: number[]): number {
  if (!placebo.length) return NaN;
  return Math.round((placebo.filter((p) => p < actual).length / placebo.length) * 1000) / 1000;
}

/** Simple summary of a grid: how many settings were tried and how many made money, in each period. The multiple-testing record. */
export function familySummary(values: number[]): { tried: number; profitable: number; median: number; p25: number; p75: number; best: number; worst: number } {
  const s = [...values].sort((a, b) => a - b), q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0);
  return { tried: s.length, profitable: s.filter((v) => v > 0).length, median: q(0.5), p25: q(0.25), p75: q(0.75), best: Math.round(s[s.length - 1] ?? 0), worst: Math.round(s[0] ?? 0) };
}
