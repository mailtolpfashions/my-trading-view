// Read-only report of the NSE F&O end-of-day history one underlying has, year by year: trading days, expiries, strikes,
// how much of the near chain actually traded, lot sizes and missing index closes. Gaps are reported, never filled.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/fno-coverage.ts [NIFTY]

import { prisma } from '@mtv/db';

const underlying = process.argv[2] ?? 'NIFTY';
const rows = await prisma.$queryRaw<{ y: string; days: bigint; expiries: bigint; contracts: bigint; traded: bigint; strikes: bigint }[]>`
  SELECT substr(date, 1, 4) AS y, count(DISTINCT date) AS days, count(DISTINCT expiry) AS expiries, count(*) AS contracts,
         count(*) FILTER (WHERE traded) AS traded, count(DISTINCT "strikePaise") AS strikes
  FROM "FnoEod" WHERE underlying = ${underlying} AND kind IN ('CE', 'PE') GROUP BY 1 ORDER BY 1`;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying }, select: { date: true, lotSize: true, spotPaise: true, source: true }, orderBy: { date: 'asc' } });

console.log(`${underlying}: ${meta[0]?.date ?? '-'} to ${meta.at(-1)?.date ?? '-'}, ${meta.length} days`);
console.log('year  days  expiries  option rows  traded%  strikes  no-spot  no-lot  lot sizes');
for (const r of rows) {
  const m = meta.filter((x) => x.date.startsWith(r.y));
  const lots = [...new Set(m.map((x) => x.lotSize))].join(',');
  console.log(`${r.y}  ${String(r.days).padStart(4)}  ${String(r.expiries).padStart(8)}  ${String(r.contracts).padStart(11)}  ${((Number(r.traded) / Number(r.contracts)) * 100).toFixed(1).padStart(7)}  ${String(r.strikes).padStart(7)}  ${String(m.filter((x) => x.spotPaise == null).length).padStart(7)}  ${String(m.filter((x) => x.lotSize == null).length).padStart(6)}  ${lots}`);
}
const big = await prisma.$queryRaw<{ date: string }[]>`
  SELECT date FROM (SELECT date, lag(date) OVER (ORDER BY date) AS prev FROM "FnoDayMeta" WHERE underlying = ${underlying}) t
  WHERE prev IS NOT NULL AND date::date - prev::date > 5`;
console.log('gaps over 5 calendar days end at:', big.map((g) => g.date).join(', ') || 'none');
const source = new Map<string, number>();
for (const m of meta) source.set(m.source, (source.get(m.source) ?? 0) + 1);
console.log('sources:', [...source].map(([s, n]) => `${s} ${n}`).join(', '));
await prisma.$disconnect();
