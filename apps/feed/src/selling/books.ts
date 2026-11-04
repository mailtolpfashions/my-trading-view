// NIFTY option chains from NSE's official end-of-day files, in the form the selling engine reads. Closes that cannot be live
// (see staleFlags) lose their "traded" mark, so nothing can enter on them and delta ignores them. They are counted, never
// repaired. Used by the studies, which load years of days, and by the plan, which loads one day.

import { prisma } from '@mtv/db';
import { makeBook, monthlyExpiries, type BookRow, type DayBook } from '@mtv/backtest';
import { staleFlags, type IvPoint, type Kind } from '@mtv/options';

export const SELLING_UNDERLYING = 'NIFTY';
const U = SELLING_UNDERLYING;
type Row = BookRow & { date: string; expiry: string; kind: Kind };

/** Takes the "traded" mark off impossible closes, one expiry and option type at a time. Returns how many. */
export function markStale(rows: Row[]): number {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.traded || !(r.closePaise > 0)) continue;
    const k = `${r.date}|${r.expiry}|${r.kind}`, list = groups.get(k);
    if (list) list.push(r); else groups.set(k, [r]);
  }
  let count = 0;
  for (const [key, list] of groups) {
    list.sort((a, b) => a.strikePaise - b.strikePaise);
    const flags = staleFlags(list.map((r) => r.closePaise), key.endsWith('|PE'));
    flags.forEach((stale, i) => { if (stale) { list[i].traded = false; count++; } });
  }
  return count;
}

/** The IV the entry rule looks at: the ATM IV of an expiry 25 to 60 days away, one reading a day. */
export async function ivHistory(u: string = U): Promise<IvPoint[]> {
  const rows = await prisma.fnoDerivedDay.findMany({ where: { underlying: u, atmIv: { not: null }, daysToExpiry: { gte: 25, lte: 60 } }, select: { date: true, atmIv: true }, orderBy: [{ date: 'asc' }, { daysToExpiry: 'asc' }] });
  const seen = new Set<string>(), out: IvPoint[] = [];
  for (const r of rows) if (!seen.has(r.date)) { seen.add(r.date); out.push({ date: r.date, iv: r.atmIv! }); }
  return out;
}

export async function dayBook(date: string, u: string = U): Promise<DayBook | null> {
  const meta = await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date, underlying: u } } });
  if (!meta) return null;
  const rows = (await prisma.fnoEod.findMany({ where: { underlying: u, date, kind: { in: ['CE', 'PE'] } }, select: { date: true, expiry: true, kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Row[];
  markStale(rows);
  const lots = await prisma.fnoDerivedDay.findMany({ where: { underlying: u, date, lotSize: { not: null } }, select: { expiry: true, lotSize: true } });
  return makeBook(date, meta.spotPaise, meta.lotSize, rows, new Map(lots.map((l) => [l.expiry, l.lotSize!])));
}

/** Every day of an index's options within reach of a tested position. Heavy: for the study scripts, not the service. */
export async function loadBooks(log: (m: string) => void = () => {}, u: string = U) {
  const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: u }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
  const lotsRaw = await prisma.fnoDerivedDay.findMany({ where: { underlying: u, lotSize: { not: null } }, select: { date: true, expiry: true, lotSize: true } });
  const lots = new Map<string, Map<string, number>>();
  for (const r of lotsRaw) { if (!lots.has(r.date)) lots.set(r.date, new Map()); lots.get(r.date)!.set(r.expiry, r.lotSize!); }
  const allExpiries = (await prisma.fnoEod.findMany({ where: { underlying: u, kind: { in: ['CE', 'PE'] } }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry);
  // An expiry later moved for a holiday stays in older files under its old date. It never settled, so only dates that
  // really traded count when finding each month's last expiry; contracts not yet expired count as listed.
  const traded = new Set(meta.map((m) => m.date)), lastDate = meta.at(-1)!.date;
  const realExpiries = allExpiries.filter((e) => traded.has(e) || e > lastDate);
  const movedExpiries = allExpiries.filter((e) => !realExpiries.includes(e)).sort();
  const monthly = monthlyExpiries(realExpiries);
  const books: DayBook[] = [];
  let stale = 0;
  for (let year = Number(meta[0].date.slice(0, 4)); year <= Number(lastDate.slice(0, 4)); year++) {
    // Up to 75 days out and 35% from the index, with some real interest. A file saved with a two-digit expiry year
    // (14 May 2012, before the parser was fixed) is left out.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT e.date, e.expiry, e.kind, e."strikePaise", e."closePaise", e."settlePaise", e.traded
      FROM "FnoEod" e JOIN "FnoDayMeta" m ON m.date = e.date AND m.underlying = e.underlying
      WHERE e.underlying = ${u} AND e.kind IN ('CE', 'PE') AND e.date LIKE ${year + '-%'}
        AND length(e.expiry) = 10 AND e.expiry::date - e.date::date <= 75 AND (e.traded OR e.oi > 0)
        AND (m."spotPaise" IS NULL OR abs(e."strikePaise" - m."spotPaise") <= m."spotPaise" * 0.35)`;
    stale += markStale(rows);
    const byDate = new Map<string, Row[]>();
    for (const r of rows) { const l = byDate.get(r.date); if (l) l.push(r); else byDate.set(r.date, [r]); }
    for (const m of meta) if (m.date.startsWith(`${year}-`)) books.push(makeBook(m.date, m.spotPaise, m.lotSize, byDate.get(m.date) ?? [], lots.get(m.date) ?? new Map()));
    log(`${year}: ${rows.length} rows`);
  }
  log(`Stale closes set aside: ${stale}. Expiries moved before they arrived: ${movedExpiries.join(', ') || 'none'}`);
  return { books, monthly, calendar: books.map((b) => b.date), stale, movedExpiries };
}
