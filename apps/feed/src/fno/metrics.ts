// Option-chain statistics computed from NSE's official end-of-day F&O file: max pain, put-call ratio, ATM straddle,
// gamma exposure and volatility series. Everything here is a pure function of one day's contracts (or of a stored
// daily series), so each number can be checked by hand against the bhavcopy.
//
// Units: prices and strikes in paise; open interest in shares and volume in contracts, as NSE publishes them.
// IV and gamma are MODEL estimates (Black-76 on the put-call-parity forward) and are labelled as such in the UI.

import { black76 } from '@mtv/options';
import type { ChainRow } from './chain';

/**
 * Strike interval near the money: the most common gap between neighbouring listed strikes among the 12 strikes
 * closest to `refPaise` (ties go to the smaller gap). NSE lists wider gaps far from the money (NIFTY: 50 near, 100
 * further out), so only the strikes nearest the price are used. Null with fewer than 3 strikes.
 */
export function strikeStep(strikesPaise: number[], refPaise: number): number | null {
  const near = [...new Set(strikesPaise)].sort((a, b) => Math.abs(a - refPaise) - Math.abs(b - refPaise)).slice(0, 12).sort((a, b) => a - b);
  if (near.length < 3) return null;
  const count = new Map<number, number>();
  for (let i = 1; i < near.length; i++) {
    const g = near[i] - near[i - 1];
    count.set(g, (count.get(g) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** The listed strike nearest `refPaise` (the lower one on an exact tie). */
export function nearestStrike(strikesPaise: number[], refPaise: number): number | null {
  let best: number | null = null;
  for (const k of strikesPaise) if (best == null || Math.abs(k - refPaise) < Math.abs(best - refPaise) || (Math.abs(k - refPaise) === Math.abs(best - refPaise) && k < best)) best = k;
  return best;
}

export type PainPoint = { strikePaise: number; /** Total payout to option holders if the expiry close were this strike, in rupees. */ pain: number };

/**
 * Max pain: the listed strike at which option holders would collect the least at expiry, i.e. minimising
 * Σ CE OI·max(0, K − k) + Σ PE OI·max(0, k − K) over the listed strikes K. Ties go to the lower strike.
 * Returns the curve too. Null when the chain has no open interest.
 */
export function maxPain(rows: ChainRow[]): { strikePaise: number; curve: PainPoint[] } | null {
  const strikes = rows.map((r) => r.strikePaise).sort((a, b) => a - b);
  if (!rows.some((r) => (r.CE?.oi ?? 0) + (r.PE?.oi ?? 0) > 0)) return null;
  const curve = strikes.map((K) => {
    let pain = 0;
    for (const r of rows) {
      if (r.CE?.oi && K > r.strikePaise) pain += (r.CE.oi * (K - r.strikePaise)) / 100;
      if (r.PE?.oi && K < r.strikePaise) pain += (r.PE.oi * (r.strikePaise - K)) / 100;
    }
    return { strikePaise: K, pain };
  });
  const best = curve.reduce((a, b) => (b.pain < a.pain ? b : a));
  return { strikePaise: best.strikePaise, curve };
}

export type ChainTotals = { ceOi: number; peOi: number; ceVolume: number; peVolume: number; oiPcr: number | null; volumePcr: number | null };

/** Total open interest and volume per side, and the put-call ratios (put ÷ call; null when the call side is zero). */
export function chainTotals(rows: ChainRow[]): ChainTotals {
  let ceOi = 0, peOi = 0, ceVolume = 0, peVolume = 0;
  for (const r of rows) {
    ceOi += r.CE?.oi ?? 0; peOi += r.PE?.oi ?? 0;
    ceVolume += r.CE?.volume ?? 0; peVolume += r.PE?.volume ?? 0;
  }
  return { ceOi, peOi, ceVolume, peVolume, oiPcr: ceOi > 0 ? peOi / ceOi : null, volumePcr: ceVolume > 0 ? peVolume / ceVolume : null };
}

/**
 * IV for every leg with open interest: the leg's own IV when it traded, otherwise linear interpolation in strike
 * between the nearest traded strikes on the same side (flat beyond the last one). Untraded legs carry open
 * interest too, so gamma exposure would be understated without them. Returns the IVs and how many were filled in.
 */
export function ivForOpenInterest(rows: ChainRow[]): { iv: Map<string, number>; filled: number } {
  const iv = new Map<string, number>();
  let filled = 0;
  for (const right of ['CE', 'PE'] as const) {
    const known = rows.filter((r) => r[right]?.iv != null).map((r) => [r.strikePaise, r[right]!.iv!] as const).sort((a, b) => a[0] - b[0]);
    if (!known.length) continue;
    for (const r of rows) {
      const side = r[right];
      if (!side?.oi) continue;
      if (side.iv != null) { iv.set(`${right}${r.strikePaise}`, side.iv); continue; }
      const k = r.strikePaise;
      const hi = known.findIndex(([s]) => s >= k);
      let v: number;
      if (hi === 0) v = known[0][1];
      else if (hi < 0) v = known[known.length - 1][1];
      else {
        const [k0, v0] = known[hi - 1], [k1, v1] = known[hi];
        v = v0 + ((v1 - v0) * (k - k0)) / (k1 - k0);
      }
      iv.set(`${right}${k}`, v);
      filled++;
    }
  }
  return { iv, filled };
}

export type GexStrike = { strikePaise: number; ce: number; pe: number; net: number };
export type Gex = {
  /** Net gamma exposure, rupees per 1% move of the underlying: calls counted +, puts − (the usual convention that
   * dealers are long the calls and short the puts the public holds; a convention, not a fact about positions). */
  net: number;
  strikes: GexStrike[];
  /** Strike with the largest call gamma exposure / the largest put gamma exposure. */
  callWallPaise: number | null;
  putWallPaise: number | null;
  /** Underlying level (paise) where net gamma exposure changes sign, nearest the forward; null if none within ±15%. */
  flipPaise: number | null;
  /** Legs with open interest whose IV was interpolated because they did not trade. */
  ivFilled: number;
};

const gexAt = (rows: ChainRow[], iv: Map<string, number>, F: number, T: number, r: number) => {
  const out: GexStrike[] = [];
  for (const row of rows) {
    const K = row.strikePaise / 100;
    const leg = (right: 'CE' | 'PE') => {
      const oi = row[right]?.oi ?? 0, sigma = iv.get(`${right}${row.strikePaise}`);
      if (!oi || sigma == null) return 0;
      return black76(right, F, K, T, r, sigma).gamma * oi * F * F * 0.01;
    };
    const ce = leg('CE'), pe = -leg('PE');
    out.push({ strikePaise: row.strikePaise, ce, pe, net: ce + pe });
  }
  return out;
};

/** Gamma exposure per strike and in total at the forward `forwardPaise`, with walls and the gamma flip level. */
export function gammaExposure(rows: ChainRow[], forwardPaise: number, T: number, r: number): Gex | null {
  if (!(T > 0) || !(forwardPaise > 0)) return null;
  const { iv, filled } = ivForOpenInterest(rows);
  if (!iv.size) return null;
  const F = forwardPaise / 100;
  const strikes = gexAt(rows, iv, F, T, r);
  const net = strikes.reduce((s, x) => s + x.net, 0);
  const top = (pick: (x: GexStrike) => number) => {
    const best = strikes.reduce<GexStrike | null>((a, b) => (pick(b) > (a ? pick(a) : 0) ? b : a), null);
    return best ? best.strikePaise : null;
  };
  // Flip: scan the underlying from −15% to +15% in 0.25% steps and take the sign change nearest the forward.
  let flipPaise: number | null = null;
  let prev: { f: number; g: number } | null = null;
  for (let pct = -15; pct <= 15.0001; pct += 0.25) {
    const f = F * (1 + pct / 100);
    const g = gexAt(rows, iv, f, T, r).reduce((s, x) => s + x.net, 0);
    if (prev && Math.sign(g) !== Math.sign(prev.g) && g !== 0) {
      const cross = prev.f + ((f - prev.f) * prev.g) / (prev.g - g);
      if (flipPaise == null || Math.abs(cross * 100 - forwardPaise) < Math.abs(flipPaise - forwardPaise)) flipPaise = Math.round(cross * 100);
    }
    prev = { f, g };
  }
  return { net, strikes, callWallPaise: top((x) => x.ce), putWallPaise: top((x) => -x.pe), flipPaise, ivFilled: filled };
}

/** ATM implied volatility: the mean of the call and put IV at the ATM strike (either one if only one traded). */
export function atmIv(rows: ChainRow[], atmStrikePaise: number | null): number | null {
  const row = rows.find((r) => r.strikePaise === atmStrikePaise);
  const ivs = [row?.CE?.iv, row?.PE?.iv].filter((v): v is number => v != null);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

/**
 * Constant-maturity IV (default 30 calendar days) from the ATM IV of each expiry, interpolating total variance
 * σ²·T linearly in T between the expiries either side of the target. Expiries under 3 days are skipped: their IV
 * is dominated by the last days' noise. With no expiry beyond the target, the longest one is used, and with none
 * before it, the shortest one: `exact` is then false.
 */
export function constantMaturityIv(points: { days: number; iv: number | null }[], target = 30): { iv: number; exact: boolean } | null {
  const pts = points.filter((p): p is { days: number; iv: number } => p.iv != null && p.days >= 3).sort((a, b) => a.days - b.days);
  if (!pts.length) return null;
  const at = pts.find((p) => p.days === target);
  if (at) return { iv: at.iv, exact: true };
  const after = pts.findIndex((p) => p.days > target);
  if (after <= 0) return { iv: (after === 0 ? pts[0] : pts[pts.length - 1]).iv, exact: false };
  const a = pts[after - 1], b = pts[after];
  const va = a.iv * a.iv * a.days, vb = b.iv * b.iv * b.days;
  const v = va + ((vb - va) * (target - a.days)) / (b.days - a.days);
  return { iv: Math.sqrt(v / target), exact: true };
}

/** Annualised close-to-close historical volatility over the last `n` returns (√252 scaling); null if too short. */
export function historicalVol(closes: number[], n = 20): number | null {
  if (closes.length < n + 1) return null;
  const last = closes.slice(-(n + 1));
  const rets = last.slice(1).map((c, i) => Math.log(c / last[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance * 252);
}

/**
 * IV rank: where today's IV sits between the lowest and highest of the lookback, 0–100.
 * IV percentile: the share of lookback days with IV below today's, 0–100.
 * Both need at least 20 earlier values; `history` excludes today.
 */
export function ivRankPercentile(today: number, history: number[]): { rank: number | null; percentile: number | null } {
  if (history.length < 20) return { rank: null, percentile: null };
  const lo = Math.min(...history), hi = Math.max(...history);
  return {
    rank: hi > lo ? Math.max(0, Math.min(100, ((today - lo) / (hi - lo)) * 100)) : null,
    percentile: (history.filter((v) => v < today).length / history.length) * 100,
  };
}
