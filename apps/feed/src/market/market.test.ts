import { describe, expect, it } from 'vitest';
import { breadthByDay, breadthSnapshot, type DayClose } from './breadth';
import { ema, quadrant, rrg, weekly } from './rrg';

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10));

describe('relative rotation', () => {
  it('keeps the last close of each week', () => {
    // 5 Jan 2026 is a Monday.
    const w = weekly([{ date: '2026-01-05', close: 1 }, { date: '2026-01-09', close: 2 }, { date: '2026-01-12', close: 3 }, { date: '2026-01-14', close: 4 }]);
    expect(w).toEqual([{ date: '2026-01-09', close: 2 }, { date: '2026-01-14', close: 4 }]);
  });

  const P = { ema: 3, average: 5, lag: 2 };
  it('puts a steadily outperforming sector at RS-Ratio above 100 and an underperformer below', () => {
    const d = days(60);
    const bench = d.map((date) => ({ date, close: 100 }));
    const up = rrg(d.map((date, i) => ({ date, close: 100 * 1.01 ** i })), bench, P);
    const down = rrg(d.map((date, i) => ({ date, close: 100 * 0.99 ** i })), bench, P);
    // First RS-Ratio at index ema + average − 2 = 6; first momentum `lag` (2) points after that.
    expect(up).toHaveLength(60 - 6 - 2);
    expect(up.at(-1)!.rsRatio).toBeGreaterThan(100);
    expect(down.at(-1)!.rsRatio).toBeLessThan(100);
  });

  it('matches a hand computation', () => {
    // Bench flat at 100, so RS = the sector close.
    const d = days(12);
    const closes = [10, 11, 13, 12, 14, 15, 15, 16, 18, 17, 19, 20];
    const pts = rrg(d.map((date, i) => ({ date, close: closes[i] })), d.map((date) => ({ date, close: 100 })), P);
    const e = ema(closes, 3);
    expect(e[1]).toBeCloseTo(10 + 0.5 * (11 - 10), 12); // k = 2 / (3 + 1)
    const ratioAt = (i: number) => (100 * e[i]) / (e.slice(i - 4, i + 1).reduce((a, b) => a + b) / 5);
    expect(pts[0].date).toBe(d[8]);
    expect(pts[0].rsRatio).toBeCloseTo(ratioAt(8), 10);
    expect(pts[0].rsMomentum).toBeCloseTo((100 * ratioAt(8)) / ratioAt(6), 10);
  });

  it('names the quadrants', () => {
    expect(quadrant({ rsRatio: 101, rsMomentum: 101 })).toBe('leading');
    expect(quadrant({ rsRatio: 101, rsMomentum: 99 })).toBe('weakening');
    expect(quadrant({ rsRatio: 99, rsMomentum: 99 })).toBe('lagging');
    expect(quadrant({ rsRatio: 99, rsMomentum: 101 })).toBe('improving');
  });
});

describe('breadth', () => {
  const m = new Map<string, DayClose[]>([
    ['A', [{ date: 'd1', close: 10 }, { date: 'd2', close: 11 }, { date: 'd3', close: 11 }]],
    ['B', [{ date: 'd1', close: 10 }, { date: 'd2', close: 9 }, { date: 'd3', close: 8 }]],
    ['C', [{ date: 'd2', close: 5 }, { date: 'd3', close: 6 }]], // listed on d2: no change that day
  ]);
  it('counts advances, declines, unchanged and not traded, with a cumulative A−D line', () => {
    expect(breadthByDay(m, ['d2', 'd3'])).toEqual([
      { date: 'd2', advances: 1, declines: 1, unchanged: 0, notTraded: 1, cumulative: 0 },
      { date: 'd3', advances: 1, declines: 1, unchanged: 1, notTraded: 0, cumulative: 0 },
    ]);
  });
  it('counts members above their moving averages and at 52-week highs', () => {
    const rising = Array.from({ length: 260 }, (_, i) => ({ date: `x${String(i).padStart(3, '0')}`, close: 100 + i }));
    const s = breadthSnapshot(new Map([['R', rising]]), rising.at(-1)!.date);
    expect(s).toMatchObject({ traded: 1, aboveSma20: 1, aboveSma50: 1, aboveSma200: 1, withSma200: 1, newHighs: 1, newLows: 0, with52w: 1 });
  });
});
