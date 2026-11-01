// NSE's daily FII derivatives statistics (content/fo/fii_stats_DD-Mon-YYYY.xls, archive from about Dec 2014): what
// foreign investors bought and sold that day, and their open interest at the close, in contracts and ₹ crore, for
// index futures, index options (overall and, in newer files, per index), stock futures and stock options. Stored as
// published (amounts as decimal strings, no rounding).

import { Prisma, prisma } from '@mtv/db';
import { NotPublished, nseGet } from '../nse-http';
import { readXlsFirstSheet, type Cell } from '../official/xls';
import { datesToFetch } from './store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fiiStatsUrl(date: string): string {
  const [y, m, d] = date.split('-');
  return `https://nsearchives.nseindia.com/content/fo/fii_stats_${d}-${MONTHS[Number(m) - 1]}-${y}.xls`;
}

export type FiiStatRow = {
  /** As NSE names it: INDEX FUTURES, INDEX OPTIONS, NIFTY OPTIONS, BANKNIFTY FUTURES, STOCK FUTURES, … */
  segment: string;
  buyContracts: number; buyCr: string;
  sellContracts: number; sellCr: string;
  oiContracts: number; oiCr: string;
};

const asContracts = (c: Cell, what: string) => {
  const n = typeof c === 'number' ? c : Number(String(c ?? '').replaceAll(',', '').trim());
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`FII stats: invalid number "${c}" for ${what}`);
  return n;
};
/** Crore amounts kept exactly as NSE published them (up to 4 decimals), as a decimal string. */
const asCrore = (c: Cell, what: string) => {
  const s = typeof c === 'number' ? String(Math.round(c * 1e4) / 1e4) : String(c ?? '').replaceAll(',', '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`FII stats: invalid amount "${c}" for ${what}`);
  return s;
};

/** Parses one FII statistics sheet. Throws if the date differs from `date` or the core rows are missing. */
export function parseFiiStats(grid: Cell[][], date: string): FiiStatRow[] {
  const title = grid.flat().find((c): c is string => typeof c === 'string' && /FII DERIVATIVES STATISTICS FOR/i.test(c));
  if (!title) throw new Error('FII stats: format changed: no title row');
  const m = /FOR\s+(\d{2})-([A-Za-z]{3})-(\d{4})/i.exec(title);
  const fileDate = m ? `${m[3]}-${String(MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1]}` : null;
  if (fileDate !== date) throw new Error(`FII stats: file is for ${fileDate ?? 'an unknown date'}, expected ${date}`);
  const rows: FiiStatRow[] = [];
  for (const r of grid) {
    const label = typeof r[0] === 'string' ? r[0].trim().toUpperCase() : '';
    if (!/(FUTURES|OPTIONS)$/.test(label)) continue;
    rows.push({
      segment: label,
      buyContracts: asContracts(r[1], `${label} buy`), buyCr: asCrore(r[2], `${label} buy`),
      sellContracts: asContracts(r[3], `${label} sell`), sellCr: asCrore(r[4], `${label} sell`),
      oiContracts: asContracts(r[5], `${label} OI`), oiCr: asCrore(r[6], `${label} OI`),
    });
  }
  for (const need of ['INDEX FUTURES', 'INDEX OPTIONS', 'STOCK FUTURES', 'STOCK OPTIONS']) {
    if (!rows.some((r) => r.segment === need)) throw new Error(`FII stats: format changed: no ${need} row`);
  }
  return rows;
}

async function recordFetch(date: string, status: string, message: string | null = null) {
  await prisma.fiiStatFetch.upsert({ where: { date }, create: { date, status, message }, update: { status, message, attempts: { increment: 1 } } });
}

export async function fetchFiiStatsDay(date: string) {
  const file = new Uint8Array(await (await nseGet(fiiStatsUrl(date))).arrayBuffer());
  const rows = parseFiiStats(readXlsFirstSheet(file), date);
  await prisma.$transaction(async (tx) => {
    await tx.fiiDerivStat.deleteMany({ where: { date } });
    await tx.fiiDerivStat.createMany({
      data: rows.map((r) => ({
        date, segment: r.segment,
        buyContracts: BigInt(r.buyContracts), buyCr: new Prisma.Decimal(r.buyCr),
        sellContracts: BigInt(r.sellContracts), sellCr: new Prisma.Decimal(r.sellCr),
        oiContracts: BigInt(r.oiContracts), oiCr: new Prisma.Decimal(r.oiCr),
      })),
    });
    await tx.fiiStatFetch.upsert({ where: { date }, create: { date, status: 'saved' }, update: { status: 'saved', message: null, attempts: { increment: 1 } } });
  });
}

let running = false;

/** Fetches missing days, newest first. A format problem is recorded and skipped; a network problem pauses. */
export async function syncFiiStats(from: string, log: (m: string) => void): Promise<void> {
  if (running) return;
  running = true;
  try {
    const done = new Set((await prisma.fiiStatFetch.findMany({ where: { status: { in: ['saved', 'not-published'] } }, select: { date: true } })).map((f) => f.date));
    const todo = datesToFetch(from, Date.now() / 1000, true).filter((d) => !done.has(d)).reverse();
    if (todo.length) log(`FII derivatives statistics: ${todo.length} days to download`);
    let saved = 0;
    for (const date of todo) {
      try {
        await fetchFiiStatsDay(date);
        saved++;
        if (saved % 50 === 0) log(`FII derivatives statistics: ${saved}/${todo.length} days saved (latest ${date})`);
      } catch (e) {
        if (e instanceof NotPublished) { await recordFetch(date, 'not-published'); continue; }
        const msg = (e as Error).message;
        await recordFetch(date, 'error', msg);
        if (/^FII stats:|^xls:/.test(msg)) { log(`FII stats ${date}: ${msg}`); continue; }
        log(`FII stats sync paused at ${date}: ${msg}. Retrying in 30 minutes.`);
        return;
      }
    }
    if (todo.length) log(`FII derivatives statistics: up to date (${saved} new days)`);
  } finally {
    running = false;
  }
}

export function startFiiStatsSync(from: string, log: (m: string) => void) {
  const run = () => syncFiiStats(from, log).catch((e) => log(`FII stats sync failed, will retry: ${(e as Error).message.split('\n').slice(-2).join(' ')}`));
  setTimeout(run, 25_000);
  setInterval(run, 30 * 60_000);
}
