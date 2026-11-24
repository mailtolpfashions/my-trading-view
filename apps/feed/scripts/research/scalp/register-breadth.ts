// Records the breadth study (breadth.ts + options-estimate.ts breadth-trades.json) in the quant registry.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/register-breadth.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { register, saveDetail } from '../quant/registry';

type O = { setup: string; date: string; spotPts: number; buyer: number | null; seller: number | null; buyerRs: number | null; sellerRs: number | null };
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
const out = JSON.parse(await readFile(path.join(dir, 'breadth-options.json'), 'utf8')) as O[];
const w = JSON.parse(await readFile(path.join(dir, 'breadth-weights.json'), 'utf8'));
const avg = (x: number[]) => (x.length ? +(x.reduce((a, b) => a + b, 0) / x.length).toFixed(2) : null);
const part = (z: O[]) => ({ n: z.length, spotAvg: avg(z.map((x) => x.spotPts)), buyerNetAvg: avg(z.map((x) => x.buyer!)), sellerNetAvg: avg(z.map((x) => x.seller!)), buyerRsPerLot: Math.round(z.reduce((a, x) => a + x.buyerRs!, 0)), sellerRsPerLot: Math.round(z.reduce((a, x) => a + x.sellerRs!, 0)) });
for (const name of [...new Set(out.map((o) => o.setup))]) {
  const o = out.filter((x) => x.setup === name && x.buyer != null && x.seller != null);
  const build = part(o.filter((x) => x.date < '2026-06')), check = part(o.filter((x) => x.date >= '2026-06'));
  const pass = ((build.buyerNetAvg ?? -1) > 1 && (check.buyerNetAvg ?? -1) > 1) || ((build.sellerNetAvg ?? -1) > 1 && (check.sellerNetAvg ?? -1) > 1);
  const id = await register({
    name: `Scalp breadth: ${name}`, family: 'S-scalp', script: 'scripts/research/scalp/breadth.ts + options-estimate.ts',
    hypothesis: 'Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.',
    params: { setup: name, weights: `least squares on 1-min returns since ${w.fitFrom}, R² ${w.r2.toFixed(3)}`, tiers: 'heavy ≥2%, mid 1–2%, light <1%', state: 'line vs its running mean since 9:15' },
    period: { from: '2025-11-03', to: '2026-11-23', role: 'train+validation' },
    costs: { broker: 'zerodha', slippage: '0.5 pt per option fill', charges: 'itemised, dated', notes: 'option P&L modelled with Black-76 at the day\'s ATM IV' },
    metrics: { all: part(o) }, validation: { build202511to202605: build, check202606to202611: check },
    caveats: ['Only ~1 year of stock minutes', "Today's members and estimated weights used for the whole year", 'Option prices are an estimate', 'P state change = price vs its TWAP, the no-breadth baseline'],
    verdict: pass ? 'lead' : 'fail',
  });
  saveDetail(id, 'trades', o);
}
await prisma.$disconnect();
