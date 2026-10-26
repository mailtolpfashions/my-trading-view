// Free, delayed market data from Yahoo Finance's public chart endpoints. For development only:
// it is unofficial and not licensed for commercial redistribution, so it is replaced by Kite (or a vendor) at go-live.

import type { Candle, Quote, Timeframe } from '@mtv/shared';
import { TtlCache } from '../cache';
import { yahooTicker } from '../symbols';
import { NotFoundError, type MarketDataProvider } from './types';

const BASE = 'https://query1.finance.yahoo.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; MyTradingView/0.1; +https://mytradingview.in)' };

/** Yahoo interval and how much history to request for each timeframe (Yahoo limits 1m history to ~7 days). */
const INTERVALS: Record<Timeframe, [interval: string, range: string]> = {
  '1': ['1m', '5d'],
  '5': ['5m', '1mo'],
  '15': ['15m', '1mo'],
  '30': ['30m', '1mo'],
  '60': ['60m', '6mo'],
  D: ['1d', '5y'],
  W: ['1wk', '20y'],
};

/**
 * Backtests use the deepest history Yahoo serves at the requested bar size. Never use range=max:
 * Yahoo then silently returns MONTHLY bars for daily and weekly requests.
 */
const DEEP_RANGES: Record<Timeframe, string> = { '1': '7d', '5': '60d', '15': '60d', '30': '60d', '60': '730d', D: '10y', W: '20y' };

/** The bar size Yahoo reports back for each interval we request. */
const GRANULARITY: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '1h', '1d': '1d', '1wk': '1wk' };

/** Refuses a response whose bars are not the size we asked for, instead of mislabelling them. */
export function checkGranularity(json: YahooChart, interval: string) {
  const got = json.chart.result?.[0]?.meta?.dataGranularity;
  if (got && got !== GRANULARITY[interval]) throw new Error(`Yahoo returned ${got} bars for a ${interval} request`);
}

type YahooChart = {
  chart: {
    result: { meta?: { dataGranularity?: string }; timestamp?: number[]; indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] } }[] | null;
    error: { code: string; description: string } | null;
  };
};
type YahooSpark = Record<string, { symbol: string; timestamp?: number[]; close?: (number | null)[]; previousClose?: number; chartPreviousClose?: number }>;

// Yahoo returns float32-ish prices (22753.19921875); NSE prices have at most two decimals.
const round2 = (n: number) => Math.round(n * 100) / 100;

const IST_OFFSET = 5.5 * 3600;
const SESSION_END = (15 * 60 + 30) * 60; // 15:30 IST, seconds after midnight

/** Drops Yahoo's extra closing-tick bar stamped 15:30 IST, which is outside NSE's 09:15–15:30 session. */
export const withinSession = (c: Candle) => (c.time + IST_OFFSET) % 86400 < SESSION_END;

/** Converts a Yahoo chart response to candles, dropping bars Yahoo reports with missing values. */
export function parseChart(json: YahooChart): Candle[] {
  const r = json.chart.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0];
  const out: Candle[] = [];
  r.timestamp.forEach((time, i) => {
    const [open, high, low, close] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if (open == null || high == null || low == null || close == null) return;
    out.push({ time, open: round2(open), high: round2(high), low: round2(low), close: round2(close), volume: q.volume[i] ?? 0 });
  });
  return out;
}

/** Converts a Yahoo spark response to quotes keyed back to our symbols. */
export function parseSpark(json: YahooSpark, bySymbol: Map<string, string>): Quote[] {
  const out: Quote[] = [];
  for (const [ticker, s] of Object.entries(json)) {
    const symbol = bySymbol.get(ticker);
    const closes = s.close ?? [];
    let i = closes.length - 1;
    while (i >= 0 && closes[i] == null) i--;
    const prev = s.previousClose ?? s.chartPreviousClose;
    if (!symbol || i < 0 || prev == null) continue;
    const ltp = closes[i]!;
    out.push({ symbol, ltp, prevClose: prev, change: ltp - prev, changePct: ((ltp - prev) / prev) * 100, time: s.timestamp?.[i] ?? 0 });
  }
  return out;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  return (await res.json()) as T;
}

export class FreeProvider implements MarketDataProvider {
  readonly status = { provider: 'free', delayed: true } as const;
  private candleCache = new TtlCache<Candle[]>();
  private quoteCache = new TtlCache<Quote[]>();

  async candles(symbol: string, tf: Timeframe, deep = false): Promise<Candle[]> {
    const interval = INTERVALS[tf][0];
    const range = deep ? DEEP_RANGES[tf] : INTERVALS[tf][1];
    const ttl = tf === 'D' || tf === 'W' ? 10 * 60_000 : 30_000;
    return this.candleCache.get(`${symbol}:${tf}:${range}`, ttl, async () => {
      const url = `${BASE}/v8/finance/chart/${encodeURIComponent(yahooTicker(symbol))}?interval=${interval}&range=${range}&includePrePost=false`;
      const json = await getJson<YahooChart>(url);
      checkGranularity(json, interval);
      let candles = parseChart(json);
      if (tf !== 'D' && tf !== 'W') candles = candles.filter(withinSession);
      if (!candles.length) throw new NotFoundError(symbol);
      return candles;
    });
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    const unique = [...new Set(symbols)].sort();
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += 20) batches.push(unique.slice(i, i + 20)); // spark accepts up to 20 tickers
    const results = await Promise.all(
      batches.map((batch) =>
        this.quoteCache.get(batch.join(','), 4_000, async () => {
          const bySymbol = new Map(batch.map((s) => [yahooTicker(s), s]));
          const url = `${BASE}/v8/finance/spark?symbols=${[...bySymbol.keys()].map(encodeURIComponent).join(',')}&range=1d&interval=1m`;
          return parseSpark(await getJson<YahooSpark>(url), bySymbol);
        }),
      ),
    );
    return results.flat();
  }
}
