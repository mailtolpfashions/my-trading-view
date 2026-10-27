// Prints the latest futures analytics from stored NSE data. Run: npx tsx scripts/check-futures.ts [NIFTY|BANKNIFTY] [days]
import { prisma } from '@mtv/db';
import { futuresHistory } from '../src/fno/futures';

const u = (process.argv[2] ?? 'NIFTY') as 'NIFTY' | 'BANKNIFTY';
const rows = await futuresHistory(u, Number(process.argv[3] ?? 8));
const r2 = (p: number | null) => (p == null ? '—' : (p / 100).toFixed(2));
for (const d of rows) {
  const n = d.near;
  console.log(`${d.date} spot ${r2(d.spotPaise)} | near ${n?.expiry} ${r2(n?.closePaise ?? null)} chg ${r2(n?.changePaise ?? null)} basis ${r2(n?.basisPaise ?? null)} (${n?.premiumPct?.toFixed(2)}%, carry ${n?.carryPct?.toFixed(1)}%/yr, ${n?.daysToExpiry}d) OI ${n?.oi} Δ${n?.oiChange} ${n?.buildUp} | total OI ${d.totalOi} roll ${d.rolloverPct?.toFixed(1)}% | ${d.contracts.length} contracts`);
}
await prisma.$disconnect();
