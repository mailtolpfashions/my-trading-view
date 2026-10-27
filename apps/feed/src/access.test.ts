import { describe, expect, it, vi } from 'vitest';
import { DelayBuffer, LiveUsageRecorder, barEnd, delayCandles, delayCandlesWithPartial, delayedQuoteFromBars } from './access';

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
  it('replays every second: one sample per second, the last price in that second', () => {
    const b = new DelayBuffer();
    const t0 = ist(27, 10, 0);
    b.push({ ...q(t0, 100), time: t0 + 0.2 });
    b.push({ ...q(t0, 101), time: t0 + 0.7 }); // same second: replaces
    b.push(q(t0 + 1, 102));
    b.push(q(t0 + 3, 103));
    const at = (s: number) => b.delayed('NIFTY', t0 + 900 + s);
    expect([0, 1, 2, 3, 4].map((s) => at(s)?.ltp)).toEqual([101, 102, 102, 103, 103]);
    expect(at(1)).toMatchObject({ prevClose: 22600, change: 102 - 22600, time: t0 + 1 });
  });
  it('knows nothing from before recording started (falls back elsewhere) and keeps 20 minutes', () => {
    const b = new DelayBuffer();
    const t0 = ist(27, 10, 0);
    for (let s = 0; s < 1500; s++) b.push(q(t0 + s, 1000 + s)); // 25 minutes, one tick a second
    expect(b.delayed('NIFTY', t0 + 1499)).toMatchObject({ ltp: 1000 + 599, time: t0 + 599 }); // 15 min before the last tick
    expect(b.delayed('NIFTY', t0 + 1000)).toBeNull(); // that moment (t0+100 s) has been overwritten: ring holds 20 min
    expect(b.delayed('OTHER', t0 + 1499)).toBeNull();
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

describe('delayed data straight after the live source connects', () => {
  const ohlc = (time: number, o: number, h: number, l: number, c: number, v = 10) => ({ time, open: o, high: h, low: l, close: c, volume: v });
  const minutes = (from: number, closes: number[]) => closes.map((c, i) => ohlc(from + i * 60, c, c + 1, c - 1, c));
  const now = ist(27, 10, 0); // cutoff 09:45

  it('rebuilds the current daily bar from 1-minute bars that closed by the cutoff, and nothing later', () => {
    const daily = [ohlc(ist(26, 9, 15), 1, 1, 1, 1), ohlc(ist(27, 9, 15), 100, 150, 90, 140, 9999)]; // live bar includes post-cutoff prices
    const oneMin = minutes(ist(27, 9, 15), Array.from({ length: 45 }, (_, i) => 100 + i)); // 09:15 … 09:59
    const out = delayCandlesWithPartial(daily, 'D', now, oneMin);
    expect(out).toHaveLength(2);
    // 09:15–09:44 bars (30 of them) closed by 09:45: closes 100..129
    expect(out[1]).toEqual({ time: ist(27, 9, 15), open: 100, high: 130, low: 99, close: 129, volume: 300 });
  });
  it('a weekly bar uses the completed days of the week plus today\'s closed minutes', () => {
    const week = ohlc(ist(26, 9, 15), 0, 0, 0, 0); // Mon 26 Oct
    const daily = [ohlc(ist(26, 9, 15), 50, 60, 40, 55, 1000)];
    const out = delayCandlesWithPartial([week], 'W', now, minutes(ist(27, 9, 15), [56, 70, 52]), daily);
    expect(out).toEqual([{ time: ist(26, 9, 15), open: 50, high: 71, low: 40, close: 52, volume: 1030 }]); // low 40 is Monday's
  });
  it('quotes the last 1-minute close from before the cutoff; before 09:30 that is still yesterday\'s price', () => {
    const live = { symbol: 'NIFTY', ltp: 999, prevClose: 100, change: 899, changePct: 899, time: now };
    const q = delayedQuoteFromBars(live, minutes(ist(27, 9, 15), [101, 102, 103, 104]), ist(27, 9, 32));
    expect(q).toMatchObject({ ltp: 102, change: 2, time: ist(27, 9, 16) + 59 }); // cutoff 09:17: bars 09:15 and 09:16 closed; stamped inside 09:16
    const early = delayedQuoteFromBars(live, minutes(ist(26, 15, 28), [98, 99]), ist(27, 9, 20));
    expect(early).toMatchObject({ ltp: 99, change: 0, changePct: 0 });
    expect(delayedQuoteFromBars(live, [], now)).toBeNull();
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
