// Stage 1 of the 30% ROI search: shapes × schedules × IV × booking, one lot of NIFTY at today's size.
// Writes .data/research/roi30-sweep.json with every trade (for stage 2 trend mixing).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import type { LabLeg, LabSchedule } from '@mtv/backtest';
import { run, sell, buy, buyPct, fut, fmt, type Row } from './roi30-lib';

const shapes: [string, LabLeg[]][] = [
  ['str16', [sell('CE', 0.16), sell('PE', 0.16)]],
  ['str20', [sell('CE', 0.2), sell('PE', 0.2)]],
  ['str25', [sell('CE', 0.25), sell('PE', 0.25)]],
  ['str30', [sell('CE', 0.3), sell('PE', 0.3)]],
  ['str35', [sell('CE', 0.35), sell('PE', 0.35)]],
  ['skew15/30', [sell('CE', 0.15), sell('PE', 0.3)]],
  ['skew10/30', [sell('CE', 0.1), sell('PE', 0.3)]],
  ['skew20/35', [sell('CE', 0.2), sell('PE', 0.35)]],
  ['skew15/40', [sell('CE', 0.15), sell('PE', 0.4)]],
  ['put30', [sell('PE', 0.3)]],
  ['put45', [sell('PE', 0.45)]],
  ['str25+crash12', [sell('CE', 0.25), sell('PE', 0.25), buyPct('PE', -12)]],
  ['skew15/35+crash12', [sell('CE', 0.15), sell('PE', 0.35), buyPct('PE', -12)]],
  ['bullRR25', [sell('PE', 0.25), buy('CE', 0.25)]],
  ['longFut', [fut('BUY')]],
  ['collar', [fut('BUY'), sell('CE', 0.25), buy('PE', 0.1)]],
];
const schedules: [string, LabSchedule, number | undefined][] = [];
for (const db of [30, 45, 60]) for (const dl of [undefined, 7, 14, 21, 30]) if (dl == null || dl < db - 7) schedules.push([`${db}→${dl ?? 'exp'}`, { every: 'expiry', cycle: 'monthly', daysBefore: db }, dl]);
schedules.push(['wk7→exp', { every: 'expiry', cycle: 'weekly', daysBefore: 7 }, undefined]);

const out: { row: Row; trades: { entry: string; exit: string; net: number; worstMtm: number; spotIn: number }[] }[] = [];
const t0 = performance.now();
for (const [sn, legs] of shapes)
  for (const [schn, schedule, daysLeft] of schedules)
    for (const iv of ['any', 'high'] as const)
      for (const book of [undefined, 50]) {
        if (legs.some((l) => l.kind === 'FUT') && (book || schn.startsWith('wk'))) continue;
        const name = `${sn} ${schn} ${iv}${book ? ' b' + book : ''}`;
        try {
          const { r, row } = await run(name, { schedule, legs, iv, exit: { ...(daysLeft ? { daysLeft } : {}), ...(book ? { bookPct: book } : {}) } });
          out.push({ row, trades: r.trades.map((t) => ({ entry: t.entry, exit: t.exit, net: t.net, worstMtm: t.worstMtm, spotIn: t.spotIn })) });
          console.log(fmt(row));
        } catch (e) { console.log(name, 'FAILED', (e as Error).message); }
      }
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/roi30-sweep.json'), JSON.stringify(out));
console.log('done', out.length, Math.round((performance.now() - t0) / 1000), 's');
await prisma.$disconnect();
