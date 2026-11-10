// Live and intraday data from the owner's Kite Connect account (personal use, never redistributed):
// - streams ticks for NIFTY 500 + F&O stocks + the main indices and builds one-minute bars (builder.ts);
// - on start, fetches today's minutes so far, then back-fills history from Kite's historical API (store.ts);
// - after the close (15:50 IST) replaces the day's live-built minutes with Kite's official ones;
// - serves bars at any intraday timeframe on the same adjusted prices as the daily history (adjust.ts).
// Zerodha ends the session at 6 AM, so the owner logs in once a day; without a session everything here waits.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resample, type Tf } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, rawCloses, rawDays } from '../eod/store';
import { fnoUnderlyings } from '../fno/analytics';
import { KiteProvider } from '../providers/kite/provider';
import { activeSession } from '../providers/kite/session';
import { indexMemberRows } from '../research/overview';
import { adjustToEod, type DayInfo } from './adjust';
import { MinuteBuilder } from './builder';
import { MinuteStore, dateOfIst } from './store';
import { OptionRecorder, OptionStore, pickContracts } from './options';

const OPTION_UNDERLYINGS = ['NIFTY', 'BANKNIFTY'];

const IST = 5.5 * 3600;
const DAY = 86400;
const LIVE_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
/** Traded NIFTY instruments with volume, for the intraday seller engine's VWAP proxy (NIFTY-FUT = nearest future). */
const VWAP_PROXIES = ['NIFTYBEES', 'NIFTY-FUT'];
/** Trading days of one-minute history each timeframe needs for its indicators. */
const DAYS_FOR: Partial<Record<Tf, number>> = { '1m': 5, '3m': 10, '5m': 15, '15m': 40, '30m': 60, '1h': 120, '2h': 250, '4h': 250 };
const nowSec = () => Math.floor(Date.now() / 1000);
/** A stock's trading days from its NSE bars; an index's from NSE's index closes (indices have no stock bars). */
const tradingDays = (symbol: string): string[] => {
  const own = [...rawCloses(symbol).keys()];
  return own.length ? own : (dailyHistory(symbol)?.candles ?? []).map((c) => dateOfIst(c.time));
};
const istClock = (t: number) => ((t + IST) % DAY) / 3600; // hours since IST midnight
const istMidnight = (t: number) => t - ((t + IST) % DAY);

export type LiveStatus = {
  state: 'off' | 'login-required' | 'starting' | 'live' | 'error';
  message: string | null;
  userName: string | null;
  expiresAt: number | null;
  stocks: number;
  lastTickAt: number | null;
  today: { running: boolean; done: number; total: number };
  history: { running: boolean; done: number; total: number; failed: number; days: number; finishedAt: number | null };
  correctedOn: string | null;
  options: { contracts: number; minutesToday: number; coverage: Record<string, OptionCoverage> };
  /** The last after-close check of live-built minutes against Kite's official ones. */
  liveCheck: LiveCheck | null;
};

/** What the option recorder holds against the live price, checked every minute (see recordOptions). */
export type OptionCoverage = {
  checkedAt: number; spot: number; spotSource: 'live tick' | 'last daily close'; expiry: string | null;
  /** Lowest and highest strike recorded for the nearest expiry */
  strikes: [number, number] | null;
  /** Contracts of the nearest expiry within spot ±500, and how many of them had no tick in the last 3 minutes */
  nearSpot: number; silent: number; resubscribed: number;
};

export type LiveCheck = {
  date: string; stocks: number; minutes: number;
  /** Share of live minutes whose close / high and low / volume (within 1%) equal the official minute's. */
  closeSamePct: number; highLowSamePct: number; volumeWithin1Pct: number;
  /** Official minutes the live feed never built (stocks with no tick that minute, or the service was off). */
  missedMinutes: number;
};

export class LiveService {
  readonly store = new MinuteStore();
  readonly builder: MinuteBuilder;
  private provider: KiteProvider | null = null;
  private timer: NodeJS.Timeout | null = null;
  private universe: string[] = [];
  private cache = new Map<string, Candle[]>();
  private cacheKey = '';
  /** Bumps when stored history changes, invalidating cached bars. */
  private version = 0;
  status: LiveStatus = {
    state: 'off', message: null, userName: null, expiresAt: null, stocks: 0, lastTickAt: null,
    today: { running: false, done: 0, total: 0 }, history: { running: false, done: 0, total: 0, failed: 0, days: 0, finishedAt: null }, correctedOn: null,
    options: { contracts: 0, minutesToday: 0, coverage: {} },
    liveCheck: null,
  };
  readonly optionStore = new OptionStore();
  readonly options = new OptionRecorder((u, rows) => { void this.optionStore.append(u, rows).catch((e) => this.log(`Could not store ${u} option minutes: ${e.message}`)); });
  private optionsCheckedAt = 0;
  private coverageLoggedAt = new Map<string, number>();
  private optionsDay = '';

  constructor(private log: (m: string) => void, private historyDays = Number(process.env.INTRADAY_HISTORY_DAYS ?? 365)) {
    this.builder = new MinuteBuilder((symbol, bars) => { void this.store.append(symbol, bars).catch((e) => this.log(`Could not store ${symbol} minutes: ${e.message}`)); });
  }

  get symbols() { return this.universe; }
  /** The live Kite connection, while streaming (Trade lab prices its orders from it). */
  kite(): KiteProvider | null { return this.status.state === 'live' ? this.provider : null; }
  has(symbol: string) { return this.universe.includes(symbol); }

  /** Starts (or restarts) everything once a Kite session exists. */
  async start() {
    const s = activeSession();
    this.status.userName = s?.userName ?? null;
    this.status.expiresAt = s?.expiresAt ?? null;
    if (!s) { this.status.state = 'login-required'; this.status.message = 'Connect Kite to stream live prices'; return; }
    if (this.status.state === 'starting' || this.status.state === 'live') return;
    this.status.state = 'starting';
    this.status.message = null;
    try {
      await this.takeLock();
      this.provider?.ticker.stop();
      const provider = new KiteProvider(this.log, (symbols) => this.onTicks(symbols));
      this.provider = provider;
      await provider.loadInstruments();
      this.universe = await this.chooseUniverse(provider);
      this.status.stocks = this.universe.length;
      provider.ticker.subscribe(this.universe.map((x) => provider.tokenFor(x)!), 'full');
      provider.tickListeners.push((ticks) => { const now = nowSec(); for (const t of ticks) this.options.tick(t, now); });
      provider.ticker.start();
      this.recordOptions();
      this.timer ??= setInterval(() => this.everySecond(), 1000);
      this.status.state = 'live';
      this.log(`Live data: streaming ${this.universe.length} instruments`);
      void this.catchUp();
    } catch (e) {
      this.status.state = 'error';
      this.status.message = (e as Error).message;
      this.log(`Live data could not start: ${(e as Error).message}`);
    }
  }

  /**
   * Only one process may stream and write minutes (two would race on the same files). The lock holds this process's
   * id; a lock left by a process that has ended is taken over.
   */
  private async takeLock() {
    const file = path.join(this.store.dir, '..', 'live.lock');
    const other = Number(await readFile(file, 'utf8').catch(() => '0'));
    if (other && other !== process.pid) {
      let alive = true;
      try { process.kill(other, 0); } catch { alive = false; }
      if (alive) throw new Error(`Another data service (process ${other}) is already streaming live data`);
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, String(process.pid));
  }

  stop() {
    this.provider?.ticker.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.state = activeSession() ? 'off' : 'login-required';
  }

  private async chooseUniverse(p: KiteProvider): Promise<string[]> {
    const set = new Set<string>([...LIVE_INDICES, ...VWAP_PROXIES]);
    for (const r of await indexMemberRows('NIFTY 500').catch(() => [])) set.add(r.symbol);
    for (const u of (await fnoUnderlyings().catch(() => ({ underlyings: [] }))).underlyings) if (!u.isIndex) set.add(u.symbol);
    return [...set].filter((x) => p.tokenFor(x) != null).sort();
  }

  private onTicks(symbols: string[]) {
    const now = nowSec();
    for (const s of symbols) {
      const t = this.provider?.lastTick(s);
      if (!t) continue;
      this.builder.tick(s, t.ltpPaise / 100, t.volume, t.time || now);
    }
    this.status.lastTickAt = now;
  }

  /** Adds the strikes near each index (current and next expiry) to the option recording; run again every minute. */
  private recordOptions() {
    const p = this.provider;
    if (!p) return;
    const now = nowSec(), today = dateOfIst(now);
    for (const u of OPTION_UNDERLYINGS) {
      const liveSpot = (p.lastTick(u)?.ltpPaise ?? 0) / 100;
      const spot = liveSpot || dailyHistory(u)?.candles.at(-1)?.close;
      if (!spot) continue;
      const fresh = this.options.add(u, pickContracts(p.optionContracts(u), spot, today));
      if (fresh.length) p.ticker.subscribe(fresh, 'full');
      this.checkCoverage(u, spot, liveSpot ? 'live tick' : 'last daily close', today, now);
    }
    this.status.options.contracts = this.options.size;
    this.optionsCheckedAt = now;
  }

  /**
   * Coverage check, every minute: which strikes the recorder holds for the nearest expiry against the live price, and
   * whether the contracts near the price are actually ticking. Contracts within ±500 of the price with no tick for 3
   * minutes during the session are subscribed again (once a minute at most) and the gap is logged (every 10 minutes).
   */
  private checkCoverage(u: string, spot: number, spotSource: OptionCoverage['spotSource'], today: string, now: number) {
    const p = this.provider;
    if (!p) return;
    const mine = this.options.contractsOf(u).filter((c) => c.expiry >= today);
    const expiry = [...new Set(mine.map((c) => c.expiry))].sort()[0] ?? null;
    const ofExpiry = mine.filter((c) => c.expiry === expiry);
    const strikes = ofExpiry.map((c) => c.strike);
    const near = ofExpiry.filter((c) => Math.abs(c.strike - spot) <= 500);
    const clock = istClock(now);
    const inSession = clock >= 9 + 18 / 60 && clock < 15.5 && spotSource === 'live tick';
    const silent = inSession ? near.filter((c) => now - (this.options.lastTickAt.get(c.token) ?? 0) > 180) : [];
    if (silent.length) p.ticker.resubscribe(silent.map((c) => c.token), 'full');
    this.status.options.coverage[u] = { checkedAt: now, spot, spotSource, expiry, strikes: strikes.length ? [Math.min(...strikes), Math.max(...strikes)] : null, nearSpot: near.length, silent: silent.length, resubscribed: silent.length };
    if ((silent.length || spotSource !== 'live tick') && now - (this.coverageLoggedAt.get(u) ?? 0) >= 600) {
      this.coverageLoggedAt.set(u, now);
      this.log(`Option recorder ${u}: spot ${spot} (${spotSource}), expiry ${expiry}, strikes ${strikes.length ? `${Math.min(...strikes)}–${Math.max(...strikes)}` : 'none'}, ${near.length} near spot, ${silent.length} silent → subscribed again; ticker holds ${p.ticker.count}`);
    }
  }

  private everySecond() {
    const now = nowSec();
    this.builder.flush(now);
    this.options.flush(now);
    if (dateOfIst(now) !== this.optionsDay) { this.optionsDay = dateOfIst(now); this.options.rowsToday = 0; }
    this.status.options.minutesToday = this.options.rowsToday;
    if (now - this.optionsCheckedAt >= 60) this.recordOptions();
    if (!activeSession()) { if (this.status.state === 'live') { this.stop(); this.status.message = 'Kite session ended (6 AM). Connect again.'; } return; }
    // After the close, swap today's live-built minutes for Kite's official ones, once a day.
    const today = dateOfIst(now), weekday = new Date((now + IST) * 1000).getUTCDay();
    if (weekday > 0 && weekday < 6 && istClock(now) >= 15 + 50 / 60 && this.status.correctedOn !== today && !this.status.today.running && this.builder.symbols().length) {
      this.status.correctedOn = today;
      void this.fetchToday(true);
    }
  }

  /** Today's minutes so far (so screens work at once), then the history back-fill. */
  private async catchUp() {
    await this.fetchToday(false);
    await this.backfill();
  }

  /** Downloads today's minutes for every stock: during the session to fill what was missed, after it to correct. */
  async fetchToday(afterClose: boolean, only?: string[]) {
    const p = this.provider;
    if (!p || this.status.today.running) return;
    const list = only ?? this.universe;
    const seams: string[] = [];
    const now = nowSec(), start = istMidnight(now) + 9 * 3600 + 15 * 60;
    if (now < start) return;
    const today = dateOfIst(now);
    this.status.today = { running: true, done: 0, total: list.length };
    const check = { stocks: 0, minutes: 0, close: 0, highLow: 0, volume: 0, missed: 0 };
    for (const s of list) {
      try {
        const bars = (await p.minutes(s, start, now)).filter((b) => dateOfIst(b.time) === today && (afterClose || b.time + 60 <= now));
        if (bars.length && afterClose) {
          // Before the official minutes replace them, compare what the live feed built.
          const live = new Map(this.builder.liveBars(s).map((b) => [b.time, b]));
          if (live.size) check.stocks++;
          for (const o of bars) {
            const l = live.get(o.time);
            if (!l) { if (live.size) check.missed++; continue; }
            check.minutes++;
            if (Math.abs(l.close - o.close) < 0.005) check.close++;
            if (Math.abs(l.high - o.high) < 0.005 && Math.abs(l.low - o.low) < 0.005) check.highLow++;
            if (o.volume ? Math.abs(l.volume / o.volume - 1) <= 0.01 : l.volume === 0) check.volume++;
          }
        }
        if (bars.length) {
          await this.store.replaceDays(s, [today], bars);
          if (this.builder.setToday(s, bars)) seams.push(s);
        }
      } catch (e) {
        if (!activeSession()) break;
        this.log(`Today's minutes for ${s}: ${(e as Error).message}`);
      }
      this.status.today.done++;
    }
    this.status.today.running = false;
    if (afterClose && check.minutes) {
      const pctOf = (n: number) => Math.round((n / check.minutes) * 1000) / 10;
      this.status.liveCheck = { date: today, stocks: check.stocks, minutes: check.minutes, closeSamePct: pctOf(check.close), highLowSamePct: pctOf(check.highLow), volumeWithin1Pct: pctOf(check.volume), missedMinutes: check.missed };
      this.log(`Live vs official minutes ${today}: ${JSON.stringify(this.status.liveCheck)}`);
      await mkdir(path.join(this.store.dir, '..', 'reports'), { recursive: true });
      await writeFile(path.join(this.store.dir, '..', 'reports', `live-check-${today}.json`), JSON.stringify(this.status.liveCheck, null, 1));
    }
    this.version++;
    this.log(`Live data: today's minutes ${afterClose ? 'corrected' : 'loaded'} for ${this.status.today.done} instruments`);
    // Minutes that fell between the download and the first live bar: one more download for those stocks fills them.
    if (!afterClose && !only && seams.length) await this.fetchToday(false, seams);
  }

  /** Fills missing past days (the stock's own trading days from the daily history) for every stock, oldest gaps too. */
  async backfill() {
    const p = this.provider;
    if (!p || this.status.history.running) return;
    const now = nowSec(), today = dateOfIst(now);
    const cutoff = dateOfIst(now - this.historyDays * DAY);
    this.status.history = { running: true, done: 0, total: this.universe.length, failed: 0, days: 0, finishedAt: null };
    for (const s of this.universe) {
      try {
        const traded = tradingDays(s).filter((d) => d >= cutoff && d < today).sort();
        const have = await this.store.days(s, Date.parse(`${cutoff}T00:00:00+05:30`) / 1000);
        const missing = traded.filter((d) => !have.has(d));
        // Consecutive missing trading days are fetched together (the provider splits long spans into 60-day requests).
        for (const run of runs(traded, missing)) {
          const from = Date.parse(`${run[0]}T09:15:00+05:30`) / 1000, to = Date.parse(`${run[run.length - 1]}T15:30:00+05:30`) / 1000;
          const bars = await p.minutes(s, from, to);
          await this.store.replaceDays(s, run, bars.filter((b) => run.includes(dateOfIst(b.time))));
          this.status.history.days += run.length;
        }
      } catch (e) {
        this.status.history.failed++;
        if (!activeSession()) break;
        this.log(`History for ${s}: ${(e as Error).message}`);
      }
      this.status.history.done++;
    }
    this.status.history.running = false;
    this.status.history.finishedAt = nowSec();
    this.version++;
    this.log(`Live data: history back-filled (${this.status.history.days} stock-days, ${this.status.history.failed} failed)`);
  }

  /** NSE's published open and the daily history's adjustment for each day, for re-basing minutes (adjust.ts). */
  /**
   * Stored minutes from `fromTime` up to yesterday, on the daily history's adjusted basis, as bars of each of `tfs`
   * (for backtests; reads the disk store, so it works without a Kite session). Today's minutes are left out until
   * the day is complete.
   */
  async history(symbol: string, tfs: Tf[], fromTime: number): Promise<Map<Tf, Candle[]>> {
    const today = dateOfIst(nowSec());
    const stored = (await this.store.read(symbol, fromTime)).filter((b) => dateOfIst(b.time) < today);
    const adjusted = adjustToEod(stored, this.dayInfo(symbol));
    return new Map(tfs.map((tf) => [tf, tf === '1m' ? adjusted : resample(adjusted, tf)]));
  }

  private dayInfo(symbol: string): DayInfo {
    const raw = rawDays(symbol), adj = dailyHistory(symbol)?.candles ?? [];
    const out: DayInfo = new Map();
    for (const c of adj) { const d = dateOfIst(c.time), r = raw.get(d); if (r?.close) out.set(d, { rawOpen: r.open, adj: c.close / r.close }); }
    return out;
  }

  /**
   * Bars at an intraday timeframe: stored history (adjusted, cached until the day or the store changes) plus today's
   * bars from the live builder; `forming` adds the bar still building.
   */
  async bars(symbol: string, tf: Tf, forming: boolean): Promise<Candle[]> {
    const now = nowSec(), today = dateOfIst(now);
    const key = `${today}|${this.version}`;
    if (key !== this.cacheKey) { this.cache.clear(); this.cacheKey = key; }
    const ck = `${symbol}|${tf}`;
    let past = this.cache.get(ck);
    if (!past) {
      const days = DAYS_FOR[tf] ?? 40;
      const from = istMidnight(now) - Math.ceil(days * 1.5 + 4) * DAY;
      const stored = (await this.store.read(symbol, from)).filter((b) => dateOfIst(b.time) < today);
      const adjusted = adjustToEod(stored, this.dayInfo(symbol));
      past = tf === '1m' ? adjusted : resample(adjusted, tf);
      this.cache.set(ck, past);
    }
    const todays = this.builder.todayBars(symbol, forming);
    return todays.length ? [...past, ...(tf === '1m' ? todays : resample(todays, tf))] : past;
  }

  /** Today's partial daily bar from live minutes, for joining onto the end-of-day history during the session. */
  todayDaily(symbol: string, forming: boolean): Candle | null {
    const m = this.builder.todayBars(symbol, forming);
    if (!m.length) return null;
    return resample(m, 'D')[0] ?? null;
  }
}

/** Splits the missing days into runs of days that are consecutive among the traded ones. */
function runs(traded: string[], missing: string[]): string[][] {
  const miss = new Set(missing), out: string[][] = [];
  let cur: string[] = [];
  for (const d of traded) {
    if (miss.has(d)) cur.push(d);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}
