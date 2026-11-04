// The owner's own data: saved screens (with their run history), watchlists and recently run screens. One JSON file in
// .userdata/ at the repo root (git-ignored). Writes are serialised, go to a temp file that then replaces the old one,
// and the previous version is kept as .bak, so a crash mid-write never loses the file. Single user for now; every
// record carries owner and visibility so sharing can be added later without reshaping the data.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { Tf } from '@mtv/rules';
import type { UniverseFilters, UniverseSpec } from '../screener/universe';

export type ScreenCategory = 'technical' | 'fundamental' | 'fno' | 'custom';
export type RunRecord = { at: string; asOf: string | null; matches: number; scanned: number; ms: number };

export type SavedScreen = {
  id: string;
  owner: string;
  visibility: 'private';
  name: string;
  category: ScreenCategory;
  formula: string;
  tf: Tf;
  candle: 'closed' | 'live';
  universe: UniverseSpec;
  filters: UniverseFilters;
  columns: string[];
  favourite: boolean;
  createdAt: string;
  updatedAt: string;
  /** Newest first, at most 50. */
  runs: RunRecord[];
};

export type Watchlist = { id: string; owner: string; name: string; symbols: string[]; createdAt: string; updatedAt: string };
export type RecentRun = RunRecord & { screenId: string | null; name: string; formula: string; tf: Tf };

export type BacktestRecord = { at: string; from: string; to: string; trades: number; returnPct: number; cagrPct: number; maxDrawdownPct: number; winRatePct: number | null };
export type SavedStrategy = {
  id: string;
  owner: string;
  visibility: 'private';
  name: string;
  description: string;
  /** The engine's settings (packages/backtest EquityStrategy), stored as given. */
  strategy: Record<string, unknown>;
  universe: UniverseSpec;
  createdAt: string;
  updatedAt: string;
  /** Newest first, at most 50. */
  backtests: BacktestRecord[];
};

/** One paper trade of the option-selling rule. Money is integer paise at the lot traded. */
export type SellingPaperTrade = {
  id: string;
  /** Which paper rule made it. Trades from before there were two rules have none, and belong to the first. */
  rule?: 'paper-rule' | 'paper-straddle';
  openedOn: string;
  expiry: string;
  exitOn: string;
  spotPaise: number;
  creditPaise: number;
  legs: { expiry: string; strikePaise: number; kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; qty: number; entryPaise: number; role: 'short' | 'wing' }[];
  chargesPaise: number;
  status: 'open' | 'closed';
  closedOn: string | null;
  why: string | null;
  netPaise: number | null;
  lastMarkOn: string;
  lastPnlPaise: number;
};

export type AlertChannel = 'inApp' | 'telegram' | 'email' | 'whatsapp';
export type Alert = {
  id: string;
  owner: string;
  name: string;
  /** What is watched: a saved screen, or a saved strategy's entry rule. */
  source: { kind: 'screen'; id: string } | { kind: 'strategy'; id: string };
  /** first: a stock alerts when it newly matches (again only after it stopped matching); every: on every check. */
  trigger: 'first' | 'every';
  /** market: checks only between 09:15 and 15:30 IST on weekdays (plus the evening end-of-day check). */
  session: 'market' | 'always';
  channels: AlertChannel[];
  /** Last day to run, YYYY-MM-DD; null = until paused. */
  until: string | null;
  enabled: boolean;
  createdAt: string;
  lastCheckAt: string | null;
  /** What the last check was based on (a bar time or an end-of-day date), so a check never runs twice for it. */
  lastBasis: string | null;
  lastError: string | null;
  /** Stocks matching at the last check; null before the first (baseline) check. */
  matching: string[] | null;
};
export type AlertEvent = {
  id: string; alertId: string; alertName: string; at: string; read: boolean;
  /** Stocks that triggered, with the price and bar of the check. */
  hits: { symbol: string; price: number; bar: string }[];
  /** A note instead of hits (the baseline check, or a delivery problem). */
  note: string | null;
  delivered: Partial<Record<AlertChannel, string>>;
};

/** The owner's trading mode for the day and the day's limits (the Today page). */
export type DaySettings = {
  mode: 'intraday' | 'swing' | 'positional';
  capitalRupees: number;
  /** Risk on one trade, % of capital (sizes trade plans). */
  riskPerTradePct: number;
  /** Stop trading for the day after losing this much. */
  maxDailyLossRupees: number;
  maxTradesPerDay: number;
};
export const DEFAULT_SETTINGS: DaySettings = { mode: 'intraday', capitalRupees: 500000, riskPerTradePct: 1, maxDailyLossRupees: 10000, maxTradesPerDay: 5 };

type Data = { version: 1; sellingPaper?: SellingPaperTrade[]; settings?: DaySettings; screens: SavedScreen[]; watchlists: Watchlist[]; recent: RecentRun[]; strategies?: SavedStrategy[]; alerts?: Alert[]; alertEvents?: AlertEvent[] };

export class UserStoreError extends Error {}

const MAX_RUNS = 50, MAX_RECENT = 30, MAX_SYMBOLS = 1000;
const OWNER = 'owner';

export class UserStore {
  private data: Data | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file = path.resolve(import.meta.dirname, '../../../../.userdata/user.json')) {}

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8')) as Data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new UserStoreError(`Your saved data file could not be read (${(e as Error).message}). It was left untouched; the last good copy is ${this.file}.bak`);
      this.data = { version: 1, screens: [], watchlists: [], recent: [] };
    }
    return this.data;
  }

  /** Runs `fn` on the data and saves it, one change at a time. */
  private change<T>(fn: (d: Data) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const d = await this.load();
      const out = fn(d);
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(d, null, 1));
      await copyFile(this.file, `${this.file}.bak`).catch(() => {}); // no previous file yet
      await rename(tmp, this.file);
      return out;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async screens(): Promise<SavedScreen[]> {
    return [...(await this.load()).screens].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async screen(id: string): Promise<SavedScreen | null> {
    return (await this.load()).screens.find((s) => s.id === id) ?? null;
  }

  /** Creates a screen, or updates the one with this id (its run history and favourite flag are kept). */
  async saveScreen(input: Omit<SavedScreen, 'id' | 'owner' | 'visibility' | 'createdAt' | 'updatedAt' | 'runs' | 'favourite'> & { id?: string; favourite?: boolean }): Promise<SavedScreen> {
    const name = input.name?.trim();
    if (!name) throw new UserStoreError('Give the screen a name');
    if (!input.formula?.trim()) throw new UserStoreError('A screen needs at least one condition');
    return this.change((d) => {
      const now = new Date().toISOString();
      const fields = { name: name.slice(0, 120), category: input.category, formula: input.formula, tf: input.tf, candle: input.candle, universe: input.universe, filters: input.filters ?? {}, columns: (input.columns ?? []).slice(0, 20) };
      const existing = input.id ? d.screens.find((s) => s.id === input.id) : undefined;
      if (input.id && !existing) throw new UserStoreError('That screen no longer exists');
      if (existing) {
        Object.assign(existing, fields, { favourite: input.favourite ?? existing.favourite, updatedAt: now });
        return existing;
      }
      const s: SavedScreen = { id: randomUUID(), owner: OWNER, visibility: 'private', ...fields, favourite: input.favourite ?? false, createdAt: now, updatedAt: now, runs: [] };
      d.screens.push(s);
      return s;
    });
  }

  deleteScreen(id: string): Promise<void> {
    return this.change((d) => { d.screens = d.screens.filter((s) => s.id !== id); });
  }

  setFavourite(id: string, favourite: boolean): Promise<SavedScreen> {
    return this.change((d) => {
      const s = d.screens.find((x) => x.id === id);
      if (!s) throw new UserStoreError('That screen no longer exists');
      s.favourite = favourite;
      return s;
    });
  }

  /** Records a run in the recent list, and in the screen's own history when it was a saved screen. */
  recordRun(r: RecentRun): Promise<void> {
    return this.change((d) => {
      d.recent = [r, ...d.recent].slice(0, MAX_RECENT);
      const s = r.screenId ? d.screens.find((x) => x.id === r.screenId) : undefined;
      if (s) s.runs = [{ at: r.at, asOf: r.asOf, matches: r.matches, scanned: r.scanned, ms: r.ms }, ...s.runs].slice(0, MAX_RUNS);
    });
  }

  async recent(): Promise<RecentRun[]> {
    return (await this.load()).recent;
  }

  async strategies(): Promise<SavedStrategy[]> {
    return [...((await this.load()).strategies ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Creates a strategy, or updates the one with this id (its backtest history is kept). */
  async saveStrategy(input: { id?: string; name: string; description?: string; strategy: Record<string, unknown>; universe: UniverseSpec }): Promise<SavedStrategy> {
    const name = input.name?.trim();
    if (!name) throw new UserStoreError('Give the strategy a name');
    if (!input.strategy || typeof input.strategy !== 'object') throw new UserStoreError('The strategy settings are missing');
    return this.change((d) => {
      d.strategies ??= [];
      const now = new Date().toISOString();
      const fields = { name: name.slice(0, 120), description: (input.description ?? '').slice(0, 2000), strategy: input.strategy, universe: input.universe };
      const existing = input.id ? d.strategies.find((x) => x.id === input.id) : undefined;
      if (input.id && !existing) throw new UserStoreError('That strategy no longer exists');
      if (existing) { Object.assign(existing, fields, { updatedAt: now }); return existing; }
      const st: SavedStrategy = { id: randomUUID(), owner: OWNER, visibility: 'private', ...fields, createdAt: now, updatedAt: now, backtests: [] };
      d.strategies.push(st);
      return st;
    });
  }

  deleteStrategy(id: string): Promise<void> {
    return this.change((d) => { d.strategies = (d.strategies ?? []).filter((x) => x.id !== id); });
  }

  recordBacktest(id: string, r: BacktestRecord): Promise<void> {
    return this.change((d) => {
      const st = d.strategies?.find((x) => x.id === id);
      if (st) st.backtests = [r, ...st.backtests].slice(0, MAX_RUNS);
    });
  }

  async settings(): Promise<DaySettings> {
    return { ...DEFAULT_SETTINGS, ...(await this.load()).settings };
  }

  saveSettings(input: Partial<DaySettings>): Promise<DaySettings> {
    const next = { ...DEFAULT_SETTINGS, ...input };
    if (!['intraday', 'swing', 'positional'].includes(next.mode)) throw new UserStoreError('Pick intraday, swing or positional');
    if (!(next.capitalRupees > 0)) throw new UserStoreError('Capital must be above zero');
    if (!(next.riskPerTradePct > 0 && next.riskPerTradePct <= 10)) throw new UserStoreError('Risk per trade must be above 0 and at most 10%');
    if (!(next.maxDailyLossRupees > 0)) throw new UserStoreError('The daily loss limit must be above zero');
    if (!(Number.isInteger(next.maxTradesPerDay) && next.maxTradesPerDay >= 1)) throw new UserStoreError('Trades per day must be a whole number, at least 1');
    return this.change((d) => {
      d.settings = { ...DEFAULT_SETTINGS, ...d.settings, ...input };
      return d.settings;
    });
  }

  async alerts(): Promise<Alert[]> {
    return [...((await this.load()).alerts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveAlert(input: Pick<Alert, 'name' | 'source' | 'trigger' | 'session' | 'channels' | 'until'> & { id?: string; enabled?: boolean }): Promise<Alert> {
    const name = input.name?.trim();
    if (!name) throw new UserStoreError('Give the alert a name');
    if (!input.channels?.length) throw new UserStoreError('Pick at least one way to be told');
    if (input.until && !/^\d{4}-\d{2}-\d{2}$/.test(input.until)) throw new UserStoreError('The end date must be a date');
    return this.change((d) => {
      d.alerts ??= [];
      const exists = input.source.kind === 'screen' ? d.screens.some((x) => x.id === input.source.id) : (d.strategies ?? []).some((x) => x.id === input.source.id);
      if (!exists) throw new UserStoreError(`That saved ${input.source.kind} no longer exists`);
      const fields = { name: name.slice(0, 120), source: input.source, trigger: input.trigger, session: input.session, channels: [...new Set(input.channels)], until: input.until || null };
      const existing = input.id ? d.alerts.find((a) => a.id === input.id) : undefined;
      if (input.id && !existing) throw new UserStoreError('That alert no longer exists');
      if (existing) {
        // What is watched changed: start again from a fresh baseline.
        const reset = JSON.stringify(existing.source) !== JSON.stringify(fields.source);
        Object.assign(existing, fields, { enabled: input.enabled ?? existing.enabled }, reset ? { matching: null, lastBasis: null } : {});
        return existing;
      }
      const a: Alert = { id: randomUUID(), owner: OWNER, ...fields, enabled: input.enabled ?? true, createdAt: new Date().toISOString(), lastCheckAt: null, lastBasis: null, lastError: null, matching: null };
      d.alerts.push(a);
      return a;
    });
  }

  setAlertEnabled(id: string, enabled: boolean): Promise<Alert> {
    return this.change((d) => {
      const a = d.alerts?.find((x) => x.id === id);
      if (!a) throw new UserStoreError('That alert no longer exists');
      a.enabled = enabled;
      return a;
    });
  }

  deleteAlert(id: string): Promise<void> {
    return this.change((d) => { d.alerts = (d.alerts ?? []).filter((a) => a.id !== id); });
  }

  /** Records a check's outcome on the alert, and its event (if any), newest first, at most 1,000 kept. */
  recordAlertCheck(id: string, patch: Partial<Pick<Alert, 'lastCheckAt' | 'lastBasis' | 'lastError' | 'matching'>>, event?: Omit<AlertEvent, 'id' | 'read'>): Promise<AlertEvent | null> {
    return this.change((d) => {
      const a = d.alerts?.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
      if (!event) return null;
      const e: AlertEvent = { id: randomUUID(), read: false, ...event };
      d.alertEvents = [e, ...(d.alertEvents ?? [])].slice(0, 1000);
      return e;
    });
  }

  async alertEvents(): Promise<AlertEvent[]> {
    return (await this.load()).alertEvents ?? [];
  }

  markAlertEventsRead(ids?: string[]): Promise<void> {
    return this.change((d) => { for (const e of d.alertEvents ?? []) if (!ids || ids.includes(e.id)) e.read = true; });
  }

  async sellingPaper(): Promise<SellingPaperTrade[]> {
    return (await this.load()).sellingPaper ?? [];
  }

  saveSellingPaper(trades: SellingPaperTrade[]): Promise<void> {
    return this.change((d) => { d.sellingPaper = trades; });
  }

  async watchlists(): Promise<Watchlist[]> {
    return [...(await this.load()).watchlists].sort((a, b) => a.name.localeCompare(b.name));
  }

  async watchlist(id: string): Promise<Watchlist | null> {
    return (await this.load()).watchlists.find((w) => w.id === id) ?? null;
  }

  /** Creates a watchlist or replaces the name and symbols of an existing one. Symbols are upper-cased and de-duplicated. */
  async saveWatchlist(input: { id?: string; name: string; symbols: string[] }): Promise<Watchlist> {
    const name = input.name?.trim();
    if (!name) throw new UserStoreError('Give the watchlist a name');
    const symbols = clean(input.symbols);
    return this.change((d) => {
      const now = new Date().toISOString();
      const existing = input.id ? d.watchlists.find((w) => w.id === input.id) : undefined;
      if (input.id && !existing) throw new UserStoreError('That watchlist no longer exists');
      if (existing) { Object.assign(existing, { name: name.slice(0, 80), symbols, updatedAt: now }); return existing; }
      const w: Watchlist = { id: randomUUID(), owner: OWNER, name: name.slice(0, 80), symbols, createdAt: now, updatedAt: now };
      d.watchlists.push(w);
      return w;
    });
  }

  /** Adds symbols to a watchlist (already present ones are skipped). */
  addToWatchlist(id: string, symbols: string[]): Promise<Watchlist> {
    return this.change((d) => {
      const w = d.watchlists.find((x) => x.id === id);
      if (!w) throw new UserStoreError('That watchlist no longer exists');
      w.symbols = clean([...w.symbols, ...symbols]);
      w.updatedAt = new Date().toISOString();
      return w;
    });
  }

  deleteWatchlist(id: string): Promise<void> {
    return this.change((d) => { d.watchlists = d.watchlists.filter((w) => w.id !== id); });
  }
}

function clean(symbols: string[]): string[] {
  const out = [...new Set((symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z0-9&_-]{1,20}$/.test(s)))];
  if (out.length > MAX_SYMBOLS) throw new UserStoreError(`A watchlist holds at most ${MAX_SYMBOLS} stocks`);
  return out;
}

export const userStore = new UserStore();
