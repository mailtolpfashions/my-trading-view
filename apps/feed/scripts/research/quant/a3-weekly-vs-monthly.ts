// A3. Weekly versus monthly premium harvesting on NIFTY, Feb 2019 (first weekly expiries) → Dec 2023, one lot at
// today's size, daily closes. Weekly: a trade on every expiry (weekly and monthly) entered 7 or 4 calendar days before,
// held to expiry or closed with 1 or 2 days left. Monthly: the A1 family's 45→21 and 38→14 settings over the same
// window. Train 2019–2021, validation 2022–2023 (the holdout is locked; the Nov 2024 one-weekly rule falls in it).
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=4096 -- npx tsx scripts/research/quant/a3-weekly-vs-monthly.ts
import { prisma } from '@mtv/db';
import { runLab, tradeMetrics, equityFromTrades, curveMetrics, familySummary, guardHoldout, PERIODS, type LabStrategy, type LabLeg, type LabTrade } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { register, saveDetail, COSTS } from './registry';

const FROM = '2019-02-01', TO = guardHoldout(PERIODS.validation.to), SPLIT = '2021-12-31';
const CAPITAL = 1_000_000;
const data = await labData('NIFTY');
const days = data.days.map((d) => d.date).filter((d) => d >= FROM && d <= TO);
const sell = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const SHAPES: Record<string, LabLeg[]> = {
  s10: [sell('CE', 0.1), sell('PE', 0.1)], s16: [sell('CE', 0.16), sell('PE', 0.16)], s25: [sell('CE', 0.25), sell('PE', 0.25)],
  straddle: [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }],
};
type Setting = { id: string; cycle: 'weekly' | 'monthly'; shape: string; daysBefore: number; daysLeft?: number; iv: 'any' | 'high' };
const settings: Setting[] = [];
for (const shape of Object.keys(SHAPES)) for (const iv of ['any', 'high'] as const) {
  for (const daysBefore of [7, 4]) for (const daysLeft of [undefined, 1, 2]) if (!(daysBefore === 4 && daysLeft === 2)) settings.push({ id: `wk ${shape} ${daysBefore}→${daysLeft ?? 'exp'} ${iv}`, cycle: 'weekly', shape, daysBefore, daysLeft, iv });
  for (const [daysBefore, daysLeft] of [[45, 21], [38, 14], [30, 7]] as const) settings.push({ id: `mo ${shape} ${daysBefore}→${daysLeft} ${iv}`, cycle: 'monthly', shape, daysBefore, daysLeft, iv });
}
const rows: { s: Setting; trades: LabTrade[]; skipped: number }[] = [];
const t0 = Date.now();
for (const s of settings) {
  const strat: LabStrategy = { name: s.id, underlying: 'NIFTY', schedule: { every: 'expiry', cycle: s.cycle, daysBefore: s.daysBefore }, legs: SHAPES[s.shape], iv: s.iv, exit: s.daysLeft ? { daysLeft: s.daysLeft } : {}, missing: 'skip', slippage: 1, money: 'today', from: FROM, to: TO };
  const r = await runLab(strat, data);
  rows.push({ s, trades: r.trades, skipped: r.skipped.length });
}
console.log(`${rows.length} settings in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const sum = (ts: LabTrade[]) => Math.round(ts.reduce((a, t) => a + t.net, 0));
const tr = (ts: LabTrade[]) => ts.filter((t) => t.exit <= SPLIT), va = (ts: LabTrade[]) => ts.filter((t) => t.exit > SPLIT);
const yrs = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (365.25 * 86_400_000);
const perYear = (ts: LabTrade[], from: string, to: string) => Math.round(sum(ts) / yrs(from, to));
const line = (r: (typeof rows)[number]) => {
  const a = tradeMetrics(tr(r.trades)), b = tradeMetrics(va(r.trades));
  return { id: r.s.id, cycle: r.s.cycle, trades: r.trades.length, skipped: r.skipped, train: { perYear: perYear(tr(r.trades), FROM, SPLIT), trades: a.trades, winRatePct: a.winRatePct, worst: a.largestLoss, pf: a.profitFactor, worstMtm: Math.min(0, ...tr(r.trades).map((t) => t.worstMtm)) }, validation: { perYear: perYear(va(r.trades), SPLIT, TO), trades: b.trades, winRatePct: b.winRatePct, worst: b.largestLoss, pf: b.profitFactor, worstMtm: Math.min(0, ...va(r.trades).map((t) => t.worstMtm)) } };
};
const table = rows.map(line);
console.log('\nPer year ₹ at today\'s size, 1 lot (train 2019-02→2021 | validation 2022→2023):');
for (const r of [...table].sort((a, b) => b.train.perYear - a.train.perYear)) console.log(`  ${r.id.padEnd(26)} train ${String(r.train.perYear).padStart(8)} (${r.train.trades} tr, ${r.train.winRatePct}% won, worst MTM ${r.train.worstMtm}) | valid ${String(r.validation.perYear).padStart(8)} (${r.validation.trades} tr, ${r.validation.winRatePct}% won, worst MTM ${r.validation.worstMtm})`);

const fam = (cycle: 'weekly' | 'monthly') => ({ train: familySummary(table.filter((r) => r.cycle === cycle).map((r) => r.train.perYear)), validation: familySummary(table.filter((r) => r.cycle === cycle).map((r) => r.validation.perYear)) });
const family = { weekly: fam('weekly'), monthly: fam('monthly') };
console.log('\nFamily per-year ₹ (median across settings): weekly', JSON.stringify(family.weekly), '\n monthly', JSON.stringify(family.monthly));

// Best weekly and best monthly chosen on train, read on validation; curves at 1 lot on ₹10 lakh.
const pick = (cycle: 'weekly' | 'monthly') => [...table].filter((r) => r.cycle === cycle && r.train.trades >= 30).sort((a, b) => b.train.perYear / Math.max(10_000, -b.train.worstMtm) - a.train.perYear / Math.max(10_000, -a.train.worstMtm))[0];
const chosen = { weekly: pick('weekly'), monthly: pick('monthly') };
const curves: Record<string, { train: unknown; validation: unknown }> = {};
for (const [c, ch] of Object.entries(chosen)) {
  const r = rows.find((x) => x.s.id === ch.id)!;
  const curve = equityFromTrades(days, CAPITAL, r.trades);
  const m = (from: string, to: string) => { const cm = curveMetrics(curve.filter((p) => p.date >= from && p.date <= to)); return { cagrPct: cm.cagrPct, maxDdPct: cm.drawdown.maxDdPct, sharpe: cm.sharpe, calmar: cm.calmar, worstMonthPct: cm.worstMonthPct, ddDays: cm.drawdown.longestUnderwaterDays }; };
  curves[c] = { train: m(FROM, SPLIT), validation: m('2022-01-01', TO) };
  console.log(`\nChosen ${c} (on train, per-year ÷ worst MTM): ${ch.id}\n  train ${JSON.stringify(curves[c].train)}\n  valid ${JSON.stringify(curves[c].validation)}`);
}
const weeklyWins = family.weekly.validation.median > family.monthly.validation.median;
const id = await register({
  name: 'A3 weekly vs monthly NIFTY premium, 2019–2023', family: 'A3',
  hypothesis: 'Weekly expiries, traded every week, harvest more premium per year than monthly 45→21 at a comparable worst loss.',
  script: 'scripts/research/quant/a3-weekly-vs-monthly.ts',
  params: { shapes: Object.keys(SHAPES), weekly: { daysBefore: [7, 4], daysLeft: ['expiry', 1, 2] }, monthly: [[45, 21], [38, 14], [30, 7]], iv: ['any', 'high'], lots: 1, money: 'today', capital: CAPITAL, split: SPLIT },
  period: { from: FROM, to: TO, role: 'train+validation' }, costs: COSTS.nifty,
  metrics: { settings: table, family, chosen, curves },
  validation: { split: { train: `${FROM}→${SPLIT}`, validation: `2022-01-01→${TO}` }, holdoutTouched: false, note: 'Short window (5 years); the Nov 2024 regime change (one weekly per exchange) is in the holdout.' },
  caveats: ['Daily closes: a weekly trade is marked once a day; intraday blow-ups on expiry day are invisible.', 'Weekly strikes 7 days out often have thin trading before 2021; skipped entries counted.', 'Money at today\'s size.', '₹1 slippage assumed.'],
  verdict: weeklyWins ? 'lead' : 'info', notes: `Validation median per year: weekly ₹${family.weekly.validation.median}, monthly ₹${family.monthly.validation.median}.`,
});
saveDetail(id, 'settings', rows.map((r) => ({ s: r.s, skipped: r.skipped, trades: r.trades.map((t) => ({ entry: t.entry, exit: t.exit, expiry: t.expiry, net: t.net, worstMtm: t.worstMtm, reason: t.reason, daily: t.daily })) })));
await prisma.$disconnect();
