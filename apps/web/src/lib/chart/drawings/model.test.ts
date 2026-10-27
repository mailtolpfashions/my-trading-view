import { describe, expect, it } from 'vitest';
import { channelOffset, distanceToSegment, fibPrice, hitTest, logicalToTime, measureText, timeToLogical, type Drawing } from './model';

describe('time ↔ bar position', () => {
  const t = [1000, 1300, 1600, 1900]; // 5-minute bars
  it('maps a bar time to its index and interpolates inside a bar', () => {
    expect(timeToLogical(t, 1300)).toBe(1);
    expect(timeToLogical(t, 1450)).toBe(1.5);
  });
  it('extends before the first and after the last bar at the edge interval', () => {
    expect(timeToLogical(t, 700)).toBe(-1);
    expect(timeToLogical(t, 2500)).toBe(5);
  });
  it('round-trips', () => {
    for (const x of [700, 1000, 1123, 1900, 2600]) expect(logicalToTime(t, timeToLogical(t, x)!)).toBeCloseTo(x, 9);
  });
  it('a point drawn on intraday bars lands inside the right day on daily bars (with weekend gaps)', () => {
    const day = 86400, mon = 0, fri = 4 * day, nextMon = 7 * day;
    const daily = [mon, day, 2 * day, 3 * day, fri, nextMon];
    expect(timeToLogical(daily, fri + 3600)).toBeGreaterThan(4);
    expect(timeToLogical(daily, fri + 3600)).toBeLessThan(5);
  });
});

describe('hit testing', () => {
  const trend: Drawing = { id: 't', kind: 'trend', p1: { time: 0, price: 0 }, p2: { time: 1, price: 1 }, color: '#000' };
  const hline: Drawing = { id: 'h', kind: 'hline', p1: { time: 0, price: 5 }, color: '#000' };
  const placed = [{ d: trend, a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }, { d: hline, a: { x: 0, y: 300 } }];
  it('finds a line within tolerance, and its end handles', () => {
    expect(hitTest(placed, { x: 50, y: 53 }, 800)).toEqual({ id: 't', handle: 'body' });
    expect(hitTest(placed, { x: 99, y: 101 }, 800)).toEqual({ id: 't', handle: 'p2' });
    expect(hitTest(placed, { x: 50, y: 70 }, 800)).toBeNull();
  });
  it('a horizontal line is hit anywhere along its price', () => {
    expect(hitTest(placed, { x: 600, y: 304 }, 800)).toEqual({ id: 'h', handle: 'body' });
  });
  it('distance to a ray continues past its second point', () => {
    expect(distanceToSegment({ x: 200, y: 200 }, { x: 0, y: 0 }, { x: 100, y: 100 }, true)).toBeCloseTo(0, 9);
    expect(distanceToSegment({ x: 200, y: 200 }, { x: 0, y: 0 }, { x: 100, y: 100 })).toBeGreaterThan(100);
  });
});

describe('Fibonacci retracement and parallel channel', () => {
  it('Fibonacci levels run from 1 at the first point to 0 at the second, as on TradingView', () => {
    const low = { time: 0, price: 100 }, high = { time: 10, price: 200 };
    expect(fibPrice(low, high, 0)).toBe(200);
    expect(fibPrice(low, high, 1)).toBe(100);
    expect(fibPrice(low, high, 0.618)).toBeCloseTo(138.2, 9);
    expect(fibPrice(low, high, 1.618)).toBeCloseTo(38.2, 9);
  });
  it('channel width is the price distance from the base line at the third point', () => {
    expect(channelOffset({ time: 0, price: 100 }, { time: 10, price: 200 }, { time: 5, price: 170 })).toBe(20); // base 150 at t=5
  });
});

describe('measure readout', () => {
  it('shows change, percent, bars and time span', () => {
    expect(measureText({ time: 0, price: 22000 }, { time: 3 * 3600 + 900, price: 22110 }, 39)).toBe('+110.00 (+0.50%) · 39 bars · 3h 15m');
    expect(measureText({ time: 0, price: 100 }, { time: 2 * 86400, price: 95 }, 2)).toBe('−5.00 (−5.00%) · 2 bars · 2d 0h');
  });
});
