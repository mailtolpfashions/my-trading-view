import { describe, expect, it } from 'vitest';
import { dayTime } from '../eod/adjust';
import { niftyDays } from './nifty-days';

const c = (date: string, open: number, high: number, low: number, close: number) => ({ time: dayTime(date), open, high, low, close, volume: 0 });

describe('NIFTY day rows', () => {
  // Test values shaped like the 4 Jun 2024 election-result day (a ~5.9% fall); not checked against NSE's files.
  const rows = niftyDays(
    [c('2024-06-03', 23337.9, 23338.7, 23062.3, 23263.9), c('2024-06-04', 23179.5, 23179.5, 21281.45, 21884.5)],
    [c('2024-06-04', 0, 0, 0, 26.74)],
    new Set(['2024-06-06']),
    new Set(['2024-06-03', '2024-06-04']),
  );
  it('computes gap, change and range against the previous close, and tags the event', () => {
    const d = rows[1];
    expect(d).toMatchObject({ date: '2024-06-04', weekday: 'Tue', prevClose: 23263.9, gapPts: -84.4, changePts: -1379.4, vixClose: 26.74, expiryDay: false, events: ['election-2024'] });
    expect(d.changePct).toBeCloseTo(-5.929, 3);
    expect(d.rangePct).toBeCloseTo(((23179.5 - 21281.45) / 23263.9) * 100, 9);
  });
  it('first day has no previous close; expiry is unknown outside F&O coverage', () => {
    expect(rows[0]).toMatchObject({ prevClose: null, gapPct: null, changePct: null, vixClose: null });
    expect(niftyDays([c('2010-01-04', 1, 1, 1, 1)], [], new Set(), new Set())[0].expiryDay).toBeNull();
  });
});
