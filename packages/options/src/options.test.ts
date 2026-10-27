import { describe, expect, it } from 'vitest';
import { black76, bsPrice, impliedVol, normCdf, payoff, pnlAt, summarise, summariseCurve, summariseNet, yearsToExpiry, type Leg, type ModelLeg } from './index';

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

describe('expiry payoff after charges', () => {
  const qty = 65;
  const L = (kind: 'CE' | 'PE', side: 'BUY' | 'SELL', strike: number, price: number): Leg => ({ kind, side, strikePaise: strike * 100, pricePaise: Math.round(price * 100), qty });
  const noSettle = () => 0;
  it('with no settlement charges, net = gross − entry charges: breakeven moves by charges ÷ qty', () => {
    // Long 22600 CE @ ₹120: gross breakeven 22720. ₹65 of charges on 65 units moves it ₹1 higher.
    const s = summariseNet([L('CE', 'BUY', 22600, 120)], 65_00, noSettle);
    expect(s.breakevens).toEqual([22721_00]);
    expect(s.maxLossPaise).toBe(-(120_00 * qty + 65_00));
    expect(s.maxProfitPaise).toBeNull();
  });
  it('exercise STT on a long ITM call lowers the upside slope and moves the breakeven', () => {
    // net(S) = 65(S − 22600 − 120) − 0.15% × 65(S − 22600) for S > 22600 (paise). Zero at S − 22600 = 120 / 0.9985.
    const stt = (l: Leg, S: number) => (l.side === 'BUY' && l.kind === 'CE' && S > l.strikePaise ? 0.0015 * l.qty * (S - l.strikePaise) : 0);
    const s = summariseNet([L('CE', 'BUY', 22600, 120)], 0, stt);
    expect(s.breakevens[0]).toBeCloseTo(22600_00 + 120_00 / 0.9985, 6);
  });
  it('iron condor: exercise STT beyond the outer strikes is reported, not turned into "unlimited" loss', () => {
    const stt = (l: Leg, S: number) => (l.side === 'BUY' ? 0.0015 * l.qty * Math.max(0, l.kind === 'CE' ? S - l.strikePaise : l.strikePaise - S) : 0);
    const ic = [L('PE', 'SELL', 22550, 40), L('PE', 'BUY', 22350, 20), L('CE', 'SELL', 22950, 35), L('CE', 'BUY', 23150, 15)];
    const s = summariseNet(ic, 100_00, stt);
    // At 23150 the call spread loses its full 200-point width: (35 − 15 + 40 − 20 − 200) × 65 = −₹10,400, minus ₹100 entry charges.
    expect(s.maxLossPaise).toBeCloseTo(-10_500_00, 0); // plus 0.1 paisa of STT one paisa past the strike
    expect(s.chargesGrow?.above).toEqual({ strikePaise: 23150_00, chargeSlope: expect.closeTo(0.0015 * qty, 9) });
    expect(s.chargesGrow?.below).toEqual({ strikePaise: 22350_00, chargeSlope: expect.closeTo(0.0015 * qty, 9) });
    expect(s.breakevens).toHaveLength(2);
    expect(s.maxProfitPaise).toBe(40 * 65 * 100 - 100_00);
  });
  it('a flat exercise brokerage that starts just past the strike is a step: max loss includes it', () => {
    const brk = (l: Leg, S: number) => (S > l.strikePaise && l.kind === 'CE' ? 23_60 : 0);
    const s = summariseNet([L('CE', 'SELL', 22600, 120)], 0, brk);
    expect(s.maxProfitPaise).toBe(120_00 * qty); // at or below the strike: no settlement charge
    expect(s.maxLossPaise).toBeNull(); // short call: unlimited
    expect(s.breakevens[0]).toBeCloseTo(22600_00 + (120_00 * qty - 23_60) / qty, 6);
  });
});

describe('multi-expiry model (calendars)', () => {
  const ml = (kind: 'CE' | 'PE', side: 'BUY' | 'SELL', strike: number, price: number, years: number, iv: number): ModelLeg =>
    ({ kind, side, strikePaise: strike * 100, pricePaise: price * 100, qty: 65, years, iv });
  it('when every leg has expired, the model P&L is the exact expiry payoff', () => {
    const legs = [ml('CE', 'SELL', 22600, 121.35, 0.02, 0.15), ml('PE', 'SELL', 22600, 98.65, 0.02, 0.15)];
    for (const S of [21000_00, 22600_00, 22800_50, 24000_00]) expect(pnlAt(legs, S, 0.02, 0.065, 0.065)).toBe(payoff(legs, S));
  });
  it('a calendar at the near expiry: near leg at intrinsic, far leg at its Black-76 value', () => {
    const near = ml('CE', 'SELL', 22750, 103.55, 7 / 365, 0.16), far = ml('CE', 'BUY', 22750, 261.1, 14 / 365, 0.16);
    const S = 22750_00, t = 7 / 365;
    const farValue = black76('CE', (S * Math.exp(0.065 * 7 / 365)) / 100, 22750, 7 / 365, 0.065, 0.16).price * 100;
    expect(pnlAt([near, far], S, t, 0.065, 0.065)).toBeCloseTo(-65 * (0 - 103_55) + 65 * (farValue - 261_10), 6);
  });
  it('a live leg without IV makes the model P&L unavailable rather than wrong', () => {
    expect(pnlAt([ml('CE', 'BUY', 22750, 100, 0.05, 0)], 22750_00, 0, 0.065, 0.065)).toBeNull();
  });
  it('curve summary finds max, min and interpolated breakevens', () => {
    const s = summariseCurve((S) => 1000 - Math.abs(S - 5000), 0, 10000, 10);
    expect(s.maxProfitPaise).toBe(1000);
    expect(s.maxLossPaise).toBe(-4000);
    expect(s.breakevens.map((b) => Math.round(b))).toEqual([4000, 6000]);
  });
});
