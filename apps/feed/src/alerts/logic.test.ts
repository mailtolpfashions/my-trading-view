import { describe, expect, it } from 'vitest';
import type { RuleSet } from '@mtv/backtest';
import { priceCrossed, rulesFireOn } from './logic';

describe('price alerts fire on a crossing', () => {
  it('crosses above: below before, at or above now', () => {
    expect(priceCrossed('crossesAbove', 23000_00, 22990_00, 23000_00)).toBe(true);
    expect(priceCrossed('crossesAbove', 23000_00, 22990_00, 23005_00)).toBe(true);
    expect(priceCrossed('crossesAbove', 23000_00, 23001_00, 23005_00)).toBe(false); // already above: no new cross
    expect(priceCrossed('crossesAbove', 23000_00, 22990_00, 22999_95)).toBe(false);
  });
  it('crosses below mirrors it', () => {
    expect(priceCrossed('crossesBelow', 23000_00, 23010_00, 23000_00)).toBe(true);
    expect(priceCrossed('crossesBelow', 23000_00, 22990_00, 22980_00)).toBe(false);
  });
  it('never fires on the first price seen (an alert set beyond the level waits for a real cross)', () => {
    expect(priceCrossed('crossesAbove', 23000_00, undefined, 23500_00)).toBe(false);
  });
});

describe('indicator alerts use closed bars only', () => {
  const ist = (h: number, m: number) => Date.UTC(2026, 9, 27, h, m) / 1000 - 5.5 * 3600;
  // 5-minute bars from 09:15; close crosses above 100 on the 09:25 bar, and the forming 09:30 bar dips back below.
  const closes = [98, 99, 101, 97];
  const bars = closes.map((c, i) => ({ time: ist(9, 15 + i * 5), open: c, high: c, low: c, close: c, volume: 1 }));
  const rules: RuleSet = { match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'number', value: 100 } }] };

  it('fires on the bar that closed with the condition true, ignoring the bar still forming', () => {
    expect(rulesFireOn(bars, '5', rules, ist(9, 32))?.time).toBe(ist(9, 25)); // 09:30 bar is still open at 09:32
  });
  it('does not fire before that bar has closed', () => {
    expect(rulesFireOn(bars, '5', rules, ist(9, 29))).toBeNull(); // 09:25 bar closes at 09:30
  });
  it('once the next bar closes the cross is in the past and the alert does not fire again', () => {
    expect(rulesFireOn(bars, '5', rules, ist(9, 36))).toBeNull(); // last closed bar is 09:30 (97): no cross
  });
});
