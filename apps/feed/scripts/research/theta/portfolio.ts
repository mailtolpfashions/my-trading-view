// Portfolio of the rules that worked (2026-11-24, user: "combine the best ones into one portfolio and test it").
// Books, 1 NIFTY lot each, money at today's index level and lot (lab money: 'today'), ₹1 slippage, Zerodha charges:
//   W  weekly 0.16Δ strangle, Monday close → expiry, high IV only (the quant lead; Thu expiry → Mon is 3 days before,
//      Tue expiry → 1 day before)
//   S  45 DTE ATM straddle, book 50% / stop 1× credit / out at 21 days left, India VIX above its 25th percentile
//   P  monthly 0.30Δ put, 45 → 21 days, every month
//   F  weekend: Friday close → Tuesday expiry, 0.30Δ strangle + 0.05Δ wings (Tue era only, from theta/weekend.json)
// Every mix of the books is run on ₹5 lakh. Capital check per day: margin of the open books (today's SPAN per lot,
// an estimate) + the fall from the equity peak must stay under ₹5 lakh.
// Periods: 2016-01 → now (F has no trades before Sep 2025), and Sep 2025 → now (all four live together).
// Not a fresh test: each book was already chosen on this data; the mix is the only new thing.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=4096 -- npx tsx scripts/research/theta/portfolio.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { prisma } from '@mtv/db';
import { runLab, equityFromTrades, combineCurves, curveMetrics, pnlCorrelation, type LabStrategy, type LabLeg, type CurvePoint } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { marginPerLot } from '../quant/lib';

const CAP = 500_000, FROM = '2016-01-01', RECENT = '2025-09-01';
const data = await labData('NIFTY');
const last = data.days.at(-1)!.date;
const sell = (kind: 'CE' | 'PE', strike: LabLeg['strike']): LabLeg => ({ side: 'SELL', kind, lots: 1, strike, expiry: 0 });
const buy = (kind: 'CE' | 'PE', strike: LabLeg['strike']): LabLeg => ({ side: 'BUY', kind, lots: 1, strike, expiry: 0 });
const base = { underlying: 'NIFTY' as const, missing: 'skip' as const, slippage: 1, money: 'today' as const };

type T = { entry: string; exit: string; net: number; worstMtm: number; daily: { date: string; mtm: number }[] };
const strangle16 = [sell('CE', { by: 'delta', delta: 0.16 }), sell('PE', { by: 'delta', delta: 0.16 })];
const wThu: LabStrategy = { ...base, name: 'W thu', schedule: { every: 'expiry', cycle: 'weekly', daysBefore: 3 }, legs: strangle16, iv: 'high', exit: {}, from: '2019-02-01', to: '2025-08-31' };
const wTue: LabStrategy = { ...base, name: 'W tue', schedule: { every: 'expiry', cycle: 'weekly', daysBefore: 1 }, legs: strangle16, iv: 'high', exit: {}, from: RECENT, to: last };
const S: LabStrategy = { ...base, name: 'S', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: [sell('CE', { by: 'atm' }), sell('PE', { by: 'atm' })], iv: 'any', vixAbove: 25, exit: { daysLeft: 21, bookPct: 50, stopCredit: 1 }, from: FROM, to: last };
const P: LabStrategy = { ...base, name: 'P', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: [sell('PE', { by: 'delta', delta: 0.3 })], iv: 'any', exit: { daysLeft: 21 }, from: FROM, to: last };
const fLegs = [sell('CE', { by: 'delta', delta: 0.3 }), sell('PE', { by: 'delta', delta: 0.3 }), buy('CE', { by: 'delta', delta: 0.05 }), buy('PE', { by: 'delta', delta: 0.05 })];

const keep = (ts: { entry: string; exit: string; net: number; worstMtm: number; daily: { date: string; mtm: number }[] }[]): T[] => ts.map((t) => ({ entry: t.entry, exit: t.exit, net: t.net, worstMtm: t.worstMtm, daily: t.daily }));
const rThu = await runLab(wThu, data), rTue = await runLab(wTue, data), rS = await runLab(S, data), rP = await runLab(P, data);
// weekend book from the weekend study (exit at expiry; marked at Monday close)
const wk = JSON.parse(readFileSync('.data/research/theta/weekend.json', 'utf8')).trades as { u: string; era: string; shape: string; fri: string; mon: string; expiry: string; pnl: Record<string, number | undefined> }[];
const F: T[] = wk.filter((t) => t.u === 'NIFTY' && t.era === 'Tue' && t.shape === 's30+w' && t.pnl.expiry != null)
  .map((t) => ({ entry: t.fri, exit: t.expiry, net: t.pnl.expiry!, worstMtm: Math.min(0, t.pnl.monClose ?? 0, t.pnl.expiry!), daily: [...(t.pnl.monClose != null && t.mon < t.expiry ? [{ date: t.mon, mtm: t.pnl.monClose }] : []), { date: t.expiry, mtm: t.pnl.expiry! }] }));

const books: Record<string, { trades: T[]; margin: number | null }> = {
  W: { trades: keep([...rThu.trades, ...rTue.trades]), margin: await marginPerLot({ ...wTue, from: undefined, to: undefined }, data) },
  S: { trades: keep(rS.trades), margin: await marginPerLot({ ...S, vixAbove: undefined, from: undefined, to: undefined }, data) },
  P: { trades: keep(rP.trades), margin: await marginPerLot({ ...P, from: undefined, to: undefined }, data) },
  F: { trades: F, margin: await marginPerLot({ ...base, name: 'F', schedule: { every: 'expiry', cycle: 'weekly', daysBefore: 4 }, legs: fLegs, iv: 'any', exit: {} }, data) },
};
console.log('Margin per lot today (₹, SPAN + exposure, estimate):', Object.fromEntries(Object.entries(books).map(([k, b]) => [k, b.margin])));
for (const [k, b] of Object.entries(books)) {
  const ts = b.trades, won = ts.filter((t) => t.net > 0).length;
  console.log(`${k}: ${ts.length} trades ${ts[0]?.entry} → ${ts.at(-1)?.exit}, won ${Math.round((100 * won) / ts.length)}%, total ₹${Math.round(ts.reduce((a, t) => a + t.net, 0))}, worst trade ₹${Math.round(Math.min(...ts.map((t) => t.net)))}, worst open ₹${Math.round(Math.min(...ts.map((t) => t.worstMtm)))}`);
}

const allDays = data.days.map((d) => d.date);
function study(names: string[], from: string) {
  const days = allDays.filter((d) => d >= from);
  const parts = names.map((n) => equityFromTrades(days, 0, books[n].trades.filter((t) => t.entry >= from)));
  const curve = combineCurves(parts, CAP);
  const m = curveMetrics(curve);
  // capital check: margin of open books + fall from peak
  let peak = -Infinity, need = 0, needOn = '', worstDay = 0, worstDayOn = '';
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i], d = p.date;
    peak = Math.max(peak, p.equity);
    const open = names.reduce((a, n) => a + (books[n].trades.some((t) => t.entry <= d && t.exit > d && t.entry >= from) ? books[n].margin ?? 0 : 0), 0);
    const use = open + (peak - p.equity);
    if (use > need) { need = use; needOn = d; }
    if (i > 0 && p.equity - curve[i - 1].equity < worstDay) { worstDay = p.equity - curve[i - 1].equity; worstDayOn = d; }
  }
  return { names: names.join('+'), from, cagrPct: m.cagrPct, perYear: Math.round((curve.at(-1)!.equity - CAP) / ((Date.parse(curve.at(-1)!.date) - Date.parse(curve[0].date)) / (365.25 * 864e5))), maxDdPct: m.drawdown.maxDdPct, worstDay: Math.round(worstDay), worstDayOn, need: Math.round(need), needOn, fits: need <= CAP, losingYears: m.annual.filter((y) => y.returnPct < 0).map((y) => `${y.year}:${y.returnPct}%`), annual: m.annual.map((y) => `${String(y.year).slice(2)}:${y.returnPct}%`).join(' '), curve };
}
const names = Object.keys(books);
const mixes: string[][] = [];
for (let mask = 1; mask < 1 << names.length; mask++) mixes.push(names.filter((_, i) => mask & (1 << i)));
const out: Record<string, unknown>[] = [];
const bookStats = Object.fromEntries(Object.entries(books).map(([k, b]) => [k, { trades: b.trades.length, from: b.trades[0]?.entry, wonPct: Math.round((100 * b.trades.filter((t) => t.net > 0).length) / b.trades.length), total: Math.round(b.trades.reduce((a, t) => a + t.net, 0)), worstTrade: Math.round(Math.min(...b.trades.map((t) => t.net))), worstOpen: Math.round(Math.min(...b.trades.map((t) => t.worstMtm))), margin: b.margin }]));
for (const from of [FROM, RECENT]) {
  console.log(`\n=== From ${from} on ₹5 lakh (1 lot each). ₹/yr | CAGR | max DD | worst day | capital needed (margin + fall) | years`);
  const rows = mixes.filter((m) => from === RECENT || !(m.length === 1 && m[0] === 'F')).map((m) => study(m, from));
  for (const r of rows.sort((a, b) => b.perYear - a.perYear)) {
    console.log(`  ${r.names.padEnd(8)} ₹${String(r.perYear).padStart(7)} | ${String(r.cagrPct).padStart(5)}% | DD ${String(r.maxDdPct).padStart(5)}% | ₹${r.worstDay} ${r.worstDayOn} | need ₹${r.need} ${r.fits ? 'fits' : 'OVER'} (${r.needOn}) | ${from === FROM ? r.annual : ''}`);
    out.push({ ...r, curve: r.curve.filter((p, i) => i % 3 === 0 || i === r.curve.length - 1).map((p) => [p.date, Math.round(p.equity)]), byYear: Object.fromEntries(curveMetrics(r.curve).annual.map((y) => [String(y.year), y.returnPct])) });
  }
}
// how much the books move together (daily P&L, 1 lot each, from 2019-02 for W)
const c = (n: string, from: string) => equityFromTrades(allDays.filter((d) => d >= from), CAP, books[n].trades.filter((t) => t.entry >= from));
console.log('\nDaily P&L correlation from 2019-02: W–S', pnlCorrelation(c('W', '2019-02-01'), c('S', '2019-02-01')), 'W–P', pnlCorrelation(c('W', '2019-02-01'), c('P', '2019-02-01')), 'S–P', pnlCorrelation(c('S', '2019-02-01'), c('P', '2019-02-01')));
console.log('From Sep 2025: W–F', pnlCorrelation(c('W', RECENT), c('F', RECENT)), 'S–F', pnlCorrelation(c('S', RECENT), c('F', RECENT)));
writeFileSync('.data/research/theta/portfolio.json', JSON.stringify({ built: new Date().toISOString(), capital: CAP, from: FROM, recent: RECENT, to: last, books: bookStats, corr: { WS: pnlCorrelation(c('W', '2019-02-01'), c('S', '2019-02-01')).r, WP: pnlCorrelation(c('W', '2019-02-01'), c('P', '2019-02-01')).r, SP: pnlCorrelation(c('S', '2019-02-01'), c('P', '2019-02-01')).r, WF: pnlCorrelation(c('W', RECENT), c('F', RECENT)).r, SF: pnlCorrelation(c('S', RECENT), c('F', RECENT)).r }, margins: Object.fromEntries(Object.entries(books).map(([k, b]) => [k, b.margin])), rows: out, trades: Object.fromEntries(Object.entries(books).map(([k, b]) => [k, b.trades.map((t) => ({ entry: t.entry, exit: t.exit, net: t.net, worstMtm: t.worstMtm }))])) }));
await prisma.$disconnect();
