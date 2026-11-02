// Market-wide views: sector rotation and breadth, from NSE's official index closes and the corporate-action
// adjusted daily closes of index members. Cached per latest trading day.

import { dailyHistory, eodLoaded, indexCloses, onEodReady } from '../eod/store';
import { LISTS, candleDate, indexMembers, type IndexList } from '../research/overview';
import { breadthByDay, breadthSnapshot, type DayClose } from './breadth';
import { RRG_PARAMS, quadrant, rrg, weekly, type RrgPoint } from './rrg';

/** NSE sectoral and thematic indices shown on the rotation chart (names as in NSE's index-close file). */
export const RRG_SECTORS = [
  'NIFTY AUTO', 'NIFTY BANK', 'NIFTY FINANCIAL SERVICES', 'NIFTY PRIVATE BANK', 'NIFTY PSU BANK', 'NIFTY IT', 'NIFTY FMCG', 'NIFTY METAL',
  'NIFTY PHARMA', 'NIFTY HEALTHCARE INDEX', 'NIFTY REALTY', 'NIFTY MEDIA', 'NIFTY ENERGY', 'NIFTY OIL & GAS', 'NIFTY CONSUMER DURABLES',
  'NIFTY INFRASTRUCTURE', 'NIFTY COMMODITIES', 'NIFTY PSE', 'NIFTY CPSE', 'NIFTY MNC', 'NIFTY INDIA CONSUMPTION', 'NIFTY CAPITAL MARKETS',
  'NIFTY INDIA DEFENCE', 'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100',
] as const;
export const RRG_BENCHMARKS = ['NIFTY 50', 'NIFTY 500'] as const;
export const BREADTH_INDICES = Object.keys(LISTS) as IndexList[];

const latest = () => indexCloses('NIFTY 50').at(-1)?.date ?? '';

const rrgCache = new Map<string, unknown>();
/** The last `points` rotation points of every sector against `bench`, daily or weekly. */
export function rotation(tf: 'D' | 'W', bench: string, points = 60) {
  const key = `${latest()}|${tf}|${bench}|${points}`;
  if (rrgCache.has(key)) return rrgCache.get(key);
  const series = (name: string) => (tf === 'W' ? weekly(indexCloses(name)) : indexCloses(name));
  const b = series(bench);
  const sectors = RRG_SECTORS.map((name) => {
    const pts: RrgPoint[] = rrg(series(name), b, RRG_PARAMS[tf]).slice(-points);
    return { name, points: pts.map((p) => ({ ...p, rsRatio: round(p.rsRatio), rsMomentum: round(p.rsMomentum) })), quadrant: pts.length ? quadrant(pts[pts.length - 1]) : null };
  }).filter((s) => s.points.length);
  const body = { tf, bench, asOf: latest(), sectors };
  rrgCache.clear();
  rrgCache.set(key, body);
  return body;
}
const round = (v: number) => Math.round(v * 1000) / 1000;

// ---- breadth ----
const closesCache: { key: string; bySymbol: Map<string, DayClose[]> } = { key: '', bySymbol: new Map() };
/** A member's adjusted daily closes (cached for the current trading day). */
function memberCloses(symbol: string): DayClose[] {
  if (closesCache.key !== latest()) { closesCache.key = latest(); closesCache.bySymbol.clear(); }
  let c = closesCache.bySymbol.get(symbol);
  if (!c) {
    c = (dailyHistory(symbol)?.candles ?? []).map((k) => ({ date: candleDate(k), close: k.close }));
    closesCache.bySymbol.set(symbol, c);
  }
  return c;
}

/** Breadth of one index over its last `days` sessions, with its level, today's snapshot and the members' moves. */
export async function indexBreadth(index: IndexList, days: number) {
  const list = await indexMembers(index);
  const members = new Map(list.symbols.map((s) => [s, memberCloses(s)] as const));
  const level = indexCloses(index);
  const dates = level.slice(-days).map((l) => l.date);
  const asOf = dates.at(-1) ?? latest();
  const moves = list.symbols.flatMap((s) => {
    const c = members.get(s)!;
    const i = c.findIndex((x) => x.date === asOf);
    return i > 0 ? [{ symbol: s, close: c[i].close, changePct: ((c[i].close - c[i - 1].close) / c[i - 1].close) * 100 }] : [];
  }).sort((a, b) => b.changePct - a.changePct);
  return {
    index, asOf, listFetched: list.fetched, members: list.symbols.length,
    level: level.slice(-days),
    days: breadthByDay(members, dates),
    snapshot: breadthSnapshot(members, asOf),
    moves,
  };
}

let allCache: { key: string; body: unknown } | null = null;
/** Today's breadth of every index we have a constituent list for. */
export async function allBreadth() {
  if (allCache?.key === latest()) return allCache.body;
  const rows = [];
  for (const index of BREADTH_INDICES) {
    try {
      const b = await indexBreadth(index, 2);
      const lv = b.level, d = b.days.at(-1);
      rows.push({
        index, members: b.members, asOf: b.asOf,
        close: lv.at(-1)?.close ?? null, changePct: lv.length > 1 ? ((lv[1].close - lv[0].close) / lv[0].close) * 100 : null,
        advances: d?.advances ?? 0, declines: d?.declines ?? 0, unchanged: d?.unchanged ?? 0,
        aboveSma50: b.snapshot.aboveSma50, aboveSma200: b.snapshot.aboveSma200, withSma200: b.snapshot.withSma200, traded: b.snapshot.traded,
        newHighs: b.snapshot.newHighs, newLows: b.snapshot.newLows,
      });
    } catch { /* a list NSE did not serve today is skipped, never guessed */ }
  }
  const body = { asOf: latest(), rows };
  allCache = { key: latest(), body };
  return body;
}

/**
 * Computes the all-index breadth table once the NSE history is loaded and after each day's download, so the first
 * visitor doesn't wait for ~30 constituent lists and ~700 histories.
 */
export function warmMarketViews(log: (m: string) => void) {
  const warm = () => allBreadth().then(() => log('Market breadth ready'), (e) => log(`Market breadth warm-up failed: ${(e as Error).message}`));
  const t = setInterval(() => { if (eodLoaded()) { clearInterval(t); void warm(); } }, 5000);
  onEodReady(() => warm());
}
