import { describe, expect, it } from 'vitest';
import { DEFAULT_WEEKEND_RULE, dueTime, entryDue, midOf, positionValue, straddleOf } from './weekend';

describe('weekend theta helpers', () => {
  it('values a quote at the mid, else the last trade', () => {
    expect(midOf({ ltpPaise: 10000, bidPaise: 9900, askPaise: 10100 })).toBe(10000);
    expect(midOf({ ltpPaise: 10000, bidPaise: 0, askPaise: 10100 })).toBe(10000);
    expect(midOf({ ltpPaise: 0, bidPaise: 0, askPaise: 0 })).toBeNull();
    expect(midOf(null)).toBeNull();
  });
  it('adds the call and put of a straddle snapshot', () => {
    const q = (p: number) => ({ ltpPaise: p, bidPaise: p - 10, askPaise: p + 10 });
    expect(straddleOf({ time: '09:15', at: 0, spotPaise: 1, strikePaise: 1, ce: q(5000), pe: q(6000) })).toBe(11000);
    expect(straddleOf({ time: '09:15', at: 0, spotPaise: 1, strikePaise: 1, ce: q(5000), pe: null })).toBeNull();
  });
  it('takes each snapshot time once, and not when more than 3 minutes late', () => {
    const times = ['09:15', '09:16', '09:20'];
    expect(dueTime(times, 555, new Set())).toBe('09:15');
    expect(dueTime(times, 556, new Set(['09:15']))).toBe('09:16');
    expect(dueTime(times, 556, new Set())).toBe('09:15'); // 09:15 still in its window, taken first
    expect(dueTime(times, 559, new Set(['09:16']))).toBeNull(); // 09:15 too late, 09:20 not yet
    expect(dueTime(times, 554, new Set())).toBeNull();
  });
  it('enters only on an enabled Friday from the set time, once', () => {
    const on = { ...DEFAULT_WEEKEND_RULE, enabled: true };
    expect(entryDue(on, '2026-11-27', 925, false)).toBe(true); // Friday 15:25
    expect(entryDue(on, '2026-11-27', 924, false)).toBe(false);
    expect(entryDue(on, '2026-11-27', 925, true)).toBe(false);
    expect(entryDue(on, '2026-11-26', 925, false)).toBe(false); // Thursday
    expect(entryDue(DEFAULT_WEEKEND_RULE, '2026-11-27', 925, false)).toBe(false); // off by default
  });
  it('values the position: sold legs owe, bought wings are worth something', () => {
    const q = (p: number) => ({ ltpPaise: p, bidPaise: 0, askPaise: 0 });
    expect(positionValue([{ side: 'SELL', qty: 65, q: q(4000) }, { side: 'BUY', qty: 65, q: q(500) }])).toBe(65 * 3500);
    expect(positionValue([{ side: 'SELL', qty: 65, q: null }])).toBeNull();
  });
});
