// A3b. The weekly entry-window effect found in A3 (Monday close → Wednesday close short strangles made money every year,
// Thursday-close entries lost), checked properly:
//   1. NIFTY weeklies 2019-02 → 2023-12: every entry weekday (Fri, Mon, Tue, Wed close) × exit (expiry, 1 or 2 days
//      left) × shape × IV, result per YEAR, so one year cannot carry it; slippage ₹1 and ₹2.
//   2. BANKNIFTY weeklies 2016-06 → 2023-12 as an independent sample (different index, three extra years before NIFTY
//      weeklies existed); slippage ₹2.
//   3. Walk-forward inside each family (fit 2 years, trade the next), plateau over the window, bootstrap of trade P&L.
//   4. Gap stress at entry (model) and how often the index actually gapped ≥2/3/5% overnight, by weekday, since 2011.
// Holdout (2024 on) locked. Daily closes only: a weekly position is marked once a day.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=3072 -- npx tsx scripts/research/quant/a3b-weekly-window.ts
import { prisma } from '@mtv/db';
import { runLab, tradeMetrics, equityFromTrades, curveMetrics, familySummary, walkForward, blockBootstrap, plateau, guardHoldout, PERIODS, type LabStrategy, type LabLeg, type LabTrade, type Candidate } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { register, saveDetail, COSTS } from './registry';
import { gapStress, marginPerLot, overnightGaps } from './lib';

const TO = guardHoldout(PERIODS.validation.to);
const CAPITAL = 1_000_000;
const sell = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const SHAPES: Record<string, LabLeg[]> = {
  s10: [sell('CE', 0.1), sell('PE', 0.1)], s16: [sell('CE', 0.16), sell('PE', 0.16)], s25: [sell('CE', 0.25), sell('PE', 0.25)],
  straddle: [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }],
};
// Entry = first trading day on/after expiry − daysBefore. For a Thursday expiry: 6 → Fri, 4 → Mon, 3 → Tue, 2 → Wed.
const WINDOWS: { daysBefore: number; daysLeft?: number; label: string }[] = [
  { daysBefore: 6, label: 'Fri→exp' }, { daysBefore: 6, daysLeft: 1, label: 'Fri→Wed' }, { daysBefore: 6, daysLeft: 2, label: 'Fri→Tue' },
  { daysBefore: 4, label: 'Mon→exp' }, { daysBefore: 4, daysLeft: 1, label: 'Mon→Wed' }, { daysBefore: 4, daysLeft: 2, label: 'Mon→Tue' },
  { daysBefore: 3, label: 'Tue→exp' }, { daysBefore: 3, daysLeft: 1, label: 'Tue→Wed' }, { daysBefore: 2, label: 'Wed→exp' },
];
type P = { window: string; shape: string; iv: 'any' | 'high' };
type Row = { p: P; trades: LabTrade[]; skipped: number; slip2: number };
const sum = (ts: LabTrade[]) => Math.round(ts.reduce((a, t) => a + t.net, 0));
const yrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);

async function family(u: 'NIFTY' | 'BANKNIFTY', from: string, slippage: number) {
  const data = await labData(u);
  const days = data.days.map((d) => d.date).filter((d) => d >= from && d <= TO);
  const rows: Row[] = [];
  const t0 = Date.now();
  for (const w of WINDOWS) for (const shape of Object.keys(SHAPES)) for (const iv of ['any', 'high'] as const) {
    const s: LabStrategy = { name: `${w.label} ${shape} ${iv}`, underlying: u, schedule: { every: 'expiry', cycle: 'weekly', daysBefore: w.daysBefore }, legs: SHAPES[shape], iv, exit: w.daysLeft ? { daysLeft: w.daysLeft } : {}, missing: 'skip', slippage, money: 'today', from, to: TO };
    const r = await runLab(s, data);
    const r2 = await runLab({ ...s, slippage: slippage + 1 }, data);
    rows.push({ p: { window: w.label, shape, iv }, trades: r.trades, skipped: r.skipped.length, slip2: sum(r2.trades) });
  }
  console.log(`\n=== ${u} weekly ${from} → ${TO}: ${rows.length} settings in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const years = [...new Set(days.map((d) => d.slice(0, 4)))];
  const byYear = (ts: LabTrade[]) => Object.fromEntries(years.map((y) => [y, sum(ts.filter((t) => t.exit.startsWith(y)))]));
  const table = rows.map((r) => {
    const tm = tradeMetrics(r.trades), by = byYear(r.trades);
    return { id: `${r.p.window} ${r.p.shape} ${r.p.iv}`, p: r.p, trades: tm.trades, winRatePct: tm.winRatePct, perYear: Math.round(tm.total / yrs(from, TO)), perYearSlipPlus1: Math.round(r.slip2 / yrs(from, TO)), pf: tm.profitFactor, worst: tm.largestLoss, worstMtm: Math.min(0, ...r.trades.map((t) => t.worstMtm)), maxConsecLoss: tm.maxConsecutiveLosses, byYear: by, positiveYears: Object.values(by).filter((v) => v > 0).length, skipped: r.skipped };
  });
  console.log('window, shape, iv | per year ₹ (slip+₹1) | trades, won% | worst MTM | years positive | by year');
  for (const r of [...table].sort((a, b) => b.perYear - a.perYear)) console.log(`  ${r.id.padEnd(24)} ${String(r.perYear).padStart(8)} (${String(r.perYearSlipPlus1).padStart(7)}) | ${String(r.trades).padStart(3)} tr ${r.winRatePct}% | ${String(r.worstMtm).padStart(8)} | ${r.positiveYears}/${years.length} | ${Object.entries(r.byYear).map(([y, v]) => `${y.slice(2)}:${Math.round(v / 1000)}k`).join(' ')}`);
  // per-window family: median per-year across shapes and IV, and share positive
  const byWindow = WINDOWS.map((w) => ({ window: w.label, ...familySummary(table.filter((r) => r.p.window === w.label).map((r) => r.perYear)) }));
  console.log('\nPer window (median per-year across 8 shape×IV settings):', byWindow.map((w) => `${w.window}: ${w.median} (${w.profitable}/${w.tried} positive)`).join(' | '));
  // walk-forward: fit 2 years → next
  const cands: Candidate<P>[] = rows.map((r) => ({ id: `${r.p.window} ${r.p.shape} ${r.p.iv}`, params: r.p, byYear: new Map(years.map((y) => { const ts = r.trades.filter((t) => t.exit.startsWith(y)); return [y, { net: sum(ts), worst: Math.min(0, ...ts.map((t) => t.worstMtm)), trades: ts.length }]; })) }));
  const wf = { total: walkForward(cands, years, 2, (rs) => rs.reduce((a, r) => a + r.net, 0)), risk: walkForward(cands, years, 2, (rs) => rs.reduce((a, r) => a + r.net, 0) / Math.max(10_000, -Math.min(...rs.map((r) => r.worst)))) };
  for (const [k, v] of Object.entries(wf)) console.log(`walk-forward (${k}): total ₹${v.total}, worst MTM ${v.worst}, changes ${v.changes}: ${v.picks.map((p) => `${p.year}:${p.chosen}=${p.net}`).join(' | ')}`);
  // chosen on the first 60% of years (per-year ÷ worst MTM), read on the rest; plateau over windows
  const fitYears = years.slice(0, Math.ceil(years.length * 0.6)), testYears = years.slice(fitYears.length);
  const score = (r: (typeof table)[number]) => { const fit = fitYears.reduce((a, y) => a + r.byYear[y], 0); return fit / Math.max(10_000, -Math.min(0, ...rows.find((x) => `${x.p.window} ${x.p.shape} ${x.p.iv}` === r.id)!.trades.filter((t) => fitYears.includes(t.exit.slice(0, 4))).map((t) => t.worstMtm))); };
  const chosen = [...table].filter((r) => r.trades >= 40).sort((a, b) => score(b) - score(a))[0];
  const chosenRow = rows.find((x) => `${x.p.window} ${x.p.shape} ${x.p.iv}` === chosen.id)!;
  const windowOrder = WINDOWS.map((w) => w.label);
  const plat = plateau(chosen.p, table.map((r) => ({ params: r.p, value: r.perYear })), { window: windowOrder, shape: Object.keys(SHAPES), iv: ['any', 'high'] });
  const curve = equityFromTrades(days, CAPITAL, chosenRow.trades);
  const m = (from: string, to: string) => { const c = curveMetrics(curve.filter((p) => p.date >= from && p.date <= to)); return { cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, sharpe: c.sharpe, calmar: c.calmar, worstMonthPct: c.worstMonthPct, ddDays: c.drawdown.longestUnderwaterDays }; };
  const curves = { fit: m(`${fitYears[0]}-01-01`, `${fitYears.at(-1)}-12-31`), test: m(`${testYears[0]}-01-01`, TO), all: m(from, TO) };
  const today = { spot: 0, lot: 0 };
  const base = await runLab({ name: 'x', underlying: u, schedule: { every: 'expiry', cycle: 'weekly', daysBefore: 4 }, legs: SHAPES.s16, iv: 'any', exit: { daysLeft: 1 }, missing: 'skip', slippage, money: 'today', from: TO, to: TO }, data);
  today.spot = base.today.spot; today.lot = base.today.lot;
  const stress = gapStress(chosenRow.trades, today);
  const margin = await marginPerLot({ name: 'm', underlying: u, schedule: { every: 'expiry', cycle: 'weekly', daysBefore: 4 }, legs: SHAPES[chosen.p.shape], iv: 'any', exit: {}, missing: 'skip', slippage, money: 'today' }, data, u);
  const boot = blockBootstrap(chosenRow.trades.map((t) => t.net), { draws: 2000, blockLen: 4, seed: 9, ddThresholds: [25_000, 50_000, 100_000] });
  console.log(`\nChosen on ${fitYears[0]}–${fitYears.at(-1)} (per-year ÷ worst MTM, ≥40 trades): ${chosen.id}; test ${testYears.join(',')}: ₹${testYears.reduce((a, y) => a + chosen.byYear[y], 0)}`);
  console.log('  curve 1 lot on ₹10 lakh: fit', JSON.stringify(curves.fit), 'test', JSON.stringify(curves.test));
  console.log('  plateau (per-year kept by neighbours):', plat.neighbours.map((x) => `${String(x.key)}=${x.value}:${x.kept}`).join(' '), ' min', plat.minKept);
  console.log(`  margin/lot today ₹${margin}; gap stress per lot (worst/median ₹):`, stress.shocks.map((s) => `${s.gapPct}%: ${s.worst}/${s.median}`).join('  '));
  console.log('  bootstrap trade P&L: total p5/p50', boot.total.p5, boot.total.p50, '; max DD p50/p95/p99', boot.maxDd.p50, boot.maxDd.p95, boot.maxDd.p99);
  return { u, from, years, table, byWindow, wf: Object.fromEntries(Object.entries(wf).map(([k, v]) => [k, { total: v.total, worst: v.worst, changes: v.changes, picks: v.picks.map((p) => ({ year: p.year, chosen: p.chosen, net: p.net })) }])), chosen: { id: chosen.id, fitYears, testYears, test: testYears.reduce((a, y) => a + chosen.byYear[y], 0), row: chosen, curves, plateau: plat, marginPerLot: margin, gapStress: stress, bootstrap: boot }, rows };
}

const nifty = await family('NIFTY', '2019-02-01', 1);
const bank = await family('BANKNIFTY', '2016-06-01', 2);
const gaps = { nifty: await overnightGaps('NIFTY 50', '2011-01-01', TO), bank: await overnightGaps('NIFTY BANK', '2011-01-01', TO) };
console.log('\nOvernight gaps 2011–2023 (open vs previous close), NIFTY:', JSON.stringify(gaps.nifty.counts), 'worst', JSON.stringify(gaps.nifty.worst), '\n  Bank Nifty:', JSON.stringify(gaps.bank.counts), 'worst', JSON.stringify(gaps.bank.worst));

// Does the Monday→Wednesday window hold on both indices and in most years?
const monWed = (f: Awaited<ReturnType<typeof family>>) => f.table.filter((r) => r.p.window === 'Mon→Wed');
const nMW = monWed(nifty), bMW = monWed(bank);
const summary = { nifty: { settings: nMW.length, positive: nMW.filter((r) => r.perYear > 0).length, medianPerYear: familySummary(nMW.map((r) => r.perYear)).median, yearsPositiveMedian: familySummary(nMW.map((r) => r.positiveYears)).median, of: nifty.years.length }, bank: { settings: bMW.length, positive: bMW.filter((r) => r.perYear > 0).length, medianPerYear: familySummary(bMW.map((r) => r.perYear)).median, yearsPositiveMedian: familySummary(bMW.map((r) => r.positiveYears)).median, of: bank.years.length } };
console.log('\nMon→Wed window summary:', JSON.stringify(summary));
const lead = summary.nifty.positive >= 6 && summary.bank.positive >= 6 && nifty.chosen.test > 0 && bank.chosen.test > 0;
const id = await register({
  name: 'A3b weekly entry window: NIFTY 2019–23 and BANKNIFTY 2016–23, by year, walk-forward, stress', family: 'A3',
  hypothesis: 'Short weekly strangles entered at Monday\'s close and closed Wednesday earn premium in most years on both indices; Thursday/Friday entries do not.',
  script: 'scripts/research/quant/a3b-weekly-window.ts',
  params: { windows: WINDOWS.map((w) => w.label), shapes: Object.keys(SHAPES), iv: ['any', 'high'], slippage: { NIFTY: 1, BANKNIFTY: 2 }, lots: 1, money: 'today', capital: CAPITAL, walkForwardFit: 2 },
  period: { from: '2016-06-01', to: TO, role: 'train+validation' }, costs: { ...COSTS.nifty, notes: 'BANKNIFTY ₹2 per option; +₹1 shown for every setting' },
  metrics: { nifty: { ...nifty, rows: undefined }, bank: { ...bank, rows: undefined }, gaps, monWed: summary },
  validation: { holdoutTouched: false, independentSample: 'BANKNIFTY 2016–2018 predates NIFTY weeklies', selection: 'chosen on the first 60% of years, read on the rest; walk-forward 2-year fit; plateau across adjacent windows', note: 'NIFTY has only 5 years of weeklies before the holdout.' },
  caveats: ['Daily closes: the worst loss inside a day is not seen; a 2-day weekly position can lose far more than its close-to-close marks.', 'Gap stress is a model; the gap counts are real.', 'Thin trading on far strikes early in each series: skipped entries are counted per setting.', 'Money at today\'s size; margin is today\'s SPAN.'],
  verdict: lead ? 'lead' : 'info', notes: `Mon→Wed: NIFTY ${summary.nifty.positive}/${summary.nifty.settings} settings positive (median ₹${summary.nifty.medianPerYear}/yr), Bank Nifty ${summary.bank.positive}/${summary.bank.settings} (median ₹${summary.bank.medianPerYear}/yr). Chosen NIFTY ${nifty.chosen.id} test ₹${nifty.chosen.test}; Bank ${bank.chosen.id} test ₹${bank.chosen.test}.`,
});
saveDetail(id, 'nifty-settings', nifty.rows.map((r) => ({ p: r.p, skipped: r.skipped, trades: r.trades.map((t) => ({ entry: t.entry, exit: t.exit, expiry: t.expiry, net: t.net, worstMtm: t.worstMtm, reason: t.reason, spotIn: t.spotIn, daily: t.daily })) })));
saveDetail(id, 'bank-settings', bank.rows.map((r) => ({ p: r.p, skipped: r.skipped, trades: r.trades.map((t) => ({ entry: t.entry, exit: t.exit, expiry: t.expiry, net: t.net, worstMtm: t.worstMtm, reason: t.reason, spotIn: t.spotIn, daily: t.daily })) })));
await prisma.$disconnect();
