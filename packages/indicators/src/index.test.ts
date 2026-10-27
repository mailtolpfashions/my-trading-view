import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { atr, barStart, bollinger, changePct, ema, heikinAshi, highestBefore, lowestBefore, macd, mergeTick, rsi, sma, supertrend, vwap, wma } from './index';

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 100): Candle => ({ time, open, high, low, close, volume });
const line = (closes: number[]) => closes.map((c, i) => bar(i * 300, c, c + 1, c - 1, c));

describe('moving averages', () => {
  it('sma', () => expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]));
  it('ema seeds with the SMA, then smooths with k = 2/(n+1)', () => {
    // seed = (1+2+3)/3 = 2; k = 0.5 -> 4*0.5 + 2*0.5 = 3; 10*0.5 + 3*0.5 = 6.5
    expect(ema([1, 2, 3, 4, 10], 3)).toEqual([null, null, 2, 3, 6.5]);
  });
  it('wma weights recent values most', () => expect(wma([1, 2, 3], 3)).toEqual([null, null, (1 + 4 + 9) / 6]));
});

describe('highest / lowest of the previous bars', () => {
  const v = [5, 3, 8, 1, 7, 2, 9];
  // Brute force reference: extreme of v[i-n .. i-1].
  const ref = (n: number, pick: (...x: number[]) => number) => v.map((_, i) => (i < n ? null : pick(...v.slice(i - n, i))));
  it('excludes the current bar, so a breakout can be detected', () => {
    expect(highestBefore(v, 3)).toEqual(ref(3, Math.max));
    expect(lowestBefore(v, 3)).toEqual(ref(3, Math.min));
    expect(highestBefore(v, 1)).toEqual(ref(1, Math.max));
  });
  it('matches brute force on long random data', () => {
    const r = Array.from({ length: 600 }, (_, i) => Math.round(Math.sin(i * 1.7) * 100 + (i % 13) * 7));
    for (const n of [1, 5, 20, 252]) {
      expect(highestBefore(r, n)).toEqual(r.map((_, i) => (i < n ? null : Math.max(...r.slice(i - n, i)))));
      expect(lowestBefore(r, n)).toEqual(r.map((_, i) => (i < n ? null : Math.min(...r.slice(i - n, i)))));
    }
  });
  it('change % from the previous close', () => expect(changePct([100, 110, 99])).toEqual([null, 10, -10]));
});

describe('rsi (Wilder)', () => {
  it('matches a hand-computed series', () => {
    // changes +1, -1, +1; period 2: seed gain 0.5 / loss 0.5 -> 50; then gain 0.75 / loss 0.25 -> 75
    expect(rsi([1, 2, 1, 2], 2)).toEqual([null, null, 50, 75]);
  });
  it('is 100 on a rising series and 0 on a falling one', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
  });
});

describe('macd', () => {
  it('is zero for a flat series', () => {
    const m = macd(new Array(60).fill(100));
    expect(m.macd.at(-1)).toBe(0);
    expect(m.signal.at(-1)).toBe(0);
    expect(m.histogram.at(-1)).toBe(0);
  });
  it('signal starts once the MACD line has `signal` values', () => {
    const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(m.macd.findIndex((v) => v != null)).toBe(25);
    expect(m.signal.findIndex((v) => v != null)).toBe(33);
  });
});

describe('bollinger', () => {
  it('collapses to the mean on a flat series', () => {
    const b = bollinger(new Array(25).fill(50), 20, 2);
    expect([b.upper.at(-1), b.middle.at(-1), b.lower.at(-1)]).toEqual([50, 50, 50]);
  });
  it('uses population standard deviation', () => {
    const b = bollinger([1, 3], 2, 1); // mean 2, population sd 1
    expect([b.upper[1], b.lower[1]]).toEqual([3, 1]);
  });
});

describe('atr and supertrend', () => {
  it('atr equals the constant range when there are no gaps', () => {
    expect(atr(line([10, 10, 10, 10, 10]), 3).at(-1)).toBe(2);
  });
  it('supertrend is up on a rally and flips down after a crash', () => {
    const rally = Array.from({ length: 30 }, (_, i) => 100 + i);
    const s1 = supertrend(line(rally), 10, 3);
    expect(s1.direction.at(-1)).toBe(1);
    expect(s1.value.at(-1)!).toBeLessThan(rally.at(-1)!);

    const crash = [...rally, 110, 100, 90, 80];
    const s2 = supertrend(line(crash), 10, 3);
    expect(s2.direction.at(-1)).toBe(-1);
    expect(s2.value.at(-1)!).toBeGreaterThan(80);
  });
});

describe('vwap', () => {
  it('accumulates within a day and resets on the next IST day', () => {
    const day1 = Date.UTC(2026, 9, 23, 3, 45) / 1000; // 09:15 IST
    const day2 = Date.UTC(2026, 9, 26, 3, 45) / 1000;
    const v = vwap([bar(day1, 0, 12, 6, 9, 100), bar(day1 + 300, 0, 15, 9, 12, 300), bar(day2, 0, 30, 30, 30, 50)]);
    expect(v[0]).toBe(9);
    expect(v[1]).toBe((9 * 100 + 12 * 300) / 400);
    expect(v[2]).toBe(30);
  });
});

describe('live bars', () => {
  const ist = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m) / 1000 - 5.5 * 3600;

  it('aligns intraday buckets to the 09:15 IST open', () => {
    expect(barStart(ist(26, 9, 17), '5')).toBe(ist(26, 9, 15));
    expect(barStart(ist(26, 10, 44), '60')).toBe(ist(26, 10, 15)); // hourly bars: 09:15, 10:15, ...
    expect(barStart(ist(26, 9, 5), '5')).toBeNull(); // pre-open
  });
  it('maps daily to 09:15 IST and weekly to Monday', () => {
    expect(barStart(ist(29, 14, 0), 'D')).toBe(ist(29, 9, 15));
    expect(barStart(ist(29, 14, 0), 'W')).toBe(ist(26, 9, 15)); // Thu 29 Oct -> Mon 26 Oct
  });
  it('updates the current bar and opens a new one when the bucket rolls over', () => {
    const start = [bar(ist(26, 9, 15), 100, 101, 99, 100)];
    const updated = mergeTick(start, '5', 103, ist(26, 9, 18));
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ open: 100, high: 103, low: 99, close: 103 });
    const rolled = mergeTick(updated, '5', 102, ist(26, 9, 21));
    expect(rolled).toHaveLength(2);
    expect(rolled[1]).toMatchObject({ time: ist(26, 9, 20), open: 102, close: 102 });
  });
  it('ignores stale ticks', () => {
    const c = [bar(ist(26, 9, 20), 100, 101, 99, 100)];
    expect(mergeTick(c, '5', 50, ist(26, 9, 16))).toBe(c);
  });
});

describe('heikin ashi', () => {
  it('averages OHLC for close and the previous HA body for open', () => {
    const h = heikinAshi([bar(0, 10, 14, 8, 12), bar(300, 12, 16, 11, 15)]);
    expect(h[0]).toMatchObject({ open: 11, close: 11 });
    expect(h[1]).toMatchObject({ open: 11, close: 13.5, high: 16, low: 11 });
  });
});
