import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Instrument } from '@mtv/shared';

/** Indices we support, with their Yahoo tickers and their names in NSE's official index-close file. */
export const INDICES: (Instrument & { yahoo: string; nseName?: string })[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE', kind: 'INDEX', yahoo: '^NSEI', nseName: 'NIFTY 50' },
  { symbol: 'BANKNIFTY', name: 'NIFTY Bank', exchange: 'NSE', kind: 'INDEX', yahoo: '^NSEBANK', nseName: 'NIFTY BANK' },
  { symbol: 'FINNIFTY', name: 'NIFTY Financial Services', exchange: 'NSE', kind: 'INDEX', yahoo: 'NIFTY_FIN_SERVICE.NS', nseName: 'NIFTY FINANCIAL SERVICES' },
  { symbol: 'MIDCPNIFTY', name: 'NIFTY Midcap Select', exchange: 'NSE', kind: 'INDEX', yahoo: 'NIFTY_MID_SELECT.NS', nseName: 'NIFTY MIDCAP SELECT' },
  { symbol: 'NIFTYNXT50', name: 'NIFTY Next 50', exchange: 'NSE', kind: 'INDEX', yahoo: '^NSMIDCP', nseName: 'NIFTY NEXT 50' },
  { symbol: 'NIFTYIT', name: 'NIFTY IT', exchange: 'NSE', kind: 'INDEX', yahoo: '^CNXIT', nseName: 'NIFTY IT' },
  { symbol: 'INDIAVIX', name: 'India VIX', exchange: 'NSE', kind: 'INDEX', yahoo: '^INDIAVIX', nseName: 'INDIA VIX' },
  { symbol: 'SENSEX', name: 'S&P BSE SENSEX', exchange: 'BSE', kind: 'INDEX', yahoo: '^BSESN' }, // BSE index: not in NSE's files
];

const EQUITY_LIST_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
const CACHE_FILE = path.resolve(import.meta.dirname, '../.cache/EQUITY_L.csv');
const DAY_MS = 24 * 3600 * 1000;

let equities: Instrument[] = [];

/** Parses NSE's public equity list (SYMBOL, NAME OF COMPANY, SERIES, ...). Keeps EQ and BE series. */
export function parseEquityList(csv: string): Instrument[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(','))
    .filter((cols) => cols.length >= 3 && ['EQ', 'BE'].includes(cols[2].trim()))
    .map(([symbol, name]) => ({ symbol: symbol.trim(), name: name.trim(), exchange: 'NSE' as const, kind: 'EQUITY' as const }));
}

/** Loads the NSE equity list, refreshing the on-disk copy once a day. Falls back to a stale copy if NSE is unreachable. */
export async function loadEquities(log: (msg: string) => void): Promise<void> {
  const fresh = await stat(CACHE_FILE).then((s) => Date.now() - s.mtimeMs < DAY_MS, () => false);
  if (!fresh) {
    try {
      const res = await fetch(EQUITY_LIST_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await writeFile(CACHE_FILE, await res.text());
    } catch (e) {
      log(`Equity list download failed (${(e as Error).message}); using cached copy if present`);
    }
  }
  const csv = await readFile(CACHE_FILE, 'utf8').catch(() => '');
  equities = parseEquityList(csv);
  log(`Loaded ${equities.length} NSE equities`);
}

/** Every NSE equity symbol in the current list. */
export const allEquitySymbols = () => equities.map((e) => e.symbol);

export function findInstrument(symbol: string): Instrument | undefined {
  const s = symbol.toUpperCase();
  return INDICES.find((i) => i.symbol === s) ?? equities.find((e) => e.symbol === s);
}

export function yahooTicker(symbol: string): string {
  const idx = INDICES.find((i) => i.symbol === symbol);
  return idx ? idx.yahoo : `${symbol}.NS`;
}

/** Symbol search: exact symbol, then symbol prefix, then name matches. */
export function searchInstruments(query: string, limit = 20, list: Instrument[] = [...INDICES, ...equities]): Instrument[] {
  const q = query.trim().toUpperCase();
  if (!q) return list.slice(0, limit);
  const rank = (i: Instrument) => {
    if (i.symbol === q) return 0;
    if (i.symbol.startsWith(q)) return 1;
    if (i.name.toUpperCase().startsWith(q)) return 2;
    if (i.symbol.includes(q) || i.name.toUpperCase().includes(q)) return 3;
    return -1;
  };
  return list
    .map((i) => ({ i, r: rank(i) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || (a.i.kind === 'INDEX' ? -1 : 0) - (b.i.kind === 'INDEX' ? -1 : 0) || a.i.symbol.length - b.i.symbol.length)
    .slice(0, limit)
    .map((x) => ({ symbol: x.i.symbol, name: x.i.name, exchange: x.i.exchange, kind: x.i.kind }));
}
