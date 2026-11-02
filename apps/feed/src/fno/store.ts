// Stores NSE's official F&O end-of-day data and downloads it politely: one request at a time with a pause between,
// stopping at the first network error and resuming later. Each date is recorded (saved / holiday / error) so no file
// is ever downloaded twice.
//
// Coverage: index F&O (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50, …) for every day, and stock F&O from
// STOCKS_FROM (the UDiFF layout, which carries each stock's lot size and price). Days saved with less coverage than
// that are downloaded again, newest first.

import { prisma } from '@mtv/db';
import { NotPublished, nseGet as download } from '../nse-http';
import { unzipFirstCsv, officialIndexCloses } from '../official/nse-files';
import { unzipSync } from 'fflate';
import { prBundleUrl } from '../eod/corporate';
import { CORE_UNDERLYINGS, UDIFF_FROM, fnoBhavcopyUrl, parseOldFo, parseUdiffFo, type FnoDay, type FnoScope } from './bhavcopy';
import { deriveDay } from './derive';
import { missIsFinal } from '../fetch-log';

const PAUSE_MS = 4000;
const RETRY_MS = 30 * 60_000;
const PUBLISH_AFTER = (18 * 60 + 30) * 60; // seconds after IST midnight
/** NSE's index-close file names for index underlyings (old-layout days take the underlying price from that file). */
const INDEX_NAMES: Record<string, string> = { NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK', FINNIFTY: 'NIFTY FINANCIAL SERVICES', MIDCPNIFTY: 'NIFTY MIDCAP SELECT', NIFTYNXT50: 'NIFTY NEXT 50' };
/** Stock F&O is stored from the first UDiFF day: the old layout has no stock lot sizes or prices. */
export const STOCKS_FROM = UDIFF_FROM;
export const scopeFor = (date: string): FnoScope => (date >= STOCKS_FROM ? 'all' : 'index');
/**
 * What FnoFetch.scope records for a saved day. 'all-v2': UDiFF days saved with a lot size per expiry (2 Nov 2026);
 * days saved as plain 'all' before that are downloaded again.
 */
export const savedScopeFor = (date: string) => (scopeFor(date) === 'all' ? 'all-v2' : 'index');
const toPaise = (rupees: number) => Math.round(rupees * 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Downloads and parses one trading day. Old-layout days also fetch NSE's index-close file for the underlying price. */
export async function fetchFnoDay(date: string, scope = scopeFor(date)): Promise<FnoDay> {
  const zip = new Uint8Array(await (await download(fnoBhavcopyUrl(date))).arrayBuffer());
  const csv = unzipFirstCsv(zip);
  const day = date >= UDIFF_FROM ? parseUdiffFo(csv, date, scope) : parseOldFo(csv, date, scope);
  if (date < UDIFF_FROM) {
    await sleep(PAUSE_MS);
    const closes = await officialIndexCloses(date, download, async () => unzipSync(new Uint8Array(await (await download(prBundleUrl(date))).arrayBuffer())), (e) => e instanceof NotPublished);
    for (const u of day.indices) day.spot[u] = INDEX_NAMES[u] ? closes.get(INDEX_NAMES[u])?.close ?? null : null;
  }
  for (const u of CORE_UNDERLYINGS) {
    if (!day.rows.some((r) => r.underlying === u)) throw new Error(`${date}: no ${u} contracts in the F&O file`);
  }
  return day;
}

export async function saveFnoDay(day: FnoDay, scope = savedScopeFor(day.date)) {
  const rows = day.rows.map((r) => ({
    date: day.date, underlying: r.underlying, kind: r.kind, expiry: r.expiry, strikePaise: r.strike == null ? 0 : toPaise(r.strike),
    openPaise: toPaise(r.open), highPaise: toPaise(r.high), lowPaise: toPaise(r.low), closePaise: toPaise(r.close), settlePaise: toPaise(r.settle),
    oi: BigInt(Math.round(r.oi)), volume: BigInt(Math.round(r.volume)), traded: r.traded,
  }));
  const derived = deriveDay(day);
  const underlyings = [...new Set(day.rows.map((r) => r.underlying))];
  await prisma.$transaction(async (tx) => {
    await tx.fnoEod.deleteMany({ where: { date: day.date } });
    for (let i = 0; i < rows.length; i += 2000) await tx.fnoEod.createMany({ data: rows.slice(i, i + 2000) });
    await tx.fnoDayMeta.deleteMany({ where: { date: day.date } });
    await tx.fnoDayMeta.createMany({ data: underlyings.map((u) => ({
      date: day.date, underlying: u, lotSize: day.lotSize[u] ?? null, spotPaise: day.spot[u] != null ? toPaise(day.spot[u]!) : null,
      source: day.date >= UDIFF_FROM ? 'udiff' : 'old', isIndex: day.indices.has(u),
    })) });
    await tx.fnoDerivedDay.deleteMany({ where: { date: day.date } });
    for (let i = 0; i < derived.length; i += 2000) await tx.fnoDerivedDay.createMany({ data: derived.slice(i, i + 2000) });
    await tx.fnoFetch.upsert({ where: { date: day.date }, create: { date: day.date, status: 'saved', scope }, update: { status: 'saved', scope, message: null, attempts: { increment: 1 } } });
  }, { timeout: 120_000 });
}

const recordFetch = (date: string, status: string, message?: string) =>
  prisma.fnoFetch.upsert({ where: { date }, create: { date, status, message }, update: { status, message, attempts: { increment: 1 } } });

/**
 * Dates from `from` up to the latest date whose files should be published (today only after 18:30 IST). Weekdays
 * by default; with `weekends`, every day, because NSE also trades in special weekend sessions (Diwali Muhurat
 * trading, Budget-day and Saturday sessions) and a weekend with no session simply has no file.
 */
export function datesToFetch(from: string, nowSec: number, weekends = false): string[] {
  const local = new Date((nowSec + 5.5 * 3600) * 1000);
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if ((nowSec + 5.5 * 3600) % 86400 < PUBLISH_AFTER) end.setUTCDate(end.getUTCDate() - 1);
  const out: string[] = [];
  for (const d = new Date(from + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (weekends || (wd !== 0 && wd !== 6)) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

let running = false;

/** Fetches missing days, newest first, one at a time. Stops at the first network error (resumes on the next run). */
export async function syncFno(from: string, log: (m: string) => void): Promise<void> {
  if (running) return;
  running = true;
  try {
    // A day is done when NSE published nothing, or when it was saved with the coverage its date needs.
    const fetched = await prisma.fnoFetch.findMany({ where: { status: { in: ['saved', 'not-published'] } }, select: { date: true, status: true, scope: true, updatedAt: true } });
    const done = new Set(fetched.filter((f) => (f.status === 'not-published' ? missIsFinal(f.date, f.updatedAt) : f.scope === savedScopeFor(f.date))).map((f) => f.date));
    const todo = datesToFetch(from, Date.now() / 1000, true).filter((d) => !done.has(d)).reverse(); // incl. weekend special sessions
    if (todo.length) log(`F&O history: ${todo.length} trading days to download`);
    let saved = 0;
    for (const date of todo) {
      try {
        await saveFnoDay(await fetchFnoDay(date));
        saved++;
        if (saved % 25 === 0) log(`F&O history: ${saved}/${todo.length} days saved (latest ${date})`);
      } catch (e) {
        if (e instanceof NotPublished) { await recordFetch(date, 'not-published'); continue; }
        const msg = (e as Error).message;
        await recordFetch(date, 'error', msg);
        // A format or data problem on one day is recorded and skipped; a network problem stops the run.
        if (/format changed|Invalid number|Inconsistent|no .* contracts/.test(msg)) { log(`F&O ${date}: ${msg}`); continue; }
        log(`F&O sync paused at ${date}: ${msg}. Retrying in 30 minutes.`);
        return;
      } finally {
        await sleep(PAUSE_MS);
      }
    }
    if (todo.length) log(`F&O history: up to date (${saved} new days)`);
  } finally {
    running = false;
  }
}

/** Runs the sync now and every 30 minutes. Failures (e.g. the database still starting) are logged, never fatal. */
export function startFnoSync(from: string, log: (m: string) => void) {
  const run = () => syncFno(from, log).catch((e) => log(`F&O sync failed, will retry: ${(e as Error).message.split('\n').slice(-2).join(' ')}`));
  setTimeout(run, 5_000); // give the database a moment after a cold start
  setInterval(run, RETRY_MS);
}

export async function fnoStatus() {
  const [saved, holidays, errors, range] = await Promise.all([
    prisma.fnoFetch.count({ where: { status: 'saved' } }),
    prisma.fnoFetch.count({ where: { status: 'not-published' } }),
    prisma.fnoFetch.findMany({ where: { status: 'error' }, select: { date: true, message: true }, orderBy: { date: 'desc' }, take: 20 }),
    prisma.fnoDayMeta.aggregate({ _min: { date: true }, _max: { date: true } }),
  ]);
  return { savedDays: saved, holidays, errors, from: range._min.date, to: range._max.date, running };
}
