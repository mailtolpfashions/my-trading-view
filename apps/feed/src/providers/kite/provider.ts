// Live NSE data from Zerodha Kite Connect: historical candles (paced at Kite's documented 3 req/s limit, fetched in
// chunks well under the per-request date limits) and real-time ticks over the Kite WebSocket.

import { yearsToExpiry } from '@mtv/options';
import type { Candle, Quote, Timeframe } from '@mtv/shared';
import { TtlCache } from '../../cache';
import { applyGreeks, type Chain, type ChainRow, type ChainSide } from '../../fno/chain';
import { splitCsvLine } from '../../official/nse-files';
import { INDICES } from '../../symbols';
import { NotFoundError, type MarketDataProvider } from '../types';
import { activeSession, authHeader, clearSession, kiteApiKey } from './session';
import { KiteTicker, type Tick } from './ticker';

/** Underlyings with a live option chain. */
export const LIVE_CHAIN_UNDERLYINGS = ['NIFTY', 'BANKNIFTY'] as const;
export type LiveChainUnderlying = (typeof LIVE_CHAIN_UNDERLYINGS)[number];
export type LiveFuture = { expiry: string; ltpPaise: number; prevClosePaise: number; oi: number; volume: number };
type OptionContract = { token: number; tradingsymbol: string; expiry: string; strike: number; right: 'CE' | 'PE'; lot: number };

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
  /** NFO option contracts per underlying, from Kite's instrument list. */
  private options = new Map<string, OptionContract[]>();
  /** NFO index futures per underlying. */
  private futures = new Map<string, { token: number; tradingsymbol: string; expiry: string; lot: number }[]>();
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
    const [cTok, cSym, cSeg, cExch, cType, cName, cExp, cStrike, cLot] = ['instrument_token', 'tradingsymbol', 'segment', 'exchange', 'instrument_type', 'name', 'expiry', 'strike', 'lot_size'].map(col);
    const indexWanted = new Map(Object.entries(KITE_INDEX_SYMBOLS).map(([ours, k]) => [`${k.exchange}|${k.tradingsymbol}`, ours]));
    this.tokens.clear();
    this.symbolsByToken.clear();
    this.options.clear();
    this.futures.clear();
    for (const line of lines.slice(1)) {
      const c = splitCsvLine(line);
      const token = Number(c[cTok]);
      if (c[cSeg] === 'NFO-FUT' && (LIVE_CHAIN_UNDERLYINGS as readonly string[]).includes(c[cName])) {
        const list = this.futures.get(c[cName]) ?? [];
        list.push({ token, tradingsymbol: c[cSym], expiry: c[cExp], lot: Number(c[cLot]) });
        this.futures.set(c[cName], list);
      } else if (c[cSeg] === 'NFO-OPT' && (LIVE_CHAIN_UNDERLYINGS as readonly string[]).includes(c[cName]) && (c[cType] === 'CE' || c[cType] === 'PE')) {
        const list = this.options.get(c[cName]) ?? [];
        list.push({ token, tradingsymbol: c[cSym], expiry: c[cExp], strike: Number(c[cStrike]), right: c[cType], lot: Number(c[cLot]) });
        this.options.set(c[cName], list);
      } else if (c[cSeg] === 'INDICES') {
        const ours = indexWanted.get(`${c[cExch]}|${c[cSym]}`);
        if (ours) { this.tokens.set(ours, token); this.symbolsByToken.set(token, ours); }
      } else if (c[cSeg] === 'NSE' && c[cType] === 'EQ') {
        this.tokens.set(c[cSym], token);
        this.symbolsByToken.set(token, c[cSym]);
      }
    }
    const missing = INDICES.map((i) => i.symbol).filter((s) => !this.tokens.has(s));
    const opts = [...this.options].map(([u, l]) => `${u} ${l.length}`).join(', ') + `; futures: ${[...this.futures].map(([u, l]) => `${u} ${l.length}`).join(', ') || 'none'}`;
    this.log(`Kite instruments loaded: ${this.tokens.size} symbols, options: ${opts || 'none'}${missing.length ? `; indices not found: ${missing.join(', ')}` : ''}`);
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

  /**
   * Live option chain for one expiry: the strikes around the index, streamed in full mode (price, volume, OI).
   * Contracts with no tick yet are filled from one REST quote call. IV and Greeks use the same model as the
   * end-of-day chain. Returns null if Kite has no contracts for the underlying.
   */
  async liveChain(underlying: LiveChainUnderlying, expiry?: string, width = 15): Promise<Chain | null> {
    const today = new Date(Date.now() + IST * 1000).toISOString().slice(0, 10);
    const all = (this.options.get(underlying) ?? []).filter((o) => o.expiry >= today);
    const expiries = [...new Set(all.map((o) => o.expiry))].sort();
    const exp = expiry && expiries.includes(expiry) ? expiry : expiries[0];
    if (!exp) return null;
    const [spotQuote] = await this.quotes([underlying]);
    const spot = spotQuote ? Math.round(spotQuote.ltp * 100) : null;
    const contracts = all.filter((o) => o.expiry === exp);
    const strikes = [...new Set(contracts.map((o) => o.strike))].sort((a, b) => a - b);
    const atmIndex = spot == null ? Math.floor(strikes.length / 2) : strikes.reduce((best, k, i) => (Math.abs(k * 100 - spot) < Math.abs(strikes[best] * 100 - spot) ? i : best), 0);
    const window = new Set(strikes.slice(Math.max(0, atmIndex - width), atmIndex + width + 1));
    const chosen = contracts.filter((o) => window.has(o.strike));
    this.ticker.subscribe(chosen.map((o) => o.token), 'full');

    // Contracts without a full-mode tick yet (just subscribed): one REST quote call fills them (Kite: 1 call/second).
    const missing = chosen.filter((o) => this.ticks.get(o.token)?.oi == null);
    const rest = new Map<number, { ltp: number; close: number; oi: number; volume: number }>();
    if (missing.length) {
      const json = await this.get<{ data: Record<string, { instrument_token: number; last_price: number; volume?: number; oi?: number; ohlc: { close: number } }> }>(
        `/quote?${missing.map((o) => `i=${encodeURIComponent(`NFO:${o.tradingsymbol}`)}`).join('&')}`,
      );
      for (const q of Object.values(json.data ?? {})) rest.set(q.instrument_token, { ltp: q.last_price, close: q.ohlc.close, oi: q.oi ?? 0, volume: q.volume ?? 0 });
    }

    const byStrike = new Map<number, ChainRow>();
    for (const o of chosen) {
      const t = this.ticks.get(o.token), r = rest.get(o.token);
      const ltpPaise = t?.oi != null ? t.ltpPaise : r ? Math.round(r.ltp * 100) : 0;
      const side: ChainSide = {
        closePaise: ltpPaise, // the latest traded price (live)
        settlePaise: t?.oi != null ? t.closePaise : r ? Math.round(r.close * 100) : 0, // previous day's close
        oi: t?.oi ?? r?.oi ?? 0,
        volume: (t?.oi != null ? t.volume : r?.volume) ?? 0,
        traded: ltpPaise > 0 && ((t?.oi != null ? t.volume : r?.volume) ?? 0) > 0,
        iv: null, delta: null, theta: null, vega: null, gamma: null,
      };
      const strikePaise = Math.round(o.strike * 100);
      const row = byStrike.get(strikePaise) ?? { strikePaise, CE: null, PE: null };
      row[o.right] = side;
      byStrike.set(strikePaise, row);
    }
    const rows = [...byStrike.values()].sort((a, b) => a.strikePaise - b.strikePaise);
    const F = applyGreeks(rows, spot, yearsToExpiry(Date.now() / 1000, exp));
    return {
      underlying, date: today, expiry: exp, expiries, lotSize: contracts[0]?.lot ?? null, spotPaise: spot,
      forwardPaise: F == null ? null : Math.round(F), atmStrikePaise: strikes[atmIndex] != null ? Math.round(strikes[atmIndex] * 100) : null, rows,
    };
  }

  /** Live index futures (all listed expiries, nearest first), streamed in full mode for OI; REST fills the first call. */
  async liveFutures(underlying: LiveChainUnderlying): Promise<{ spotPaise: number | null; lot: number | null; contracts: LiveFuture[] }> {
    const today = new Date(Date.now() + IST * 1000).toISOString().slice(0, 10);
    const list = (this.futures.get(underlying) ?? []).filter((f) => f.expiry >= today).sort((a, b) => (a.expiry < b.expiry ? -1 : 1)).slice(0, 3);
    this.ticker.subscribe(list.map((f) => f.token), 'full');
    const [spotQuote] = await this.quotes([underlying]);
    const missing = list.filter((f) => this.ticks.get(f.token)?.oi == null);
    const rest = new Map<number, LiveFuture>();
    if (missing.length) {
      const json = await this.get<{ data: Record<string, { instrument_token: number; last_price: number; volume?: number; oi?: number; ohlc: { close: number } }> }>(
        `/quote?${missing.map((f) => `i=${encodeURIComponent(`NFO:${f.tradingsymbol}`)}`).join('&')}`,
      );
      for (const q of Object.values(json.data ?? {})) {
        const f = missing.find((m) => m.token === q.instrument_token);
        if (f) rest.set(f.token, { expiry: f.expiry, ltpPaise: Math.round(q.last_price * 100), prevClosePaise: Math.round(q.ohlc.close * 100), oi: q.oi ?? 0, volume: q.volume ?? 0 });
      }
    }
    const contracts = list.map((f): LiveFuture => {
      const t = this.ticks.get(f.token);
      if (t?.oi != null) return { expiry: f.expiry, ltpPaise: t.ltpPaise, prevClosePaise: t.closePaise, oi: t.oi, volume: t.volume ?? 0 };
      return rest.get(f.token) ?? { expiry: f.expiry, ltpPaise: 0, prevClosePaise: 0, oi: 0, volume: 0 };
    });
    return { spotPaise: spotQuote ? Math.round(spotQuote.ltp * 100) : null, lot: list[0]?.lot ?? null, contracts };
  }

  /** Streams these symbols continuously (up to Kite's 3,000 per connection), whether or not anyone is watching. */
  streamAlways(symbols: string[]) {
    this.ticker.subscribe(symbols.filter((s) => this.tokens.has(s)).map((s) => this.tokens.get(s)!));
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
