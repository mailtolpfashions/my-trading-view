// Stock options vs NIFTY on the same window. Stock F&O history starts 2024-07-08 (about 2.3 years, no crash year), so
// this is weak evidence and is labelled so. Money is as traded (actual lot sizes). One lot each, ₹1 slippage
// (stock options' real spreads are often wider: a ₹2 run is printed too). A corporate action (bonus, split) inside a
// trade would distort it: such trades are flagged by a strike far from spot at exit.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { runLab, type LabStrategy, type LabLeg } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';

const STOCKS = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'LT', 'ITC', 'BHARTIARTL', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'TATAMOTORS', 'SUNPHARMA', 'M&M', 'TITAN', 'NTPC', 'TATASTEEL'];
const sp = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const shapes: [string, LabLeg[]][] = [['put30', [sp('PE', 0.3)]], ['put45', [sp('PE', 0.45)]], ['str20', [sp('CE', 0.2), sp('PE', 0.2)]], ['skew15/35', [sp('CE', 0.15), sp('PE', 0.35)]]];
const scheds: [string, number, number][] = [['30→7', 30, 7], ['20→3', 20, 3], ['45→7', 45, 7]];
const FROM = '2024-07-08';
const out: Record<string, unknown>[] = [];
for (const u of ['NIFTY', ...STOCKS]) {
  let d;
  try { d = await labData(u as 'NIFTY'); } catch (e) { console.log(u, 'no data', (e as Error).message); continue; }
  for (const [sn, legs] of shapes) for (const [schn, db, dl] of scheds) for (const slip of [1, 2]) {
    const s: LabStrategy = { name: sn, underlying: 'NIFTY', missing: 'skip', slippage: slip, money: 'actual', from: FROM, schedule: { every: 'expiry', cycle: 'monthly', daysBefore: db }, iv: 'any', exit: { daysLeft: dl }, legs };
    try {
      const r = await runLab(s, d);
      const t = r.trades, yrs = (Date.parse(r.to) - Date.parse(FROM)) / (365.25 * 864e5);
      const notional = t.length ? t.reduce((a, x) => a + x.spotIn, 0) / t.length * (d.days.at(-1)!.lotSize ?? 0) : 0;
      const row = { u, shape: sn, sched: schn, slip, n: t.length, won: t.filter((x) => x.net > 0).length, total: Math.round(r.summary.total), perYear: Math.round(r.summary.total / yrs),
        worst: r.summary.worst, worstMtm: r.summary.worstMtm, skipped: r.skipped.length, notional: Math.round(notional),
        pctNotionalYr: notional ? +(100 * r.summary.total / yrs / notional).toFixed(2) : null, first: t[0]?.entry, last: t.at(-1)?.exit };
      out.push(row);
      if (slip === 1 || u === 'NIFTY') console.log(JSON.stringify(row));
    } catch (e) { console.log(u, sn, schn, 'FAILED', (e as Error).message); }
  }
}
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/roi30-stocks.json'), JSON.stringify(out));
console.log('done', out.length);
await prisma.$disconnect();
