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

type Data = { version: 1; screens: SavedScreen[]; watchlists: Watchlist[]; recent: RecentRun[]; strategies?: SavedStrategy[] };

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
