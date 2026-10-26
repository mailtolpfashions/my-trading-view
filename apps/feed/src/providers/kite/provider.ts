// Live NSE data from Zerodha Kite Connect: historical candles (paced at Kite's documented 3 req/s limit, fetched in
// chunks well under the per-request date limits) and real-time ticks over the Kite WebSocket.

import type { Candle, Quote, Timeframe } from '@mtv/shared';
import { TtlCache } from '../../cache';
import { splitCsvLine } from '../../official/nse-files';
import { INDICES } from '../../symbols';
import { NotFoundError, type MarketDataProvider } from '../types';
import { activeSession, authHeader, clearSession, kiteApiKey } from './session';
import { KiteTicker, type Tick } from './ticker';

const API = 'https://api.kite.trade';
const IST = 5.5 * 3600;
const DAY = 86400;

/** Kite's tradingsymbol for each index we support (segment INDICES). */
export const KITE_INDEX_SYMBOLS: Record<string, { exchange: 'NSE' | 'BSE'; tradingsymbol: string }> = {
  NIFTY: { exchange: 'NSE', tradingsymbol: 'NIFTY 50' },
  BANKNIFTY: { exchange: 'NSE', tradingsymbol: 'NIFTY BANK' },
  FINNIFTY: { exchange: 'NSE', tradingsymbol: 'NIFTY FIN SERVICE' },
  MIDCPNIFTY: { exchange: 'NSE', tradingsymbol: 'NIFTY MID SELECT' },
  NIFTYNXT50: { exchange: 'NSE', tradingsymbol: 'NIFTY NEXT 50' },
  NIFTYIT: { exchange: 'NSE', tradingsymbol: 'NIFTY IT' },
  INDIAVIX: { exchange: 'NSE', tradingsymbol: 'INDIA VIX' },
  SENSEX: { exchange: 'BSE', tradingsymbol: 'SENSEX' },
};

/** Kite interval, chunk size (kept well below Kite's per-request limits) and default/deep history, in days. */
const PLAN: Record<Exclude<Timeframe, 'W'>, { interval: string; chunk: number; chart: number; deep: number }> = {
  '1': { interval: 'minute', chunk: 30, chart: 10, deep: 60 },
  '5': { interval: '5minute', chunk: 60, chart: 40, deep: 365 },
  '15': { interval: '15minute', chunk: 100, chart: 90, deep: 730 },
  '30': { interval: '30minute', chunk: 100, chart: 120, deep: 730 },
  '60': { interval: '60minute', chunk: 200, chart: 365, deep: 1825 },
  D: { interval: 'day', chunk: 1000, chart: 5 * 365, deep: 20 * 365 },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Kite timestamps look like 2026-10-23T09:15:00+0530; insert the colon so every JS engine parses the offset. */
export const parseKiteTime = (s: string) => Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) / 1000;

/**
 * Converts Kite candles. Daily candles (stamped 00:00 IST) are re-stamped 09:15 IST, the convention the rest of the
 * app uses for daily bars (live-bar merging, NSE official-data matching).
 */
export function parseKiteCandles(rows: [string, number, number, number, number, number, number?][], daily: boolean): Candle[] {
  return rows.map(([ts, o, h, l, c, v]) => {
    let time = parseKiteTime(ts);
    if (daily) { const local = time + IST; time = local - (local % DAY) + 9 * 3600 + 15 * 60 - IST; }
    return { time, open: round2(o), high: round2(h), low: round2(l), close: round2(c), volume: v ?? 0 };
  });
}

/** Weekly bars from daily bars, weeks starting Monday (stamped Monday 09:15 IST, even if Monday was a holiday). */
export function weeklyFromDaily(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const d of days) {
    const local = d.time + IST;
    const dow = new Date(local * 1000).getUTCDay();
    const monday = local - (local % DAY) - ((dow + 6) % 7) * DAY + 9 * 3600 + 15 * 60 - IST;
    const w = out.at(-1);
    if (w && w.time === monday) { w.high = Math.max(w.high, d.high); w.low = Math.min(w.low, d.low); w.close = d.close; w.volume += d.volume; }
    else out.push({ ...d, time: monday });
  }
  return out;
}

const kiteDate = (sec: number) => new Date((sec + IST) * 1000).toISOString().slice(0, 19).replace('T', ' ');

export class KiteProvider implements MarketDataProvider {
  readonly status = { provider: 'kite', delayed: false } as const;
  private tokens = new Map<string, number>(); // our symbol -> instrument token
  private symbolsByToken = new Map<number, string>();
  private ticks = new Map<number, Tick>();
  private candleCache = new TtlCache<Candle[]>();
  private nextHistorical = 0;
  ticker: KiteTicker;

  constructor(private log: (m: string) => void, private onTicks: (symbols: string[]) => void) {
    this.ticker = new KiteTicker(
      () => { const s = activeSession(); return s ? `wss://ws.kite.trade?api_key=${kiteApiKey()}&access_token=${s.accessToken}` : null; },
      (ticks) => {
        const changed: string[] = [];
        for (const t of ticks) {
          this.ticks.set(t.token, t);
          const sym = this.symbolsByToken.get(t.token);
          if (sym) changed.push(sym);
        }
        if (changed.length) this.onTicks(changed);
      },
      log,
      () => void clearSession(),
    );
  }

  get ready() { return !!activeSession() && this.tokens.size > 0; }

  private async get<T>(path: string): Promise<T> {
    const s = activeSession();
    if (!s) throw new Error('Kite login required');
    const res = await fetch(API + path, { headers: authHeader(s), signal: AbortSignal.timeout(20000) });
    if (res.status === 403) { await clearSession(); throw new Error('Kite session expired: log in again'); }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message ?? text; } catch { /* plain text */ }
      throw new Error(`Kite ${res.status}: ${msg}`);
    }
    return (path.startsWith('/instruments') && !path.includes('historical') ? text : JSON.parse(text)) as T;
  }

  /** Downloads Kite's instrument list once per session and maps our symbols to instrument tokens. */
  async loadInstruments() {
    const csv = await this.get<string>('/instruments');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = splitCsvLine(lines[0]);
    const col = (n: string) => { const i = header.indexOf(n); if (i < 0) throw new Error(`Kite instruments format changed: no ${n}`); return i; };
    const [cTok, cSym, cSeg, cExch, cType] = ['instrument_token', 'tradingsymbol', 'segment', 'exchange', 'instrument_type'].map(col);
    const indexWanted = new Map(Object.entries(KITE_INDEX_SYMBOLS).map(([ours, k]) => [`${k.exchange}|${k.tradingsymbol}`, ours]));
    this.tokens.clear();
    this.symbolsByToken.clear();
    for (const line of lines.slice(1)) {
      const c = splitCsvLine(line);
      const token = Number(c[cTok]);
      if (c[cSeg] === 'INDICES') {
        const ours = indexWanted.get(`${c[cExch]}|${c[cSym]}`);
        if (ours) { this.tokens.set(ours, token); this.symbolsByToken.set(token, ours); }
      } else if (c[cSeg] === 'NSE' && c[cType] === 'EQ') {
        this.tokens.set(c[cSym], token);
        this.symbolsByToken.set(token, c[cSym]);
      }
    }
    const missing = INDICES.map((i) => i.symbol).filter((s) => !this.tokens.has(s));
    this.log(`Kite instruments loaded: ${this.tokens.size} symbols${missing.length ? `; indices not found: ${missing.join(', ')}` : ''}`);
  }

  private token(symbol: string): number {
    const t = this.tokens.get(symbol);
    if (t == null) throw new NotFoundError(symbol);
    return t;
  }

  /** Paces historical requests to stay under Kite's 3 requests/second. */
  private async paced<T>(fn: () => Promise<T>): Promise<T> {
    const wait = Math.max(0, this.nextHistorical - Date.now());
    this.nextHistorical = Math.max(Date.now(), this.nextHistorical) + 400;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return fn();
  }

  async candles(symbol: string, tf: Timeframe, deep = false): Promise<Candle[]> {
    if (tf === 'W') return weeklyFromDaily(await this.candles(symbol, 'D', true));
    const plan = PLAN[tf];
    const days = deep ? plan.deep : plan.chart;
    const token = this.token(symbol);
    const ttl = tf === 'D' ? 5 * 60_000 : 20_000;
    return this.candleCache.get(`${symbol}:${tf}:${days}`, ttl, async () => {
      const to = Math.floor(Date.now() / 1000);
      const out: Candle[] = [];
      // Oldest chunk first, so candles come back in time order.
      for (let start = to - days * DAY; start < to; start += plan.chunk * DAY) {
        const end = Math.min(to, start + plan.chunk * DAY - 1);
        const path = `/instruments/historical/${token}/${plan.interval}?from=${encodeURIComponent(kiteDate(start))}&to=${encodeURIComponent(kiteDate(end))}`;
        const json = await this.paced(() => this.get<{ data: { candles: [string, number, number, number, number, number][] } }>(path));
        out.push(...parseKiteCandles(json.data.candles, tf === 'D'));
      }
      // Chunks meet at boundaries; keep one bar per timestamp.
      const seen = new Set<number>();
      const candles = out.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true))).sort((a, b) => a.time - b.time);
      if (!candles.length) throw new NotFoundError(symbol);
      return candles;
    });
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    const known = symbols.filter((s) => this.tokens.has(s));
    this.ticker.subscribe(known.map((s) => this.tokens.get(s)!));
    const out: Quote[] = [];
    const missing: string[] = [];
    for (const s of known) {
      const t = this.ticks.get(this.tokens.get(s)!);
      if (t && t.closePaise > 0) out.push(toQuote(s, t));
      else missing.push(s);
    }
    // Before the first tick arrives (or outside market hours), fall back to one REST quote call (1 req/s limit).
    if (missing.length) {
      const ids = missing.map((s) => { const k = KITE_INDEX_SYMBOLS[s]; return k ? `${k.exchange}:${k.tradingsymbol}` : `NSE:${s}`; });
      const json = await this.get<{ data: Record<string, { instrument_token: number; last_price: number; ohlc: { open: number; high: number; low: number; close: number } }> }>(
        `/quote/ohlc?${ids.map((i) => `i=${encodeURIComponent(i)}`).join('&')}`,
      );
      for (const [, q] of Object.entries(json.data ?? {})) {
        const sym = this.symbolsByToken.get(q.instrument_token);
        if (!sym || !(q.ohlc.close > 0)) continue;
        const tick: Tick = { token: q.instrument_token, ltpPaise: Math.round(q.last_price * 100), closePaise: Math.round(q.ohlc.close * 100), openPaise: Math.round(q.ohlc.open * 100), highPaise: Math.round(q.ohlc.high * 100), lowPaise: Math.round(q.ohlc.low * 100), volume: null, time: Math.floor(Date.now() / 1000) };
        if (!this.ticks.has(tick.token)) this.ticks.set(tick.token, tick);
        out.push(toQuote(sym, tick));
      }
    }
    return out;
  }
}

function toQuote(symbol: string, t: Tick): Quote {
  const ltp = t.ltpPaise / 100, prev = t.closePaise / 100;
  return { symbol, ltp, prevClose: prev, change: round2(ltp - prev), changePct: ((ltp - prev) / prev) * 100, time: t.time || Math.floor(Date.now() / 1000) };
}
