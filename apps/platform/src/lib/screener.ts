// Shapes of the data service's screener answers, and the screen being edited.

import { parseFormula, print, timeframesOf, type Node, type Tf } from '@mtv/rules';

export type UniverseSpec =
  | { kind: 'all' }
  | { kind: 'index'; name: string }
  | { kind: 'fno' }
  | { kind: 'symbols'; symbols: string[]; label?: string }
  | { kind: 'watchlist'; id: string };

export type UniverseFilters = { minPrice?: number; maxPrice?: number; minAvgValueCr?: number; minHistory?: number; industries?: string[] };

export type Screen = {
  /** Set once the screen is saved. */
  id?: string;
  name: string;
  category: 'technical' | 'fundamental' | 'fno' | 'custom';
  formula: string;
  tf: Tf;
  candle: 'closed' | 'live';
  universe: UniverseSpec;
  filters: UniverseFilters;
  columns: string[];
};

export type ScreenRow = {
  symbol: string; name: string; industry: string | null; close: number; changePct: number | null; volume: number;
  avgValueCr: number | null; lowLiquidity: boolean; dataBreak: string | null; barDate: string;
  columns: (number | null)[]; conditions: { formula: string; value: number | null }[];
};

export type ScreenResult = {
  asOf: string | null; tf: Tf; formula: string; columns: string[]; candle: 'closed' | 'live'; eligible: number;
  scanned: number; matches: number; rows: ScreenRow[]; complete: boolean; excluded: { reason: string; count: number }[]; ms: number;
};

export type Param = { name: string; kind: 'series' | 'bool' | 'int' | 'number' | { oneOf: string[] }; def?: number | string };
export type Meta = {
  timeframes: Tf[];
  fields: { name: string; summary: string }[];
  functions: { name: string; group: string; returns: 'num' | 'bool'; params: Param[]; summary: string }[];
  presets: { id: string; name: string; category: string; tf: Tf; formula: string; about: string }[];
  library: { group: string; items: { label: string; formula: string }[] }[];
  indices: string[];
  industries: string[];
};

export const TF_LABEL: Record<string, string> = { '1m': '1 minute', '3m': '3 minutes', '5m': '5 minutes', '15m': '15 minutes', '30m': '30 minutes', '1h': '1 hour', '2h': '2 hours', '4h': '4 hours', D: 'Daily', W: 'Weekly', M: 'Monthly' };
export const INTRADAY_OPTIONS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'] as const;

/** Default result columns (spec 8.2): relative volume, RSI and the 20 / 50 EMAs; the rest are fixed columns. */
export const DEFAULT_COLUMNS = ['RVOL(20)', 'RSI(CLOSE, 14)', 'EMA(CLOSE, 20)', 'EMA(CLOSE, 50)'];

export const NEW_SCREEN: Screen = {
  name: 'Untitled screen', category: 'technical', formula: 'CLOSE > EMA(CLOSE, 50) AND RSI(CLOSE, 14) > 55', tf: 'D', candle: 'closed',
  universe: { kind: 'all' }, filters: { minAvgValueCr: 1 }, columns: DEFAULT_COLUMNS,
};

/** A short readable name for a column formula: RSI(CLOSE, 14) → RSI 14, EMA(CLOSE, 20) → EMA 20. */
export function columnLabel(f: string): string {
  const m = /^([A-Z_]+)\((?:CLOSE, )?([^)]*)\)$/.exec(f);
  return m ? `${m[1].replace(/_/g, ' ')} ${m[2].replace(/, /g, '·')}`.trim() : f;
}

// ---- a row's own timeframe ----

/** True when every value in the tree is read on timeframe `tf` (numbers are timeless). */
function fullyOn(n: Node, tf: Tf): boolean {
  switch (n.t) {
    case 'tf': return n.tf === tf;
    case 'num': return true;
    case 'id': case 'call': return false;
    case 'neg': case 'not': case 'ref': return fullyOn(n.a, tf);
    case 'bin': case 'cmp': return fullyOn(n.a, tf) && fullyOn(n.b, tf);
    case 'logic': return n.items.every((x) => fullyOn(x, tf));
  }
}
/** The tree with every [tf] wrapper of that timeframe removed. */
function strip(n: Node, tf: Tf): Node {
  switch (n.t) {
    case 'tf': return n.tf === tf ? strip(n.a, tf) : n;
    case 'neg': case 'not': case 'ref': return { ...n, a: strip(n.a, tf) };
    case 'bin': case 'cmp': return { ...n, a: strip(n.a, tf), b: strip(n.b, tf) };
    case 'logic': return { ...n, items: n.items.map((x) => strip(x, tf)) };
    default: return n;
  }
}

/**
 * A condition row as "timeframe + condition": `[W] RSI(14) > 60` → { tf: 'W', text: 'RSI(CLOSE, 14) > 60' }.
 * tf null = the screen's timeframe; 'mixed' = the row compares values on different timeframes (e.g.
 * CLOSE > [W] HIGH[1]) and is kept exactly as written, since wrapping it in one timeframe would change its meaning.
 */
export function splitRowTf(formula: string): { tf: Tf | null | 'mixed'; text: string } {
  const p = parseFormula(formula);
  if (!p.ok) return { tf: null, text: formula };
  const tfs = [...timeframesOf(p.node)];
  if (!tfs.length) return { tf: null, text: formula };
  if (tfs.length === 1 && fullyOn(p.node, tfs[0])) return { tf: tfs[0], text: print(strip(p.node, tfs[0])) };
  return { tf: 'mixed', text: formula };
}

/** The row back as one formula: the whole condition on its timeframe. */
export function joinRowTf(tf: Tf | null, text: string): string {
  if (!tf || !text.trim()) return text;
  const p = parseFormula(`[${tf}] (${text})`);
  return p.ok ? p.formula : `[${tf}] (${text})`;
}

/** A screen as CSV text, for Excel and Google Sheets. */
export function toCsv(r: ScreenResult): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Symbol', 'Company', 'Industry', 'Close', 'Change %', 'Volume', 'Avg traded value (Rs cr)', ...r.columns, 'Bar date', 'Low liquidity', 'Data break'];
  const lines = r.rows.map((x) => [x.symbol, x.name, x.industry, x.close, x.changePct?.toFixed(2), x.volume, x.avgValueCr?.toFixed(2), ...x.columns.map((v) => (v == null ? '' : +v.toFixed(4))), x.barDate, x.lowLiquidity ? 'yes' : '', x.dataBreak ?? '']);
  return [head, ...lines].map((l) => l.map(esc).join(',')).join('\n');
}
