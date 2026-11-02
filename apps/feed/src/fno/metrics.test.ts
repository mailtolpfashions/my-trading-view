import { describe, expect, it } from 'vitest';
import { black76 } from '@mtv/options';
import type { ChainRow, ChainSide } from './chain';
import { atmIv, chainTotals, constantMaturityIv, gammaExposure, historicalVol, ivForOpenInterest, ivRankPercentile, maxPain, nearestStrike, strikeStep } from './metrics';

const side = (oi: number, extra: Partial<ChainSide> = {}): ChainSide => ({ closePaise: 0, settlePaise: 0, oi, volume: 0, traded: false, iv: null, delta: null, theta: null, vega: null, gamma: null, ...extra });
const row = (k: number, ce: ChainSide | null, pe: ChainSide | null): ChainRow => ({ strikePaise: k * 100, CE: ce, PE: pe });

describe('strike step and ATM', () => {
  it('uses the most common gap near the price, not the wider gaps further out', () => {
    // NIFTY-style listing: 50 apart near the money, 100 apart beyond.
    const strikes = [22000, 22100, 22200, 22300, 22400, 22450, 22500, 22550, 22600, 22650, 22700, 22750, 22800, 22900, 23000].map((k) => k * 100);
    expect(strikeStep(strikes, 22600_00)).toBe(50_00);
    expect(strikeStep([1, 2], 1)).toBeNull();
  });
  it('picks the listed strike nearest the price, the lower one on a tie', () => {
    expect(nearestStrike([100_00, 105_00, 110_00], 107_60)).toBe(110_00);
    expect(nearestStrike([100_00, 105_00, 110_00], 107_50)).toBe(105_00);
  });
});

describe('max pain', () => {
  // Hand-checked: holders' payout at each expiry close K (rupees, OI in shares).
  // K=100: puts 110 (200×10) = 2000            -> 2000
  // K=110: calls 100 (100×10) = 1000           -> 1000
  // K=120: calls 100 (100×20) + 110 (300×10) = 5000 -> 5000
  const rows = [row(100, side(100), side(0)), row(110, side(300), side(200)), row(120, side(0), side(0))];
  it('finds the strike with the smallest payout to option holders', () => {
    const r = maxPain(rows)!;
    expect(r.strikePaise).toBe(110_00);
    expect(r.curve.map((p) => p.pain)).toEqual([2000, 1000, 5000]);
  });
  it('returns null with no open interest', () => {
    expect(maxPain([row(100, side(0), side(0))])).toBeNull();
  });
});

describe('totals and put-call ratio', () => {
  it('sums each side and divides puts by calls', () => {
    const t = chainTotals([row(100, side(400, { volume: 10 }), side(200, { volume: 30 })), row(110, side(100, { volume: 10 }), null)]);
    expect(t).toEqual({ ceOi: 500, peOi: 200, ceVolume: 20, peVolume: 30, oiPcr: 0.4, volumePcr: 1.5 });
    expect(chainTotals([row(100, null, side(5))]).oiPcr).toBeNull();
  });
});

describe('IV for open interest', () => {
  it('keeps traded IVs, interpolates untraded legs in strike and holds flat beyond the ends', () => {
    const rows = [row(90, side(10), null), row(100, side(10, { iv: 0.2 }), null), row(105, side(10), null), row(110, side(10, { iv: 0.3 }), null), row(120, side(10), null), row(130, side(0), null)];
    const { iv, filled } = ivForOpenInterest(rows);
    expect(iv.get('CE9000')).toBe(0.2);
    expect(iv.get('CE10500')).toBeCloseTo(0.25, 12);
    expect(iv.get('CE12000')).toBe(0.3);
    expect(iv.has('CE13000')).toBe(false); // no open interest: not needed
    expect(filled).toBe(3);
  });
  it('averages the call and put IV at the ATM strike', () => {
    expect(atmIv([row(100, side(1, { iv: 0.2 }), side(1, { iv: 0.24 }))], 100_00)).toBeCloseTo(0.22, 12);
    expect(atmIv([row(100, side(1, { iv: 0.2 }), side(1))], 100_00)).toBe(0.2);
    expect(atmIv([], 100_00)).toBeNull();
  });
});

describe('gamma exposure', () => {
  const T = 7 / 365, r = 0.065;
  it('counts calls positive and puts negative, in rupees per 1% move', () => {
    const rows = [row(100, side(1000, { iv: 0.2 }), side(500, { iv: 0.2 }))];
    const g = gammaExposure(rows, 100_00, T, r)!;
    const gamma = black76('CE', 100, 100, T, r, 0.2).gamma;
    expect(g.net).toBeCloseTo(gamma * 500 * 100 * 100 * 0.01, 9);
    expect(g.strikes[0].ce).toBeCloseTo(gamma * 1000 * 100, 9);
  });
  it('finds the walls and the flip level between a put-heavy strike below and a call-heavy strike above', () => {
    const rows = [row(95, side(0), side(5000, { iv: 0.2 })), row(105, side(5000, { iv: 0.2 }), side(0))];
    const g = gammaExposure(rows, 100_00, T, r)!;
    expect(g.callWallPaise).toBe(105_00);
    expect(g.putWallPaise).toBe(95_00);
    // Symmetric books: gamma exposure crosses zero at the midpoint, to within the 0.25% scan step.
    expect(Math.abs(g.flipPaise! - 100_00)).toBeLessThan(30);
  });
  it('is null on expiry day (no time left) or with no IV at all', () => {
    expect(gammaExposure([row(100, side(1, { iv: 0.2 }), null)], 100_00, 0, r)).toBeNull();
    expect(gammaExposure([row(100, side(1), null)], 100_00, T, r)).toBeNull();
  });
});

describe('volatility series', () => {
  it('interpolates 30-day IV in total variance between the expiries either side', () => {
    const v = constantMaturityIv([{ days: 20, iv: 0.2 }, { days: 40, iv: 0.3 }])!;
    // σ² at 30d = (0.04·20 + (0.09·40 − 0.04·20)·½) / 30 = (0.8 + 1.4) / 30
    expect(v.iv).toBeCloseTo(Math.sqrt(2.2 / 30), 12);
    expect(v.exact).toBe(true);
  });
  it('skips expiries under 3 days and flags extrapolation', () => {
    expect(constantMaturityIv([{ days: 1, iv: 0.9 }, { days: 10, iv: 0.2 }])).toEqual({ iv: 0.2, exact: false });
    expect(constantMaturityIv([{ days: 45, iv: 0.25 }])).toEqual({ iv: 0.25, exact: false });
    expect(constantMaturityIv([{ days: 2, iv: 0.2 }])).toBeNull();
  });
  it('computes close-to-close historical volatility', () => {
    // Alternating +1% / −1% moves.
    const closes = [100];
    for (let i = 0; i < 20; i++) closes.push(closes[i] * (i % 2 ? 0.99 : 1.01));
    expect(historicalVol(closes)).toBeCloseTo(0.16287, 4); // std 0.01026 (n − 1 = 19) × √252
    expect(historicalVol(closes.slice(0, 5))).toBeNull();
  });
  it('ranks today against the lookback', () => {
    const hist = Array.from({ length: 20 }, (_, i) => 0.1 + i * 0.01); // 0.10 … 0.29
    expect(ivRankPercentile(0.2, hist).rank).toBeCloseTo((0.1 / 0.19) * 100, 9);
    expect(ivRankPercentile(0.2, hist).percentile).toBe(50);
    expect(ivRankPercentile(0.2, hist.slice(0, 19))).toEqual({ rank: null, percentile: null });
  });
});
