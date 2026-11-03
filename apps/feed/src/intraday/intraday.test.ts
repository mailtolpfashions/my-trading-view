import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { MinuteBuilder, minuteStart } from './builder';
import { MinuteStore } from './store';

const IST = 5.5 * 3600;
/** UTC seconds of an IST wall-clock time on 3 Nov 2026. */
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 3, h, m, s) / 1000 - IST;

describe('minute builder', () => {
  it('builds bars from ticks: OHLC from prices, volume from the running day volume', () => {
    const out: Candle[] = [];
    const b = new MinuteBuilder((_s, bars) => out.push(...bars));
    b.tick('X', 100, 1000, at(9, 15, 2));
    b.tick('X', 102, 1500, at(9, 15, 30));
    b.tick('X', 99, 1600, at(9, 15, 59));
    b.tick('X', 101, 1700, at(9, 16, 1));
    expect(out).toEqual([{ time: at(9, 15), open: 100, high: 102, low: 99, close: 99, volume: 1600 }]);
    expect(b.todayBars('X', true).at(-1)).toEqual({ time: at(9, 16), open: 101, high: 101, low: 101, close: 101, volume: 100 });
  });

  it('never keeps the first bar after a mid-session start (its earlier volume is unknown)', () => {
    const out: Candle[] = [];
    const b = new MinuteBuilder((_s, bars) => out.push(...bars));
    b.tick('X', 100, 50000, at(11, 3, 40));
    b.tick('X', 101, 50100, at(11, 4, 5));
    b.tick('X', 102, 50300, at(11, 5, 0));
    expect(out).toEqual([{ time: at(11, 4), open: 101, high: 101, low: 101, close: 101, volume: 100 }]);
  });

  it('closes quiet stocks\' bars on the clock, ignores late and out-of-session ticks', () => {
    const out: Candle[] = [];
    const b = new MinuteBuilder((_s, bars) => out.push(...bars));
    b.tick('X', 100, 10, at(9, 15, 1));
    b.tick('X', 90, 20, at(9, 0, 0)); // pre-open: not a bar
    b.flush(at(9, 16, 2));
    expect(out).toHaveLength(0); // inside the grace period
    b.flush(at(9, 16, 4));
    expect(out).toHaveLength(1);
    b.tick('X', 50, 30, at(9, 15, 50)); // late tick for a closed minute
    expect(b.todayBars('X', false)).toHaveLength(1);
    expect(minuteStart(at(15, 30, 0))).toBeNull();
    expect(minuteStart(at(15, 29, 59))).toBe(at(15, 29));
  });

  it('historical minutes replace live ones up to their last bar; later live bars stay', () => {
    const b = new MinuteBuilder(() => {});
    b.tick('X', 100, 10, at(9, 15, 1));
    b.tick('X', 101, 20, at(9, 16, 1));
    b.tick('X', 102, 30, at(9, 17, 1));
    b.flush(at(9, 20));
    b.setToday('X', [{ time: at(9, 15), open: 99, high: 100, low: 98, close: 100, volume: 11 }, { time: at(9, 16), open: 100, high: 101, low: 100, close: 101, volume: 9 }]);
    expect(b.todayBars('X', false).map((c) => [c.time, c.volume])).toEqual([[at(9, 15), 11], [at(9, 16), 9], [at(9, 17), 10]]);
  });
});

describe('minute store', () => {
  const bar = (t: number, c: number, v = 100): Candle => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: v });

  it('appends, reads back exactly (paise), and keeps the last write for a minute', async () => {
    const s = new MinuteStore(await mkdtemp(path.join(tmpdir(), 'm1-')));
    await s.append('ABC', [bar(at(9, 15), 100.05), bar(at(9, 16), 100.1)]);
    await s.append('ABC', [bar(at(9, 16), 100.15, 7)]);
    expect(await s.read('ABC', 0)).toEqual([bar(at(9, 15), 100.05), bar(at(9, 16), 100.15, 7)]);
  });

  it('replaces whole days, across months, without touching other days', async () => {
    const s = new MinuteStore(await mkdtemp(path.join(tmpdir(), 'm1-')));
    const oct31 = Date.UTC(2026, 9, 30, 3, 45) / 1000; // Fri 30 Oct 2026 09:15 IST
    await s.append('ABC', [bar(oct31, 90), bar(at(9, 15), 100), bar(at(9, 16), 101)]);
    await s.replaceDays('ABC', ['2026-11-03'], [bar(at(9, 15), 200), bar(at(9, 17), 202)]);
    expect((await s.read('ABC', 0)).map((b) => b.close)).toEqual([90, 200, 202]);
    expect([...(await s.days('ABC', 0))].sort()).toEqual(['2026-10-30', '2026-11-03']);
  });

  it('serialises concurrent appends and replacements on one file', async () => {
    const s = new MinuteStore(await mkdtemp(path.join(tmpdir(), 'm1-')));
    await Promise.all([
      s.replaceDays('ABC', ['2026-11-03'], Array.from({ length: 10 }, (_, i) => bar(at(9, 15 + i), 100 + i))),
      ...Array.from({ length: 5 }, (_, i) => s.append('ABC', [bar(at(10, i), 300 + i)])),
    ]);
    expect(await s.read('ABC', 0)).toHaveLength(15);
  });
});

describe('intraday prices on the daily adjusted basis', () => {
  const day = (h: number, c: number): Candle => ({ time: Date.UTC(2026, 0, 13, h, 0) / 1000 - 5.5 * 3600, open: c, high: c, low: c, close: c, volume: 100 });
  it('scales unadjusted minutes before a split, leaves adjusted or unaffected days alone', async () => {
    const { adjustToEod } = await import('./adjust');
    // 13 Jan 2026: published close 2000, adjusted for a later 1:5 split → 400.
    const closes = new Map([['2026-01-13', { raw: 2000, adj: 400 }]]);
    expect(adjustToEod([day(10, 1990), day(15, 2000)], closes).map((b) => [b.close, b.volume])).toEqual([[398, 500], [400, 500]]);
    expect(adjustToEod([day(10, 398), day(15, 400)], closes).map((b) => b.close)).toEqual([398, 400]);
    expect(adjustToEod([day(15, 2000)], new Map())).toEqual([day(15, 2000)]);
  });
});

describe('the seam between downloaded and live minutes', () => {
  it('reports when the live side starts more than a minute after the download, so it can be filled', () => {
    const b = new MinuteBuilder(() => {});
    b.tick('X', 100, 5000, at(14, 59, 40)); // joined mid-minute: 14:59 is not kept
    b.tick('X', 101, 5100, at(15, 0, 5));
    b.flush(at(15, 1, 10));
    const hist = [{ time: at(14, 58), open: 99, high: 99, low: 99, close: 99, volume: 10 }];
    expect(b.setToday('X', hist)).toBe(true);
    const full = [...hist, { time: at(14, 59), open: 100, high: 100, low: 100, close: 100, volume: 20 }];
    expect(b.setToday('X', full)).toBe(false);
    expect(b.todayBars('X', false).map((c) => c.time)).toEqual([at(14, 58), at(14, 59), at(15, 0)]);
  });
});

describe('option recording', () => {
  it('picks the nearest two expiries and 10 strikes each side of the index', async () => {
    const { pickContracts } = await import('./options');
    const all = ['2026-11-04', '2026-11-11', '2026-11-25'].flatMap((expiry) => Array.from({ length: 60 }, (_, k) => 24000 + k * 50).flatMap((strike) =>
      (['CE', 'PE'] as const).map((right) => ({ token: strike * 10 + (right === 'CE' ? 1 : 2) + expiry.length, tradingsymbol: '', expiry, strike, right, lot: 75 }))));
    const got = pickContracts(all, 25012, '2026-11-03');
    expect(new Set(got.map((c) => c.expiry))).toEqual(new Set(['2026-11-04', '2026-11-11']));
    const strikes = [...new Set(got.filter((c) => c.expiry === '2026-11-04').map((c) => c.strike))].sort((a, b) => a - b);
    expect([strikes[0], strikes.at(-1), strikes.length]).toEqual([24500, 25500, 21]);
    expect(got).toHaveLength(2 * 21 * 2);
  });

  it('builds option minutes with OI and the closing bid / ask, dropping the first partial minute', async () => {
    const { OptionRecorder, OptionStore } = await import('./options');
    const rows: unknown[] = [];
    const r = new OptionRecorder((_u, x) => rows.push(...x));
    r.add('NIFTY', [{ token: 7, tradingsymbol: 'NIFTY26NOV25000CE', expiry: '2026-11-04', strike: 25000, right: 'CE', lot: 75 }]);
    const tick = (ltp: number, vol: number, t: number, bid: number, ask: number, oi: number) => r.tick({ token: 7, ltpPaise: ltp * 100, volume: vol, time: t, bidPaise: bid * 100, askPaise: ask * 100, oi, openPaise: 0, highPaise: 0, lowPaise: 0, closePaise: 0 }, t);
    tick(100, 5000, at(11, 0, 30), 99.9, 100.1, 1000); // joined mid-minute: not kept
    tick(101, 5100, at(11, 1, 2), 100.9, 101.1, 1010);
    tick(103, 5400, at(11, 1, 50), 102.8, 103.2, 1050);
    r.flush(at(11, 2, 4));
    expect(rows).toEqual([{ time: at(11, 1), expiry: '2026-11-04', strike: 25000, right: 'CE', open: 101, high: 103, low: 101, close: 103, volume: 400, oi: 1050, bid: 102.8, ask: 103.2 }]);
    const store = new OptionStore(await mkdtemp(path.join(tmpdir(), 'opt-')));
    await store.append('NIFTY', rows as never);
    expect(await store.read('NIFTY', '2026-11-03')).toEqual(rows);
  });
});
