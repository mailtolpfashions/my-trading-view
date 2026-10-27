import { FEED_URL, feedFetch } from './feed';

export type BuildUp = 'long-buildup' | 'short-buildup' | 'short-covering' | 'long-unwinding' | 'neutral';

export type FuturesDay = {
  date: string;
  spotPaise: number | null;
  near: {
    expiry: string; closePaise: number; oi: number; volume: number; traded: boolean;
    changePaise: number | null; oiChange: number | null; basisPaise: number | null; premiumPct: number | null; carryPct: number | null;
    daysToExpiry: number; buildUp: BuildUp;
  } | null;
  totalOi: number;
  totalOiChange: number | null;
  rolloverPct: number | null;
};

export type LiveFutures = {
  underlying: string; asOf: number; spotPaise: number | null; lot: number | null; totalOi: number; rolloverPct: number | null;
  contracts: {
    expiry: string; ltpPaise: number; prevClosePaise: number; oi: number; volume: number; changePaise: number | null; oiChange: number | null;
    oiBaseDate: string | null; buildUp: BuildUp; basisPaise: number | null; premiumPct: number | null; carryPct: number | null; daysToExpiry: number;
  }[];
};

export class FuturesAccessError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new FuturesAccessError(body.message ?? fallback, body.error ?? 'failed');
  return body as T;
}

export const fetchFuturesHistory = async (underlying: string, days: number) =>
  json<{ underlying: string; days: FuturesDay[] }>(await feedFetch(`${FEED_URL}/api/futures/history?underlying=${underlying}&days=${days}`), 'Futures history unavailable');
export const fetchLiveFutures = async (underlying: string) => json<LiveFutures>(await feedFetch(`${FEED_URL}/api/futures/live?underlying=${underlying}`), 'Live futures unavailable');

export const BUILD_UP: Record<BuildUp, { label: string; hint: string; tone: 'up' | 'up-soft' | 'down' | 'down-soft' | 'neutral' }> = {
  'long-buildup': { label: 'Long build-up', hint: 'Price up, open interest up: new buying', tone: 'up' },
  'short-covering': { label: 'Short covering', hint: 'Price up, open interest down: shorts closing', tone: 'up-soft' },
  'short-buildup': { label: 'Short build-up', hint: 'Price down, open interest up: new selling', tone: 'down' },
  'long-unwinding': { label: 'Long unwinding', hint: 'Price down, open interest down: longs closing', tone: 'down-soft' },
  neutral: { label: 'Neutral', hint: 'Price or open interest unchanged', tone: 'neutral' },
};
