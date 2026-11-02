import { describe, expect, it } from 'vitest';
import { amountAt, assumedGrowth, xirr } from './sip';

describe('SIP', () => {
  it('raises the instalment once every 12 months', () => {
    expect(amountAt(1000, 10, 0)).toBe(1000);
    expect(amountAt(1000, 10, 11)).toBe(1000);
    expect(amountAt(1000, 10, 12)).toBeCloseTo(1100, 9);
    expect(amountAt(1000, 10, 24)).toBeCloseTo(1210, 9);
  });
  it('grows instalments at the monthly rate equal to the yearly return', () => {
    // 12 instalments of 1000 at the start of each month; at 12.68% a year (1% a month) the value is
    // 1000 × 1.01 × (1.01^12 − 1) / 0.01 = 12,809.33 (annuity due).
    const [y1] = assumedGrowth(1000, 1, (1.01 ** 12 - 1) * 100, 0);
    expect(y1.invested).toBe(12000);
    expect(y1.value).toBeCloseTo((1000 * 1.01 * (1.01 ** 12 - 1)) / 0.01, 6);
  });
  it('finds the XIRR of dated cash flows', () => {
    // 1000 in, 1100 back exactly 365 days later: 10% a year.
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }])).toBeCloseTo(0.1, 6);
    expect(xirr([{ date: '2025-01-01', amount: -1000 }])).toBeNull();
  });
});
