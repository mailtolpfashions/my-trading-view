// B10. 52-week-high breakout as a costed portfolio on ALL NSE equity shares (delisted included, no survivorship),
// 2011-09 → 2023-12 (holdout locked). The signal showed about +1% excess per 20 sessions in preset-evidence; here it has
// slots, point-in-time liquidity (20-day average turnover ≥ ₹10 crore at the signal), ATR trailing stop, time exit,
// ranking by 6-month momentum when slots are short, Zerodha delivery charges (incl. DP charge) and 0.03% slippage.
// One run per setting over the whole development window; train and validation are read from the same curve, so the
// grid choice is made on train numbers and checked on validation numbers.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/quant/b10-52w-breakout.ts
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
  if (!h || h.candles.length < 300) continue;
  // Keep stocks that were ever liquid enough to matter: a day with ₹5 crore traded. The strategy's own rule is point-in-time.
  if (!h.candles.some((c) => c.close * c.volume >= 5e7)) continue;
  instruments.push({ symbol: s, daily: h.candles, breaks: h.breaks.map((b) => b.date), kind: 'equity' });
}
const nifty = dailyHistory('NIFTY')!.candles;
console.log(`${instruments.length} stocks`);

type P = { maxOpen: number; trail: number; maxBars: number; exitRule: 'none' | 'sma50' };
const GRID = { maxOpen: [5, 10, 20], trail: [2, 3, 4], maxBars: [40, 60, 120], exitRule: ['none', 'sma50'] as const };
const key = (p: P) => `open${p.maxOpen} trail${p.trail} hold${p.maxBars} ${p.exitRule}`;
const BASE: P = { maxOpen: 10, trail: 3, maxBars: 60, exitRule: 'none' };

function strategy(p: P): EquityStrategy {
  return {
    tf: 'D', side: 'LONG', entry: 'CLOSE > HIGHEST(HIGH, 252)[1] AND CLOSE > 20', exit: p.exitRule === 'sma50' ? 'CLOSE < SMA(CLOSE, 50)' : undefined,
    order: { type: 'market' }, stop: { kind: 'atr', mult: p.trail, length: 14 }, target: { kind: 'none' }, trail: { kind: 'atr', mult: p.trail, length: 14 },
    maxBars: p.maxBars, sizing: { mode: 'percent', pct: Math.round(100 / p.maxOpen) }, maxOpen: p.maxOpen, pyramid: 1, cooldownBars: 20, maxEntriesPerBar: p.maxOpen,
    rank: 'ROC(CLOSE, 126)', minAvgValueCr: 10, capitalRupees: CAPITAL, reinvest: true, slippagePct: 0.03, broker: 'zerodha', charges: true, from: FROM, to: TO, riskFreePct: 6.5,
  };
}

type Out = { p: P; curve: CurvePoint[]; trades: { symbol: string; entry: string; exit: string; net: number; reason: string }[]; counts: Record<string, number> };
const outs: Out[] = [];
const t0 = Date.now();
for (const maxOpen of GRID.maxOpen) for (const trail of GRID.trail) for (const maxBars of GRID.maxBars) for (const exitRule of GRID.exitRule) {
  const p: P = { maxOpen, trail, maxBars, exitRule };
  const t1 = Date.now();
  const r = runPortfolio(instruments, strategy(p), nifty);
  const curve = r.equity.map((e) => ({ date: dateOf(e.time), equity: e.equityPaise / 100 }));
  outs.push({ p, curve, trades: r.trades.map((t) => ({ symbol: t.symbol, entry: dateOf(t.entryTime), exit: dateOf(t.exitTime), net: t.netPaise / 100, reason: t.exitReason })), counts: { signals: r.metrics.signals, skippedSlots: r.metrics.skippedSlots, illiquid: r.metrics.illiquid, dataBreakTrades: r.metrics.dataBreakTrades } });
  console.log(`${key(p).padEnd(32)} ${r.metrics.trades} trades, CAGR ${r.metrics.cagrPct.toFixed(1)}%, DD ${r.metrics.maxDrawdownPct.toFixed(1)}%, bench CAGR ${r.benchmark?.cagrPct.toFixed(1)}%  (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
}
console.log(`${outs.length} settings in ${((Date.now() - t0) / 60000).toFixed(1)} min`);

const slice = (c: CurvePoint[], from: string, to: string) => c.filter((x) => x.date >= from && x.date <= to);
const per = (o: Out) => ({ train: curveMetrics(slice(o.curve, PERIODS.train.from, PERIODS.train.to)), validation: curveMetrics(slice(o.curve, PERIODS.validation.from, PERIODS.validation.to)), all: curveMetrics(o.curve) });
const niftyCurve: CurvePoint[] = nifty.filter((c) => dateOf(c.time) >= FROM && dateOf(c.time) <= TO).map((c) => ({ date: dateOf(c.time), equity: c.close }));
const bench = { train: curveMetrics(slice(niftyCurve, PERIODS.train.from, PERIODS.train.to)), validation: curveMetrics(slice(niftyCurve, PERIODS.validation.from, PERIODS.validation.to)), all: curveMetrics(niftyCurve) };
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, ddDays: c.drawdown.longestUnderwaterDays, sharpe: c.sharpe, sortino: c.sortino, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstYear: Math.min(...c.annual.map((y) => y.returnPct)), positiveYearsPct: c.positiveYearsPct });

const table = outs.map((o) => { const m = per(o); return { id: key(o.p), p: o.p, train: brief(m.train), validation: brief(m.validation), all: brief(m.all), trades: o.trades.length, counts: o.counts }; });
console.log('\nNIFTY 50 buy-and-hold: train', JSON.stringify(brief(bench.train)), 'validation', JSON.stringify(brief(bench.validation)));
console.log('\nSettings sorted by train CAGR (then validation shown):');
for (const r of [...table].sort((a, b) => b.train.cagrPct - a.train.cagrPct)) console.log(`  ${r.id.padEnd(32)} train CAGR ${r.train.cagrPct}% DD ${r.train.maxDdPct}% Sh ${r.train.sharpe} | valid CAGR ${r.validation.cagrPct}% DD ${r.validation.maxDdPct}% Sh ${r.validation.sharpe} | trades ${r.trades}`);

// Choice on train only: best Calmar with at least 100 train trades; then its validation numbers and plateau.
const trainTrades = (o: Out) => o.trades.filter((t) => t.exit <= PERIODS.train.to).length;
const chosen = [...table].filter((r) => trainTrades(outs.find((o) => key(o.p) === r.id)!) >= 100).sort((a, b) => (b.train.calmar ?? -9) - (a.train.calmar ?? -9))[0];
const grid = { maxOpen: GRID.maxOpen, trail: GRID.trail, maxBars: GRID.maxBars, exitRule: [...GRID.exitRule] };
const plat = { trainCagr: plateau(chosen.p, table.map((r) => ({ params: r.p, value: r.train.cagrPct })), grid), validationCagr: plateau(chosen.p, table.map((r) => ({ params: r.p, value: r.validation.cagrPct })), grid) };
const fam = { trainCagr: familySummary(table.map((r) => r.train.cagrPct)), validationCagr: familySummary(table.map((r) => r.validation.cagrPct)), validationExcessOverNifty: familySummary(table.map((r) => r.validation.cagrPct - bench.validation.cagrPct)) };
const chosenOut = outs.find((o) => key(o.p) === chosen.id)!;
const tm = { train: tradeMetrics(chosenOut.trades.filter((t) => t.exit <= PERIODS.train.to)), validation: tradeMetrics(chosenOut.trades.filter((t) => t.exit > PERIODS.train.to)) };
console.log('\nChosen on train (best Calmar):', chosen.id, '\n  train', JSON.stringify(chosen.train), '\n  validation', JSON.stringify(chosen.validation), '\n  plateau (validation CAGR kept):', plat.validationCagr.neighbours.map((x) => `${String(x.key)}=${x.value}:${x.result}%`).join(' '));
console.log('  trades: train', tm.train.trades, 'win', tm.train.winRatePct, '% pf', tm.train.profitFactor, '| validation', tm.validation.trades, 'win', tm.validation.winRatePct, '% pf', tm.validation.profitFactor);

const beats = chosen.validation.cagrPct > bench.validation.cagrPct && chosen.validation.maxDdPct <= bench.validation.maxDdPct;
const id = await register({
  name: 'B10 52-week-high breakout portfolio, all NSE shares', family: 'B10',
  hypothesis: 'Buying 52-week-high breakouts in liquid stocks with an ATR trail and a time exit beats NIFTY after costs with a smaller drawdown.',
  script: 'scripts/research/quant/b10-52w-breakout.ts',
  params: { entry: 'CLOSE > HIGHEST(HIGH,252)[1] AND CLOSE > 20', rank: 'ROC(CLOSE,126)', minAvgTurnoverCr: 10, sizing: '100/maxOpen % of equity', cooldownBars: 20, grid: GRID, chosenOnTrainBy: 'Calmar (≥100 train trades)', capital: CAPITAL, universe: `${instruments.length} NSE equity shares incl. delisted, ever ≥ ₹5 cr a day` },
  period: { from: FROM, to: TO, role: 'train+validation' }, costs: COSTS.stocksLiquid,
  metrics: { nifty: { train: brief(bench.train), validation: brief(bench.validation), all: brief(bench.all) }, settings: table, chosen: { id: chosen.id, train: chosen.train, validation: chosen.validation, trades: tm }, family: fam, plateau: plat },
  validation: { trainValidationSplit: PERIODS, holdoutTouched: false, selection: 'single choice on train (Calmar), validation read once', survivorship: 'none: all shares incl. delisted; liquidity point-in-time', placebo: 'family distribution across 54 settings; NIFTY buy-and-hold as the crowd' },
  caveats: ['Slippage 0.03% a side is an assumption.', 'Signals at close, fills next open; a gap through the trail fills at the open.', 'Percent-of-equity sizing compounds, so later years weigh more in rupee terms; CAGR per period is from the curve slice.', `${table.reduce((a, r) => a + r.counts.dataBreakTrades, 0)} trades across settings span an unadjusted corporate action (flagged by the engine).`],
  verdict: beats ? 'lead' : 'fail', notes: `Chosen ${chosen.id}: validation CAGR ${chosen.validation.cagrPct}% vs NIFTY ${bench.validation.cagrPct}%, DD ${chosen.validation.maxDdPct}% vs ${bench.validation.maxDdPct}%.`,
});
saveDetail(id, 'curves', outs.map((o) => ({ p: o.p, curve: o.curve })));
saveDetail(id, 'chosen-trades', chosenOut.trades);
await prisma.$disconnect();
