// B9b. B9's cross-sectional momentum (same 24 settings) with a NIFTY market filter, the engine's `market` rule:
// new buys only while NIFTY's rule holds at the same daily close; on "sell-all" every holding is sold at the next open
// when it turns off. Plus a volatility-scaled version (size × MIN(1, 15 / NIFTY HV20)). 2011-09 → 2023-12 only;
// chosen on train (2011–2018, Calmar), read on validation (2019–2023). Holdout is a separate, one-time run.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/quant/b9b-momentum-filter.ts
import { prisma } from '@mtv/db';
import { runPortfolio, curveMetrics, tradeMetrics, plateau, familySummary, guardHoldout, PERIODS, type EquityStrategy, type Instrument, type CurvePoint, type MarketFilter } from '@mtv/backtest';
import { loadEod, allEquityShareSymbols, dailyHistory } from '../../../src/eod/store';
import { register, saveDetail, COSTS } from './registry';

const TO = guardHoldout(process.env.B9B_TO ?? PERIODS.validation.to), FROM = '2011-09-01';
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
console.log(`${instruments.length} stocks, NIFTY from ${dateOf(nifty[0].time)}`);

const VOL = 'MIN(1, 15 / HV(20))';
export const FILTERS: Record<string, MarketFilter | null> = {
  none: null,
  'sma200-keep': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 200)', whenOff: 'keep' },
  'sma200-sell': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 200)', whenOff: 'sell-all' },
  'sma100-keep': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 100)', whenOff: 'keep' },
  'sma100-sell': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 100)', whenOff: 'sell-all' },
  'roc126-keep': { symbol: 'NIFTY', rule: 'ROC(CLOSE, 126) > 0', whenOff: 'keep' },
  'roc126-sell': { symbol: 'NIFTY', rule: 'ROC(CLOSE, 126) > 0', whenOff: 'sell-all' },
  vol: { symbol: 'NIFTY', sizeScale: VOL, whenOff: 'keep' },
  'sma200-keep-vol': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 200)', sizeScale: VOL, whenOff: 'keep' },
};

type P = { lookback: number; maxOpen: number; stopPct: number; skipMonth: 0 | 1; filter: string };
const GRID = { lookback: [63, 126, 252], maxOpen: [10, 20], stopPct: [0, 15], skipMonth: [0, 1] as const, filter: Object.keys(FILTERS) };
const key = (p: P) => `lb${p.lookback} open${p.maxOpen} stop${p.stopPct} skip${p.skipMonth} ${p.filter}`;

function strategy(p: P): EquityStrategy {
  const mom = p.skipMonth ? `(CLOSE[21] / CLOSE[${p.lookback + 21}] - 1) * 100` : `ROC(CLOSE, ${p.lookback})`;
  const f = FILTERS[p.filter];
  return {
    tf: 'D', side: 'LONG', entry: `${mom} > 0 AND CLOSE > SMA(CLOSE, 200) AND CLOSE > 20`,
    order: { type: 'market' }, stop: p.stopPct ? { kind: 'pct', value: p.stopPct } : { kind: 'none' }, target: { kind: 'none' }, trail: { kind: 'none' },
    maxBars: 21, sizing: { mode: 'percent', pct: Math.round(100 / p.maxOpen) }, maxOpen: p.maxOpen, pyramid: 1, cooldownBars: 0, maxEntriesPerBar: p.maxOpen,
    rank: mom, minAvgValueCr: 10, capitalRupees: CAPITAL, reinvest: true, slippagePct: 0.03, broker: 'zerodha', charges: true, from: FROM, to: TO, riskFreePct: 6.5,
    ...(f ? { market: f } : {}),
  };
}

type Out = { p: P; curve: CurvePoint[]; trades: { symbol: string; entry: string; exit: string; net: number; reason: string }[]; counts: Record<string, number> };
const outs: Out[] = [];
const t0 = Date.now();
for (const filter of GRID.filter) for (const lookback of GRID.lookback) for (const maxOpen of GRID.maxOpen) for (const stopPct of GRID.stopPct) for (const skipMonth of GRID.skipMonth) {
  const p: P = { lookback, maxOpen, stopPct, skipMonth, filter };
  const t1 = Date.now();
  const r = runPortfolio(instruments, strategy(p), nifty, nifty);
  outs.push({ p, curve: r.equity.map((e) => ({ date: dateOf(e.time), equity: e.equityPaise / 100 })), trades: r.trades.map((t) => ({ symbol: t.symbol, entry: dateOf(t.entryTime), exit: dateOf(t.exitTime), net: t.netPaise / 100, reason: t.exitReason })), counts: { signals: r.metrics.signals, skippedSlots: r.metrics.skippedSlots, illiquid: r.metrics.illiquid, marketOff: r.metrics.marketOff, dataBreakTrades: r.metrics.dataBreakTrades } });
  console.log(`${key(p).padEnd(44)} ${r.metrics.trades} trades, CAGR ${r.metrics.cagrPct.toFixed(1)}%, DD ${r.metrics.maxDrawdownPct.toFixed(1)}%  (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
}
console.log(`${outs.length} settings in ${((Date.now() - t0) / 60000).toFixed(1)} min`);

const slice = (c: CurvePoint[], from: string, to: string) => c.filter((x) => x.date >= from && x.date <= to);
const niftyCurve: CurvePoint[] = nifty.filter((c) => dateOf(c.time) >= FROM && dateOf(c.time) <= TO).map((c) => ({ date: dateOf(c.time), equity: c.close }));
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, ddDays: c.drawdown.longestUnderwaterDays, sharpe: c.sharpe, sortino: c.sortino, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstYear: Math.min(...c.annual.map((y) => y.returnPct)), positiveYearsPct: c.positiveYearsPct, annual: c.annual.map((y) => ({ year: y.year, returnPct: y.returnPct })) });
const bench = { train: brief(curveMetrics(slice(niftyCurve, PERIODS.train.from, PERIODS.train.to))), validation: brief(curveMetrics(slice(niftyCurve, PERIODS.validation.from, PERIODS.validation.to))), all: brief(curveMetrics(niftyCurve)) };
const table = outs.map((o) => ({ id: key(o.p), p: o.p, train: brief(curveMetrics(slice(o.curve, PERIODS.train.from, PERIODS.train.to))), validation: brief(curveMetrics(slice(o.curve, PERIODS.validation.from, PERIODS.validation.to))), all: brief(curveMetrics(o.curve)), trades: o.trades.length, counts: o.counts }));
const line = (b: ReturnType<typeof brief>) => `CAGR ${b.cagrPct}% DD ${b.maxDdPct}% worst yr ${b.worstYear}%`;
console.log(`\nNIFTY 50: train ${line(bench.train)} | validation ${line(bench.validation)}`);

// Each filter across the same 24 base settings: does it lower the drawdown everywhere, and at what cost in return?
const byFilter = GRID.filter.map((f) => {
  const rows = table.filter((r) => r.p.filter === f);
  return {
    filter: f,
    train: { cagr: familySummary(rows.map((r) => r.train.cagrPct)), dd: familySummary(rows.map((r) => r.train.maxDdPct)) },
    validation: { cagr: familySummary(rows.map((r) => r.validation.cagrPct)), dd: familySummary(rows.map((r) => r.validation.maxDdPct)) },
    passValidation: rows.filter((r) => r.validation.cagrPct > bench.validation.cagrPct && r.validation.maxDdPct < 25).length,
  };
});
console.log('\nBy filter, median of 24 settings (train | validation):');
for (const f of byFilter) console.log(`  ${f.filter.padEnd(16)} CAGR ${f.train.cagr.median}% DD ${f.train.dd.median}% | CAGR ${f.validation.cagr.median}% DD ${f.validation.dd.median}%  pass ${f.passValidation}/24`);

const chosen = [...table].sort((a, b) => (b.train.calmar ?? -9) - (a.train.calmar ?? -9))[0];
const grid = { lookback: GRID.lookback, maxOpen: GRID.maxOpen, stopPct: GRID.stopPct, skipMonth: [...GRID.skipMonth], filter: GRID.filter };
const same = table.filter((r) => r.p.filter === chosen.p.filter);
const baseGrid = { lookback: GRID.lookback, maxOpen: GRID.maxOpen, stopPct: GRID.stopPct, skipMonth: [...GRID.skipMonth] };
const plat = {
  trainCagr: plateau(chosen.p, same.map((r) => ({ params: r.p, value: r.train.cagrPct })), baseGrid),
  validationCagr: plateau(chosen.p, same.map((r) => ({ params: r.p, value: r.validation.cagrPct })), baseGrid),
  validationDd: plateau(chosen.p, same.map((r) => ({ params: r.p, value: r.validation.maxDdPct })), baseGrid),
};
const chosenOut = outs.find((o) => key(o.p) === chosen.id)!;
const tm = { train: tradeMetrics(chosenOut.trades.filter((t) => t.exit <= PERIODS.train.to)), validation: tradeMetrics(chosenOut.trades.filter((t) => t.exit > PERIODS.train.to)) };
console.log('\nChosen on train (best Calmar):', chosen.id, `\n  train ${line(chosen.train)} | validation ${line(chosen.validation)}`);
console.log('  plateau (validation CAGR, same filter):', JSON.stringify(plat.validationCagr));
const chosenFamily = byFilter.find((f) => f.filter === chosen.p.filter)!;
const pass = chosen.validation.cagrPct > bench.validation.cagrPct && chosen.validation.maxDdPct < 25 && chosenFamily.passValidation >= 12;
const id = await register({
  name: 'B9b momentum with a NIFTY market filter', family: 'B9',
  hypothesis: 'A NIFTY trend filter (or volatility scaling) keeps most of B9\'s return while cutting its 35–65% drawdowns below 25%.',
  script: 'scripts/research/quant/b9b-momentum-filter.ts',
  params: { base: 'B9 (E-20261111-008) settings', filters: FILTERS, grid: GRID, chosenOnTrainBy: 'Calmar', capital: CAPITAL, universe: `${instruments.length} NSE equity shares incl. delisted`, passMark: 'validation CAGR > NIFTY, max DD < 25%, and at least 12 of the chosen filter\'s 24 settings do the same' },
  period: { from: FROM, to: TO, role: 'train+validation' }, costs: COSTS.stocksLiquid,
  metrics: { nifty: bench, settings: table, byFilter, chosen: { id: chosen.id, train: chosen.train, validation: chosen.validation, trades: tm }, plateau: plat },
  validation: { trainValidationSplit: PERIODS, holdoutTouched: TO > PERIODS.validation.to, selection: 'single choice on train (Calmar) over all filters × settings', survivorship: 'none', placebo: 'each filter across the same 24 base settings; NIFTY as the crowd' },
  caveats: ['Rotation is approximated: each holding exits after 21 sessions and re-enters only if it still ranks.', 'Slippage 0.03% a side assumed.', 'Filter read at the same close as the stock signal; orders fill next open.', 'Sell-all exits pay full charges and slippage at the next open.'],
  verdict: pass ? 'lead' : 'fail', notes: `Chosen ${chosen.id}: validation CAGR ${chosen.validation.cagrPct}% vs NIFTY ${bench.validation.cagrPct}%, DD ${chosen.validation.maxDdPct}% vs ${bench.validation.maxDdPct}%; ${chosenFamily.passValidation}/24 of its filter pass.`,
});
saveDetail(id, 'curves', outs.map((o) => ({ p: o.p, curve: o.curve })));
saveDetail(id, 'chosen-trades', chosenOut.trades);
console.log(`\nRegistered ${id}`);
await prisma.$disconnect();
