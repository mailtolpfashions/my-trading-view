import { describe, expect, it } from 'vitest';
import { black76, bsPrice, impliedVol, normCdf, payoff, summarise, yearsToExpiry, type Leg } from './index';

describe('pricing models', () => {
  it('matches the textbook Black-Scholes reference (Hull: S=K=100, T=1, r=5%, σ=20%)', () => {
    expect(bsPrice('CE', 100, 100, 1, 0.05, 0.2)).toBeCloseTo(10.4506, 3);
    expect(bsPrice('PE', 100, 100, 1, 0.05, 0.2)).toBeCloseTo(5.5735, 3);
  });
  it('normal CDF reference points', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
  });
  it('Black-76 satisfies put-call parity: C − P = e^(−rT)(F − K)', () => {
    const [F, K, T, r, s] = [22650, 22600, 7 / 365, 0.065, 0.13];
    const c = black76('CE', F, K, T, r, s).price, p = black76('PE', F, K, T, r, s).price;
    expect(c - p).toBeCloseTo(Math.exp(-r * T) * (F - K), 8);
  });
  it('implied volatility recovers the volatility that produced a premium', () => {
    const prem = black76('PE', 22650, 22400, 10 / 365, 0.065, 0.1437).price;
    expect(impliedVol('PE', prem, 22650, 22400, 10 / 365, 0.065)).toBeCloseTo(0.1437, 5);
  });
  it('returns no IV (rather than a fake number) for a premium below intrinsic value', () => {
    expect(impliedVol('CE', 10, 22650, 22400, 10 / 365, 0.065)).toBeNull();
  });
  it('time to expiry runs to 15:30 IST on the expiry date', () => {
    const now = Date.UTC(2026, 9, 26, 15, 30) / 1000 - 5.5 * 3600; // Mon 15:30 IST
    expect(yearsToExpiry(now, '2026-10-27')).toBeCloseTo(1 / 365, 10);
  });
});

const leg = (kind: Leg['kind'], side: Leg['side'], strike: number, price: number, qty = 65): Leg => ({ kind, side, strikePaise: strike * 100, pricePaise: Math.round(price * 100), qty });

describe('expiry payoff (exact)', () => {
  it('long call: limited loss, unlimited profit, breakeven = strike + premium', () => {
    const s = summarise([leg('CE', 'BUY', 22600, 120.5)]);
    expect(s).toEqual({ maxProfitPaise: null, maxLossPaise: -65 * 12050, breakevens: [2272050], netPremiumPaise: -65 * 12050 });
  });
  it('short straddle: limited profit = premium received, unlimited loss, two breakevens', () => {
    const s = summarise([leg('CE', 'SELL', 22600, 121.35), leg('PE', 'SELL', 22600, 98.65)]);
    expect(s.maxProfitPaise).toBe(65 * 22000);
    expect(s.maxLossPaise).toBeNull();
    expect(s.breakevens).toEqual([2238000, 2282000]); // 22600 ∓ 220.00
    expect(s.netPremiumPaise).toBe(65 * 22000);
  });
  it('iron condor: both max profit and max loss are limited', () => {
    // sell 22400 PE @60, buy 22200 PE @25, sell 22800 CE @55, buy 23000 CE @20 -> credit 70; wings 200 wide
    const ic = [leg('PE', 'SELL', 22400, 60), leg('PE', 'BUY', 22200, 25), leg('CE', 'SELL', 22800, 55), leg('CE', 'BUY', 23000, 20)];
    const s = summarise(ic);
    expect(s.maxProfitPaise).toBe(65 * 7000);
    expect(s.maxLossPaise).toBe(-65 * 13000); // 200 − 70
    expect(s.breakevens).toEqual([2233000, 2287000]);
    expect(payoff(ic, 2260000)).toBe(65 * 7000);
  });
  it('bull call spread payoff at a price between strikes', () => {
    const sp = [leg('CE', 'BUY', 22600, 120), leg('CE', 'SELL', 22800, 50)];
    expect(payoff(sp, 2270000)).toBe(65 * (10000 - 7000)); // long call worth 100, net debit 70
  });
  it('futures leg is linear', () => {
    expect(payoff([leg('FUT', 'SELL', 0, 22661.3, 65)], 2256130)).toBe(65 * 10000);
  });
});
