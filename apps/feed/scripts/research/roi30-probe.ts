// Timing + baseline probe for the 30% ROI search.
import { prisma } from '@mtv/db';
import { run, sell, fmt, data } from './roi30-lib';

console.log('days', data.days[0].date, '→', data.days.at(-1)!.date, 'monthly', data.monthly.length, 'expiries', data.expiries.length);
for (const [name, iv] of [['0.25 strangle 45→21 high IV', 'high'], ['0.25 strangle 45→21 every month', 'any']] as const) {
  const t0 = performance.now();
  const { r, row } = await run(name, { schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: [sell('CE', 0.25), sell('PE', 0.25)], iv, exit: { daysLeft: 21 } });
  console.log(fmt(row), Math.round(performance.now() - t0), 'ms');
  console.log('  ', row.years, ' today', r.today);
}
await prisma.$disconnect();
