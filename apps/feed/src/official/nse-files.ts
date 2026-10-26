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

/** ind_close_all_DDMMYYYY.csv → official index name → OHLC. */
export function parseIndexClose(csv: string): Map<string, OfficialBar> {
  const rows = table(csv, ['Index Name', 'Open Index Value', 'High Index Value', 'Low Index Value', 'Closing Index Value']);
  const out = new Map<string, OfficialBar>();
  for (const get of rows) {
    const bar = { open: num(get('Open Index Value')), high: num(get('High Index Value')), low: num(get('Low Index Value')), close: num(get('Closing Index Value')) };
    if (valid(bar)) out.set(get('Index Name').toUpperCase(), bar);
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
