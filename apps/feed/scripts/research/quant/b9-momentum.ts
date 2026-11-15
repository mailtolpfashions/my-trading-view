// B9. Cross-sectional momentum on ALL NSE equity shares (delisted included): each day, stocks above their 200-day
// average with a positive 6-month (or 3 / 12-month) return and ≥ ₹10 crore average turnover are candidates; the N
// highest-momentum ones fill the free slots; each holding is sold after 21 sessions (monthly rotation) unless a stop
// hits. Costs: Zerodha delivery (incl. DP), 0.03% slippage. 2011-09 → 2023-12, holdout locked. Choice on train only.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/quant/b9-momentum.ts
import { prisma } from '@mtv/db';
import { runPortfolio, curveMetrics, tradeMetrics, plateau, familySummary, guardHoldout, PERIODS, type EquityStrategy, type Instrument, type CurvePoint } from '@mtv/backtest';
import { loadEod, allEquityShareSymbols, dailyHistory } from '../../../src/eod/store';
import { register, saveDetail, COSTS } from './registry';

const TO = guardHoldout(PERIODS.validation.to), FROM = '2011-09-01';
const CAPITAL = 1_000_000;
const IST = 5.5 * 3600, dateOf = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);

await loadEod(() => {});
const instruments: Instrument[] = [];
for (const s of allEquityShareSymbols()) {
  const h = dailyHistory(s);
  if (!h || h.candles.length < 300 || !h.candles.some((c) => c.close * c.volume >= 5e7)) continue;
  instruments.push({ symbol: s, daily: h.candles, breaks: h.breaks.map((b) => b.date), kind: 'equity' });
}
const nifty = dailyHistory('NIFTY')!.candles;
console.log(`${instruments.length} stocks`);

type P = { lookback: number; maxOpen: number; stopPct: number; skipMonth: 0 | 1 };
const GRID = { lookback: [63, 126, 252], maxOpen: [10, 20], stopPct: [0, 15], skipMonth: [0, 1] as const };
const key = (p: P) => `lb${p.lookback} open${p.maxOpen} stop${p.stopPct} skip${p.skipMonth}`;

function strategy(p: P): EquityStrategy {
  const mom = p.skipMonth ? `(CLOSE[21] / CLOSE[${p.lookback + 21}] - 1) * 100` : `ROC(CLOSE, ${p.lookback})`;
  return {
    tf: 'D', side: 'LONG', entry: `${mom} > 0 AND CLOSE > SMA(CLOSE, 200) AND CLOSE > 20`,
    order: { type: 'market' }, stop: p.stopPct ? { kind: 'pct', value: p.stopPct } : { kind: 'none' }, target: { kind: 'none' }, trail: { kind: 'none' },
    maxBars: 21, sizing: { mode: 'percent', pct: Math.round(100 / p.maxOpen) }, maxOpen: p.maxOpen, pyramid: 1, cooldownBars: 0, maxEntriesPerBar: p.maxOpen,
    rank: mom, minAvgValueCr: 10, capitalRupees: CAPITAL, reinvest: true, slippagePct: 0.03, broker: 'zerodha', charges: true, from: FROM, to: TO, riskFreePct: 6.5,
  };
}

type Out = { p: P; curve: CurvePoint[]; trades: { symbol: string; entry: string; exit: string; net: number; reason: string }[]; counts: Record<string, number> };
const outs: Out[] = [];
const t0 = Date.now();
for (const lookback of GRID.lookback) for (const maxOpen of GRID.maxOpen) for (const stopPct of GRID.stopPct) for (const skipMonth of GRID.skipMonth) {
  const p: P = { lookback, maxOpen, stopPct, skipMonth };
  const t1 = Date.now();
  const r = runPortfolio(instruments, strategy(p), nifty);
  outs.push({ p, curve: r.equity.map((e) => ({ date: dateOf(e.time), equity: e.equityPaise / 100 })), trades: r.trades.map((t) => ({ symbol: t.symbol, entry: dateOf(t.entryTime), exit: dateOf(t.exitTime), net: t.netPaise / 100, reason: t.exitReason })), counts: { signals: r.metrics.signals, skippedSlots: r.metrics.skippedSlots, illiquid: r.metrics.illiquid, dataBreakTrades: r.metrics.dataBreakTrades } });
  console.log(`${key(p).padEnd(30)} ${r.metrics.trades} trades, CAGR ${r.metrics.cagrPct.toFixed(1)}%, DD ${r.metrics.maxDrawdownPct.toFixed(1)}%, charges ₹${Math.round(r.metrics.chargesPaise / 100)}  (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
}
console.log(`${outs.length} settings in ${((Date.now() - t0) / 60000).toFixed(1)} min`);

const slice = (c: CurvePoint[], from: string, to: string) => c.filter((x) => x.date >= from && x.date <= to);
const niftyCurve: CurvePoint[] = nifty.filter((c) => dateOf(c.time) >= FROM && dateOf(c.time) <= TO).map((c) => ({ date: dateOf(c.time), equity: c.close }));
const bench = { train: curveMetrics(slice(niftyCurve, PERIODS.train.from, PERIODS.train.to)), validation: curveMetrics(slice(niftyCurve, PERIODS.validation.from, PERIODS.validation.to)), all: curveMetrics(niftyCurve) };
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, ddDays: c.drawdown.longestUnderwaterDays, sharpe: c.sharpe, sortino: c.sortino, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstYear: Math.min(...c.annual.map((y) => y.returnPct)), positiveYearsPct: c.positiveYearsPct });
const table = outs.map((o) => ({ id: key(o.p), p: o.p, train: brief(curveMetrics(slice(o.curve, PERIODS.train.from, PERIODS.train.to))), validation: brief(curveMetrics(slice(o.curve, PERIODS.validation.from, PERIODS.validation.to))), all: brief(curveMetrics(o.curve)), trades: o.trades.length, counts: o.counts }));
console.log('\nNIFTY 50: train', JSON.stringify(brief(bench.train)), 'validation', JSON.stringify(brief(bench.validation)));
for (const r of [...table].sort((a, b) => b.train.cagrPct - a.train.cagrPct)) console.log(`  ${r.id.padEnd(30)} train CAGR ${r.train.cagrPct}% DD ${r.train.maxDdPct}% Sh ${r.train.sharpe} | valid CAGR ${r.validation.cagrPct}% DD ${r.validation.maxDdPct}% Sh ${r.validation.sharpe} | trades ${r.trades}`);

const chosen = [...table].sort((a, b) => (b.train.calmar ?? -9) - (a.train.calmar ?? -9))[0];
const grid = { lookback: GRID.lookback, maxOpen: GRID.maxOpen, stopPct: GRID.stopPct, skipMonth: [...GRID.skipMonth] };
const plat = { trainCagr: plateau(chosen.p, table.map((r) => ({ params: r.p, value: r.train.cagrPct })), grid), validationCagr: plateau(chosen.p, table.map((r) => ({ params: r.p, value: r.validation.cagrPct })), grid) };
const fam = { trainCagr: familySummary(table.map((r) => r.train.cagrPct)), validationCagr: familySummary(table.map((r) => r.validation.cagrPct)), validationExcessOverNifty: familySummary(table.map((r) => r.validation.cagrPct - bench.validation.cagrPct)) };
const chosenOut = outs.find((o) => key(o.p) === chosen.id)!;
const tm = { train: tradeMetrics(chosenOut.trades.filter((t) => t.exit <= PERIODS.train.to)), validation: tradeMetrics(chosenOut.trades.filter((t) => t.exit > PERIODS.train.to)) };
console.log('\nChosen on train (best Calmar):', chosen.id, '\n  train', JSON.stringify(chosen.train), '\n  validation', JSON.stringify(chosen.validation));
const beats = chosen.validation.cagrPct > bench.validation.cagrPct && chosen.validation.maxDdPct <= bench.validation.maxDdPct;
const id = await register({
  name: 'B9 cross-sectional momentum, monthly rotation, all NSE shares', family: 'B9',
  hypothesis: 'The highest 3/6/12-month-momentum liquid stocks, rotated monthly, beat NIFTY after costs.',
  script: 'scripts/research/quant/b9-momentum.ts',
  params: { entry: 'momentum > 0 AND CLOSE > SMA200 AND CLOSE > 20', rank: 'momentum', hold: '21 sessions', minAvgTurnoverCr: 10, grid: GRID, chosenOnTrainBy: 'Calmar', capital: CAPITAL, universe: `${instruments.length} NSE equity shares incl. delisted` },
  period: { from: FROM, to: TO, role: 'train+validation' }, costs: COSTS.stocksLiquid,
  metrics: { nifty: { train: brief(bench.train), validation: brief(bench.validation) }, settings: table, chosen: { id: chosen.id, train: chosen.train, validation: chosen.validation, trades: tm }, family: fam, plateau: plat },
  validation: { trainValidationSplit: PERIODS, holdoutTouched: false, selection: 'single choice on train (Calmar)', survivorship: 'none', placebo: 'family distribution across 24 settings; NIFTY as the crowd' },
  caveats: ['Rotation is approximated: each holding exits after 21 sessions and re-enters only if it still ranks; not a true top-decile rebalance.', 'Slippage 0.03% a side assumed.', 'Percent-of-equity sizing compounds.'],
  verdict: beats ? 'lead' : 'fail', notes: `Chosen ${chosen.id}: validation CAGR ${chosen.validation.cagrPct}% vs NIFTY ${bench.validation.cagrPct}%, DD ${chosen.validation.maxDdPct}% vs ${bench.validation.maxDdPct}%.`,
});
saveDetail(id, 'curves', outs.map((o) => ({ p: o.p, curve: o.curve })));
saveDetail(id, 'chosen-trades', chosenOut.trades);
await prisma.$disconnect();
