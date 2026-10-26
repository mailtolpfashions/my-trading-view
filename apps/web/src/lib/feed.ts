'use client';

import { useEffect, useRef, useState } from 'react';
import type { PaperOrder, PaperSnapshot, PlaceOrderInput } from '@mtv/paper';
import type { Candle, ClientMessage, DataQuality, DataStatus, Instrument, MarketSession, Quote, ServerMessage, Timeframe } from '@mtv/shared';

export const FEED_URL = process.env.NEXT_PUBLIC_FEED_URL ?? 'http://localhost:4001';

export type CandleResponse = { instrument: Instrument; tf: Timeframe; status: DataStatus; quality: DataQuality; candles: Candle[] };

export async function fetchCandles(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<CandleResponse> {
  const res = await fetch(`${FEED_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { signal });
  if (!res.ok) throw new Error(res.status === 404 ? `No data for ${symbol}` : 'Market data is unavailable right now');
  return res.json();
}

export async function searchSymbols(q: string, signal?: AbortSignal): Promise<Instrument[]> {
  const res = await fetch(`${FEED_URL}/api/search?q=${encodeURIComponent(q)}`, { signal });
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
  const wsRef = useRef<WebSocket | null>(null);
  const subscribed = useRef<Set<string>>(new Set());
  const key = [...new Set(symbols)].sort().join(',');
  // The socket's onopen handler outlives renders, so it reads the latest symbols from a ref.
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let closed = false, retry = 0, timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(FEED_URL.replace(/^http/, 'ws') + '/ws');
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
    connect();
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

  return { quotes, status, session, connected, paper };
}

// ---- paper trading API ----
async function paperCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FEED_URL}/api/paper${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Paper trading is unavailable right now');
  return body as T;
}
export const placePaperOrder = (o: PlaceOrderInput) => paperCall<PaperOrder>('/orders', { method: 'POST', body: JSON.stringify(o) });
export const cancelPaperOrder = (id: string) => paperCall<{ ok: true }>(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const resetPaper = (startingCash: string) => paperCall<{ ok: true }>('/reset', { method: 'POST', body: JSON.stringify({ startingCash }) });
