// Pivot levels of one option contract for each of its earlier days (each day's levels come from the day before's
// high / low / close), printed between two prices, to find which past pivots make the user's levels.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/pivot-levels-history.ts 2026-11-23 25900 PE 80 140
import { prisma } from '@mtv/db';

const [expiry, strikeS, kind, loS, hiS] = process.argv.slice(2);
const lo = Number(loS), hi = Number(hiS);
const rows = await prisma.fnoEod.findMany({ where: { underlying: 'NIFTY', expiry, kind, strikePaise: Number(strikeS) * 100 }, orderBy: { date: 'asc' } });
for (const r of rows) {
  const H = r.highPaise / 100, L = r.lowPaise / 100, C = r.closePaise / 100, O = r.openPaise / 100, R = H - L, P = (H + L + C) / 3;
  const types: Record<string, Record<string, number>> = {
    trad: { S5: P * 4 - (4 * H - L) , S4: P * 3 - (3 * H - L), S3: L - 2 * (H - P), S2: P - R, S1: 2 * P - H, P, R1: 2 * P - L, R2: P + R, R3: H + 2 * (P - L), R4: P * 3 + (H - 3 * L), R5: P * 4 + (H - 4 * L) },
    fib: { S3: P - R, S2: P - 0.618 * R, S1: P - 0.382 * R, P, R1: P + 0.382 * R, R2: P + 0.618 * R, R3: P + R },
    cam: { S4: C - R * 1.1 / 2, S3: C - R * 1.1 / 4, S2: C - R * 1.1 / 6, S1: C - R * 1.1 / 12, R1: C + R * 1.1 / 12, R2: C + R * 1.1 / 6, R3: C + R * 1.1 / 4, R4: C + R * 1.1 / 2 },
  };
  const inRange = Object.entries(types).map(([t, lv]) => `${t}: ` + Object.entries(lv).filter(([, v]) => v >= lo && v <= hi).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')).join('  |  ');
  console.log(`${r.date} O ${O} H ${H} L ${L} C ${C}${r.traded ? '' : ' (not traded)'}  → levels for the next day  ${inRange}`);
}
await prisma.$disconnect();
