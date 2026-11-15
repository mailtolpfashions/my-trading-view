// Phase 2: market regime table for NIFTY 50 (and Bank Nifty) from 2011: trend, realized-vol tercile, VIX tercile, crisis
// tags and expiry week per trading day, with counts per year. Written to .data/research/quant/regimes.json and read by
// every experiment report. No look-ahead: each day's label uses data up to that day.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/quant/p2-regimes.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { regimeCounts, regimeTable, type RegimeLabels } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { QUANT_DIR, dataVersion, register } from './registry';

const q = async (name: string) => (await prisma.indexEod.findMany({ where: { name }, orderBy: { date: 'asc' }, select: { date: true, closePaise: true } })).map((r) => ({ date: r.date, close: r.closePaise / 100 }));
const nifty = await q('NIFTY 50'), bank = await q('NIFTY BANK'), vix = await q('INDIA VIX');
const monthly = (await labData('NIFTY')).monthly;

const tables: Record<string, Map<string, RegimeLabels>> = { NIFTY: regimeTable(nifty, vix, monthly), BANKNIFTY: regimeTable(bank, vix, monthly) };
const byYear: Record<string, Record<string, Record<string, number>>> = {};
for (const [u, t] of Object.entries(tables)) {
  byYear[u] = {};
  for (const [d, r] of t) {
    const y = d.slice(0, 4), row = (byYear[u][y] ??= {});
    for (const k of [`trend:${r.trend}`, `vol:${r.vol}`, `vix:${r.vix}`]) row[k] = (row[k] ?? 0) + 1;
    if (r.crisis) row[`crisis:${r.crisis}`] = (row[`crisis:${r.crisis}`] ?? 0) + 1;
  }
}
console.log('NIFTY 50 regime days per year (trend / vol tercile / VIX tercile):');
for (const [y, row] of Object.entries(byYear.NIFTY)) {
  const g = (k: string) => String(row[k] ?? 0).padStart(4);
  console.log(`${y}  bull${g('trend:bull')} side${g('trend:sideways')} bear${g('trend:bear')} | vol lo${g('vol:low')} mid${g('vol:mid')} hi${g('vol:high')} | vix lo${g('vix:low')} mid${g('vix:mid')} hi${g('vix:high')}`);
}
console.log('totals:', regimeCounts(tables.NIFTY));

mkdirSync(QUANT_DIR, { recursive: true });
const out = { builtAt: new Date().toISOString(), data: await dataVersion(), byYear, tables: Object.fromEntries(Object.entries(tables).map(([u, t]) => [u, Object.fromEntries(t)])) };
writeFileSync(path.join(QUANT_DIR, 'regimes.json'), JSON.stringify(out));
await register({
  name: 'Regime table NIFTY/BANKNIFTY 2011-2026', family: 'P2', hypothesis: 'Label every trading day so results can be split by market state (no look-ahead).', script: 'scripts/research/quant/p2-regimes.ts',
  params: { trend: 'close vs SMA200 and 126-day change', vol: '20-day realized vol tercile vs prior 3 years', vix: 'INDIA VIX tercile vs prior 3 years', crisis: 'CRISIS_TAGS', expiryWeek: '≤6 calendar days before a monthly expiry' },
  period: { from: nifty[0].date, to: nifty.at(-1)!.date, role: 'other' }, costs: { broker: '-', slippage: '-', charges: '-' },
  metrics: { days: nifty.length, counts: regimeCounts(tables.NIFTY) }, validation: {}, caveats: ['VIX complete only from 2015; vix tercile is null before it has 250 days.', 'The table covers the holdout too; labels only, no results.'], verdict: 'info',
});
await prisma.$disconnect();
