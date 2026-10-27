// NSE official end-of-day history for every stock and index: downloaded politely (one file at a time through
// nseGet, newest first, stopping at the first network error), stored as published, and served as
// corporate-action-adjusted daily candles.

import { prisma } from '@mtv/db';
import type { Candle } from '@mtv/shared';
import { NotPublished, nseGet } from '../nse-http';
import { indexCloseUrl, parseIndexClose, unzipFirstCsv } from '../official/nse-files';
import { datesToFetch } from '../fno/store';
import { INDICES } from '../symbols';
import { unzipSync, strFromU8 } from 'fflate';
import { adjustedCandles, dayTime, findAdjustments, type Adjustment, type CorporateAction, type RawBar, type UnhandledAction } from './adjust';
import { CM_UDIFF_FROM, cmBhavcopyUrl, parseOldCm, parseUdiffCm, type EquityDay } from './bhavcopy';
import { findBcFile, parseBc, parsePurpose, prBundleUrl, type CorporateActionRow } from './corporate';

const RETRY_MS = 30 * 60_000;
const toPaise = (rupees: number) => Math.round(rupees * 100);

type MemBar = RawBar & { isin: string };
type IndexBar = { date: string; openPaise: number; highPaise: number; lowPaise: number; closePaise: number };

// ---- in-memory history, loaded from the database at start and extended as each day is saved ----
const bySymbol = new Map<string, MemBar[]>();
const symbolsByIsin = new Map<string, Set<string>>();
const indexByName = new Map<string, IndexBar[]>();
const actionsBySymbol = new Map<string, CorporateAction[]>();
const dates: string[] = []; // trading dates held, ascending

function addAction(a: CorporateAction) {
  const list = actionsBySymbol.get(a.symbol) ?? [];
  if (!list.some((x) => x.exDate === a.exDate && x.purpose === a.purpose)) list.push(a);
  actionsBySymbol.set(a.symbol, list);
}

function addEquity(b: MemBar) {
  const list = bySymbol.get(b.symbol) ?? [];
  // Bars arrive in date order except during backfill (newest first); keep each list sorted.
  if (list.length && list[list.length - 1].date > b.date) {
    const i = list.findIndex((x) => x.date >= b.date);
    if (list[i]?.date === b.date) list[i] = b; else list.splice(i, 0, b);
  } else if (list.length && list[list.length - 1].date === b.date) list[list.length - 1] = b;
  else list.push(b);
  bySymbol.set(b.symbol, list);
  const s = symbolsByIsin.get(b.isin) ?? new Set<string>();
  s.add(b.symbol);
  symbolsByIsin.set(b.isin, s);
}

function addIndex(name: string, b: IndexBar) {
  const list = indexByName.get(name) ?? [];
  const i = list.findIndex((x) => x.date >= b.date);
  if (i < 0) list.push(b); else if (list[i].date === b.date) list[i] = b; else list.splice(i, 0, b);
  indexByName.set(name, list);
}

function addDate(d: string) {
  const i = dates.findIndex((x) => x >= d);
  if (i < 0) dates.push(d); else if (dates[i] !== d) dates.splice(i, 0, d);
}

/** Loads all stored history into memory, a month at a time. */
export async function loadEod(log: (m: string) => void): Promise<void> {
  const all = (await prisma.eodFetch.findMany({ where: { status: 'saved' }, select: { date: true }, orderBy: { date: 'asc' } })).map((f) => f.date);
  for (let i = 0; i < all.length; i += 21) {
    const chunk = all.slice(i, i + 21);
    const [eq, ix] = await Promise.all([
      prisma.equityEod.findMany({ where: { date: { in: chunk } }, orderBy: { date: 'asc' } }),
      prisma.indexEod.findMany({ where: { date: { in: chunk } } }),
    ]);
    for (const r of eq) addEquity({ date: r.date, symbol: r.symbol, isin: r.isin, openPaise: r.openPaise, highPaise: r.highPaise, lowPaise: r.lowPaise, closePaise: r.closePaise, prevClosePaise: r.prevClosePaise, volume: Number(r.volume) });
    for (const r of ix) addIndex(r.name, r);
    chunk.forEach(addDate);
  }
  for (const a of await prisma.corporateAction.findMany({ select: { symbol: true, exDate: true, purpose: true } })) addAction(a);
  log(`NSE end-of-day history: ${dates.length} days, ${bySymbol.size} stocks in memory`);
}

// ---- download and save ----
/** Downloads one trading day: the equity bhavcopy, NSE's index closes, and the PR bundle's corporate-action file. */
export async function fetchEodDay(date: string): Promise<{ day: EquityDay; indices: Map<string, IndexBar>; actions: CorporateActionRow[] }> {
  const zip = new Uint8Array(await (await nseGet(cmBhavcopyUrl(date))).arrayBuffer());
  const csv = unzipFirstCsv(zip);
  const day = date >= CM_UDIFF_FROM ? parseUdiffCm(csv, date) : parseOldCm(csv, date);
  const closes = parseIndexClose(await (await nseGet(indexCloseUrl(date))).text());
  if (day.rows.length < 500) throw new Error(`${date}: equity file looks incomplete (${day.rows.length} stocks)`);
  if (!closes.has('NIFTY 50')) throw new Error(`${date}: index file has no NIFTY 50`);
  const indices = new Map([...closes].map(([name, b]) => [name, { date, openPaise: toPaise(b.open), highPaise: toPaise(b.high), lowPaise: toPaise(b.low), closePaise: toPaise(b.close) }]));
  const pr = unzipSync(new Uint8Array(await (await nseGet(prBundleUrl(date))).arrayBuffer()));
  const bcName = findBcFile(Object.keys(pr));
  if (!bcName) throw new Error(`${date}: PR bundle format changed: no corporate action (Bc) file`);
  return { day, indices, actions: parseBc(strFromU8(pr[bcName])) };
}

export async function saveEodDay({ day, indices, actions }: Awaited<ReturnType<typeof fetchEodDay>>) {
  const eq = day.rows.map((r) => ({
    date: day.date, symbol: r.symbol, isin: r.isin, series: r.series,
    openPaise: toPaise(r.open), highPaise: toPaise(r.high), lowPaise: toPaise(r.low), closePaise: toPaise(r.close), prevClosePaise: toPaise(r.prevClose),
    volume: BigInt(Math.round(r.volume)), trades: r.trades,
  }));
  const ix = [...indices].map(([name, b]) => ({ name, ...b }));
  const message = day.rejected.length ? `${day.rejected.length} rows rejected: ${day.rejected.slice(0, 10).map((r) => `${r.symbol} (${r.reason})`).join('; ')}` : null;
  await prisma.$transaction(async (tx) => {
    await tx.equityEod.deleteMany({ where: { date: day.date } });
    await tx.indexEod.deleteMany({ where: { date: day.date } });
    for (let i = 0; i < eq.length; i += 2000) await tx.equityEod.createMany({ data: eq.slice(i, i + 2000) });
    await tx.indexEod.createMany({ data: ix });
    await tx.corporateAction.createMany({ data: actions.map((a) => ({ ...a, firstSeen: day.date })), skipDuplicates: true });
    await tx.eodFetch.upsert({ where: { date: day.date }, create: { date: day.date, status: 'saved', message }, update: { status: 'saved', message, attempts: { increment: 1 } } });
  }, { timeout: 120_000 });
  for (const r of eq) addEquity({ ...r, volume: Number(r.volume) });
  for (const r of ix) addIndex(r.name, r);
  for (const a of actions) addAction(a);
  addDate(day.date);
}

const recordFetch = (date: string, status: string, message?: string) =>
  prisma.eodFetch.upsert({ where: { date }, create: { date, status, message }, update: { status, message, attempts: { increment: 1 } } });

let running = false;
/** True once a sync has finished with every published day stored: until then the history has gaps. */
let complete = false;
export const eodComplete = () => complete;
const listeners: ((date: string) => unknown)[] = [];
/** Called with the latest date once the history is complete and up to date (e.g. to issue that evening's signals). */
export const onEodReady = (fn: (date: string) => unknown) => listeners.push(fn);

/** Downloads missing days. Returns how many were saved, or null if the run paused on a network error (or was already running). */
export async function syncEod(from: string, log: (m: string) => void): Promise<number | null> {
  if (running) return null;
  running = true;
  try {
    const done = new Set((await prisma.eodFetch.findMany({ where: { status: { in: ['saved', 'not-published'] } }, select: { date: true } })).map((f) => f.date));
    const todo = datesToFetch(from, Date.now() / 1000).filter((d) => !done.has(d)).reverse();
    if (todo.length) log(`NSE equity history: ${todo.length} trading days to download`);
    let saved = 0;
    for (const date of todo) {
      try {
        const got = await fetchEodDay(date);
        await saveEodDay(got);
        saved++;
        if (got.day.rejected.length) log(`NSE equity ${date}: ${got.day.rejected.length} rows rejected (see /api/eod/status)`);
        if (saved % 25 === 0) log(`NSE equity history: ${saved}/${todo.length} days saved (latest ${date})`);
      } catch (e) {
        if (e instanceof NotPublished) { await recordFetch(date, 'not-published'); continue; }
        const msg = (e as Error).message;
        await recordFetch(date, 'error', msg);
        if (/format changed|incomplete|no NIFTY/.test(msg)) { log(`NSE equity ${date}: ${msg}`); continue; }
        log(`NSE equity sync paused at ${date}: ${msg}. Retrying in 30 minutes.`);
        return null;
      }
    }
    if (todo.length) log(`NSE equity history: up to date (${saved} new days)`);
    // Days that failed for a data reason are retried later; the history is only complete without them.
    complete = (await prisma.eodFetch.count({ where: { status: 'error' } })) === 0;
    return saved;
  } finally {
    running = false;
  }
}

/**
 * Loads stored history, then downloads missing days now and every 30 minutes. Listeners run after the first
 * complete sync and after every sync that saved a new day: never on a half-downloaded history.
 */
export function startEodSync(from: string, log: (m: string) => void) {
  let notifiedOnce = false;
  const run = async () => {
    try {
      const saved = await syncEod(from, log);
      const latest = dates[dates.length - 1];
      if (saved === null || !latest || (saved === 0 && notifiedOnce)) return;
      notifiedOnce = true;
      for (const fn of listeners) await Promise.resolve(fn(latest)).catch((e) => log(`After NSE sync: ${(e as Error).message}`));
    } catch (e) {
      log(`NSE equity sync failed, will retry: ${(e as Error).message.split('\n').slice(-2).join(' ')}`);
    }
  };
  setTimeout(() => void loadEod(log).then(run, (e) => log(`Loading NSE history failed: ${(e as Error).message}`)), 5_000);
  setInterval(run, RETRY_MS);
}

// ---- reading ----

/** A stock's bars, following a symbol change back through its ISIN (e.g. a renamed company keeps its history). */
function lineage(symbol: string): MemBar[] {
  const own = bySymbol.get(symbol);
  if (!own?.length) return [];
  const first = own[0];
  // Another symbol that had this ISIN and stopped trading just before this one started.
  const earlier = [...(symbolsByIsin.get(first.isin) ?? [])]
    .filter((s) => s !== symbol)
    .map((s) => bySymbol.get(s)!)
    .filter((l) => l.length && l[l.length - 1].date < first.date)
    .sort((a, b) => (a[a.length - 1].date < b[b.length - 1].date ? 1 : -1))[0];
  return earlier ? [...lineage(earlier[0].symbol).filter((b) => b.date < first.date), ...own] : own;
}

export type DailyHistory = { candles: Candle[]; adjustments: Adjustment[]; unhandled: UnhandledAction[]; from: string; to: string };

/** Adjusted daily candles for a stock, or for one of our indices. Null if we hold no history for it. */
export function dailyHistory(symbol: string): DailyHistory | null {
  const index = INDICES.find((i) => i.symbol === symbol);
  if (index) {
    const list = index.nseName ? indexByName.get(index.nseName) : undefined;
    if (!list?.length) return null;
    const candles = list.map((b) => ({ time: dayTime(b.date), open: b.openPaise / 100, high: b.highPaise / 100, low: b.lowPaise / 100, close: b.closePaise / 100, volume: 0 }));
    return { candles, adjustments: [], unhandled: [], from: list[0].date, to: list[list.length - 1].date };
  }
  const bars = lineage(symbol);
  if (!bars.length) return null;
  const actions = [...new Set(bars.map((b) => b.symbol))].flatMap((s) => actionsBySymbol.get(s) ?? []);
  const { adjustments, unhandled } = findAdjustments(bars, actions);
  return { candles: adjustedCandles(bars, adjustments), adjustments, unhandled, from: bars[0].date, to: bars[bars.length - 1].date };
}

/** Stocks that traded on the latest stored day. */
export function eodUniverse(): string[] {
  const last = dates[dates.length - 1];
  if (!last) return [];
  return [...bySymbol].filter(([, l]) => l[l.length - 1].date === last).map(([s]) => s).sort();
}

export const eodLatestDate = () => dates[dates.length - 1] ?? null;

/** Every stock with stored history, including ones no longer traded (backtests must include them). */
export const allEodSymbols = () => [...bySymbol.keys()].sort();

/** The latest bar as NSE published it (not adjusted). */
export const lastRawBar = (symbol: string): RawBar | undefined => bySymbol.get(symbol)?.at(-1);

export async function eodStatus() {
  const [saved, holidays, errors] = await Promise.all([
    prisma.eodFetch.count({ where: { status: 'saved' } }),
    prisma.eodFetch.count({ where: { status: 'not-published' } }),
    prisma.eodFetch.findMany({ where: { OR: [{ status: 'error' }, { message: { not: null } }] }, select: { date: true, status: true, message: true }, orderBy: { date: 'desc' }, take: 30 }),
  ]);
  // Corporate actions we could not apply automatically, for review (rights issues, demergers, new wording…).
  const unhandled = new Map<string, string[]>();
  for (const [symbol, list] of actionsBySymbol) {
    for (const a of list) {
      for (const p of parsePurpose(a.purpose)) {
        if (p.kind === 'unhandled') unhandled.set(p.reason, [...(unhandled.get(p.reason) ?? []), `${symbol} ${a.exDate}`]);
      }
    }
  }
  return {
    savedDays: saved, holidays, complete, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, stocks: bySymbol.size, universe: eodUniverse().length, running, issues: errors,
    corporateActions: [...actionsBySymbol.values()].reduce((n, l) => n + l.length, 0),
    unhandledActions: [...unhandled].map(([reason, where]) => ({ reason, count: where.length, examples: where.slice(0, 5) })).sort((a, b) => b.count - a.count),
  };
}
