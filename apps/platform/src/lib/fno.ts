'use client';

// Client side of the F&O analytics endpoints (apps/feed/src/fno/analytics.ts). All data is NSE's official
// end-of-day F&O files; IV, Greeks and gamma exposure are model estimates.

import { useEffect, useState } from 'react';
import { FEED_URL, feedFetch } from './feed';
import type { BuildUp } from './futures';

async function get<T>(path: string, fallback: string, signal?: AbortSignal): Promise<T> {
  const res = await feedFetch(`${FEED_URL}${path}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message ?? fallback);
  return body as T;
}
const qs = (o: Record<string, string | number | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export type Underlying = { symbol: string; isIndex: boolean; lotSize: number | null; spotPaise: number | null };
let underlyingsCache: Promise<{ date: string | null; underlyings: Underlying[] }> | null = null;
/** Every F&O underlying in the latest NSE file (cached for the page's life). */
export function fetchUnderlyings() {
  underlyingsCache ??= get<{ date: string | null; underlyings: Underlying[] }>('/api/fno/underlyings', 'F&O list unavailable').catch((e) => { underlyingsCache = null; throw e; });
  return underlyingsCache;
}

export type DerivedPoint = {
  date: string; expiry: string; daysToExpiry: number;
  spotPaise: number | null; forwardPaise: number | null; atmStrikePaise: number | null; strikeStepPaise: number | null;
  atmIv: number | null; iv30: number | null; iv30Exact: boolean; hv20: number | null; ivRank: number | null; ivPercentile: number | null;
  straddlePaise: number | null; straddleTraded: boolean; maxPainPaise: number | null;
  ceOi: number; peOi: number; ceVolume: number; peVolume: number; oiPcr: number | null; volumePcr: number | null;
  gexNet: number | null; callWallPaise: number | null; putWallPaise: number | null; gammaFlipPaise: number | null; gexIvFilled: number;
};
export type DerivedSeries = { underlying: string; from: string; to: string; expiry: string | null; expiries: string[]; points: DerivedPoint[] };
export const fetchDerived = (p: { underlying: string; from?: string; to?: string; expiry?: string }, signal?: AbortSignal) =>
  get<DerivedSeries>(`/api/fno/derived?${qs(p)}`, 'Option statistics unavailable', signal);

export type ExpiryStats = Omit<DerivedPoint, 'iv30' | 'iv30Exact' | 'hv20' | 'ivRank' | 'ivPercentile' | 'oiPcr' | 'volumePcr'>;
export const fetchExpiryStats = (p: { underlying: string; date?: string }, signal?: AbortSignal) =>
  get<{ underlying: string; date: string; expiries: ExpiryStats[] }>(`/api/fno/expiries?${qs(p)}`, 'Expiry statistics unavailable', signal);

export type StrikeQuote = { date: string; kind: 'CE' | 'PE'; strikePaise: number; closePaise: number; oi: number; volume: number; traded: boolean };
export type StrikeHistory = {
  underlying: string; expiry: string; truncated: boolean; quotes: StrikeQuote[];
  days: { date: string; spotPaise: number | null; lotSize: number | null; future: { expiry: string; closePaise: number; oi: number } | null }[];
};
export const fetchStrikeHistory = (p: { underlying: string; expiry: string; strikes?: number[]; kind?: 'CE' | 'PE'; from?: string; to?: string }, signal?: AbortSignal) =>
  get<StrikeHistory>(`/api/fno/strike-history?${qs({ ...p, strikes: p.strikes?.join(',') })}`, 'Strike history unavailable', signal);

export type GexStrike = { strikePaise: number; ce: number; pe: number; net: number };
export type GexDay = {
  underlying: string; date: string; expiry: string; expiries: string[]; spotPaise: number | null; forwardPaise: number | null; lotSize: number | null;
  gex: { net: number; strikes: GexStrike[]; callWallPaise: number | null; putWallPaise: number | null; flipPaise: number | null; ivFilled: number } | null;
};
export const fetchGex = (p: { underlying: string; date?: string; expiry?: string }, signal?: AbortSignal) => get<GexDay>(`/api/fno/gex?${qs(p)}`, 'Gamma exposure unavailable', signal);

export type MaxPainExpiry = { expiry: string; date: string; maxPainPaise: number; spotThenPaise: number | null; expiryClosePaise: number };
export const fetchMaxPainHistory = (p: { underlying: string; from?: string; before?: number }, signal?: AbortSignal) =>
  get<{ underlying: string; from: string; before: number; expiries: MaxPainExpiry[] }>(`/api/fno/max-pain-history?${qs(p)}`, 'Max pain history unavailable', signal);

export type Mover = {
  symbol: string; isIndex: boolean; lotSize: number | null; expiry: string; closePaise: number; changePct: number | null;
  spotPaise: number | null; spotChangePct: number | null; oi: number; oiChange: number | null; oiChangePct: number | null; volume: number;
  valueApprox: number | null; buildUp: BuildUp; oiPcr: number | null;
};
export const fetchMovers = (date?: string, signal?: AbortSignal) => get<{ date: string; prevDate: string | null; rows: Mover[] }>(`/api/fno/movers?${qs({ date })}`, 'Futures data unavailable', signal);
export const fetchBuildUpCycle = (sessions: number, signal?: AbortSignal) =>
  get<{ dates: string[]; rows: { symbol: string; isIndex: boolean; phases: (BuildUp | null)[] }[] }>(`/api/fno/buildup-cycle?${qs({ sessions })}`, 'Build-up history unavailable', signal);

export type IvGridRow = { symbol: string; isIndex: boolean; spotPaise: number | null; iv30: number | null; iv30Change: number | null; hv20: number | null; ivRank: number | null; ivPercentile: number | null; ivMinusHv: number | null };
export const fetchIvGrid = (date?: string, signal?: AbortSignal) => get<{ date: string; rows: IvGridRow[] }>(`/api/fno/iv-grid?${qs({ date })}`, 'IV table unavailable', signal);

export type LotSizeRow = { symbol: string; isIndex: boolean; lotSize: number | null; current: boolean; changes: { from: string; lotSize: number }[] };
export const fetchLotSizes = () => get<{ date: string | null; rows: LotSizeRow[] }>('/api/fno/lot-sizes', 'Lot sizes unavailable');

/** Runs `load` whenever `key` changes, cancelling the previous request. */
export function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    if (key == null) return;
    const ctrl = new AbortController();
    setState((s) => ({ key, data: s.key === key ? s.data : null, error: null }));
    load(ctrl.signal).then(
      (data) => { if (!ctrl.signal.aborted) setState({ key, data, error: null }); },
      (e: Error) => { if (!ctrl.signal.aborted && e.name !== 'AbortError') setState({ key, data: null, error: e.message }); },
    );
    return () => ctrl.abort();
    // `load` is recreated every render; `key` says when the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: key != null && (!current || (state.data == null && state.error == null)) };
}

// ---- formatting ----
export const rupees = (p: number | null | undefined, digits = 2) => (p == null ? '—' : (p / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export const strike = (p: number | null | undefined) => (p == null ? '—' : (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
export const pct = (n: number | null | undefined, d = 1, sign = false) => (n == null ? '—' : `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}%`);
export const ivPct = (iv: number | null | undefined, d = 1) => (iv == null ? '—' : `${(iv * 100).toFixed(d)}%`);
export const ratio = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
/** Shares in lakh (1,00,000), e.g. 12.35L. */
export const lakh = (n: number | null | undefined, sign = false) => (n == null ? '—' : `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}${(Math.abs(n) / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}L`);
/** Rupees in crore, e.g. ₹1,234.5 Cr. */
export const crore = (n: number | null | undefined, sign = false) => (n == null ? '—' : `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}₹${(Math.abs(n) / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Cr`);
export const tone = (n: number | null | undefined) => (n == null || n === 0 ? '' : n > 0 ? 'text-up' : 'text-down');
/** "30 Oct" or "30 Oct 2026". */
export const day = (d: string, year = false) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
/** YYYY-MM-DD n calendar days before `d`. */
export const daysBefore = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);

/** Comma-separated values download in the browser. */
export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
  const blob = new Blob([[header, ...rows].map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const calendarCache = new Map<string, Promise<{ dates: string[]; expiries: string[] }>>();
/** Trading days held for an underlying and its expiry dates, oldest first (cached for the page's life). */
export function fetchFnoCalendar(underlying: string): Promise<{ dates: string[]; expiries: string[] }> {
  let p = calendarCache.get(underlying);
  if (!p) {
    p = get<{ dates: string[]; expiries?: string[] }>(`/api/fno/dates?${qs({ underlying })}`, 'Trading days unavailable').then((r) => ({ dates: r.dates, expiries: r.expiries ?? [] }));
    p.catch(() => calendarCache.delete(underlying));
    calendarCache.set(underlying, p);
  }
  return p;
}
/** Trading days held for an underlying, oldest first. */
export const fetchFnoDates = (underlying: string) => fetchFnoCalendar(underlying).then((c) => c.dates);

// ---- market ----
export type RrgSector = { name: string; quadrant: 'leading' | 'weakening' | 'lagging' | 'improving' | null; points: { date: string; rsRatio: number; rsMomentum: number }[] };
export const fetchRrg = (tf: 'D' | 'W', bench: string, signal?: AbortSignal) =>
  get<{ tf: 'D' | 'W'; bench: string; asOf: string; sectors: RrgSector[] }>(`/api/market/rrg?${qs({ tf, bench })}`, 'Sector rotation unavailable', signal);
export const fetchMarketIndices = () => get<{ breadth: string[]; rrg: { sectors: string[]; benchmarks: string[] } }>('/api/market/indices', 'Index list unavailable');
export type BreadthDay = { date: string; advances: number; declines: number; unchanged: number; notTraded: number; cumulative: number };
export type BreadthSnapshot = { date: string; members: number; traded: number; aboveSma20: number; aboveSma50: number; aboveSma200: number; withSma200: number; newHighs: number; newLows: number; with52w: number };
export type IndexBreadth = {
  index: string; asOf: string; listFetched: string; members: number; level: { date: string; close: number }[];
  days: BreadthDay[]; snapshot: BreadthSnapshot; moves: { symbol: string; close: number; changePct: number }[];
};
export const fetchBreadth = (index: string, days: number, signal?: AbortSignal) => get<IndexBreadth>(`/api/market/breadth?${qs({ index, days })}`, 'Breadth unavailable', signal);
export type BreadthRow = {
  index: string; members: number; asOf: string; close: number | null; changePct: number | null; advances: number; declines: number; unchanged: number;
  aboveSma50: number; aboveSma200: number; withSma200: number; traded: number; newHighs: number; newLows: number;
};
export const fetchAllBreadth = (signal?: AbortSignal) => get<{ asOf: string; rows: BreadthRow[] }>('/api/market/breadth-all', 'Breadth unavailable', signal);
