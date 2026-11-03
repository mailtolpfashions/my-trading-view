import { describe, expect, it } from 'vitest';
import { resample } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { monthlyFromDaily, weeklyFromDaily } from '../eod/timeframes';

// The screener builds weeks and months with the rules engine's resample (faster); the chart uses the EOD store's own
// functions. Both must give identical bars, or a screen and the chart would disagree.
describe('screener weeks and months match the chart\'s', () => {
  const IST = 5.5 * 3600;
  const days: Candle[] = [];
  let p = 100;
  for (let t = Date.UTC(2015, 0, 1) / 1000; t < Date.UTC(2026, 10, 3) / 1000; t += 86400) {
    const d = new Date(t * 1000);
    // Weekends, plus some weekday holidays (Mondays, a month's 1st, Fridays) to test the edges.
    if ([0, 6].includes(d.getUTCDay()) || d.getUTCDate() === 1 || (d.getUTCDay() === 1 && d.getUTCDate() % 3 === 0) || (d.getUTCDay() === 5 && d.getUTCDate() % 4 === 0)) continue;
    p *= 1 + Math.sin(t) * 0.01;
    days.push({ time: t + 9 * 3600 + 15 * 60 - IST, open: p, high: p * 1.01, low: p * 0.99, close: p * 1.002, volume: 1000 + (t % 97) });
  }
  it('weekly', () => expect(resample(days, 'W')).toEqual(weeklyFromDaily(days)));
  it('monthly', () => expect(resample(days, 'M')).toEqual(monthlyFromDaily(days)));
});
