// NSE's official end-of-day files: the exchange's own record of each day's prices.
// Parsers look columns up by header name and throw if a required column is missing,
// so a format change fails loudly instead of producing wrong numbers.

import { unzipSync, strFromU8 } from 'fflate';

export type OfficialBar = { open: number; high: number; low: number; close: number; volume?: number };

const ARCHIVE = 'https://nsearchives.nseindia.com/content';
const dd = (n: number) => String(n).padStart(2, '0');

/** Date as YYYY-MM-DD (IST trading date). */
export type TradeDate = string;

export const indexCloseUrl = (d: TradeDate) => {
  const [y, m, day] = d.split('-');
  return `${ARCHIVE}/indices/ind_close_all_${day}${m}${y}.csv`;
};
export const bhavcopyUrl = (d: TradeDate) => `${ARCHIVE}/cm/BhavCopy_NSE_CM_0_0_0_${d.replaceAll('-', '')}_F_0000.csv.zip`;

/** Splits one CSV line, honouring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function table(csv: string, required: string[]) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('empty file');
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(required.map((name) => {
    const i = header.indexOf(name.toLowerCase());
    if (i < 0) throw new Error(`NSE file format changed: column "${name}" not found`);
    return [name, i];
  }));
  return lines.slice(1).map(splitCsvLine).map((cells) => (name: string) => cells[col[name]] ?? '');
}

const num = (s: string) => {
  const n = Number(s.replaceAll(',', ''));
  return Number.isFinite(n) ? n : NaN;
};
const valid = (b: OfficialBar) => [b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0);

/**
 * Today's name for an NSE index. Indices were renamed in 2015–16 ("S&P CNX Nifty" → "NIFTY 50", "CNX Bank" /
 * "BANK Nifty" → "NIFTY BANK", "CNX Nifty Junior" → "NIFTY NEXT 50", "CNX Midcap" → "NIFTY MIDCAP 100"); older files
 * use the old names, so one series must not split into two. Names not listed keep their (upper-cased) file name.
 */
const RENAMED: Record<string, string> = {
  'CNX NIFTY': 'NIFTY 50', 'NIFTY': 'NIFTY 50', 'CNX NIFTY JUNIOR': 'NIFTY NEXT 50', 'NIFTY JUNIOR': 'NIFTY NEXT 50',
  'BANK NIFTY': 'NIFTY BANK', 'CNX BANK': 'NIFTY BANK', 'CNX MIDCAP': 'NIFTY MIDCAP 100', 'CNX SMALLCAP': 'NIFTY SMALLCAP 100',
  'CNX FINANCE': 'NIFTY FINANCIAL SERVICES', 'CNX INFRA': 'NIFTY INFRASTRUCTURE', 'CNX SERVICE': 'NIFTY SERVICES SECTOR',
  'CNX CONSUMPTION': 'NIFTY INDIA CONSUMPTION', 'CNX DIVIDEND OPPORTUNITIES': 'NIFTY DIVIDEND OPPORTUNITIES 50', 'CNX DEFTY': 'NIFTY50 USD',
  'CNX NIFTY DIVIDEND': 'NIFTY50 DIVIDEND POINTS',
};
export function canonicalIndexName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ').toUpperCase().replace(/^S&P /, '');
  if (RENAMED[n]) return RENAMED[n];
  return n.startsWith('CNX ') ? `NIFTY ${n.slice(4)}` : n;
}

/**
 * Index OHLC from the PR bundle's Pd file (Pd030111.csv): the only NSE archive record of index closes before
 * ind_close_all files begin (2013). Index rows have MKT = Y, no symbol, and the index name as SECURITY.
 */
export function parsePdIndices(csv: string): Map<string, OfficialBar> {
  const rows = table(csv, ['MKT', 'SYMBOL', 'SECURITY', 'OPEN_PRICE', 'HIGH_PRICE', 'LOW_PRICE', 'CLOSE_PRICE']);
  const out = new Map<string, OfficialBar>();
  for (const get of rows) {
    if (get('MKT') !== 'Y' || get('SYMBOL') || !get('SECURITY')) continue;
    const bar = { open: num(get('OPEN_PRICE')), high: num(get('HIGH_PRICE')), low: num(get('LOW_PRICE')), close: num(get('CLOSE_PRICE')) };
    if (valid(bar)) out.set(canonicalIndexName(get('SECURITY')), bar);
  }
  return out;
}

/** The Pd file inside a PR bundle (Pd030111.csv or pd03012011.csv). */
export const findPdFile = (names: string[]) => names.find((f) => /(^|\/)pd\d{6}(\d{2})?\.csv$/i.test(f));

/** ind_close_all_DDMMYYYY.csv → official index name → OHLC. */
export function parseIndexClose(csv: string): Map<string, OfficialBar> {
  const rows = table(csv, ['Index Name', 'Open Index Value', 'High Index Value', 'Low Index Value', 'Closing Index Value']);
  const out = new Map<string, OfficialBar>();
  for (const get of rows) {
    const bar = { open: num(get('Open Index Value')), high: num(get('High Index Value')), low: num(get('Low Index Value')), close: num(get('Closing Index Value')) };
    if (valid(bar)) out.set(canonicalIndexName(get('Index Name')), bar);
  }
  return out;
}

/** Cash-market bhavcopy (UDiFF CSV) → symbol → OHLCV, for EQ and BE series. Close is NSE's official closing price. */
export function parseBhavcopy(csv: string): Map<string, OfficialBar> {
  const rows = table(csv, ['TckrSymb', 'SctySrs', 'OpnPric', 'HghPric', 'LwPric', 'ClsPric', 'TtlTradgVol']);
  const out = new Map<string, OfficialBar>();
  for (const get of rows) {
    if (!['EQ', 'BE'].includes(get('SctySrs'))) continue;
    const bar = { open: num(get('OpnPric')), high: num(get('HghPric')), low: num(get('LwPric')), close: num(get('ClsPric')), volume: num(get('TtlTradgVol')) };
    if (valid(bar)) out.set(get('TckrSymb'), bar);
  }
  return out;
}

export function unzipFirstCsv(zip: Uint8Array): string {
  const files = unzipSync(zip);
  const name = Object.keys(files).find((f) => f.toLowerCase().endsWith('.csv'));
  if (!name) throw new Error('no CSV inside bhavcopy zip');
  return strFromU8(files[name]);
}

/** Previous weekdays (most recent first), as IST trading dates. Exchange holidays simply have no file. */
export function recentWeekdays(nowSec: number, count: number, includeToday: boolean): TradeDate[] {
  const out: TradeDate[] = [];
  let d = new Date((nowSec + 5.5 * 3600) * 1000);
  if (!includeToday) d = new Date(d.getTime() - 86400_000);
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(`${d.getUTCFullYear()}-${dd(d.getUTCMonth() + 1)}-${dd(d.getUTCDate())}`);
    d = new Date(d.getTime() - 86400_000);
  }
  return out;
}

/**
 * Official index closes for a trading day: ind_close_all (from 2013), or else the PR bundle's Pd file (2011–2012).
 * `get` downloads politely; `prBundle` returns the day's unzipped PR bundle (downloaded only when needed).
 * Only "not published" falls back to the Pd file; any other failure is raised.
 */
export async function officialIndexCloses(
  date: TradeDate,
  get: (url: string) => Promise<Response>,
  prBundle: () => Promise<Record<string, Uint8Array>>,
  isNotPublished: (e: unknown) => boolean,
): Promise<Map<string, OfficialBar>> {
  try {
    return parseIndexClose(await (await get(indexCloseUrl(date))).text());
  } catch (e) {
    if (!isNotPublished(e)) throw e;
    const pr = await prBundle();
    const pd = findPdFile(Object.keys(pr));
    if (!pd) throw new Error(`${date}: no index close file and no Pd file in the PR bundle`);
    return parsePdIndices(strFromU8(pr[pd]));
  }
}
