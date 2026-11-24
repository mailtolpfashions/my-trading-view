import { describe, expect, it } from 'vitest';
import { DEFAULT_EXP_RULE, noStopNet } from './expiry-straddle';

describe('expiry-day straddle', () => {
  it('uses the user window and the study stop by default, and starts off', () => {
    expect([DEFAULT_EXP_RULE.entry, DEFAULT_EXP_RULE.exit, DEFAULT_EXP_RULE.stopPct, DEFAULT_EXP_RULE.enabled]).toEqual(['09:30', '15:00', 50, false]);
  });
  it('prices the no-stop version only when both legs are bought back', () => {
    const n = { legs: [{ symbol: 'A', label: 'A', qty: 65, sellPaise: 10000, buyPaise: 4000 }, { symbol: 'B', label: 'B', qty: 65, sellPaise: 9000, buyPaise: null as number | null }], chargesPaise: 5000, netPaise: null };
    expect(noStopNet(n)).toBeNull();
    n.legs[1].buyPaise = 12000;
    // (100 − 40) × 65 + (90 − 120) × 65 = ₹1,950, less ₹50 charges
    expect(noStopNet(n)).toBe(195000 - 5000);
  });
});
