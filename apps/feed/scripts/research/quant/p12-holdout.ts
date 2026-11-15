// Phase 12. The holdout, 2024-01-01 → the last F&O day, read ONCE, with the books fixed before this run:
//   W   NIFTY weekly short strangle 0.16 delta, high-IV weeks, entered at MONDAY's close (lab 'week' schedule, weekday 1),
//       closed at the close 1 day before expiry  (Thursday expiry: Mon→Wed; Tuesday expiry: cannot exist → skipped)
//   Wx  the same, held to expiry                 (Thursday expiry: Mon→Thu, 3 nights; Tuesday expiry: Mon→Tue, 1 night)
//   Wl  the development rule exactly as the lab wrote it: calendar 4 days before expiry, exit 1 day left
//       (Thursday expiry: Mon→Wed; Tuesday expiry: Fri→Mon, the weekend-only hold that lost in development)
//   M   NIFTY monthly 0.25 delta strangle 45→21 days, high IV (the hindsight benchmark)
//   Controls: Fri→Tue weekly (weekday 5, 2 days left) and Thu→expiry (weekday 4), expected to lose; monthly straddle
//   60→7 high (the walk-forward's bad pick), monthly s25 45→21 any, s16 45→21 high, W with any IV.
// NSE moved NIFTY weekly expiry from Thursday to Tuesday in 2025, so every weekly result is also split by expiry weekday.
// Costs as in development: ₹1 per option per fill, itemised dated charges. Money at today's size, 1 lot; books at the
// lot counts chosen in P11 (W×3, W×2+M×1) on ₹10 lakh.
// Run ONCE (apps/feed): HOLDOUT_UNLOCK=1 npx dotenv -e ../../.env -- npx tsx scripts/research/quant/p12-holdout.ts
import { prisma } from '@mtv/db';
import { runLab, tradeMetrics, equityFromTrades, curveMetrics, combineCurves, guardHoldout, PERIODS, type LabStrategy, type LabLeg, type LabTrade, type CurvePoint } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { register, saveDetail, COSTS } from './registry';
import { gapStress } from './lib';

const FROM = PERIODS.holdout.from;
const data = await labData('NIFTY');
const LAST = data.days.at(-1)!.date;
const TO = guardHoldout(LAST);
const CAPITAL = 1_000_000;
const days = data.days.map((d) => d.date).filter((d) => d >= FROM && d <= TO);
const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (d: string) => wd[new Date(`${d}T00:00:00Z`).getUTCDay()];

// expiry weekday by month in the holdout (weekly expiries = all expiries minus monthly)
const monthlySet = new Set(data.monthly);
const weekly = data.expiries.filter((e) => e >= FROM && e <= TO);
const byMonth = new Map<string, Record<string, number>>();
for (const e of weekly) { const m = e.slice(0, 7), r = byMonth.get(m) ?? {}; r[weekdayOf(e)] = (r[weekdayOf(e)] ?? 0) + 1; byMonth.set(m, r); }
console.log('NIFTY expiry weekdays by month in the holdout:');
for (const [m, r] of byMonth) console.log(`  ${m} ${Object.entries(r).map(([k, v]) => `${k}×${v}`).join(' ')}`);
const firstTuesdayMonth = [...byMonth].find(([, r]) => (r.Tue ?? 0) >= 3)?.[0] ?? null;
console.log('first month with ≥3 Tuesday expiries:', firstTuesdayMonth);

const sell = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const strangle = (d: number) => [sell('CE', d), sell('PE', d)];
const straddle: LabLeg[] = [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }];
const base = { underlying: 'NIFTY' as const, missing: 'skip' as const, slippage: 1, money: 'today' as const, from: FROM, to: TO };
const books: Record<string, { s: LabStrategy; role: 'book' | 'control' }> = {
  'W Mon→1 day left s16 high': { s: { ...base, name: 'W', schedule: { every: 'week', weekday: 1, expiry: 'weekly' }, legs: strangle(0.16), iv: 'high', exit: { daysLeft: 1 } }, role: 'book' },
  'Wx Mon→expiry s16 high': { s: { ...base, name: 'Wx', schedule: { every: 'week', weekday: 1, expiry: 'weekly' }, legs: strangle(0.16), iv: 'high', exit: {} }, role: 'book' },
  'Wl literal 4→1 s16 high': { s: { ...base, name: 'Wl', schedule: { every: 'expiry', cycle: 'weekly', daysBefore: 4 }, legs: strangle(0.16), iv: 'high', exit: { daysLeft: 1 } }, role: 'book' },
  'M s25 45→21 high': { s: { ...base, name: 'M', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: strangle(0.25), iv: 'high', exit: { daysLeft: 21 } }, role: 'book' },
  'W Mon→1 day left s16 any': { s: { ...base, name: 'Wany', schedule: { every: 'week', weekday: 1, expiry: 'weekly' }, legs: strangle(0.16), iv: 'any', exit: { daysLeft: 1 } }, role: 'control' },
  'Wx Mon→expiry s16 any': { s: { ...base, name: 'Wxany', schedule: { every: 'week', weekday: 1, expiry: 'weekly' }, legs: strangle(0.16), iv: 'any', exit: {} }, role: 'control' },
  'Wx Mon→expiry s25 high': { s: { ...base, name: 'Wx25', schedule: { every: 'week', weekday: 1, expiry: 'weekly' }, legs: strangle(0.25), iv: 'high', exit: {} }, role: 'control' },
  'C Fri→2 days left s16 any': { s: { ...base, name: 'CFri', schedule: { every: 'week', weekday: 5, expiry: 'weekly' }, legs: strangle(0.16), iv: 'any', exit: { daysLeft: 2 } }, role: 'control' },
  'C Thu→expiry s16 any': { s: { ...base, name: 'CThu', schedule: { every: 'week', weekday: 4, expiry: 'weekly' }, legs: strangle(0.16), iv: 'any', exit: {} }, role: 'control' },
  'C M straddle 60→7 high': { s: { ...base, name: 'CM1', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 60 }, legs: straddle, iv: 'high', exit: { daysLeft: 7 } }, role: 'control' },
  'C M s25 45→21 any': { s: { ...base, name: 'CM2', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: strangle(0.25), iv: 'any', exit: { daysLeft: 21 } }, role: 'control' },
  'C M s16 45→21 high': { s: { ...base, name: 'CM3', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: strangle(0.16), iv: 'high', exit: { daysLeft: 21 } }, role: 'control' },
};

const sum = (ts: LabTrade[]) => Math.round(ts.reduce((a, t) => a + t.net, 0));
const yrs = (a: string, b: string) => Math.max((Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000), 1 / 12);
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, sharpe: c.sharpe, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstDayPct: c.worstDayPct, annual: c.annual.map((y) => `${y.year}:${y.returnPct}%`).join(' ') });
const results: Record<string, unknown> = {};
const curves: Record<string, CurvePoint[]> = {};
const tradeLists: Record<string, LabTrade[]> = {};
for (const [name, b] of Object.entries(books)) {
  const r = await runLab(b.s, data);
  tradeLists[name] = r.trades;
  const tm = tradeMetrics(r.trades);
  const byYear = Object.fromEntries(['2024', '2025', '2026'].map((y) => { const ts = r.trades.filter((t) => t.exit.startsWith(y)); return [y, { net: sum(ts), trades: ts.length, won: ts.filter((t) => t.net > 0).length }]; }));
  const byExpiryDay = Object.fromEntries(['Thu', 'Tue', 'other'].map((k) => { const ts = r.trades.filter((t) => (k === 'other' ? !['Thu', 'Tue'].includes(weekdayOf(t.expiry)) : weekdayOf(t.expiry) === k)); return [k, { net: sum(ts), trades: ts.length, won: ts.filter((t) => t.net > 0).length, worstMtm: Math.min(0, ...ts.map((t) => t.worstMtm)) }]; }));
  const byEntryDay = Object.fromEntries(wd.map((k) => { const ts = r.trades.filter((t) => weekdayOf(t.entry) === k); return [k, ts.length ? { net: sum(ts), trades: ts.length } : undefined]; }).filter(([, v]) => v));
  const curve = equityFromTrades(days, CAPITAL, r.trades);
  curves[name] = curve;
  const cm = curveMetrics(curve);
  const stress = gapStress(r.trades, r.today);
  results[name] = { role: b.role, trades: tm.trades, winRatePct: tm.winRatePct, total: tm.total, perYear: Math.round(tm.total / yrs(FROM, TO)), pf: tm.profitFactor, worstTrade: tm.largestLoss, worstMtm: Math.min(0, ...r.trades.map((t) => t.worstMtm)), maxConsecLoss: tm.maxConsecutiveLosses, skipped: r.skipped.length, skippedReasons: Object.entries(r.skipped.reduce<Record<string, number>>((a, s) => ((a[s.reason] = (a[s.reason] ?? 0) + 1), a), {})), byYear, byExpiryDay, byEntryDay, curve1lot: brief(cm), gapStress: stress.shocks.filter((s) => [-5, -8, 5].includes(s.gapPct)) };
  console.log(`\n${b.role === 'book' ? 'BOOK   ' : 'control'} ${name}: ${tm.trades} trades, ${tm.winRatePct}% won, total ₹${tm.total} (₹${Math.round(tm.total / yrs(FROM, TO))}/yr), pf ${tm.profitFactor}, worst trade ₹${tm.largestLoss}, worst MTM ₹${Math.min(0, ...r.trades.map((t) => t.worstMtm))}, skipped ${r.skipped.length}`);
  console.log(`         by year ${Object.entries(byYear).map(([y, v]) => `${y}: ₹${v.net} (${v.won}/${v.trades})`).join(' | ')}`);
  console.log(`         by expiry weekday ${Object.entries(byExpiryDay).map(([k, v]) => `${k}: ₹${v.net} (${v.won}/${v.trades}, worst MTM ${v.worstMtm})`).join(' | ')}; entry weekdays ${JSON.stringify(byEntryDay)}`);
  console.log(`         1 lot on ₹10 lakh: CAGR ${cm.cagrPct}% DD ${cm.drawdown.maxDdPct}% Sharpe ${cm.sharpe} worst month ${cm.worstMonthPct}% worst day ${cm.worstDayPct}% | ${cm.annual.map((y) => `${y.year}:${y.returnPct}%`).join(' ')}`);
  if (r.skipped.length) console.log(`         skipped: ${Object.entries(r.skipped.reduce<Record<string, number>>((a, s) => ((a[s.reason] = (a[s.reason] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
}

// sized books from P11
const scaled = (ts: LabTrade[], lots: number) => ts.map((t) => ({ ...t, net: t.net * lots, daily: t.daily.map((p) => ({ date: p.date, mtm: p.mtm * lots })) }));
const sized: Record<string, unknown> = {};
for (const [name, parts] of Object.entries({ 'W×3': [['W Mon→1 day left s16 high', 3]], 'Wx×3': [['Wx Mon→expiry s16 high', 3]], 'W×2 + M×1': [['W Mon→1 day left s16 high', 2], ['M s25 45→21 high', 1]], 'Wx×2 + M×1': [['Wx Mon→expiry s16 high', 2], ['M s25 45→21 high', 1]], 'M×1': [['M s25 45→21 high', 1]] } as Record<string, [string, number][]>)) {
  const curve = combineCurves(parts.map(([b, lots]) => equityFromTrades(days, 0, scaled(tradeLists[b], lots))), CAPITAL);
  const cm = curveMetrics(curve);
  sized[name] = brief(cm);
  console.log(`\n${name}: holdout CAGR ${cm.cagrPct}% DD ${cm.drawdown.maxDdPct}% Sharpe ${cm.sharpe} Calmar ${cm.calmar} worst month ${cm.worstMonthPct}% worst day ${cm.worstDayPct}% | ${cm.annual.map((y) => `${y.year}:${y.returnPct}%`).join(' ')}`);
}

const W = results['W Mon→1 day left s16 high'] as { total: number; byExpiryDay: Record<string, { net: number; trades: number }> }, Wx = results['Wx Mon→expiry s16 high'] as { total: number; byExpiryDay: Record<string, { net: number; trades: number }> }, M = results['M s25 45→21 high'] as { total: number };
const verdict = (sized['W×3'] as { cagrPct: number; maxDdPct: number }).cagrPct >= 35 && (sized['W×3'] as { maxDdPct: number }).maxDdPct <= 10 ? 'pass' : (W.total > 0 || Wx.total > 0) ? 'lead' : 'fail';
await register({
  name: 'P12 holdout 2024-01 → last day: weekly Monday books, monthly benchmark, controls (read once)', family: 'P12',
  hypothesis: 'The Monday-close weekly premium window and the monthly benchmark hold up on years never used for any choice.',
  script: 'scripts/research/quant/p12-holdout.ts',
  params: { books: Object.fromEntries(Object.entries(books).map(([k, v]) => [k, { role: v.role, schedule: v.s.schedule, legs: v.s.legs.map((l) => `${l.side} ${l.kind} ${JSON.stringify(l.strike)}`), iv: v.s.iv, exit: v.s.exit }])), sized: ['W×3', 'Wx×3', 'W×2 + M×1', 'Wx×2 + M×1', 'M×1'], capital: CAPITAL, firstTuesdayExpiryMonth: firstTuesdayMonth },
  period: { from: FROM, to: TO, role: 'holdout' }, costs: COSTS.nifty,
  metrics: { expiryWeekdaysByMonth: Object.fromEntries(byMonth), results, sized },
  validation: { holdoutTouched: true, readOnce: true, fixedBefore: 'books and controls fixed in docs/quant/02-results-phase5-11.md and this script before HOLDOUT_UNLOCK was set', labelCorrection: 'A3b labels: daysBefore 3 was a Monday entry for Thursday expiries (same as daysBefore 4); the lead is the Monday-close entry' },
  caveats: ['Daily closes only.', 'NIFTY weekly expiry moved to Tuesday in 2025: the Mon→1-day-left book cannot trade a Tuesday expiry (entry day = exit day), so its Tuesday-era rows are skips; Wx (Monday → expiry) is the 1-night version there.', 'Money at today\'s size; ₹1 slippage assumed; gap stress is a model.'],
  verdict, notes: `W (Mon→1 day left, high IV) ₹${W.total}; Wx (Mon→expiry) ₹${Wx.total} (Thu-era ₹${Wx.byExpiryDay.Thu?.net ?? 0}, Tue-era ₹${Wx.byExpiryDay.Tue?.net ?? 0}); M ₹${M.total}. W×3 holdout CAGR ${(sized['W×3'] as { cagrPct: number }).cagrPct}% DD ${(sized['W×3'] as { maxDdPct: number }).maxDdPct}%.`,
});
saveDetail('E-holdout', 'trades', Object.fromEntries(Object.entries(tradeLists).map(([k, v]) => [k, v.map((t) => ({ entry: t.entry, exit: t.exit, expiry: t.expiry, net: t.net, worstMtm: t.worstMtm, reason: t.reason, spotIn: t.spotIn, spotOut: t.spotOut, legs: t.legs.map((l) => `${l.side} ${l.strike} ${l.kind} ${l.entry}→${l.exit}`), daily: t.daily }))])));
await prisma.$disconnect();
