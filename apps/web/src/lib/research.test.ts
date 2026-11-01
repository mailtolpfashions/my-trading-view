import { describe, expect, it } from 'vitest';
import { filterRows, patternTable, periodTable, type NiftyDay } from './research';

const day = (date: string, prevClose: number | null, open: number, close: number, extra: Partial<NiftyDay> = {}): NiftyDay => ({
  date, weekday: 'Mon', prevClose, open, high: Math.max(open, close), low: Math.min(open, close), close,
  gapPts: prevClose == null ? null : open - prevClose, gapPct: prevClose == null ? null : ((open - prevClose) / prevClose) * 100,
  changePts: prevClose == null ? null : close - prevClose, changePct: prevClose == null ? null : ((close - prevClose) / prevClose) * 100,
  rangePct: null, vixClose: null, expiryDay: null, events: [], ...extra,
});

// 100 → 102 (gap up, closes above open) → 99 (gap down, closes below) → 100 (flat open after a down day, closes up)
const rows = [day('2024-01-01', null, 100, 100), day('2024-01-02', 100, 101, 102), day('2024-01-03', 102, 101, 99, { events: ['x'] }), day('2024-01-04', 99, 99, 100), day('2025-01-01', 100, 103, 101)];

describe('research tables', () => {
  it('counts per year with the extreme days and their dates, skipping the first day (no previous close)', () => {
    const [y24, y25] = periodTable(rows, 'year');
    expect(y24).toMatchObject({ period: '2024', days: 3, up: 2, down: 1, gapUp: 1, gapDown: 1, gapFlat: 1, eventDays: 1 });
    expect(y24.bestDay).toEqual({ date: '2024-01-02', pct: 2 });
    expect(y24.worstDay!.date).toBe('2024-01-03');
    expect(y24.moves).toEqual({ lt05: 0, '05to1': 0, '1to2': 1, ge2: 2 });
    expect(y25).toMatchObject({ period: '2025', days: 1, bigGaps: 1 });
  });
  it('counts the day-to-day patterns per year', () => {
    const [p] = patternTable(rows);
    expect(p.afterUp).toEqual({ gapUp: 0, gapDown: 1, gapFlat: 0 }); // after 2 Jan's up close, 3 Jan opened down
    expect(p.afterDown).toEqual({ gapUp: 0, gapDown: 0, gapFlat: 1 });
    expect(p.gapUpClose).toEqual({ aboveOpen: 1, belowOpen: 0 });
    expect(p.gapDownClose).toEqual({ aboveOpen: 0, belowOpen: 1 });
  });
  it('filters by year range and leaves out chosen event days', () => {
    expect(filterRows(rows, { excludeEvents: ['x'] }).map((r) => r.date)).not.toContain('2024-01-03');
    expect(filterRows(rows, { fromYear: '2025', excludeEvents: [] }).map((r) => r.date)).toEqual(['2025-01-01']);
  });
});
