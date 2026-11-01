import { FEED_URL, feedFetch } from './feed';

export type IndexCard = { symbol: string; date: string; open: number; high: number; low: number; close: number; prevClose: number | null; change: number | null; changePct: number | null };
export type StockMove = { symbol: string; close: number; changePct: number };
export type Breadth = { advances: number; declines: number; unchanged: number; members: number; notTraded: string[] };
export type FiiPositions = { date: string; futLong: number; futShort: number; callLong: number; callShort: number; putLong: number; putShort: number };
export type Overview = {
  asOf: string;
  indices: IndexCard[];
  nifty50: { listFetched: string; breadth: Breadth; gainers: StockMove[]; losers: StockMove[] } | null;
  nifty500: { listFetched: string; breadth: Breadth } | null;
  fii: { latest: FiiPositions; previous: FiiPositions | null } | null;
  fpi: { reportDate: string; netCr: number } | null;
  sources: Record<string, string>;
};

export async function fetchOverview(signal?: AbortSignal): Promise<Overview> {
  const res = await feedFetch(`${FEED_URL}/api/dashboard`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Market overview unavailable');
  return body as Overview;
}
