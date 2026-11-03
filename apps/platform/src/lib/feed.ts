'use client';

// Access to the data service. Everything goes through this app's own server, which adds the owner's token, so the
// browser never holds one:
// - feed(path, body): the platform's helper, via /api/feed/<path>.
// - FEED_URL + '/api/...', feedFetch, fetchCandles, useCloses …: the tools brought over from the first app, which
//   build their own URLs; FEED_URL is this origin, and /api/<path> is passed through (app/api/[...path]/route.ts).
// While the service is still loading NSE history it answers 503 "loading"; both retry for a while before failing.

import { useCallback, useEffect, useState } from 'react';
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
    if (res.ok) {
      if (body === undefined) keepAnswer(path, json);
      return json as T;
    }
    if (res.status === 503 && attempt < 20) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    throw new FeedError(json.message ?? `Request failed (${res.status})`, res.status);
  }
}

// ---- last answers, kept in the browser so a page shows at once (even while the service starts) ----

const CACHE = 'mtv.cache:';
const CACHE_MAX = 400_000; // characters; bigger answers (long candle series) are not kept
type Kept<T> = { at: number; data: T };

export function keepAnswer(path: string, data: unknown) {
  try {
    const s = JSON.stringify({ at: Date.now(), data });
    if (s.length <= CACHE_MAX) localStorage.setItem(CACHE + path, s);
  } catch { /* storage full or blocked: the page just loads normally */ }
}

/** The last answer this browser got for a GET path, with when it arrived. */
export function lastAnswer<T>(path: string): Kept<T> | null {
  try {
    const s = localStorage.getItem(CACHE + path);
    return s ? (JSON.parse(s) as Kept<T>) : null;
  } catch {
    return null;
  }
}

/** On a page's first load: hands the last answer for each path to its setter at once (the fresh fetch follows). */
export function showKept(...pairs: [path: string, set: (data: never) => void][]) {
  for (const [path, set] of pairs) {
    const kept = lastAnswer<never>(path);
    if (kept) set(kept.data);
  }
}

/** Forgets a kept answer (after a change that makes it wrong, e.g. a deleted screen). */
export const forgetAnswer = (path: string) => { try { localStorage.removeItem(CACHE + path); } catch { /* ignore */ } };

/**
 * Data for a GET path that is on screen at once: the last answer this browser got is shown immediately, the fresh one
 * replaces it when it arrives. `at` is when the shown data arrived; `stale` is true until the fresh answer is in.
 * `every` (ms) refreshes it while the page is open. `path` null waits (e.g. until a choice is made).
 */
export function useFeed<T>(path: string | null, every?: number) {
  const [state, setState] = useState<{ path: string | null; data: T | null; at: number | null; stale: boolean; error: string | null }>(
    { path: null, data: null, at: null, stale: true, error: null },
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const kept = lastAnswer<T>(path);
    setState((s) => (s.path === path ? { ...s, stale: true } : { path, data: kept?.data ?? null, at: kept?.at ?? null, stale: true, error: null }));
    feed<T>(path).then(
      (data) => { if (live) setState({ path, data, at: Date.now(), stale: false, error: null }); },
      (e: Error) => { if (live) setState((s) => ({ ...s, stale: true, error: e.message })); },
    );
    return () => { live = false; };
  }, [path, tick]);
  useEffect(() => {
    if (!path || !every) return;
    const t = setInterval(() => setTick((n) => n + 1), every);
    return () => clearInterval(t);
  }, [path, every]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const mine = state.path === path;
  return { data: mine ? state.data : null, at: mine ? state.at : null, stale: mine ? state.stale : true, error: mine ? state.error : null, reload };
}

/** "just now", "4 min ago", "at 15:42", "on 3 Nov": how old shown data is. */
export function agoText(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(at);
  if (d.toDateString() === new Date(now).toDateString()) return `at ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  return `on ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
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
