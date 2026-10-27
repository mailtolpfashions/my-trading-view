import { describe, expect, it } from 'vitest';
import { exposureMargin, positionMargin, spanMargin, type MarginLeg, type SpanUnderlying } from './margin';
import fixture from './fixtures/span-nifty-20261027-i01.json';

// Extract of NSE Clearing's start-of-day SPAN file for 27 Oct 2026 (nsccl.20261027.i01.spn). Expected figures are
// Zerodha Kite's basket margins for the same baskets on 27 Oct 2026 (apps/feed/scripts/check-margin.ts).
const d = fixture as unknown as SpanUnderlying;
const lot = 65, today = '2026-10-27';
const L = (kind: MarginLeg['kind'], side: 1 | -1, expiry: string, strike = 0): MarginLeg => ({ kind, expiry, strike, qty: side * lot });
const rupees = (p: number) => p / 100;

describe('SPAN margin vs Kite (27 Oct 2026, start-of-day file)', () => {
  it('single legs match to the paisa', () => {
    expect(rupees(spanMargin(d, [L('CE', -1, '2026-11-03', 22750)], today).spanPaise)).toBe(141028.55);
    expect(rupees(spanMargin(d, [L('FUT', -1, '2026-10-27')], today).spanPaise)).toBe(137270.9);
    expect(rupees(spanMargin(d, [L('CE', 1, '2026-11-03', 22750)], today).spanPaise)).toBe(0); // long: premium only
  });
  it('hedged baskets are within ₹1 (NSE rounds each risk array value to the paisa)', () => {
    const near = (legs: MarginLeg[], kite: number) => expect(Math.abs(rupees(spanMargin(d, legs, today).spanPaise) - kite)).toBeLessThanOrEqual(1);
    near([L('CE', -1, '2026-11-03', 22750), L('PE', -1, '2026-11-03', 22750)], 141115.25); // short straddle
    near([L('PE', -1, '2026-11-03', 22550), L('PE', 1, '2026-11-03', 22350), L('CE', -1, '2026-11-03', 22950), L('CE', 1, '2026-11-03', 23150)], 13164.25); // iron condor
    near([L('CE', 1, '2026-11-03', 22750), L('CE', -1, '2026-11-03', 22950)], 0); // bull call spread
    near([L('CE', -1, '2026-11-03', 22750), L('CE', 1, '2026-11-09', 22750)], 13140.5); // calendar: includes the spread charge
  });
  it('expiry day: contracts expiring today get no offset from other expiries', () => {
    expect(rupees(spanMargin(d, [L('CE', -1, today, 22750)], today).spanPaise)).toBe(139247.55);
    const cal = [L('CE', -1, today, 22750), L('CE', 1, '2026-11-03', 22750)];
    expect(Math.abs(rupees(spanMargin(d, cal, today).spanPaise) - 137622.25)).toBeLessThanOrEqual(1);
    expect(spanMargin(d, cal, '2026-10-26').spanPaise).toBeLessThan(spanMargin(d, cal, today).spanPaise); // the day before, the hedge counts
  });
  it('exposure: 2% of notional on shorts and futures, 4% on short options expiring today', () => {
    const spot = 22749_75;
    expect(rupees(exposureMargin([L('CE', -1, '2026-11-03', 22750), L('PE', -1, '2026-11-03', 22750)], spot, today))).toBe(59149.35);
    expect(rupees(exposureMargin([L('CE', -1, today, 22750)], spot, today))).toBe(59149.35);
    expect(exposureMargin([L('CE', 1, '2026-11-03', 22750)], spot, today)).toBe(0);
    expect(rupees(exposureMargin([{ ...L('FUT', -1, today), pricePaise: 22748_30 }], spot, today))).toBe(29572.79);
  });
  it('funds = SPAN + exposure + premium paid − premium received; hedge benefit = legs alone − together', () => {
    const legs = [{ ...L('CE', -1, '2026-11-03', 22750), pricePaise: 185_00 }];
    expect(rupees(positionMargin(d, legs, 22749_75, today).fundsPaise)).toBe(158578.23); // Kite: 158578.225
    const ic = positionMargin(d, [L('PE', -1, '2026-11-03', 22550), L('PE', 1, '2026-11-03', 22350), L('CE', -1, '2026-11-03', 22950), L('CE', 1, '2026-11-03', 23150)], 22749_75, today);
    expect(ic.hedgeBenefitPaise).toBe(ic.withoutHedgePaise - ic.marginPaise);
    expect(ic.hedgeBenefitPaise).toBeGreaterThan(200_000_00);
  });
  it('reports legs that are not in the file', () => {
    expect(spanMargin(d, [L('CE', -1, '2026-11-03', 99999)], today).missing).toHaveLength(1);
  });
});
