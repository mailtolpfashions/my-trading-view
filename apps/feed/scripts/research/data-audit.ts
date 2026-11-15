// Read-only data coverage audit. Run from apps/feed: npx dotenv -e ../../.env -- npx tsx <this file>
import { prisma } from '@mtv/db';

const q = async <T,>(label: string, sql: any) => {
  const t = Date.now();
  const r = await prisma.$queryRaw<T[]>(sql);
  console.log(`\n## ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  console.table(r.map((x: any) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))));
  return r;
};
const { Prisma } = await import('@prisma/client');
const s = Prisma.sql;

await q('EquityEod by year', s`SELECT substr(date,1,4) y, count(DISTINCT date) days, count(DISTINCT symbol) symbols, count(*) rows FROM "EquityEod" GROUP BY 1 ORDER BY 1`);
await q('IndexEod names', s`SELECT name, min(date) first, max(date) last, count(*) days FROM "IndexEod" GROUP BY 1 ORDER BY 4 DESC LIMIT 40`);
await q('FnoEod underlyings (index)', s`SELECT underlying, kind, min(date) first, max(date) last, count(DISTINCT date) days, count(*) rows FROM "FnoEod" WHERE underlying IN ('NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX') GROUP BY 1,2 ORDER BY 1,2`);
await q('FnoEod NIFTY options by year', s`SELECT substr(date,1,4) y, count(DISTINCT date) days, count(DISTINCT expiry) expiries, count(*) rows, round(100.0*count(*) FILTER (WHERE traded)/count(*),1) traded_pct FROM "FnoEod" WHERE underlying='NIFTY' AND kind IN ('CE','PE') GROUP BY 1 ORDER BY 1`);
await q('FnoEod BANKNIFTY options by year', s`SELECT substr(date,1,4) y, count(DISTINCT date) days, count(DISTINCT expiry) expiries, count(*) rows, round(100.0*count(*) FILTER (WHERE traded)/count(*),1) traded_pct FROM "FnoEod" WHERE underlying='BANKNIFTY' AND kind IN ('CE','PE') GROUP BY 1 ORDER BY 1`);
await q('FnoEod stock underlyings', s`SELECT count(DISTINCT underlying) n, min(date) first, max(date) last FROM "FnoEod" WHERE underlying NOT IN ('NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX')`);
await q('FnoEod stock futures by year', s`SELECT substr(date,1,4) y, count(DISTINCT underlying) stocks, count(DISTINCT date) days, count(*) rows FROM "FnoEod" WHERE kind='FUT' AND underlying NOT IN ('NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX') GROUP BY 1 ORDER BY 1`);
await q('FnoEod stock options by year', s`SELECT substr(date,1,4) y, count(DISTINCT underlying) stocks, count(DISTINCT date) days, count(*) rows FROM "FnoEod" WHERE kind IN ('CE','PE') AND underlying NOT IN ('NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX') GROUP BY 1 ORDER BY 1`);
await q('FnoDerivedDay (IV) by underlying', s`SELECT underlying, min(date) first, max(date) last, count(*) rows, count("atmIv") with_iv FROM "FnoDerivedDay" GROUP BY 1 ORDER BY 4 DESC LIMIT 15`);
await q('VIX', s`SELECT substr(date,1,4) y, count(*) days FROM "IndexEod" WHERE name ILIKE '%VIX%' GROUP BY 1 ORDER BY 1`);
await q('ParticipantOi', s`SELECT min(date) first, max(date) last, count(DISTINCT date) days FROM "ParticipantOi"`);
await q('FiiDerivStat', s`SELECT min(date) first, max(date) last, count(DISTINCT date) days FROM "FiiDerivStat"`);
await q('FpiFlow', s`SELECT min("reportDate") first, max("reportDate") last, count(*) rows FROM "FpiFlow"`);
await q('CorporateAction', s`SELECT substr("exDate",1,4) y, count(*) n FROM "CorporateAction" GROUP BY 1 ORDER BY 1`);
await q('EquityEod last date', s`SELECT max(date) last FROM "EquityEod"`);
await q('Table sizes', s`SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) size, n_live_tup rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15`);
await prisma.$disconnect();
