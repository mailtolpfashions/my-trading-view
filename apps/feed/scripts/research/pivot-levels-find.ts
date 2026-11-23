// Which strike / pivot type gives the user's levels? Searches every NIFTY strike of one expiry on one day for a pivot
// set that contains all the given levels (within a tolerance).
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/pivot-levels-find.ts 2026-11-23 2026-12-01 PE 90,99,115,130
import { prisma } from '@mtv/db';

const [date, expiry, kind, list] = process.argv.slice(2);
const want = list.split(',').map(Number);
const TOL = Number(process.env.TOL ?? 1.5);
type Lv = Record<string, number>;
function sets(H: number, L: number, C: number, O: number): Record<string, Lv> {
  const R = H - L, P = (H + L + C) / 3;
  const W = (H + L + 2 * C) / 4; // Woodie
  const X = C < O ? H + 2 * L + C : C > O ? 2 * H + L + C : H + L + 2 * C; // DeMark
  return {
    traditional: { S3: L - 2 * (H - P), S2: P - R, S1: 2 * P - H, P, R1: 2 * P - L, R2: P + R, R3: H + 2 * (P - L), R4: P * 3 + (H - 3 * L), R5: P * 4 + (H - 4 * L) },
    fibonacci: { S3: P - R, S2: P - 0.618 * R, S1: P - 0.382 * R, P, R1: P + 0.382 * R, R2: P + 0.618 * R, R3: P + R },
    woodie: { S2: W - R, S1: 2 * W - H, P: W, R1: 2 * W - L, R2: W + R, R3: H + 2 * (W - L), R4: H + 3 * (W - L) },
    classic: { S3: P - 2 * R, S2: P - R, S1: 2 * P - H, P, R1: 2 * P - L, R2: P + R, R3: P + 2 * R, R4: P + 3 * R },
    demark: { S1: X / 2 - H, P: X / 4, R1: X / 2 - L },
    camarilla: { S3: C - R * 1.1 / 4, S2: C - R * 1.1 / 6, S1: C - R * 1.1 / 12, P, R1: C + R * 1.1 / 12, R2: C + R * 1.1 / 6, R3: C + R * 1.1 / 4, R4: C + R * 1.1 / 2, R5: (H / L) * C },
  };
}
const rows = await prisma.fnoEod.findMany({ where: { underlying: 'NIFTY', date, expiry, kind }, orderBy: { strikePaise: 'asc' } });
const prev = (await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY', date: { lt: date } }, orderBy: { date: 'desc' }, take: 1 }))[0]?.date;
const prevRows = prev ? await prisma.fnoEod.findMany({ where: { underlying: 'NIFTY', date: prev, expiry, kind } }) : [];
const prevBy = new Map(prevRows.map((r) => [r.strikePaise, r]));
console.log(`${rows.length} ${kind} strikes of ${expiry} on ${date} (previous day ${prev}); looking for ${want.join(' / ')} ±${TOL}`);
let found = 0;
for (const r of rows) {
  const today = sets(r.highPaise / 100, r.lowPaise / 100, r.closePaise / 100, r.openPaise / 100);
  const p = prevBy.get(r.strikePaise);
  const before = p ? sets(p.highPaise / 100, p.lowPaise / 100, p.closePaise / 100, p.openPaise / 100) : null;
  for (const [type, lv] of Object.entries(today)) {
    const merged: [string, number][] = [...Object.entries(lv).map(([k, v]) => [`${k}`, v] as [string, number]), ...(before ? Object.entries(before[type]).map(([k, v]) => [`prev ${k}`, v] as [string, number]) : [])];
    for (const pool of [Object.entries(lv) as [string, number][], merged]) {
      const hit = want.map((w) => pool.find(([, v]) => Math.abs(v - w) <= TOL));
      const n = hit.filter(Boolean).length;
      if (n >= want.length - 1) {
        found++;
        console.log(`${r.strikePaise / 100} ${kind} ${type}${pool === merged ? ' (+ previous day levels)' : ''}: ${n}/${want.length} → ${hit.map((h, i) => h ? `${want[i]}≈${h[0]} ${h[1].toFixed(2)}` : `${want[i]}: -`).join(', ')}   [H ${r.highPaise / 100} L ${r.lowPaise / 100} C ${r.closePaise / 100}]`);
      }
    }
  }
}
if (!found) console.log('no strike matches');
await prisma.$disconnect();
