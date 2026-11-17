import { describe, expect, it } from 'vitest';
import { swingLevel, swingsKnown, weeklyBars } from './lab';

// 12 weeks of Monday bars: lows dip to 90 in week 5 (a swing low), highs peak at 130 in week 8 (a swing high).
const mondays = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10));
const lows = [100, 99, 98, 97, 96, 90, 97, 98, 99, 100, 101, 102];
const highs = [110, 111, 112, 113, 114, 115, 120, 125, 130, 124, 122, 121];
const bars = mondays.map((date, i) => ({ date, high: highs[i] * 100, low: lows[i] * 100, close: ((highs[i] + lows[i]) / 2) * 100 }));
const weeks = weeklyBars(bars);

describe('weekly swing levels', () => {
  it('builds one bar per week', () => expect(weeks).toHaveLength(12));
  it('knows a swing only after the 3 weeks after it have closed', () => {
    expect(swingsKnown(weeks, mondays[7]).some((x) => x.kind === 'low')).toBe(false); // week 5 low, only 2 weeks after
    expect(swingsKnown(weeks, mondays[8]).find((x) => x.kind === 'low')?.price).toBe(9000);
    expect(swingsKnown(weeks, mondays[11]).find((x) => x.kind === 'high')?.price).toBe(13000);
  });
  it('support is the nearest level at least 3% below; resistance at least 3% above', () => {
    expect(swingLevel(weeks, mondays[11], 10000, 'support')?.price).toBe(9000);
    expect(swingLevel(weeks, mondays[11], 9200, 'support')).toBeNull(); // 90 is within 3% of 92
    expect(swingLevel(weeks, mondays[11], 10000, 'resistance')?.price).toBe(13000);
  });
});
