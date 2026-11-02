'use client';

import { useEffect, useState } from 'react';
import type { Candle, DataQuality, DataStatus, Instrument, Quote, Timeframe } from '@mtv/shared';

const CONFIGURED_FEED = process.env.NEXT_PUBLIC_FEED_URL ?? 'http://localhost:4001';
const LOCAL = /^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/;
/**
 * The data service. When it is configured as localhost but this page was opened from another device on the same
 * network (e.g. a phone at http://192.168.x.x:3000), localhost would mean the phone, so use the page's own host.
 */
export const FEED_URL = typeof window !== 'undefined' && LOCAL.test(CONFIGURED_FEED) && !['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? CONFIGURED_FEED.replace(LOCAL, `$1${window.location.hostname}`)
  : CONFIGURED_FEED;

// ---- feed access token (issued by our server for the signed-in user; refreshed before it expires) ----
let cached: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;

export async function feedToken(): Promise<string> {
  if (cached && cached.exp - 60 > Date.now() / 1000) return cached.token;
  inflight ??= fetch('/api/feed-token', { cache: 'no-store' })
    .then(async (r) => {
      if (r.status === 401) { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; throw new Error('Signed out'); }
      if (!r.ok) throw new Error('Could not authorise the market data feed');
      cached = (await r.json()) as { token: string; exp: number };
      return cached.token;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * fetch() to the feed service with the user's access token. While the feed is still loading its NSE history (just
 * after it starts) it answers 503 "loading": wait and ask again, for up to two minutes, rather than show partial data.
 */
export async function feedFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await feedToken();
    const res = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
    reportVisitorRuns(res);
    if (res.status !== 503 || attempt >= 40) return res;
    const body = await res.clone().json().catch(() => ({}));
    if (body.error !== 'loading') return res;
    await new Promise((r) => setTimeout(r, 3000));
    if (init?.signal?.aborted) return res;
  }
}

/** Visitors (not signed in) get a few free runs a day; the feed says how many are left on each counted run. */
export type VisitorRuns = { remaining: number; limitReached: boolean };
export const VISITOR_RUNS_EVENT = 'mtv:visitor-runs';
function reportVisitorRuns(res: Response) {
  const left = res.headers.get('X-Visitor-Remaining');
  if (left === null || typeof window === 'undefined') return;
  const detail: VisitorRuns = { remaining: Number(left), limitReached: res.status === 429 };
  window.dispatchEvent(new CustomEvent<VisitorRuns>(VISITOR_RUNS_EVENT, { detail }));
}

export type CandleResponse = { instrument: Instrument; tf: Timeframe; status: DataStatus; quality: DataQuality; candles: Candle[] };

export async function fetchCandles(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<CandleResponse> {
  const res = await feedFetch(`${FEED_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { signal });
  if (!res.ok) throw new Error(res.status === 404 ? `No data for ${symbol}` : 'Market data is unavailable right now');
  return res.json();
}

export async function searchSymbols(q: string, signal?: AbortSignal): Promise<Instrument[]> {
  const res = await feedFetch(`${FEED_URL}/api/search?q=${encodeURIComponent(q)}`, { signal });
  return res.ok ? res.json() : [];
}

/**
 * Last NSE close for `symbols` (no live prices on this site): fetched when the list changes. Each quote's `time` is
 * its trading day; `asOf` is the latest trading day held.
 */
export function useCloses(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [error, setError] = useState(false);
  const key = [...new Set(symbols)].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    feedFetch(`${FEED_URL}/api/quotes?symbols=${encodeURIComponent(key)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Quote[]>) : Promise.reject(new Error(String(r.status)))))
      .then((list) => { setError(false); setQuotes((prev) => ({ ...prev, ...Object.fromEntries(list.map((q) => [q.symbol, q])) })); })
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(true); });
    return () => ctrl.abort();
  }, [key]);
  const times = Object.values(quotes).map((q) => q.time);
  const asOf = times.length ? new Date((Math.max(...times) + 5.5 * 3600) * 1000).toISOString().slice(0, 10) : null;
  return { quotes, asOf, error };
}

/** "30 Oct 2026" from YYYY-MM-DD. */
export const fmtTradingDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
