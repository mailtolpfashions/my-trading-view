// A1. NIFTY monthly short-premium family (strangles 0.10–0.30 delta, straddle at the forward), one lot at today's size,
// 2011-01 → 2023-12 only (holdout locked). Questions, in order:
//   1. Family: of all settings tried, how many make money in train (2011–18) and in validation (2019–23)? (multiple-testing record)
//   2. Walk-forward: each year from 2016, pick the setting that scored best over the previous 5 years, trade it the next
//      year. Does the picked sequence beat the fixed benchmark (0.25 delta, 45→21, high IV) and the median setting?
//   3. Plateau: do the benchmark's neighbours (±1 step in delta, days in, days out) keep most of its result?
//   4. Curve: benchmark at 1 lot on ₹10 lakh — CAGR, drawdown, Sharpe, worst month — train and validation apart.
//   5. Monte Carlo (preview): block bootstrap of the benchmark's trade P&L.
// Costs: itemised dated charges, ₹1 slippage per option per fill. Strikes from traded closes only (missing: skip).
// Run (apps/feed, outside market hours): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=4096 -- npx tsx scripts/research/quant/a1-strangle-walkforward.ts
import { prisma } from '@mtv/db';
import {
  runLab, walkForward, familySummary, plateau, tradeMetrics, equityFromTrades, curveMetrics, blockBootstrap, guardHoldout, PERIODS,
  type LabStrategy, type LabLeg, type LabTrade, type Candidate,
} from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { register, saveDetail, COSTS } from './registry';

const TO = guardHoldout(PERIODS.validation.to);
const CAPITAL = 1_000_000;
const data = await labData('NIFTY');
const days = data.days.map((d) => d.date).filter((d) => d <= TO);

const sell = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const SHAPES: Record<string, LabLeg[]> = {
  s10: [sell('CE', 0.1), sell('PE', 0.1)], s16: [sell('CE', 0.16), sell('PE', 0.16)], s20: [sell('CE', 0.2), sell('PE', 0.2)],
  s25: [sell('CE', 0.25), sell('PE', 0.25)], s30: [sell('CE', 0.3), sell('PE', 0.3)],
  straddle: [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }],
};
const GRID = { shape: Object.keys(SHAPES), daysBefore: [30, 38, 45, 52, 60], daysLeft: [7, 14, 21, 28], iv: ['any', 'high'] };
type P = { shape: string; daysBefore: number; daysLeft: number; iv: string };
const key = (p: P) => `${p.shape} ${p.daysBefore}→${p.daysLeft} ${p.iv}`;
const BENCH: P = { shape: 's25', daysBefore: 45, daysLeft: 21, iv: 'high' };

type Row = { p: P; trades: LabTrade[]; skipped: number };
const rows: Row[] = [];
const t0 = Date.now();
let n = 0;
for (const shape of GRID.shape) for (const daysBefore of GRID.daysBefore) for (const daysLeft of GRID.daysLeft) for (const iv of GRID.iv as ('any' | 'high')[]) {
  if (daysLeft >= daysBefore - 7) continue;
  const p: P = { shape, daysBefore, daysLeft, iv };
  const s: LabStrategy = { name: key(p), underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore }, legs: SHAPES[shape], iv, exit: { daysLeft }, missing: 'skip', slippage: 1, money: 'today', to: TO };
  const r = await runLab(s, data);
  rows.push({ p, trades: r.trades, skipped: r.skipped.length });
  if (++n % 20 === 0) console.log(`${n} settings, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`${rows.length} settings run in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const sum = (ts: LabTrade[]) => Math.round(ts.reduce((a, t) => a + t.net, 0));
const inP = (ts: LabTrade[], from: string, to: string) => ts.filter((t) => t.exit >= from && t.exit <= to);
const train = (ts: LabTrade[]) => inP(ts, PERIODS.train.from, PERIODS.train.to), valid = (ts: LabTrade[]) => inP(ts, PERIODS.validation.from, PERIODS.validation.to);

// 1. family
const fam = { train: familySummary(rows.map((r) => sum(train(r.trades)))), validation: familySummary(rows.map((r) => sum(valid(r.trades)))) };
const famHigh = { train: familySummary(rows.filter((r) => r.p.iv === 'high').map((r) => sum(train(r.trades)))), validation: familySummary(rows.filter((r) => r.p.iv === 'high').map((r) => sum(valid(r.trades)))) };
const bothProfitable = rows.filter((r) => sum(train(r.trades)) > 0 && sum(valid(r.trades)) > 0).length;
console.log('\nFamily (per setting, ₹ total at today\'s size):', JSON.stringify(fam), '\nhigh-IV only:', JSON.stringify(famHigh), '\nprofitable in both periods:', bothProfitable, 'of', rows.length);

// 2. walk-forward
const years = Array.from({ length: 13 }, (_, i) => String(2011 + i));
const cands: Candidate<P>[] = rows.map((r) => {
  const by = new Map<string, { net: number; worst: number; trades: number }>();
  for (const y of years) { const ts = r.trades.filter((t) => t.exit.startsWith(y)); if (ts.length) by.set(y, { net: sum(ts), worst: Math.min(0, ...ts.map((t) => t.worstMtm)), trades: ts.length }); }
  return { id: key(r.p), params: r.p, byYear: by };
});
const byTotal = (rs: { net: number }[]) => rs.reduce((a, r) => a + r.net, 0);
const byRisk = (rs: { net: number; worst: number }[]) => byTotal(rs) / Math.max(10_000, -Math.min(...rs.map((r) => r.worst)));
const wf = { total5: walkForward(cands, years, 5, byTotal), risk5: walkForward(cands, years, 5, byRisk), total3: walkForward(cands, years, 3, byTotal), risk3: walkForward(cands, years, 3, byRisk) };
const benchRow = rows.find((r) => key(r.p) === key(BENCH))!;
const wfYears = wf.total5.picks.map((p) => p.year);
const over = (r: Row) => sum(r.trades.filter((t) => wfYears.includes(t.exit.slice(0, 4))));
const benchOverWf = over(benchRow);
const medianOverWf = familySummary(rows.map(over)).median;
const bestHindsight = Math.max(...rows.map(over));
console.log('\nWalk-forward 2016–2023 (₹):');
for (const [k, v] of Object.entries(wf)) console.log(`  ${k.padEnd(7)} total ${v.total}  worst MTM ${v.worst}  changes ${v.changes}  picks: ${v.picks.map((p) => `${p.year}:${p.chosen}=${p.net}`).join(' | ')}`);
console.log(`  benchmark over the same years ${benchOverWf}; median setting ${medianOverWf}; best in hindsight ${bestHindsight}`);

// 3. plateau around the benchmark (validation total) and (train total)
const all = rows.map((r) => ({ params: r.p, value: sum(valid(r.trades)) }));
const allTrain = rows.map((r) => ({ params: r.p, value: sum(train(r.trades)) }));
const grid = { shape: GRID.shape, daysBefore: GRID.daysBefore, daysLeft: GRID.daysLeft, iv: GRID.iv };
const plat = { validation: plateau(BENCH, all, grid), train: plateau(BENCH, allTrain, grid) };
console.log('\nBenchmark plateau (share kept by each neighbour), validation:', plat.validation.neighbours.map((x) => `${String(x.key)}=${x.value}:${x.kept}`).join(' '), '\n  train:', plat.train.neighbours.map((x) => `${String(x.key)}=${x.value}:${x.kept}`).join(' '));

// 4. benchmark curve at 1 lot on ₹10 lakh
const curve = equityFromTrades(days, CAPITAL, benchRow.trades);
const slice = (from: string, to: string) => curve.filter((p) => p.date >= from && p.date <= to);
const cm = { all: curveMetrics(curve), train: curveMetrics(slice(PERIODS.train.from, PERIODS.train.to)), validation: curveMetrics(slice(PERIODS.validation.from, PERIODS.validation.to)) };
const tm = { all: tradeMetrics(benchRow.trades), train: tradeMetrics(train(benchRow.trades)), validation: tradeMetrics(valid(benchRow.trades)) };
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, maxDd: c.drawdown.maxDd, ddDays: c.drawdown.longestUnderwaterDays, sharpe: c.sharpe, sortino: c.sortino, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstMonth: c.worstMonth, worstDayPct: c.worstDayPct });
console.log('\nBenchmark 0.25Δ 45→21 high IV, 1 lot on ₹10 lakh:');
for (const k of ['train', 'validation', 'all'] as const) console.log(`  ${k.padEnd(10)}`, JSON.stringify({ ...brief(cm[k]), trades: tm[k].trades, winRatePct: tm[k].winRatePct, pf: tm[k].profitFactor, expectancy: tm[k].expectancy, maxConsecLoss: tm[k].maxConsecutiveLosses, withoutBest2: tm[k].totalWithoutBest2 }));

// 5. bootstrap preview on trade P&L (validation and whole development window)
const boot = { all: blockBootstrap(benchRow.trades.map((t) => t.net), { draws: 2000, blockLen: 3, seed: 11, ddThresholds: [50_000, 100_000, 150_000, 200_000] }) };
console.log('\nBootstrap (trade P&L, 2,000 draws): total p5/p50/p95', boot.all.total.p5, boot.all.total.p50, boot.all.total.p95, '; max DD p50/p95/p99', boot.all.maxDd.p50, boot.all.maxDd.p95, boot.all.maxDd.p99, '; DD ≥ ₹1 lakh in', boot.all.ddAtLeast[1].share, 'of draws');

// most-often-picked settings and their own validation results
const pickCount = new Map<string, number>();
for (const v of Object.values(wf)) for (const p of v.picks) pickCount.set(p.chosen, (pickCount.get(p.chosen) ?? 0) + 1);
const topPicks = [...pickCount].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, c]) => { const r = rows.find((x) => key(x.p) === id)!; return { id, picks: c, train: sum(train(r.trades)), validation: sum(valid(r.trades)), trades: r.trades.length, worstMtm: Math.min(0, ...r.trades.map((t) => t.worstMtm)) }; });
console.log('\nMost picked settings:', topPicks.map((p) => `${p.id} ×${p.picks} train ${p.train} valid ${p.validation} worst ${p.worstMtm}`).join('\n  '));

const wfBeatsBench = Object.values(wf).filter((v) => v.total > benchOverWf).length;
const verdict = fam.validation.profitable / fam.validation.tried >= 0.8 && sum(valid(benchRow.trades)) > 0 ? 'lead' : 'fail';
const id = await register({
  name: 'A1 NIFTY monthly short-premium family: walk-forward, plateau, curve', family: 'A1',
  hypothesis: 'Selling monthly NIFTY premium (strangle/straddle, 30–60 days in, 7–28 days out) earns a volatility risk premium that survives when the setting is chosen on past years only.',
  script: 'scripts/research/quant/a1-strangle-walkforward.ts',
  params: { grid: GRID, benchmark: BENCH, lots: 1, money: 'today', missing: 'skip', capital: CAPITAL, walkForwardFit: [5, 3], scores: ['total', 'total / worst MTM'] },
  period: { from: days[0], to: TO, role: 'train+validation' }, costs: COSTS.nifty,
  metrics: {
    settings: rows.length, family: fam, familyHighIv: famHigh, profitableBothPeriods: bothProfitable,
    benchmark: { train: sum(train(benchRow.trades)), validation: sum(valid(benchRow.trades)), curve: { train: brief(cm.train), validation: brief(cm.validation), all: brief(cm.all) }, trades: { train: tm.train, validation: tm.validation, all: tm.all } },
    walkForward: Object.fromEntries(Object.entries(wf).map(([k, v]) => [k, { total: v.total, worst: v.worst, changes: v.changes, picks: v.picks.map((p) => ({ year: p.year, chosen: p.chosen, net: p.net, trades: p.trades })) }])),
    walkForwardCompare: { benchmarkSameYears: benchOverWf, medianSettingSameYears: medianOverWf, bestInHindsight: bestHindsight, years: wfYears, walkForwardBeatsBenchmark: `${wfBeatsBench} of 4` },
    plateau: plat, topPicks, bootstrap: boot,
  },
  validation: { trainValidationSplit: PERIODS, holdoutTouched: false, placebo: 'family distribution (all settings) used as the multiple-testing reference; no random-entry placebo is possible with the lab\'s schedules', contaminationNote: 'This family was studied on the full history in Nov 2026 before this programme; 2019–23 is not a clean test for the benchmark itself. Walk-forward is the honest read.' },
  caveats: ['Money scaled to today\'s index level and lot (money: today).', 'Margin not modelled per trade here (today\'s SPAN in A2).', 'Strikes from traded closes; untraded settings skipped (counted).', 'Daily closes only: stops or books inside a day cannot be seen.', 'Bid/ask unknown: ₹1 slippage per option is an assumption.'],
  verdict, notes: `Benchmark validation total ₹${sum(valid(benchRow.trades))}; walk-forward (5y, total) ₹${wf.total5.total} vs benchmark ₹${benchOverWf} over ${wfYears[0]}–${wfYears.at(-1)}.`,
});
saveDetail(id, 'settings', rows.map((r) => ({ p: r.p, skipped: r.skipped, trades: r.trades.map((t) => ({ entry: t.entry, exit: t.exit, net: t.net, worstMtm: t.worstMtm, reason: t.reason, ivHigh: t.ivHigh, daily: t.daily })) })));
saveDetail(id, 'benchmark-curve', curve);
await prisma.$disconnect();
