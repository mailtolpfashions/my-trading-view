// Market overview for the dashboard: the last NSE session's index closes, NIFTY 50 movers and NIFTY 500 breadth, and
// the FII footprint, all from NSE's own files. Index membership comes from NSE's published constituent lists
// (nsearchives content/indices), refreshed daily; today's list is applied to the latest session only.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import { nseGet } from '../nse-http';

export const OVERVIEW_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYIT', 'INDIAVIX'] as const;

/** IST trading date of a daily candle (stamped 09:15 IST). */
export const candleDate = (c: Candle) => new Date((c.time + 5.5 * 3600) * 1000).toISOString().slice(0, 10);

export type IndexCard = { symbol: string; date: string; open: number; high: number; low: number; close: number; prevClose: number | null; change: number | null; changePct: number | null };
export type StockMove = { symbol: string; close: number; changePct: number };

export function indexCard(symbol: string, candles: Candle[] | null | undefined): IndexCard | null {
  if (!candles?.length) return null;
  const last = candles[candles.length - 1], prev = candles.length > 1 ? candles[candles.length - 2].close : null;
  const change = prev == null ? null : Math.round((last.close - prev) * 100) / 100;
  return { symbol, date: candleDate(last), open: last.open, high: last.high, low: last.low, close: last.close, prevClose: prev, change, changePct: prev ? ((last.close - prev) / prev) * 100 : null };
}

/** A stock's change on `asOf`, or null if it did not trade that day (suspended, newly listed, or no history). */
export function moveOn(symbol: string, candles: Candle[] | null | undefined, asOf: string): StockMove | null {
  if (!candles || candles.length < 2) return null;
  const last = candles[candles.length - 1];
  if (candleDate(last) !== asOf) return null;
  const prev = candles[candles.length - 2].close;
  return { symbol, close: last.close, changePct: ((last.close - prev) / prev) * 100 };
}

export type Breadth = { advances: number; declines: number; unchanged: number; members: number; notTraded: string[] };
export function breadth(members: string[], moves: Map<string, StockMove | null>): Breadth {
  const b: Breadth = { advances: 0, declines: 0, unchanged: 0, members: members.length, notTraded: [] };
  for (const s of members) {
    const m = moves.get(s);
    if (!m) b.notTraded.push(s);
    else if (m.changePct > 0) b.advances++;
    else if (m.changePct < 0) b.declines++;
    else b.unchanged++;
  }
  return b;
}

/** Top `n` gainers and losers (ties broken by symbol, so the order is stable). */
export function movers(moves: StockMove[], n = 5) {
  const sorted = [...moves].sort((a, b) => b.changePct - a.changePct || a.symbol.localeCompare(b.symbol));
  return { gainers: sorted.filter((m) => m.changePct > 0).slice(0, n), losers: sorted.filter((m) => m.changePct < 0).reverse().slice(0, n) };
}

/** Symbols from an NSE constituent CSV (header: Company Name,Industry,Symbol,Series,ISIN Code). */
export function parseConstituents(csv: string): string[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const col = head.indexOf('Symbol');
  if (col < 0) throw new Error('NSE constituent list has no Symbol column');
  return lines.slice(1).map((l) => l.split(',')[col]?.trim()).filter((s): s is string => !!s);
}

const LISTS = { 'NIFTY 50': 'ind_nifty50list.csv', 'NIFTY 500': 'ind_nifty500list.csv' } as const;
export type IndexList = keyof typeof LISTS;
const CACHE = path.resolve(import.meta.dirname, '../../.cache/indices');
const DAY_MS = 86400_000;

/** Index members, from a copy at most a day old; on a failed refresh the older copy is used. */
export async function indexMembers(name: IndexList): Promise<{ symbols: string[]; fetched: string }> {
  const file = path.join(CACHE, LISTS[name]);
  const cached = await stat(file).then((s) => s.mtime, () => null);
  if (!cached || Date.now() - cached.getTime() > DAY_MS) {
    try {
      const csv = await (await nseGet(`https://nsearchives.nseindia.com/content/indices/${LISTS[name]}`, 60_000)).text();
      parseConstituents(csv); // refuse to cache something that isn't the list
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, csv);
      return { symbols: parseConstituents(csv), fetched: new Date().toISOString() };
    } catch (e) {
      if (!cached) throw e;
    }
  }
  return { symbols: parseConstituents(await readFile(file, 'utf8')), fetched: cached!.toISOString() };
}
