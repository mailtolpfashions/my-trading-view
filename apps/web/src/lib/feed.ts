'use client';

import { useEffect, useRef, useState } from 'react';
import type { PaperOrder, PaperSnapshot, PlaceOrderInput } from '@mtv/paper';
import type { AlertEventMessage, Candle, ClientMessage, DataQuality, DataStatus, Instrument, MarketSession, Quote, ServerMessage, Timeframe } from '@mtv/shared';

export const FEED_URL = process.env.NEXT_PUBLIC_FEED_URL ?? 'http://localhost:4001';

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

/** fetch() to the feed service with the user's access token. */
export async function feedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await feedToken();
  return fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
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
 * Live quotes for `symbols` over the feed WebSocket. Reconnects with backoff and re-subscribes,
 * so a feed restart or network blip recovers on its own.
 */
export function useQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [session, setSession] = useState<MarketSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [paper, setPaper] = useState<PaperSnapshot | null>(null);
  /** The latest alert that fired for this user (pushed by the server). */
  const [alert, setAlert] = useState<AlertEventMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribed = useRef<Set<string>>(new Set());
  const key = [...new Set(symbols)].sort().join(',');
  // The socket's onopen handler outlives renders, so it reads the latest symbols from a ref.
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let closed = false, retry = 0, timer: ReturnType<typeof setTimeout>;
    // The feed authorises each connection with a token and closes it when the token expires, so plan changes
    // (upgrade, expiry) take effect on the automatic reconnect.
    const connect = async () => {
      let token: string;
      try {
        token = await feedToken();
      } catch {
        if (!closed) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
        return;
      }
      if (closed) return;
      const ws = new WebSocket(`${FEED_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        subscribed.current = new Set();
        syncSubscriptions();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'status') {
          setStatus(msg.status);
          setSession(msg.session);
        } else if (msg.type === 'paper') {
          setPaper(msg.snapshot);
        } else if (msg.type === 'alert') {
          setAlert(msg.event);
        } else if (msg.type === 'quotes' && msg.quotes.length) {
          setQuotes((prev) => {
            const next = { ...prev };
            for (const q of msg.quotes) next[q.symbol] = q;
            return next;
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    void connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  function syncSubscriptions() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const want = new Set(keyRef.current ? keyRef.current.split(',') : []);
    const add = [...want].filter((s) => !subscribed.current.has(s));
    const drop = [...subscribed.current].filter((s) => !want.has(s));
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    if (add.length) send({ type: 'subscribe', symbols: add });
    if (drop.length) send({ type: 'unsubscribe', symbols: drop });
    subscribed.current = want;
  }

  useEffect(syncSubscriptions, [key]);

  return { quotes, status, session, connected, paper, alert };
}

// ---- paper trading API ----
async function paperCall<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type only with a body: an empty body declared as JSON is invalid (e.g. cancelling an order with DELETE).
  const res = await feedFetch(`${FEED_URL}/api/paper${path}`, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Paper trading is unavailable right now');
  return body as T;
}
export const placePaperOrder = (o: PlaceOrderInput) => paperCall<PaperOrder>('/orders', { method: 'POST', body: JSON.stringify(o) });
export const cancelPaperOrder = (id: string) => paperCall<{ ok: true }>(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const resetPaper = (startingCash: string) => paperCall<{ ok: true }>('/reset', { method: 'POST', body: JSON.stringify({ startingCash }) });
