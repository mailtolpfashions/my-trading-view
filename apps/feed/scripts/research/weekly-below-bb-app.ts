// Runs the "Weekly candle below the lower Bollinger band" Backtest template through the app's own engine (all NSE stocks).
// Run (apps/feed): npx dotenv -e ../../.env -- node --max-old-space-size=6144 --import tsx scripts/research/weekly-below-bb-app.ts
import { prisma } from '@mtv/db';
import { loadEod } from '../../src/eod/store';
import { runStrategyBacktest } from '../../src/strategy/backtest';

await loadEod(() => {});
const strategy = {
  tf: 'W', side: 'LONG', entry: 'CLOSE < BB_LOWER(CLOSE, 20, 2) AND OPEN < BB_LOWER(CLOSE, 20, 2) AND HIGH < BB_LOWER(CLOSE, 20, 2) AND LOW < BB_LOWER(CLOSE, 20, 2) AND CLOSE > SMA(CLOSE, 200)',
  exit: 'CLOSE < SMA(CLOSE, 200)', order: { type: 'stop', offsetPct: 2 }, stop: { kind: 'none' }, target: { kind: 'formula', formula: 'BB_UPPER(CLOSE, 20, 2)' }, trail: { kind: 'none' },
  sizing: { mode: 'percent', pct: 10 }, maxOpen: 10, pyramid: 1, cooldownBars: 0, maxEntriesPerBar: 5, rank: 'AVG_TURNOVER(20)', minAvgValueCr: 1,
  capitalRupees: 1000000, reinvest: true, slippagePct: 0.05, broker: 'zerodha', charges: true, from: '2012-01-01', to: '2026-11-23', riskFreePct: 6,
} as const;
const r = await runStrategyBacktest({ strategy: strategy as never, universe: { kind: 'all' } }) as any;
const m = r.result?.metrics ?? r.metrics;
console.log(JSON.stringify(m, null, 1).slice(0, 2500));
const trades = r.result?.trades ?? r.trades;
const reasons: Record<string, number> = {};
for (const t of trades) reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1;
console.log('trades', trades.length, reasons);
const d = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
const srt = [...trades].sort((a: any, b: any) => a.entryTime - b.entryTime);
for (const t of [...srt.slice(0, 3), ...srt.slice(-3)]) console.log(t.symbol, d(t.entryTime), t.entryPricePaise / 100, '->', d(t.exitTime), t.exitPricePaise / 100, t.exitReason, t.returnPct.toFixed(1) + '%');
await prisma.$disconnect();
