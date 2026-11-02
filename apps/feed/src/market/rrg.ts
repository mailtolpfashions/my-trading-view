// Relative rotation of sector indices against a benchmark, from NSE's official index closes.
//
// The original RS-Ratio / RS-Momentum formulas (J. de Kempenaer) are proprietary. This is an open method, stated in
// full on the page:
//   RS        = 100 × sector close ÷ benchmark close                 (same trading day)
//   RS-Ratio  = 100 × EMA(RS, 10) ÷ its own simple average over L    (L = 26 weeks or 50 days)
//   RS-Mom.   = 100 × RS-Ratio ÷ RS-Ratio M points earlier          (M = 4 weeks or 5 days)
// Above 100 on both axes = leading, ratio above / momentum below = weakening, both below = lagging, ratio below /
// momentum above = improving.

export type Close = { date: string; close: number };
export type RrgPoint = { date: string; rsRatio: number; rsMomentum: number };
export type RrgParams = { ema: number; average: number; lag: number };
export const RRG_PARAMS: Record<'D' | 'W', RrgParams> = { W: { ema: 10, average: 26, lag: 4 }, D: { ema: 10, average: 50, lag: 5 } };
export type Quadrant = 'leading' | 'weakening' | 'lagging' | 'improving';

/** Last close of each ISO week (Monday-based), dated by that close's trading day. */
export function weekly(closes: Close[]): Close[] {
  const out: Close[] = [];
  let key = '';
  for (const c of closes) {
    const d = new Date(`${c.date}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000).toISOString().slice(0, 10);
    if (monday === key) out[out.length - 1] = c;
    else { out.push(c); key = monday; }
  }
  return out;
}

/** Exponential moving average seeded with the first value. */
export function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i ? out[i - 1] + k * (v - out[i - 1]) : v));
  return out;
}

/**
 * RS-Ratio and RS-Momentum of `sector` against `bench` on the dates both have, oldest first. The first
 * `ema` points only warm up the average and are not returned.
 */
export function rrg(sector: Close[], bench: Close[], p: RrgParams = RRG_PARAMS.W): RrgPoint[] {
  const b = new Map(bench.map((c) => [c.date, c.close]));
  const joined = sector.filter((c) => b.get(c.date)).map((c) => ({ date: c.date, rs: (100 * c.close) / b.get(c.date)! }));
  const smooth = ema(joined.map((j) => j.rs), p.ema);
  const ratio: (number | null)[] = smooth.map((v, i) => {
    if (i < p.ema + p.average - 2) return null; // EMA warm-up, then a full window of it
    const w = smooth.slice(i - p.average + 1, i + 1);
    return (100 * v) / (w.reduce((a, c) => a + c, 0) / p.average);
  });
  const out: RrgPoint[] = [];
  for (let i = p.lag; i < joined.length; i++) {
    const r = ratio[i], r0 = ratio[i - p.lag];
    if (r == null || r0 == null) continue;
    out.push({ date: joined[i].date, rsRatio: r, rsMomentum: (100 * r) / r0 });
  }
  return out;
}

export const quadrant = (p: { rsRatio: number; rsMomentum: number }): Quadrant =>
  p.rsRatio >= 100 ? (p.rsMomentum >= 100 ? 'leading' : 'weakening') : p.rsMomentum >= 100 ? 'improving' : 'lagging';
