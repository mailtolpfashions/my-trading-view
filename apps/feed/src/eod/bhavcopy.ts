// NSE cash-market bhavcopy: the exchange's official end-of-day record of every stock. Two layouts exist: UDiFF
// (from 8 Jul 2024) and the older CSV. Both are parsed by header name and fail loudly on a format change.
// Rows that break basic price rules are not stored; they are returned in `rejected` so they are reported, never hidden.

import { splitCsvLine } from '../official/nse-files';

export type EquityRow = {
  symbol: string;
  isin: string;
  series: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  volume: number;
  trades: number | null;
};

export type EquityDay = { date: string; rows: EquityRow[]; rejected: { symbol: string; reason: string }[] };

/** Main-board equity series: EQ (normal), BE and BZ (trade-for-trade). SME and debt series are excluded. */
export const EQUITY_SERIES = ['EQ', 'BE', 'BZ'];
export const CM_UDIFF_FROM = '2024-07-08';
const ARCHIVE = 'https://nsearchives.nseindia.com/content';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function cmBhavcopyUrl(date: string): string {
  const [y, m, d] = date.split('-');
  if (date >= CM_UDIFF_FROM) return `${ARCHIVE}/cm/BhavCopy_NSE_CM_0_0_0_${y}${m}${d}_F_0000.csv.zip`;
  const mon = MONTHS[Number(m) - 1];
  return `${ARCHIVE}/historical/EQUITIES/${y}/${mon}/cm${d}${mon}${y}bhav.csv.zip`;
}

function table(csv: string, required: string[]) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.trim().toUpperCase());
  const col = Object.fromEntries(required.map((name) => {
    const i = header.indexOf(name.toUpperCase());
    if (i < 0) throw new Error(`NSE equity file format changed: column "${name}" not found`);
    return [name, i];
  }));
  return lines.slice(1).map(splitCsvLine).map((cells) => (name: string) => (cells[col[name]] ?? '').trim());
}

const num = (s: string) => (s === '' ? NaN : Number(s.replaceAll(',', '')));

function check(r: EquityRow): string | null {
  for (const [k, v] of Object.entries({ open: r.open, high: r.high, low: r.low, close: r.close, prevClose: r.prevClose })) {
    if (!Number.isFinite(v) || v <= 0) return `${k} is not a positive price (${v})`;
  }
  if (!Number.isFinite(r.volume) || r.volume < 0) return `volume invalid (${r.volume})`;
  if (r.high < Math.max(r.open, r.close, r.low) || r.low > Math.min(r.open, r.close)) return `high/low inconsistent (O ${r.open} H ${r.high} L ${r.low} C ${r.close})`;
  if (!/^IN[A-Z0-9]{10}$/.test(r.isin)) return `ISIN invalid (${r.isin})`;
  return null;
}

function collect(date: string, rows: EquityRow[]): EquityDay {
  const day: EquityDay = { date, rows: [], rejected: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    if (!EQUITY_SERIES.includes(r.series)) continue;
    const reason = check(r) ?? (seen.has(r.symbol) ? 'symbol listed twice' : null);
    if (reason) day.rejected.push({ symbol: r.symbol, reason });
    else { day.rows.push(r); seen.add(r.symbol); }
  }
  return day;
}

/** UDiFF layout (8 Jul 2024 onwards). */
export function parseUdiffCm(csv: string, date: string): EquityDay {
  const rows = table(csv, ['TckrSymb', 'ISIN', 'SctySrs', 'OpnPric', 'HghPric', 'LwPric', 'ClsPric', 'PrvsClsgPric', 'TtlTradgVol', 'TtlNbOfTxsExctd']);
  return collect(date, rows.map((get) => ({
    symbol: get('TckrSymb'), isin: get('ISIN'), series: get('SctySrs'),
    open: num(get('OpnPric')), high: num(get('HghPric')), low: num(get('LwPric')), close: num(get('ClsPric')), prevClose: num(get('PrvsClsgPric')),
    volume: num(get('TtlTradgVol')), trades: Number.isFinite(num(get('TtlNbOfTxsExctd'))) ? num(get('TtlNbOfTxsExctd')) : null,
  })));
}

/** Old layout (before 8 Jul 2024). */
export function parseOldCm(csv: string, date: string): EquityDay {
  const rows = table(csv, ['SYMBOL', 'SERIES', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'PREVCLOSE', 'TOTTRDQTY', 'TOTALTRADES', 'ISIN']);
  return collect(date, rows.map((get) => ({
    symbol: get('SYMBOL'), isin: get('ISIN'), series: get('SERIES'),
    open: num(get('OPEN')), high: num(get('HIGH')), low: num(get('LOW')), close: num(get('CLOSE')), prevClose: num(get('PREVCLOSE')),
    volume: num(get('TOTTRDQTY')), trades: Number.isFinite(num(get('TOTALTRADES'))) ? num(get('TOTALTRADES')) : null,
  })));
}
