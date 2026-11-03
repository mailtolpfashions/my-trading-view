import { describe, expect, it } from 'vitest';
import { basisNow, decide, inSession } from './engine';

const IST = 5.5 * 3600;
/** UTC seconds of an IST wall-clock time on Tue 3 Nov 2026. */
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 3, h, m, s) / 1000 - IST;

describe('what an alert reports', () => {
  it('the first check is a baseline: nothing is reported', () => {
    expect(decide('first', null, ['A', 'B'])).toEqual({ baseline: true, notify: [] });
  });
  it('"first" reports stocks that newly match, again only after they stopped', () => {
    expect(decide('first', ['A', 'B'], ['B', 'C'])).toEqual({ baseline: false, notify: ['C'] });
    expect(decide('first', ['B', 'C'], ['A', 'B', 'C'])).toEqual({ baseline: false, notify: ['A'] });
    expect(decide('first', ['A', 'B', 'C'], ['A', 'B', 'C'])).toEqual({ baseline: false, notify: [] });
  });
  it('"every" reports all matches on each check', () => {
    expect(decide('every', ['A'], ['A', 'B'])).toEqual({ baseline: false, notify: ['A', 'B'] });
  });
});

describe('when an alert is checked', () => {
  it('intraday: once per closed bar, 5 s after it closes, only with live data in the session', () => {
    expect(basisNow('15m', 'closed', 'market', at(10, 0, 4), true, null)).toBe(`15m:${at(9, 30)}`);
    expect(basisNow('15m', 'closed', 'market', at(10, 0, 6), true, null)).toBe(`15m:${at(9, 45)}`);
    expect(basisNow('15m', 'closed', 'market', at(10, 14, 0), true, null)).toBe(`15m:${at(9, 45)}`);
    expect(basisNow('15m', 'closed', 'market', at(10, 0, 6), false, null)).toBeNull();
    expect(basisNow('15m', 'closed', 'market', at(16, 0), true, null)).toBeNull();
  });
  it('the short last hourly bar (15:15–15:30) is checked at 15:30', () => {
    expect(basisNow('1h', 'closed', 'market', at(15, 15, 6), true, null)).toBe(`1h:${at(14, 15)}`);
    expect(basisNow('1h', 'closed', 'market', at(15, 30, 6), true, null)).toBe(`1h:${at(15, 15)}`);
  });
  it('daily: when the end-of-day date changes; every 5 minutes in the session for a live-candle screen', () => {
    expect(basisNow('D', 'closed', 'market', at(19, 0), true, '2026-11-03')).toBe('eod:2026-11-03');
    expect(basisNow('D', 'closed', 'market', at(11, 0), true, '2026-11-02')).toBe('eod:2026-11-02');
    expect(basisNow('D', 'live', 'market', at(11, 2), true, '2026-11-02')).toBe(`live:${Math.floor(at(11, 2) / 300)}`);
    expect(basisNow('D', 'live', 'market', at(11, 2), false, '2026-11-02')).toBe('eod:2026-11-02');
  });
  it('the session is 09:15–15:31 on weekdays', () => {
    expect(inSession(at(9, 14))).toBe(false);
    expect(inSession(at(9, 15))).toBe(true);
    expect(inSession(at(15, 31))).toBe(true);
    expect(inSession(at(15, 32))).toBe(false);
    expect(inSession(Date.UTC(2026, 10, 1, 5, 0) / 1000)).toBe(false); // Sunday
  });
});
