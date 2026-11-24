// Scalping study, step 6: records each setup variant (setups.ts + options-estimate.ts outputs) in the quant registry
// and regenerates docs/quant/experiments.md is left to quant/report.ts.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/register.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { register, saveDetail } from '../quant/registry';

type O = { setup: string; date: string; dir: number; spotPts: number; buyer: number | null; seller: number | null; buyerRs: number | null; sellerRs: number | null };
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
const out = JSON.parse(await readFile(path.join(dir, 'options-estimate.json'), 'utf8')) as O[];
const avg = (x: number[]) => (x.length ? +(x.reduce((a, b) => a + b, 0) / x.length).toFixed(2) : null);
const sum = (x: number[]) => Math.round(x.reduce((a, b) => a + b, 0));
for (const name of [...new Set(out.map((o) => o.setup))]) {
  const o = out.filter((x) => x.setup === name && x.buyer != null && x.seller != null);
  const part = (z: O[]) => ({ n: z.length, spotAvg: avg(z.map((x) => x.spotPts)), buyerNetAvg: avg(z.map((x) => x.buyer!)), sellerNetAvg: avg(z.map((x) => x.seller!)), buyerRsPerLot: sum(z.map((x) => x.buyerRs!)), sellerRsPerLot: sum(z.map((x) => x.sellerRs!)), buyerWin: avg(z.map((x) => (x.buyer! > 0 ? 1 : 0))), sellerWin: avg(z.map((x) => (x.seller! > 0 ? 1 : 0))) });
  const dev = part(o.filter((x) => x.date < '2026')), hold = part(o.filter((x) => x.date >= '2026'));
  const byYear = Object.fromEntries(['2023', '2024', '2025', '2026'].map((y) => [y, part(o.filter((x) => x.date.startsWith(y)))]));
  const pass = (dev.buyerNetAvg ?? -1) > 0 && (hold.buyerNetAvg ?? -1) > 0 || (dev.sellerNetAvg ?? -1) > 0 && (hold.sellerNetAvg ?? -1) > 0;
  const id = await register({
    name: `Scalp ${name}`, family: 'S-scalp', script: 'scripts/research/scalp/setups.ts + options-estimate.ts',
    hypothesis: 'A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.',
    params: { setup: name, bars: '3m NIFTY spot', entryWindow: '9:30–14:45 bar open', exitBy: '15:00', strike: '1 ITM vs forward (round 100)', expiry: 'nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)' },
    period: { from: '2023-01-02', to: '2026-11-23', role: 'train+validation' },
    costs: { broker: 'zerodha', slippage: '0.5 pt per option fill (real recorded spread mean 0.46 pt)', charges: 'itemised, dated', notes: 'option P&L modelled with Black-76 at the day\'s ATM IV' },
    metrics: { all: part(o), byYear },
    validation: { rulesBuiltOn: '2023–2025', holdout2026: hold, dev },
    caveats: ['Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade', 'Spot index minutes (no futures before 2026-11)', '2023 minute high/low slightly narrower than daily on 60 days'],
    verdict: pass ? 'lead' : 'fail',
  });
  saveDetail(id, 'trades', o);
}
await prisma.$disconnect();
