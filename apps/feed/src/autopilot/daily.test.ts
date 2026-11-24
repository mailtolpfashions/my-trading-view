import { describe, expect, it } from 'vitest';
import { due } from './daily';

const m = (h: number, mm: number) => h * 60 + mm;
const none = () => false;

describe('autopilot timing', () => {
  it('reminds at 8:45 and 9:10 only while Kite is not logged in, on weekdays', () => {
    expect(due(m(8, 44), true, false, none)).toEqual([]);
    expect(due(m(8, 45), true, false, none)).toEqual(['login1']);
    expect(due(m(9, 12), true, false, none)).toEqual(['login2']);
    expect(due(m(8, 50), true, true, none)).toEqual([]); // already logged in
    expect(due(m(8, 50), false, false, none)).toEqual([]); // weekend
  });
  it('never repeats a message already sent, and sends the summary after 15:35', () => {
    expect(due(m(8, 50), true, false, (k) => k === 'login1')).toEqual([]);
    expect(due(m(15, 34), true, true, none)).toEqual([]);
    expect(due(m(15, 40), true, true, none)).toEqual(['summary']);
    expect(due(m(15, 40), true, true, (k) => k === 'summary')).toEqual([]);
  });
});
