import { describe, expect, it, vi } from 'vitest';
import { DelayBuffer, LiveUsageRecorder, barEnd, delayCandles } from './access';

const ist = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m) / 1000 - 5.5 * 3600;
const q = (time: number, ltp: number) => ({ symbol: 'NIFTY', ltp, prevClose: 22600, change: ltp - 22600, changePct: 0, time });
const bar = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });

describe('15-minute delay for Free users on a live source', () => {
  it('serves the latest price that is at least 15 minutes old, never a newer one', () => {
    const b = new DelayBuffer();
    b.push(q(ist(27, 10, 0), 22700));
    b.push(q(ist(27, 10, 10), 22710));
    b.push(q(ist(27, 10, 20), 22720));
    expect(b.delayed('NIFTY', ist(27, 10, 14))).toBeNull(); // nothing 15 minutes old yet
    expect(b.delayed('NIFTY', ist(27, 10, 15))!.ltp).toBe(22700);
    expect(b.delayed('NIFTY', ist(27, 10, 34))!.ltp).toBe(22710); // 10:20 is still too new
    expect(b.delayed('NIFTY', ist(27, 10, 35))!.ltp).toBe(22720);
  });
  it('drops intraday bars that close within the last 15 minutes', () => {
    const now = ist(27, 11, 0);
    // Cutoff 10:45. 5m bars close at 10:45, 10:50 and 10:55: only the first contains no price newer than the cutoff.
    const bars = [bar(ist(27, 10, 40)), bar(ist(27, 10, 45)), bar(ist(27, 10, 50))];
    expect(delayCandles(bars, '5', now).map((c) => c.time)).toEqual([ist(27, 10, 40)]);
  });
  it("hides today's daily bar until 15 minutes after the 15:30 close", () => {
    const today = bar(ist(27, 9, 15));
    expect(barEnd(today, 'D')).toBe(ist(27, 15, 30));
    expect(delayCandles([bar(ist(26, 9, 15)), today], 'D', ist(27, 15, 44))).toHaveLength(1);
    expect(delayCandles([bar(ist(26, 9, 15)), today], 'D', ist(27, 15, 45))).toHaveLength(2);
  });
  it('a weekly bar ends Friday 15:30 IST', () => {
    expect(barEnd(bar(ist(26, 9, 15)), 'W')).toBe(ist(30, 15, 30)); // Mon 26 -> Fri 30 Oct
  });
});

describe('live usage counting', () => {
  it('records each user once per month', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const r = new LiveUsageRecorder(save, () => {});
    r.record('u1', ist(27, 10, 0));
    r.record('u1', ist(28, 10, 0));
    r.record('u2', ist(27, 10, 0));
    r.record('u1', Date.UTC(2026, 10, 2, 5) / 1000); // November
    expect(save.mock.calls).toEqual([['u1', '2026-10'], ['u2', '2026-10'], ['u1', '2026-11']]);
  });
  it('retries if saving failed', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const r = new LiveUsageRecorder(save, () => {});
    r.record('u1', ist(27, 10, 0));
    await new Promise((res) => setTimeout(res, 0));
    r.record('u1', ist(27, 10, 1));
    expect(save).toHaveBeenCalledTimes(2);
  });
});
