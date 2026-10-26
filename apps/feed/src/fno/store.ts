// Stores NSE's official F&O end-of-day data and downloads it politely: one request at a time with a pause between,
// stopping at the first network error and resuming later. Each date is recorded (saved / holiday / error) so no file
// is ever downloaded twice.

import { prisma } from '@mtv/db';
import { unzipFirstCsv, indexCloseUrl, parseIndexClose } from '../official/nse-files';
import { FNO_UNDERLYINGS, UDIFF_FROM, fnoBhavcopyUrl, parseOldFo, parseUdiffFo, type FnoDay, type FnoUnderlying } from './bhavcopy';

const PAUSE_MS = 4000;
const RETRY_MS = 30 * 60_000;
const PUBLISH_AFTER = (18 * 60 + 30) * 60; // seconds after IST midnight
const INDEX_NAMES: Record<FnoUnderlying, string> = { NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK' };
const toPaise = (rupees: number) => Math.round(rupees * 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class NotPublished extends Error {}

async function download(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) throw new NotPublished(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/** Downloads and parses one trading day. Old-layout days also fetch NSE's index-close file for the underlying price. */
export async function fetchFnoDay(date: string): Promise<FnoDay> {
  const zip = new Uint8Array(await (await download(fnoBhavcopyUrl(date))).arrayBuffer());
  const csv = unzipFirstCsv(zip);
  const day = date >= UDIFF_FROM ? parseUdiffFo(csv, date) : parseOldFo(csv, date);
  if (date < UDIFF_FROM) {
    await sleep(PAUSE_MS);
    const closes = parseIndexClose(await (await download(indexCloseUrl(date))).text());
    for (const u of FNO_UNDERLYINGS) day.spot[u] = closes.get(INDEX_NAMES[u])?.close ?? null;
  }
  for (const u of FNO_UNDERLYINGS) {
    if (!day.rows.some((r) => r.underlying === u)) throw new Error(`${date}: no ${u} contracts in the F&O file`);
  }
  return day;
}

export async function saveFnoDay(day: FnoDay) {
  const rows = day.rows.map((r) => ({
    date: day.date, underlying: r.underlying, kind: r.kind, expiry: r.expiry, strikePaise: r.strike == null ? 0 : toPaise(r.strike),
    openPaise: toPaise(r.open), highPaise: toPaise(r.high), lowPaise: toPaise(r.low), closePaise: toPaise(r.close), settlePaise: toPaise(r.settle),
    oi: BigInt(Math.round(r.oi)), volume: BigInt(Math.round(r.volume)), traded: r.traded,
  }));
  await prisma.$transaction(async (tx) => {
    await tx.fnoEod.deleteMany({ where: { date: day.date } });
    for (let i = 0; i < rows.length; i += 2000) await tx.fnoEod.createMany({ data: rows.slice(i, i + 2000) });
    for (const u of FNO_UNDERLYINGS) {
      const meta = { lotSize: day.lotSize[u] ?? null, spotPaise: day.spot[u] != null ? toPaise(day.spot[u]!) : null, source: day.date >= UDIFF_FROM ? 'udiff' : 'old' };
      await tx.fnoDayMeta.upsert({ where: { date_underlying: { date: day.date, underlying: u } }, create: { date: day.date, underlying: u, ...meta }, update: meta });
    }
    await tx.fnoFetch.upsert({ where: { date: day.date }, create: { date: day.date, status: 'saved' }, update: { status: 'saved', message: null, attempts: { increment: 1 } } });
  }, { timeout: 120_000 });
}

const recordFetch = (date: string, status: string, message?: string) =>
  prisma.fnoFetch.upsert({ where: { date }, create: { date, status, message }, update: { status, message, attempts: { increment: 1 } } });

/** Weekdays from `from` up to the latest date whose files should be published (today only after 18:30 IST). */
export function datesToFetch(from: string, nowSec: number): string[] {
  const local = new Date((nowSec + 5.5 * 3600) * 1000);
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if ((nowSec + 5.5 * 3600) % 86400 < PUBLISH_AFTER) end.setUTCDate(end.getUTCDate() - 1);
  const out: string[] = [];
  for (const d = new Date(from + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

let running = false;

/** Fetches missing days, newest first, one at a time. Stops at the first network error (resumes on the next run). */
export async function syncFno(from: string, log: (m: string) => void): Promise<void> {
  if (running) return;
  running = true;
  try {
    const done = new Set((await prisma.fnoFetch.findMany({ where: { status: { in: ['saved', 'not-published'] } }, select: { date: true } })).map((f) => f.date));
    const todo = datesToFetch(from, Date.now() / 1000).filter((d) => !done.has(d)).reverse();
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
