import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { emaBandState, istHm, segmentOf, sessionStats, twap } from './index';

// Bars at IST times: day 0 = 2026-01-05 (Mon). t(day, hhmm) -> UTC seconds.
const BASE = Date.parse('2026-01-05T00:00:00+05:30') / 1000;
const t = (day: number, hhmm: number) => BASE + day * 86400 + Math.floor(hhmm / 100) * 3600 + (hhmm % 100) * 60;
const bar = (time: number, open: number, high: number, low: number, close: number): Candle => ({ time, open, high, low, close, volume: 0 });

describe('time helpers', () => {
  it('IST clock and segments', () => {
    expect(istHm(t(0, 915))).toBe(915);
    expect([1127, 1130, 1327, 1330, 1527].map((h) => segmentOf(t(0, h)))).toEqual([1, 2, 2, 3, 3]);
  });
});

describe('twap', () => {
  it('running mean of ohlc4 that resets each day', () => {
    const c = [bar(t(0, 915), 10, 12, 8, 10), bar(t(0, 918), 20, 22, 18, 20), bar(t(1, 915), 5, 5, 5, 5)];
    expect(twap(c)).toEqual([10, 15, 5]);
    expect(twap(c, (b) => b.close)).toEqual([10, 15, 5]);
  });
});

describe('emaBandState', () => {
  it('strong outside the band, weak inside keeping the last strong side', () => {
    // period 2: EMA seeds with the mean of the first 2 values.
    const c = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 105, 110, 104, 109), bar(3, 103, 104, 102, 103), bar(4, 95, 96, 90, 91), bar(5, 98, 99, 97, 98)];
    const s = emaBandState(c, 2);
    expect(s.high[1]).toBe(101);
    expect(s.state).toEqual([0, 0, 2, 1, -2, -1]);
  });
});

describe('sessionStats', () => {
  // Five identical past days of range 100 (S1 60, S2 80, S3 100), then a live day.
  const day = (d: number) => [bar(t(d, 915), 1000, 1030, 970, 1000), bar(t(d, 1200), 1000, 1050, 990, 1040), bar(t(d, 1400), 1040, 1070, 1000, 1060)];
  const live = [bar(t(5, 915), 1000, 1010, 990, 1005), bar(t(5, 1130), 1005, 1025, 1000, 1020)];
  const s = sessionStats([...day(0), ...day(1), ...day(2), ...day(3), ...day(4), ...live]);
  it('averages need 5 complete past days', () => {
    expect(s[12].avgRange).toBeNull();
    expect(s[15].avgRange).toBe(100);
  });
  it('running segment ranges and their averages', () => {
    expect(s[2].segRange).toEqual([60, 80, 100]);
    expect(s[15].segAvg).toEqual([60, 80, 100]);
    expect(s[15].segRange).toEqual([20, null, null]);
    expect(s[16].segRange).toEqual([20, 35, null]);
  });
  it('range vs average, distance from high / low, position', () => {
    const last = s[16];
    expect([last.high, last.low, last.range]).toEqual([1025, 990, 35]);
    expect(last.rangeVsAvg).toBeCloseTo(0.35);
    expect([last.fromHigh, last.fromLow]).toEqual([5, 30]);
    expect(last.position).toBeCloseTo(30 / 35);
    expect(last.segment).toBe(2);
  });
});
