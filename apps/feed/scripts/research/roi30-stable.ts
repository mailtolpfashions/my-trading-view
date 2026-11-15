// Stage 4: neighbour check for the non-overlapping monthly family (exit 21/25 days left, so every month trades).
import { prisma } from '@mtv/db';
import type { LabLeg } from '@mtv/backtest';
import { run, sell, buyPct } from './roi30-lib';
const yrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
for (const [sn, legs] of [
  ['P0.30', [sell('PE', 0.3)]], ['P0.35', [sell('PE', 0.35)]], ['P0.40', [sell('PE', 0.4)]],
  ['C0.20+P0.35', [sell('CE', 0.2), sell('PE', 0.35)]], ['C0.15+P0.30', [sell('CE', 0.15), sell('PE', 0.3)]],
  ['C0.15+P0.30+hedge-10', [sell('CE', 0.15), sell('PE', 0.3), buyPct('PE', -10)]],
] as [string, LabLeg[]][])
  for (const iv of ['any', 'high'] as const) {
    const cells: string[] = [];
    for (const db of [40, 45, 50]) for (const dl of [21, 25]) {
      const { r, row } = await run(`${sn} ${db}→${dl} ${iv}`, { schedule: { every: 'expiry', cycle: 'monthly', daysBefore: db }, legs, iv, exit: { daysLeft: dl } });
      const pre = r.trades.filter((t) => t.entry < '2021').reduce((a, t) => a + t.net, 0) / yrs('2011-01-03', '2021-01-01');
      cells.push(`${db}→${dl}: ${Math.round(row.perYear / 1000)}k (pre21 ${Math.round(pre / 1000)}k s21 ${Math.round(row.perYearSince21 / 1000)}k need ${row.margin ? Math.round((row.margin - row.worstMtm) / 1000) : '?'}k n${row.trades})`);
    }
    console.log(`${sn} ${iv}\n   ${cells.join('\n   ')}`);
  }
await prisma.$disconnect();
