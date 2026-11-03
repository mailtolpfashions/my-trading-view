// One-minute bars on disk: one file per stock per month (apps/feed/.data/1m/SYMBOL/YYYY-MM.bin), each row six int32s:
// open time (UTC seconds), open, high, low, close (paise), volume. ~200 KB per stock-month. Live bars are appended as
// each minute closes; a historical download replaces whole days (Kite's official minutes win over live-built ones).
// Reads keep the last row written for a time, so an append after a replacement can never duplicate a bar.
// Every change to a file goes through that file's queue, so an append never races a day replacement.

import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';

const ROW = 24;
const IST = 5.5 * 3600;
const monthOf = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 7);
export const dateOfIst = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const safe = (symbol: string) => symbol.replace(/[^A-Z0-9&_-]/gi, '_');

function encode(bars: Candle[]): Buffer {
  const b = Buffer.alloc(bars.length * ROW);
  bars.forEach((c, i) => {
    const o = i * ROW;
    b.writeInt32LE(c.time, o);
    b.writeInt32LE(Math.round(c.open * 100), o + 4);
    b.writeInt32LE(Math.round(c.high * 100), o + 8);
    b.writeInt32LE(Math.round(c.low * 100), o + 12);
    b.writeInt32LE(Math.round(c.close * 100), o + 16);
    b.writeInt32LE(Math.min(2 ** 31 - 1, Math.round(c.volume)), o + 20);
  });
  return b;
}

function decode(buf: Buffer): Candle[] {
  const byTime = new Map<number, Candle>();
  for (let o = 0; o + ROW <= buf.length; o += ROW) {
    const t = buf.readInt32LE(o);
    byTime.set(t, { time: t, open: buf.readInt32LE(o + 4) / 100, high: buf.readInt32LE(o + 8) / 100, low: buf.readInt32LE(o + 12) / 100, close: buf.readInt32LE(o + 16) / 100, volume: buf.readInt32LE(o + 20) });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export class MinuteStore {
  private queues = new Map<string, Promise<unknown>>();

  constructor(readonly dir = path.resolve(import.meta.dirname, '../../.data/1m')) {}

  private file(symbol: string, month: string) {
    return path.join(this.dir, safe(symbol), `${month}.bin`);
  }

  private serial<T>(file: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(file) ?? Promise.resolve()).then(fn);
    // The queue keeps only "done", never the result: holding each file's decoded bars here leaked gigabytes.
    const done = next.then(() => {}, () => {});
    this.queues.set(file, done);
    void done.then(() => { if (this.queues.get(file) === done) this.queues.delete(file); });
    return next;
  }

  /** Appends finished live bars (any months). */
  async append(symbol: string, bars: Candle[]) {
    const byMonth = new Map<string, Candle[]>();
    for (const b of bars) byMonth.set(monthOf(b.time), [...(byMonth.get(monthOf(b.time)) ?? []), b]);
    await Promise.all([...byMonth].map(([m, list]) => {
      const f = this.file(symbol, m);
      return this.serial(f, async () => { await mkdir(path.dirname(f), { recursive: true }); await appendFile(f, encode(list)); });
    }));
  }

  /** Replaces every bar of the given IST dates with `bars` (which must be those dates' complete minutes). */
  async replaceDays(symbol: string, dates: string[], bars: Candle[]) {
    const wanted = new Set(dates);
    const months = new Set([...dates.map((d) => d.slice(0, 7)), ...bars.map((b) => monthOf(b.time))]);
    await Promise.all([...months].map((m) => {
      const f = this.file(symbol, m);
      return this.serial(f, async () => {
        const old = await readFile(f).then(decode, () => [] as Candle[]);
        const keep = old.filter((b) => !wanted.has(dateOfIst(b.time)));
        const merged = [...keep, ...bars.filter((b) => monthOf(b.time) === m)].sort((a, b) => a.time - b.time);
        await mkdir(path.dirname(f), { recursive: true });
        await writeFile(`${f}.tmp`, encode(merged));
        await rename(`${f}.tmp`, f);
      });
    }));
  }

  /** Bars from `fromTime` on (whole months are read), oldest first. */
  async read(symbol: string, fromTime: number): Promise<Candle[]> {
    const dir = path.join(this.dir, safe(symbol));
    const months = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^\d{4}-\d{2}\.bin$/.test(n)).map((n) => n.slice(0, 7)).filter((m) => m >= monthOf(fromTime)).sort();
    const parts = await Promise.all(months.map((m) => { const f = this.file(symbol, m); return this.serial(f, () => readFile(f).then(decode, () => [] as Candle[])); }));
    return parts.flat().filter((b) => b.time >= fromTime);
  }

  /** IST dates that hold at least `minBars` bars for this stock (a full NSE session has 375). */
  async days(symbol: string, fromTime: number, minBars = 1): Promise<Set<string>> {
    const count = new Map<string, number>();
    for (const b of await this.read(symbol, fromTime)) count.set(dateOfIst(b.time), (count.get(dateOfIst(b.time)) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n >= minBars).map(([d]) => d));
  }
}
