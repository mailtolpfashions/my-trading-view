import { describe, expect, it } from 'vitest';
import { boundedMark } from './signals';

const row = (kind: string, strike: number, close: number, settle: number, traded: boolean) => ({ kind, strikePaise: strike * 100, closePaise: close * 100, settlePaise: settle * 100, traded });

describe('boundedMark', () => {
  // 17 Apr 2020, NIFTY Dec 2020 expiry, index 9,266.75: the 14000 CE did not trade and NSE's settlement price was ₹911.60.
  const day = [row('CE', 12000, 118, 118, true), row('CE', 14000, 36, 911.6, false), row('PE', 10500, 1500, 1500, true), row('PE', 9000, 0, 700, false)];
  it('uses a traded close as it is', () => expect(boundedMark(day, 'CE', 1200000, 926675)).toBe(11800));
  it('caps an untraded call at the cheapest traded lower-strike call', () => expect(boundedMark(day, 'CE', 1400000, 926675)).toBe(11800));
  it('keeps the settlement price when it is inside the bounds', () => expect(boundedMark(day, 'PE', 900000, 926675)).toBe(70000));
  it('never goes below intrinsic value', () => expect(boundedMark([row('PE', 10000, 0, 100, false)], 'PE', 1000000, 926675)).toBe(73325));
  it('returns null with no price', () => expect(boundedMark([row('CE', 15000, 0, 0, false)], 'CE', 1500000, 926675)).toBeNull());
});
