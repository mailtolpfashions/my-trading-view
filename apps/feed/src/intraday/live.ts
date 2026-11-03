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
import { dailyHistory, rawCloses } from '../eod/store';
import { fnoUnderlyings } from '../fno/analytics';
import { KiteProvider } from '../providers/kite/provider';
import { activeSession } from '../providers/kite/session';
import { indexMemberRows } from '../research/overview';
import { adjustToEod, type DayCloses } from './adjust';
import { MinuteBuilder } from './builder';
import { MinuteStore, dateOfIst } from './store';
import { OptionRecorder, OptionStore, pickContracts } from './options';

const OPTION_UNDERLYINGS = ['NIFTY', 'BANKNIFTY'];

const IST = 5.5 * 3600;
const DAY = 86400;
const LIVE_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
/** Trading days of one-minute history each timeframe needs for its indicators. */
const DAYS_FOR: Partial<Record<Tf, number>> = { '1m': 5, '3m': 10, '5m': 15, '15m': 40, '30m': 60, '1h': 120, '2h': 250, '4h': 250 };
const nowSec = () => Math.floor(Date.now() / 1000);
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
  options: { contracts: number; minutesToday: number };
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
    options: { contracts: 0, minutesToday: 0 },
  };
  readonly optionStore = new OptionStore();
  readonly options = new OptionRecorder((u, rows) => { void this.optionStore.append(u, rows).catch((e) => this.log(`Could not store ${u} option minutes: ${e.message}`)); });
  private optionsCheckedAt = 0;
  private optionsDay = '';

  constructor(private log: (m: string) => void, private historyDays = Number(process.env.INTRADAY_HISTORY_DAYS ?? 365)) {
    this.builder = new MinuteBuilder((symbol, bars) => { void this.store.append(symbol, bars).catch((e) => this.log(`Could not store ${symbol} minutes: ${e.message}`)); });
  }

  get symbols() { return this.universe; }
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
    const set = new Set<string>(LIVE_INDICES);
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
      const spot = (p.lastTick(u)?.ltpPaise ?? 0) / 100 || dailyHistory(u)?.candles.at(-1)?.close;
      if (!spot) continue;
      const fresh = this.options.add(u, pickContracts(p.optionContracts(u), spot, today));
      if (fresh.length) p.ticker.subscribe(fresh, 'full');
    }
    this.status.options.contracts = this.options.size;
    this.optionsCheckedAt = now;
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
    for (const s of list) {
      try {
        const bars = (await p.minutes(s, start, now)).filter((b) => dateOfIst(b.time) === today && (afterClose || b.time + 60 <= now));
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
        const traded = [...rawCloses(s).keys()].filter((d) => d >= cutoff && d < today).sort();
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

  /** Published and adjusted daily closes, for putting minutes on the daily history's adjusted basis. */
  private dayCloses(symbol: string): DayCloses {
    const raw = rawCloses(symbol), adj = dailyHistory(symbol)?.candles ?? [];
    const out: DayCloses = new Map();
    for (const c of adj) { const d = dateOfIst(c.time), r = raw.get(d); if (r) out.set(d, { raw: r, adj: c.close }); }
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
      const adjusted = adjustToEod(stored, this.dayCloses(symbol));
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
