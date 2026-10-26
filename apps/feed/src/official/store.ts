import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import type { OfficialBar, TradeDate } from './nse-files';

export type DayRecord = {
  date: TradeDate;
  fetchedAt: string;
  /** Keyed by our symbols (NIFTY, RELIANCE…). */
  bars: Record<string, OfficialBar>;
};

const DIR = path.resolve(import.meta.dirname, '../../.cache/official');
const days = new Map<TradeDate, DayRecord>();

export async function loadOfficialStore(): Promise<number> {
  const files = await readdir(DIR).catch(() => [] as string[]);
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    const rec = JSON.parse(await readFile(path.join(DIR, f), 'utf8')) as DayRecord;
    days.set(rec.date, rec);
  }
  return days.size;
}

export async function saveDay(rec: DayRecord) {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, `${rec.date}.json`), JSON.stringify(rec));
  days.set(rec.date, rec);
}

export const hasDay = (d: TradeDate) => days.has(d);
export const storedDays = () => [...days.keys()].sort();

const IST = 5.5 * 3600;
const tradeDate = (t: number): TradeDate => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Replaces daily bars with NSE's official values wherever an official record exists for that date, and adds
 * official bars for dates the free source is missing entirely. Official data always wins; every replaced or
 * added bar is reported. Volume is only compared when the official record has it (stocks, not indices).
 */
export function applyOfficial(
  symbol: string,
  candles: Candle[],
  lookup: (d: TradeDate) => DayRecord | undefined = (d) => days.get(d),
  officialDates: TradeDate[] = storedDays(),
) {
  let verified = 0, latest: TradeDate | null = null;
  const corrected: { time: number; fields: string[] }[] = [];
  const out = candles.map((c) => {
    const date = tradeDate(c.time);
    const off = lookup(date)?.bars[symbol];
    if (!off) return c;
    verified++;
    if (!latest || date > latest) latest = date;
    const fields: string[] = (['open', 'high', 'low', 'close'] as const).filter((k) => r2(c[k]) !== r2(off[k]));
    if (off.volume != null && c.volume !== off.volume) fields.push('volume');
    if (!fields.length) return c;
    corrected.push({ time: c.time, fields });
    return { time: c.time, open: off.open, high: off.high, low: off.low, close: off.close, volume: off.volume ?? c.volume };
  });

  // Dates NSE traded this symbol but the free source has no bar for: add NSE's bar (stamped 09:15 IST, like the rest).
  const have = new Set(out.map((c) => tradeDate(c.time)));
  for (const date of officialDates) {
    const off = lookup(date)?.bars[symbol];
    if (!off || have.has(date)) continue;
    const time = Date.parse(`${date}T09:15:00Z`) / 1000 - IST;
    out.push({ time, open: off.open, high: off.high, low: off.low, close: off.close, volume: off.volume ?? 0 });
    corrected.push({ time, fields: ['added'] });
    verified++;
    if (!latest || date > latest) latest = date;
  }
  out.sort((a, b) => a.time - b.time);
  corrected.sort((a, b) => a.time - b.time);
  return { candles: out, official: { verified, corrected, latest } };
}
