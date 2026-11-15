// Can the option lab run on a stock? (labData is typed for indices; the code is generic.)
import { prisma } from '@mtv/db';
import { runLab, type LabStrategy } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';
for (const u of ['RELIANCE', 'HDFCBANK']) {
  const d = await labData(u as 'NIFTY');
  const withSpot = d.days.filter((x) => x.spotPaise && x.lotSize);
  console.log(u, 'days', d.days.length, 'with spot+lot', withSpot.length, withSpot[0]?.date, '→', withSpot.at(-1)?.date, 'monthly', d.monthly.filter((m) => m >= '2024-07').join(','), 'iv points', d.iv.length);
  const s: LabStrategy = { name: 'p', underlying: 'NIFTY', missing: 'skip', slippage: 1, money: 'actual', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 30 }, iv: 'any', exit: { daysLeft: 7 },
    legs: [{ side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'delta', delta: 0.3 }, expiry: 0 }] };
  const r = await runLab(s, d);
  console.log('  trades', r.trades.length, 'skipped', r.skipped.length, r.skipped.slice(0, 4), 'total', r.summary.total, r.trades.slice(0, 2).map((t) => [t.entry, t.legs[0].strike, t.legs[0].entry, t.net]));
}
await prisma.$disconnect();
