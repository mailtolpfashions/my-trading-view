// Stage 3 of the 30% ROI search: the put-heavy family and its neighbours (is the best one a lucky peak?), with and
// without a cheap crash put, so that margin + worst open loss fits ₹3 lakh. One lot NIFTY, today's size, ₹1 slippage.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import type { LabLeg } from '@mtv/backtest';
import { run, sell, buyPct, fmt, type Row } from './roi30-lib';

const out: { row: Row; trades: { entry: string; exit: string; net: number; worstMtm: number }[] }[] = [];
for (const pd of [0.35, 0.4, 0.45, 0.5])
  for (const call of [0, 0.1])
    for (const crash of [0, -8, -10, -12])
      for (const db of [40, 45, 50])
        for (const dl of [5, 7, 10, 14])
          for (const iv of ['high', 'any'] as const) {
            const legs: LabLeg[] = [sell('PE', pd), ...(call ? [sell('CE', call)] : []), ...(crash ? [buyPct('PE', crash)] : [])];
            const name = `P${pd}${call ? ' C' + call : ''}${crash ? ' hedge' + crash : ''} ${db}→${dl} ${iv}`;
            try {
              const { r, row } = await run(name, { schedule: { every: 'expiry', cycle: 'monthly', daysBefore: db }, legs, iv, exit: { daysLeft: dl } });
              out.push({ row, trades: r.trades.map((t) => ({ entry: t.entry, exit: t.exit, net: t.net, worstMtm: t.worstMtm })) });
              console.log(fmt(row), 'need', row.margin == null ? '?' : row.margin - row.worstMtm);
            } catch (e) { console.log(name, 'FAILED', (e as Error).message); }
          }
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/roi30-puts.json'), JSON.stringify(out));
console.log('done', out.length);
await prisma.$disconnect();
