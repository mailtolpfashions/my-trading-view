// Can the user's option levels (e.g. 25900 CE above 55 → 62 / 74 / 90; 25900 PE above 90 → 99 / 115 / 130) be rebuilt
// from the option's own daily pivots? Prints standard / Fibonacci / Camarilla pivots of a strike from the last two days.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/pivot-levels-check.ts 25900
import { prisma } from '@mtv/db';

const strike = Number(process.argv[2] ?? 25900);
const days = (await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY', date: { lte: process.argv[3] ?? '9999' } }, orderBy: { date: 'desc' }, take: 3, select: { date: true, spotPaise: true } }));
console.log('latest days:', days.map((d) => `${d.date} spot ${d.spotPaise / 100}`).join(', '));
const exps = (await prisma.fnoEod.findMany({ where: { underlying: 'NIFTY', date: days[0].date, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry).filter((e) => e >= days[0].date).slice(0, 3);
console.log('expiries:', exps.join(', '));
const r2 = (x: number) => Math.round(x * 100) / 100;
for (const expiry of exps.slice(0, 2)) for (const kind of ['CE', 'PE']) {
  for (const d of days.slice(0, 2)) {
    const q = await prisma.fnoEod.findFirst({ where: { underlying: 'NIFTY', date: d.date, kind, expiry, strikePaise: strike * 100 } });
    if (!q) { console.log(`${expiry} ${strike} ${kind} ${d.date}: none`); continue; }
    const H = q.highPaise / 100, L = q.lowPaise / 100, C = q.closePaise / 100, R = H - L, P = (H + L + C) / 3;
    const std = { S3: L - 2 * (H - P), S2: P - R, S1: 2 * P - H, P, R1: 2 * P - L, R2: P + R, R3: H + 2 * (P - L) };
    const fib = { S3: P - R, S2: P - 0.618 * R, S1: P - 0.382 * R, P, R1: P + 0.382 * R, R2: P + 0.618 * R, R3: P + R };
    const cam = { S3: C - R * 1.1 / 4, S2: C - R * 1.1 / 6, S1: C - R * 1.1 / 12, R1: C + R * 1.1 / 12, R2: C + R * 1.1 / 6, R3: C + R * 1.1 / 4, R4: C + R * 1.1 / 2 };
    const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${r2(v)}`).join('  ');
    console.log(`\n${expiry} ${strike} ${kind} ${d.date}: O ${q.openPaise / 100} H ${H} L ${L} C ${C} traded ${q.traded}`);
    console.log('  standard ', fmt(std));
    console.log('  fibonacci', fmt(fib));
    console.log('  camarilla', fmt(cam));
  }
}
await prisma.$disconnect();
