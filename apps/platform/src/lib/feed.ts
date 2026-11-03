'use client';

// Access to the data service. Everything goes through this app's own server, which adds the owner's token, so the
// browser never holds one:
// - feed(path, body): the platform's helper, via /api/feed/<path>.
// - FEED_URL + '/api/...', feedFetch, fetchCandles, useCloses …: the tools brought over from the first app, which
//   build their own URLs; FEED_URL is this origin, and /api/<path> is passed through (app/api/[...path]/route.ts).
// While the service is still loading NSE history it answers 503 "loading"; both retry for a while before failing.

import { useEffect, useState } from 'react';
import type { Candle, DataQuality, DataStatus, Instrument, Quote, Timeframe } from '@mtv/shared';

export class FeedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function feed<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`/api/feed/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json as T;
    if (res.status === 503 && attempt < 20) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    throw new FeedError(json.message ?? `Request failed (${res.status})`, res.status);
  }
}

// ---- the first app's tools ----

/** This origin: /api/<path> is passed to the data service by this app's server. */
export const FEED_URL = '';

/** Kept for the tools' call sites: the server adds the real token, so there is nothing to fetch here. */
export async function feedToken(): Promise<string> {
  return '';
}

export async function feedFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 503 || attempt >= 40) return res;
    const body = await res.clone().json().catch(() => ({}));
    if (body.error !== 'loading') return res;
    await new Promise((r) => setTimeout(r, 3000));
    if (init?.signal?.aborted) return res;
  }
}

/** No visitor limits in this app; kept so imports keep working. */
export type VisitorRuns = { remaining: number; limitReached: boolean };
export const VISITOR_RUNS_EVENT = 'mtv:visitor-runs';

export type CandleResponse = { instrument: Instrument; tf: Timeframe; status: DataStatus; quality: DataQuality; candles: Candle[] };

/** The chart's intraday timeframes, served from the owner's Kite minutes (apps/feed/src/intraday). */
const INTRADAY: Partial<Record<Timeframe, string>> = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h' };

export async function fetchCandles(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<CandleResponse> {
  const intraday = INTRADAY[tf];
  if (intraday) {
    const res = await feedFetch(`/api/intraday/candles?symbol=${encodeURIComponent(symbol)}&tf=${intraday}`, { signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? 'Intraday data is unavailable');
    const quality: DataQuality = { ok: true, missing: [], invalid: [], misaligned: [], suspect: [] };
    return { instrument: { symbol, name: symbol, exchange: 'NSE', kind: 'EQUITY' }, tf, status: { provider: 'kite', delayed: false }, quality, candles: body.candles };
  }
  const res = await feedFetch(`${FEED_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { signal });
  if (!res.ok) throw new Error(res.status === 404 ? `No data for ${symbol}` : 'Market data is unavailable right now');
  return res.json();
}

export async function searchSymbols(q: string, signal?: AbortSignal): Promise<Instrument[]> {
  const res = await feedFetch(`${FEED_URL}/api/search?q=${encodeURIComponent(q)}`, { signal });
  return res.ok ? res.json() : [];
}

/** Last NSE close for `symbols`, fetched when the list changes. `asOf` is the latest trading day held. */
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
