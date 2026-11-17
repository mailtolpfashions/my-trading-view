import { describe, expect, it } from 'vitest';
import { atmStrike, nearestPremium, stopFor, weekdaysTo } from './straddle920';

describe('9:20 straddle helpers', () => {
  it('counts weekdays to expiry, expiry day = 0', () => {
    expect(weekdaysTo('2026-11-17', '2026-11-17')).toBe(0); // Tuesday expiry day
    expect(weekdaysTo('2026-11-16', '2026-11-17')).toBe(1); // Monday
    expect(weekdaysTo('2026-11-13', '2026-11-17')).toBe(2); // Friday: the weekend does not count
    expect(weekdaysTo('2026-11-11', '2026-11-17')).toBe(4); // Wednesday
  });
  it('picks the strike nearest the index', () => {
    expect(atmStrike([2530000, 2535000, 2540000], 2537400)).toBe(2535000);
    expect(atmStrike([2530000, 2535000, 2540000], 2538000)).toBe(2540000);
    expect(atmStrike([], 2538000)).toBeNull();
  });
  it('sets the stop 20% above the fill, rounded up to the 5-paise tick', () => {
    expect(stopFor(10000, 20)).toBe(12000);
    expect(stopFor(10335, 20)).toBe(12405); // 124.02 → 124.05
  });
  it('picks the option priced nearest the target, the further one on a tie', () => {
    const list = [{ strikePaise: 2550000, pricePaise: 9000 }, { strikePaise: 2560000, pricePaise: 6000 }, { strikePaise: 2570000, pricePaise: 4000 }];
    expect(nearestPremium(list, 6500, 'CE')?.strikePaise).toBe(2560000);
    expect(nearestPremium(list, 5000, 'CE')?.strikePaise).toBe(2570000); // 60 and 40 are equally near 50
    expect(nearestPremium([], 5000, 'CE')).toBeNull();
  });
});
