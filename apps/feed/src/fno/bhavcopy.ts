// NSE F&O end-of-day files ("F&O bhavcopy"): the exchange's official daily record of every futures and options
// contract. Two layouts exist: UDiFF (from 8 Jul 2024) and the older CSV. Both are parsed by header name and fail
// loudly on format changes.
//
// Accuracy notes:
// - A contract with no trades that day still has a "close" (carried forward). `traded` marks real trading, and
//   backtests must not fill at an untraded close.
// - The old layout has no lot size and no underlying price; see deriveLotSize and the index-close file.
// - Open interest is in shares (shares / lot size = contracts); volume is in contracts, in both layouts (UDiFF
//   turnover ÷ volume ÷ price = the lot size).

import { splitCsvLine } from '../official/nse-files';

/** Underlyings every NSE F&O file must contain since 2011; a file without them is broken. */
export const CORE_UNDERLYINGS = ['NIFTY', 'BANKNIFTY'] as const;
/** NSE's F&O symbol: an index (NIFTY, FINNIFTY, …) or a stock (RELIANCE, …). */
export type FnoUnderlying = string;
/** 'index': index futures and options only. 'all': stock futures and options too. */
export type FnoScope = 'index' | 'all';

export type FnoRow = {
  underlying: FnoUnderlying;
  kind: 'FUT' | 'CE' | 'PE';
  expiry: string; // YYYY-MM-DD
  strike: number | null; // rupees; null for futures
  open: number;
  high: number;
  low: number;
  close: number;
  settle: number;
  oi: number;
  volume: number; // contracts traded
  traded: boolean;
};

export type FnoDay = {
  date: string;
  rows: FnoRow[];
  /**
   * Lot size of the nearest expiry. From UDiFF directly; for the old layout derived from futures turnover (null when
   * ambiguous). When NSE revises a lot size, contracts already listed keep the old lot and new ones get the new lot,
   * so a day's file can carry both: see lotByExpiry.
   */
  lotSize: Record<FnoUnderlying, number | null>;
  /** UDiFF only: lot size of each expiry, as stated on its contracts. */
  lotByExpiry?: Record<FnoUnderlying, Record<string, number>>;
  /** Underlying price from UDiFF (null for the old layout: use NSE's index-close file). */
  spot: Record<FnoUnderlying, number | null>;
  /** Underlyings that are indices (the rest are stocks). */
  indices: Set<FnoUnderlying>;
};

const ARCHIVE = 'https://nsearchives.nseindia.com/content';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const UDIFF_FROM = '2024-07-08';

export function fnoBhavcopyUrl(date: string): string {
  const [y, m, d] = date.split('-');
  if (date >= UDIFF_FROM) return `${ARCHIVE}/fo/BhavCopy_NSE_FO_0_0_0_${y}${m}${d}_F_0000.csv.zip`;
  const mon = MONTHS[Number(m) - 1];
  return `${ARCHIVE}/historical/DERIVATIVES/${y}/${mon}/fo${d}${mon}${y}bhav.csv.zip`;
}

function table(csv: string, required: string[]) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.trim().toUpperCase());
  const col = Object.fromEntries(required.map((name) => {
    const i = header.indexOf(name.toUpperCase());
    if (i < 0) throw new Error(`NSE F&O file format changed: column "${name}" not found`);
    return [name, i];
  }));
  return lines.slice(1).map(splitCsvLine).map((cells) => (name: string) => (cells[col[name]] ?? '').trim());
}

const num = (s: string) => (s === '' ? 0 : Number(s.replaceAll(',', '')));

function oldDate(s: string): string {
  // 29-Jun-2023 -> 2023-06-29
  const [d, mon, y] = s.split('-');
  const m = MONTHS.indexOf(mon.toUpperCase()) + 1;
  if (!m) throw new Error(`Unrecognised expiry date ${s}`);
  return `${y}-${String(m).padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function checkRow(r: FnoRow) {
  for (const v of [r.open, r.high, r.low, r.close, r.settle, r.oi, r.volume]) if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid number in F&O row ${JSON.stringify(r)}`);
  // Only high >= low and the open inside that range are checked. NSE's F&O close is not a traded price (futures: the
  // last half-hour average, or a theoretical price when few trades), so it can lie outside the day's range; and a
  // contract can show trades with no open/high/low (23 Oct 2026, KAYNES December future).
  if (r.traded && r.high > 0 && (r.high < r.low || (r.open > 0 && (r.open > r.high || r.open < r.low)))) throw new Error(`Inconsistent OHLC in F&O row ${JSON.stringify(r)}`);
}

/** UDiFF layout (8 Jul 2024 onwards). Index options IDO, index futures IDF, stock options STO, stock futures STF. */
export function parseUdiffFo(csv: string, date: string, scope: FnoScope = 'index'): FnoDay {
  const rows = table(csv, ['FinInstrmTp', 'TckrSymb', 'XpryDt', 'StrkPric', 'OptnTp', 'OpnPric', 'HghPric', 'LwPric', 'ClsPric', 'SttlmPric', 'OpnIntrst', 'TtlTradgVol', 'UndrlygPric', 'NewBrdLotQty']);
  const day: FnoDay = { date, rows: [], lotSize: {}, spot: {}, indices: new Set(), lotByExpiry: {} };
  for (const get of rows) {
    const tp = get('FinInstrmTp'), sym = get('TckrSymb');
    const index = tp === 'IDO' || tp === 'IDF';
    if (!index && !(scope === 'all' && (tp === 'STO' || tp === 'STF'))) continue;
    const fut = tp === 'IDF' || tp === 'STF';
    const volume = num(get('TtlTradgVol'));
    const row: FnoRow = {
      underlying: sym,
      kind: fut ? 'FUT' : (get('OptnTp') as 'CE' | 'PE'),
      expiry: get('XpryDt'),
      strike: fut ? null : num(get('StrkPric')),
      open: num(get('OpnPric')), high: num(get('HghPric')), low: num(get('LwPric')), close: num(get('ClsPric')),
      settle: num(get('SttlmPric')), oi: num(get('OpnIntrst')), volume, traded: volume > 0,
    };
    if (row.kind !== 'FUT' && row.kind !== 'CE' && row.kind !== 'PE') throw new Error(`Unknown option type ${get('OptnTp')}`);
    checkRow(row);
    day.rows.push(row);
    if (index) day.indices.add(sym);
    const lot = num(get('NewBrdLotQty')), spot = num(get('UndrlygPric'));
    if (lot > 0) (day.lotByExpiry![sym] ??= {})[row.expiry] = lot;
    if (spot > 0) day.spot[sym] = spot;
  }
  // The day's lot size is the nearest live expiry's (the most traded contracts).
  for (const [sym, byExpiry] of Object.entries(day.lotByExpiry!)) {
    const near = Object.keys(byExpiry).filter((e) => e >= date).sort()[0] ?? Object.keys(byExpiry).sort().at(-1)!;
    day.lotSize[sym] = byExpiry[near];
  }
  return day;
}

/**
 * Old layout (before 8 Jul 2024). OPTIDX / FUTIDX, and OPTSTK / FUTSTK with scope 'all'. No lot size or underlying
 * price in the file. Stock lot sizes are not derived (they are not from a fixed list), so they stay null: flagged.
 */
export function parseOldFo(csv: string, date: string, scope: FnoScope = 'index'): FnoDay {
  const rows = table(csv, ['INSTRUMENT', 'SYMBOL', 'EXPIRY_DT', 'STRIKE_PR', 'OPTION_TYP', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'SETTLE_PR', 'CONTRACTS', 'VAL_INLAKH', 'OPEN_INT']);
  const day: FnoDay = { date, rows: [], lotSize: {}, spot: {}, indices: new Set() };
  const futTurnover: Record<FnoUnderlying, { contracts: number; lakh: number; price: number }> = {};
  for (const get of rows) {
    const inst = get('INSTRUMENT'), sym = get('SYMBOL');
    const index = inst === 'OPTIDX' || inst === 'FUTIDX';
    if (!index && !(scope === 'all' && (inst === 'OPTSTK' || inst === 'FUTSTK'))) continue;
    const fut = inst === 'FUTIDX' || inst === 'FUTSTK';
    const contracts = num(get('CONTRACTS'));
    const row: FnoRow = {
      underlying: sym,
      kind: fut ? 'FUT' : (get('OPTION_TYP') as 'CE' | 'PE'),
      expiry: oldDate(get('EXPIRY_DT')),
      strike: fut ? null : num(get('STRIKE_PR')),
      open: num(get('OPEN')), high: num(get('HIGH')), low: num(get('LOW')), close: num(get('CLOSE')),
      settle: num(get('SETTLE_PR')), oi: num(get('OPEN_INT')), volume: contracts, traded: contracts > 0,
    };
    if (row.kind !== 'FUT' && row.kind !== 'CE' && row.kind !== 'PE') throw new Error(`Unknown option type ${get('OPTION_TYP')}`);
    checkRow(row);
    day.rows.push(row);
    if (index) day.indices.add(sym);
    // The most traded futures contract gives the cleanest lot-size estimate.
    if (index && row.kind === 'FUT' && contracts > (futTurnover[sym]?.contracts ?? 0)) futTurnover[sym] = { contracts, lakh: num(get('VAL_INLAKH')), price: row.close };
  }
  for (const sym of new Set(day.rows.map((r) => r.underlying))) {
    const t = futTurnover[sym];
    day.lotSize[sym] = t ? deriveLotSize(t.lakh * 1e5, t.contracts, t.price) : null;
    day.spot[sym] = null;
  }
  return day;
}

/** Lot sizes NSE has used for index derivatives; the derived value must snap to one of these. */
export const KNOWN_LOT_SIZES = [10, 15, 20, 25, 30, 35, 40, 50, 60, 65, 75, 100, 120, 140];

/**
 * Lot size from futures turnover: value / (contracts × price) ≈ lot. Futures trade within a few percent of their
 * close during a day, so the estimate lands close to the true lot. Returns null unless exactly one known lot size
 * is within 3%, so an ambiguous day is flagged rather than guessed.
 */
export function deriveLotSize(valueRupees: number, contracts: number, price: number): number | null {
  if (!(valueRupees > 0 && contracts > 0 && price > 0)) return null;
  const est = valueRupees / (contracts * price);
  const near = KNOWN_LOT_SIZES.filter((l) => Math.abs(est - l) / l <= 0.03);
  return near.length === 1 ? near[0] : null;
}
