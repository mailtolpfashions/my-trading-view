// Phase 11. Sizing and combination of the surviving leads on ₹10 lakh, 2011/2019 → 2023 (holdout locked):
//   W  = NIFTY weekly short strangle in the Tuesday→Wednesday window (A3b's choice on 2019–21), 0.16 delta, high IV
//   W2 = the Monday→expiry 0.16 delta high-IV version (8 of 8 years positive on Bank Nifty), as the alternative
//   M  = NIFTY monthly 0.25 delta strangle 45→21, high IV (A1 benchmark; a hindsight pick, kept as the reference)
// For each: lots 1–4 → CAGR, drawdown, Calmar, worst month, margin use, gap-stress as % of capital. Then the correlation
// of daily P&L between W and M and the combined book (W 2 lots + M 1 lot; W 3 lots alone) over the common years.
// Reads the trade lists saved by A3b and A1 (apps/feed/.data/research/quant/<id>-*.json).
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/quant/p11-portfolio.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { equityFromTrades, curveMetrics, tradeMetrics, pnlCorrelation, combineCurves, blockBootstrap, guardHoldout, PERIODS, type CurvePoint } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { QUANT_DIR, readRegistry, register, saveDetail, COSTS } from './registry';

const TO = guardHoldout(PERIODS.validation.to);
const CAPITAL = 1_000_000;
const reg = readRegistry();
const a3b = reg.filter((e) => e.name.startsWith('A3b')).at(-1)!, a1 = reg.filter((e) => e.family === 'A1').at(-1)!;
type T = { entry: string; exit: string; net: number; worstMtm: number; spotIn?: number; daily: { date: string; mtm: number }[] };
const niftyWeekly = JSON.parse(readFileSync(path.join(QUANT_DIR, `${a3b.id}-nifty-settings.json`), 'utf8')) as { p: { window: string; shape: string; iv: string }; trades: T[] }[];
const monthly = JSON.parse(readFileSync(path.join(QUANT_DIR, `${a1.id}-settings.json`), 'utf8')) as { p: { shape: string; daysBefore: number; daysLeft: number; iv: string }; trades: T[] }[];
const pick = (w: string, s: string, iv: string) => niftyWeekly.find((r) => r.p.window === w && r.p.shape === s && r.p.iv === iv)!.trades;
const books: Record<string, { trades: T[]; marginPerLot: number; from: string }> = {
  'W Tue→Wed s16 high': { trades: pick('Tue→Wed', 's16', 'high'), marginPerLot: 177_466, from: '2019-02-01' },
  'W2 Mon→exp s16 high': { trades: pick('Mon→exp', 's16', 'high'), marginPerLot: 177_466, from: '2019-02-01' },
  'W3 Tue→Wed s16 any': { trades: pick('Tue→Wed', 's16', 'any'), marginPerLot: 177_466, from: '2019-02-01' },
  'M s25 45→21 high': { trades: monthly.find((r) => r.p.shape === 's25' && r.p.daysBefore === 45 && r.p.daysLeft === 21 && r.p.iv === 'high')!.trades, marginPerLot: 175_608, from: '2011-01-03' },
};
const a3m = a3b.metrics as { nifty: { chosen: { gapStress: { shocks: { gapPct: number; median: number | null; worst: number | null }[] } } } };
const gap5 = a3m.nifty.chosen.gapStress.shocks.find((s) => s.gapPct === -5)!, gap8 = a3m.nifty.chosen.gapStress.shocks.find((s) => s.gapPct === -8)!;

const data = await labData('NIFTY');
const allDays = data.days.map((d) => d.date).filter((d) => d <= TO);
const scaled = (ts: T[], lots: number) => ts.map((t) => ({ ...t, net: t.net * lots, daily: t.daily.map((p) => ({ date: p.date, mtm: p.mtm * lots })) }));
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, ddDays: c.drawdown.longestUnderwaterDays, sharpe: c.sharpe, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstYearPct: Math.min(...c.annual.map((y) => y.returnPct)), positiveYearsPct: c.positiveYearsPct, annual: c.annual.map((y) => `${y.year}:${y.returnPct}%`).join(' ') });
const slice = (c: CurvePoint[], from: string, to: string) => c.filter((p) => p.date >= from && p.date <= to);

const table: Record<string, unknown>[] = [];
const curves: Record<string, CurvePoint[]> = {};
for (const [name, b] of Object.entries(books)) {
  const days = allDays.filter((d) => d >= b.from);
  const tm = tradeMetrics(b.trades);
  console.log(`\n${name}: ${tm.trades} trades, ${tm.winRatePct}% won, pf ${tm.profitFactor}, worst trade ₹${tm.largestLoss}, max consecutive losses ${tm.maxConsecutiveLosses}, without best 2 ₹${tm.totalWithoutBest2} of ₹${tm.total}`);
  for (const lots of [1, 2, 3, 4]) {
    const curve = equityFromTrades(days, CAPITAL, scaled(b.trades, lots));
    if (lots === 1) curves[name] = curve;
    const all = curveMetrics(curve);
    const parts = name.startsWith('M') ? { train: brief(curveMetrics(slice(curve, PERIODS.train.from, PERIODS.train.to))), validation: brief(curveMetrics(slice(curve, PERIODS.validation.from, PERIODS.validation.to))) } : { fit: brief(curveMetrics(slice(curve, b.from, '2021-12-31'))), test: brief(curveMetrics(slice(curve, '2022-01-01', TO))) };
    const row = { book: name, lots, marginUsePct: Math.round((b.marginPerLot * lots / CAPITAL) * 100), all: brief(all), ...parts, gap5PctOfCapital: name.startsWith('M') ? null : Math.round(((gap5.median ?? 0) * lots / CAPITAL) * 1000) / 10, gap8PctOfCapital: name.startsWith('M') ? null : Math.round(((gap8.median ?? 0) * lots / CAPITAL) * 1000) / 10 };
    table.push(row);
    const p = Object.entries(parts).map(([k, v]) => `${k} CAGR ${v.cagrPct}% DD ${v.maxDdPct}%`).join(' | ');
    console.log(`  ${lots} lot${lots > 1 ? 's' : ''} margin ${row.marginUsePct}%: all CAGR ${all.cagrPct}% DD ${all.drawdown.maxDdPct}% Calmar ${all.calmar} worst month ${all.worstMonthPct}% | ${p}${row.gap5PctOfCapital != null ? ` | −5% gap ≈ −${row.gap5PctOfCapital}% of capital, −8% ≈ −${row.gap8PctOfCapital}%` : ''}`);
  }
}

// correlation and combination over the common window (2019-02 → 2023-12)
const common = (c: CurvePoint[]) => slice(c, '2019-02-01', TO);
const corr = { W_M: pnlCorrelation(common(curves['W Tue→Wed s16 high']), common(curves['M s25 45→21 high'])), W_W2: pnlCorrelation(common(curves['W Tue→Wed s16 high']), common(curves['W2 Mon→exp s16 high'])), W2_M: pnlCorrelation(common(curves['W2 Mon→exp s16 high']), common(curves['M s25 45→21 high'])) };
console.log('\nDaily P&L correlation 2019-02→2023 (1 lot each):', JSON.stringify(corr));
const combos: Record<string, { parts: [string, number][] }> = {
  'W×2 + M×1': { parts: [['W Tue→Wed s16 high', 2], ['M s25 45→21 high', 1]] },
  'W×3': { parts: [['W Tue→Wed s16 high', 3]] },
  'W×2 + W2×1': { parts: [['W Tue→Wed s16 high', 2], ['W2 Mon→exp s16 high', 1]] },
  'W×1 + W2×1 + M×1': { parts: [['W Tue→Wed s16 high', 1], ['W2 Mon→exp s16 high', 1], ['M s25 45→21 high', 1]] },
};
const comboOut: Record<string, unknown> = {};
for (const [name, c] of Object.entries(combos)) {
  const days = allDays.filter((d) => d >= '2019-02-01');
  const parts = c.parts.map(([b, lots]) => equityFromTrades(days, 0, scaled(books[b].trades, lots)));
  const curve = combineCurves(parts, CAPITAL);
  const m = curveMetrics(curve), fit = curveMetrics(slice(curve, '2019-02-01', '2021-12-31')), test = curveMetrics(slice(curve, '2022-01-01', TO));
  const margin = Math.round(c.parts.reduce((a, [b, lots]) => a + books[b].marginPerLot * lots, 0) / CAPITAL * 100);
  const dailyPnl = curve.slice(1).map((p, i) => p.equity - curve[i].equity);
  const boot = blockBootstrap(dailyPnl, { draws: 2000, blockLen: 10, seed: 21, ddThresholds: [50_000, 100_000, 150_000, 200_000] });
  comboOut[name] = { marginUsePct: margin, all: brief(m), fit: brief(fit), test: brief(test), bootstrap: { maxDd: boot.maxDd, ddAtLeast: boot.ddAtLeast.map((x) => ({ pctOfCapital: x.threshold / CAPITAL * 100, share: x.share })), total: boot.total } };
  console.log(`\n${name} (margin ${margin}%): all CAGR ${m.cagrPct}% DD ${m.drawdown.maxDdPct}% Sharpe ${m.sharpe} Calmar ${m.calmar} worst month ${m.worstMonthPct}% | fit CAGR ${fit.cagrPct}% DD ${fit.drawdown.maxDdPct}% | test CAGR ${test.cagrPct}% DD ${test.drawdown.maxDdPct}% | bootstrap DD p95 ₹${boot.maxDd.p95} (P ≥10% ${boot.ddAtLeast[1].share}) | years ${m.annual.map((y) => `${y.year}:${y.returnPct}%`).join(' ')}`);
}

const best = table.filter((r) => (r.marginUsePct as number) <= 70 && (r.all as { maxDdPct: number }).maxDdPct <= 10).sort((a, b) => (b.all as { cagrPct: number }).cagrPct - (a.all as { cagrPct: number }).cagrPct)[0] as { book: string; lots: number; all: { cagrPct: number; maxDdPct: number } } | undefined;
await register({
  name: 'P11 sizing and combination of the surviving leads on ₹10 lakh', family: 'P11',
  hypothesis: 'Combining the weekly window lead with the monthly premium rule gives a better return per unit of drawdown than either alone.',
  script: 'scripts/research/quant/p11-portfolio.ts',
  params: { books: Object.fromEntries(Object.entries(books).map(([k, v]) => [k, { trades: v.trades.length, marginPerLot: v.marginPerLot, from: v.from }])), lots: [1, 2, 3, 4], combos: Object.keys(combos), capital: CAPITAL },
  period: { from: '2019-02-01', to: TO, role: 'train+validation' }, costs: COSTS.nifty,
  metrics: { table, correlation: corr, combos: comboOut, gapStressSource: a3b.id },
  validation: { holdoutTouched: false, note: 'W was chosen on 2019–21 in A3b; M is the hindsight benchmark; W2 is the Bank Nifty 8/8 window applied to NIFTY (not chosen on NIFTY data).' },
  caveats: ['Drawdowns are from daily closes; a weekly short strangle can lose several times its close-to-close mark inside a day or on a gap (see gap % of capital).', 'Margin today\'s SPAN; Bank Nifty weeklies no longer exist (SEBI, Nov 2024), so only the NIFTY books are tradable.', 'Money at today\'s size; ₹1 slippage.'],
  verdict: best && best.all.cagrPct >= 35 ? 'pass' : 'fail', notes: best ? `Highest CAGR with DD ≤ 10% (closes) and margin ≤ 70%: ${best.book} ×${best.lots}: CAGR ${best.all.cagrPct}%, DD ${best.all.maxDdPct}%.` : 'Nothing keeps DD ≤ 10% within the margin cap.',
});
saveDetail(a3b.id, 'p11-curves', Object.fromEntries(Object.entries(curves).map(([k, v]) => [k, v])));
await prisma.$disconnect();
