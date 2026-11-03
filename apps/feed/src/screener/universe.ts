// Which stocks a screen searches: all NSE equity shares that traded on the latest session (the default), an NSE index's
// current members, F&O stocks, or a list (a watchlist or a custom list). Filters on price, liquidity, history length
// and industry are applied from the same history the screen uses, and every exclusion is counted for the user.
// Index membership is NSE's current list, so it is right for today's scan; a scan on a past date needs the members of
// that date (a later step) and must not use this.

import type { DailyHistory } from '../eod/store';
import { allEquityShareSymbols, eodUniverse } from '../eod/store';
import { fnoUnderlyings } from '../fno/analytics';
import { LISTS, indexMemberRows, type IndexList } from '../research/overview';
import { userStore } from '../user/store';

export type UniverseSpec =
  | { kind: 'all' }
  | { kind: 'index'; name: IndexList }
  | { kind: 'fno' }
  | { kind: 'symbols'; symbols: string[]; label?: string }
  | { kind: 'watchlist'; id: string };

export type UniverseFilters = {
  minPrice?: number;
  maxPrice?: number;
  /** Minimum average traded value of the last 20 sessions, ₹ crore. */
  minAvgValueCr?: number;
  /** Minimum sessions of history. */
  minHistory?: number;
  /** NSE industry names, as in the index lists (e.g. "Capital Goods"). */
  industries?: string[];
};

export type StockInfo = { company: string; industry: string };

/** Company names and industries from NSE's NIFTY 500 list (refreshed daily); other stocks have none. */
let infoCache: { at: number; map: Map<string, StockInfo> } | null = null;
export async function stockInfo(): Promise<Map<string, StockInfo>> {
  if (infoCache && Date.now() - infoCache.at < 6 * 3600_000) return infoCache.map;
  const map = new Map<string, StockInfo>();
  try {
    for (const r of await indexMemberRows('NIFTY 500')) map.set(r.symbol, { company: r.company, industry: r.industry });
  } catch { /* offline with no cached copy: names fall back to NSE's equity list, industry stays empty */ }
  infoCache = { at: Date.now(), map };
  return map;
}

export const UNIVERSE_INDICES = Object.keys(LISTS) as IndexList[];

/**
 * The stocks of a universe. `includeDelisted` (backtests): "all" also takes stocks no longer traded, since leaving out
 * companies that later failed would make past results look better than they were.
 */
export async function baseSymbols(spec: UniverseSpec, includeDelisted = false): Promise<string[]> {
  const shares = new Set(allEquityShareSymbols());
  const traded = eodUniverse().filter((s) => shares.has(s));
  switch (spec.kind) {
    case 'all': return includeDelisted ? [...shares] : traded;
    case 'index': {
      if (!(spec.name in LISTS)) throw new Error(`Unknown index ${spec.name}`);
      return (await indexMemberRows(spec.name)).map((r) => r.symbol);
    }
    case 'fno': return (await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol);
    case 'symbols': return [...new Set(spec.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 5000);
    case 'watchlist': {
      const w = await userStore.watchlist(spec.id);
      if (!w) throw new Error('That watchlist no longer exists');
      return w.symbols;
    }
  }
}

export async function resolveUniverse(spec: UniverseSpec, f: UniverseFilters, history: (s: string) => DailyHistory | null) {
  const info = await stockInfo();
  const excluded = new Map<string, number>();
  const drop = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  const industries = f.industries?.length ? new Set(f.industries) : null;
  const symbols: string[] = [];
  for (const s of await baseSymbols(spec)) {
    const h = history(s);
    if (!h?.candles.length) { drop('No NSE history held'); continue; }
    const c = h.candles, last = c[c.length - 1];
    if (f.minPrice != null && last.close < f.minPrice) { drop('Price below the minimum'); continue; }
    if (f.maxPrice != null && last.close > f.maxPrice) { drop('Price above the maximum'); continue; }
    if (f.minHistory != null && c.length < f.minHistory) { drop('Too little history'); continue; }
    if (f.minAvgValueCr != null) {
      const r = c.slice(-20);
      const avg = r.reduce((a, b) => a + b.close * b.volume, 0) / r.length / 1e7;
      if (avg < f.minAvgValueCr) { drop('Traded value below the minimum'); continue; }
    }
    if (industries && !industries.has(info.get(s)?.industry ?? '')) { drop('Other industry'); continue; }
    symbols.push(s);
  }
  return { symbols, info, excluded: [...excluded].map(([reason, count]) => ({ reason, count })) };
}

/** Industry names present in the NIFTY 500 list, for the filter picker. */
export async function industries(): Promise<string[]> {
  return [...new Set([...(await stockInfo()).values()].map((v) => v.industry).filter(Boolean))].sort();
}
