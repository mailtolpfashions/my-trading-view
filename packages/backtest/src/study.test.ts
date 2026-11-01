import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { StudyTally, breakIndices, dateOf, findEvents, outcome, ruleMask } from './study';
import type { RuleSet } from './strategy';

// Daily bars stamped 09:15 IST from 1 Jan 2024; close = given, high/low ±1.
const bars = (closes: number[], start = Date.UTC(2024, 0, 1, 3, 45) / 1000): Candle[] =>
  closes.map((c, i) => ({ time: start + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 }));
const above = (n: number): RuleSet => ({ match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: '>', right: { kind: 'number', value: n } }] });
const crossesAbove = (n: number): RuleSet => ({ match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'number', value: n } }] });

describe('event study', () => {
  const c = bars([100, 105, 99, 110, 120, 90]);
  it('finds bars where the rules hold (crosses as on TradingView)', () => {
    expect(ruleMask(c, above(100))).toEqual([false, true, false, true, true, false]);
    expect(ruleMask(c, crossesAbove(100))).toEqual([false, true, false, true, false, false]);
  });
  it('outcome: close-to-close % and the biggest rise / fall from highs and lows in between', () => {
    // From 105 (bar 1), 2 bars later the close is 110: +4.76%; highs 100, 111 → +5.71%; lows 98, 109 → −6.67%.
    const o = outcome(c, 1, 2)!;
    expect(o.pct).toBeCloseTo((110 / 105 - 1) * 100, 10);
    expect(o.maxUpPct).toBeCloseTo((111 / 105 - 1) * 100, 10);
    expect(o.maxDownPct).toBeCloseTo((98 / 105 - 1) * 100, 10);
    expect(outcome(c, 4, 2)).toBeNull(); // not enough bars after
  });
  it('events carry symbol, IST date and one outcome per horizon', () => {
    const ev = findEvents('X', c, crossesAbove(100), [1, 2]);
    expect(ev.map((e) => e.date)).toEqual(['2024-01-02', '2024-01-04']);
    expect(ev[1].out[0]!.pct).toBeCloseTo((120 / 110 - 1) * 100, 10);
    expect(ev[1].out[1]!.pct).toBeCloseTo((90 / 110 - 1) * 100, 10);
  });
  it('tally per period: counts, best / worst with dates, and the all-bars baseline', () => {
    const t = new StudyTally([1], (d) => d.slice(0, 4), () => true);
    for (const e of findEvents('X', c, above(100), [1])) t.addEvent(e);
    t.addBaseline(c);
    const [y] = t.rows();
    expect(y.events).toBe(3);
    expect(y.outcomes[0]).toMatchObject({ up: 1, down: 2, flat: 0 }); // 105→99 down, 110→120 up, 120→90 down
    expect(y.outcomes[0].best).toMatchObject({ date: '2024-01-04', symbol: 'X' });
    expect(y.outcomes[0].worst!.date).toBe('2024-01-05');
    expect(y.baseline[0]).toEqual({ up: 3, down: 2, total: 5 });
  });
  it('data breaks: windows that cross one are skipped and counted, in events and baseline', () => {
    const br = breakIndices(c, ['2024-01-05']); // bar 4
    expect([...br]).toEqual([4]);
    expect(outcome(c, 3, 1, br)).toBeNull(); // 3 → 4 crosses the break
    expect(outcome(c, 4, 1, br)).not.toBeNull(); // starting on the break day is fine
    const ev = findEvents('X', c, above(100), [1], br);
    expect(ev.map((e) => e.broken[0])).toEqual([false, true, false]);
    const t = new StudyTally([1], (d) => d.slice(0, 4), () => true);
    for (const e of ev) t.addEvent(e);
    t.addBaseline(c, br);
    expect(t.rows()[0]).toMatchObject({ events: 3, skipped: [1], baseline: [{ up: 2, down: 2, total: 4 }] });
  });
  it('keep() leaves dates out of both events and baseline', () => {
    const t = new StudyTally([1], (d) => d.slice(0, 7), (d) => d !== '2024-01-04');
    for (const e of findEvents('X', c, above(100), [1])) t.addEvent(e);
    t.addBaseline(c);
    expect(t.rows()[0].events).toBe(2);
    expect(t.rows()[0].baseline[0].total).toBe(4);
    expect(dateOf(c[0].time)).toBe('2024-01-01');
  });
});
