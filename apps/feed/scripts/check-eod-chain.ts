// Integrity check of stored NSE history against NSE itself: each day's published "previous close" must equal the
// stock's close on its previous trading day (NSE does not adjust it). Reports the dates where that chain breaks.
// Run: npx tsx scripts/check-eod-chain.ts
import { prisma } from '@mtv/db';

const rows = await prisma.$queryRaw<{ date: string; breaks: bigint; checked: bigint }[]>`
  WITH ordered AS (
    SELECT symbol, date, "closePaise", "prevClosePaise",
           LAG("closePaise") OVER (PARTITION BY symbol ORDER BY date) AS prior_close,
           LAG(date) OVER (PARTITION BY symbol ORDER BY date) AS prior_date
    FROM "EquityEod")
  SELECT date, COUNT(*) FILTER (WHERE "prevClosePaise" <> prior_close) AS breaks, COUNT(*) AS checked
  FROM ordered WHERE prior_close IS NOT NULL GROUP BY date HAVING COUNT(*) FILTER (WHERE "prevClosePaise" <> prior_close) > 20
  ORDER BY breaks DESC LIMIT 15`;
console.log('Dates where many stocks break the previous-close chain (NSE prev close ≠ our stored prior close):');
for (const r of rows) console.log(`  ${r.date}: ${r.breaks} of ${r.checked}`);
for (const d of ['2025-03-18', '2025-03-19', '2025-05-02', '2025-05-05']) {
  const r = await prisma.equityEod.findMany({ where: { date: d, symbol: { in: ['ICICIBANK', 'RELIANCE'] } }, select: { symbol: true, openPaise: true, highPaise: true, lowPaise: true, closePaise: true, prevClosePaise: true } });
  console.log(d, r.map((x) => `${x.symbol} O${x.openPaise / 100} H${x.highPaise / 100} L${x.lowPaise / 100} C${x.closePaise / 100} prev${x.prevClosePaise / 100}`).join(' | '));
}
const fetch = await prisma.eodFetch.findMany({ where: { date: { in: ['2025-03-18', '2025-05-02'] } } });
console.log(fetch);
await prisma.$disconnect();
