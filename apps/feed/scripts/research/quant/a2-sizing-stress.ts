// A2. Sizing, loss limits, stress and Monte Carlo for the NIFTY monthly short-premium rules on ₹10 lakh, 2011–2023
// (holdout locked). For each rule: lots 1–4 × a per-trade loss limit (none, 3%, 5% of capital, seen at a close) →
// equity curve, CAGR, drawdown, Calmar, worst month; today's SPAN margin against the capital; gap stress at entry
// (Black-76 re-pricing of the entry legs under GAP_SHOCKS, a model estimate); slippage ×2 and ×3 and a one-day-late
// entry as fragility checks; block bootstrap of daily P&L for the drawdown distribution.
// Answers the brief's question directly: is there a size at which this family gives ~35% a year with a drawdown under 10%?
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=4096 -- npx tsx scripts/research/quant/a2-sizing-stress.ts
import { prisma } from '@mtv/db';
import { runLab, previewLab, equityFromTrades, curveMetrics, tradeMetrics, blockBootstrap, guardHoldout, PERIODS, type LabStrategy, type LabLeg, type LabTrade, type CurvePoint } from '@mtv/backtest';
import { GAP_SHOCKS, gapPnl, ivOf, positionMargin, yearsBetween, type ShockLeg } from '@mtv/options';
import { labData } from '../../../src/options-lab/data';
import { spanToday } from '../../../src/fno/span';
import { register, saveDetail, readRegistry, COSTS } from './registry';

const TO = guardHoldout(PERIODS.validation.to);
const CAPITAL = 1_000_000;
const data = await labData('NIFTY');
const days = data.days.map((d) => d.date).filter((d) => d <= TO);
const span = await spanToday();

const sell = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const strangle = (d: number) => [sell('CE', d), sell('PE', d)];
const straddle: LabLeg[] = [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }];
type Rule = { id: string; legs: LabLeg[]; daysBefore: number; exit: LabStrategy['exit']; iv: LabStrategy['iv'] };
const rules: Rule[] = [
  { id: 's25 45→21 high (benchmark)', legs: strangle(0.25), daysBefore: 45, exit: { daysLeft: 21 }, iv: 'high' },
  { id: 's16 45→21 high', legs: strangle(0.16), daysBefore: 45, exit: { daysLeft: 21 }, iv: 'high' },
  { id: 's25 45→21 any', legs: strangle(0.25), daysBefore: 45, exit: { daysLeft: 21 }, iv: 'any' },
  { id: 'straddle 45→25 top-third book50 (paper)', legs: straddle, daysBefore: 45, exit: { daysLeft: 25, bookPct: 50 }, iv: 'top-third' },
];
// The setting A1's walk-forward picked most often, if A1 has run.
const a1 = readRegistry().filter((e) => e.family === 'A1').at(-1);
const top = (a1?.metrics as { topPicks?: { id: string }[] } | undefined)?.topPicks?.[0]?.id;
if (top && !rules.some((r) => r.id.startsWith(top))) {
  const m = /^(s\d+|straddle) (\d+)→(\d+) (any|high)$/.exec(top);
  if (m) rules.push({ id: `${top} (A1 most picked)`, legs: m[1] === 'straddle' ? straddle : strangle(Number(m[1].slice(1)) / 100), daysBefore: Number(m[2]), exit: { daysLeft: Number(m[3]) }, iv: m[4] as 'any' | 'high' });
}

const strat = (r: Rule, over: Partial<LabStrategy> = {}): LabStrategy => ({ name: r.id, underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: r.daysBefore }, legs: r.legs, iv: r.iv, exit: r.exit, missing: 'skip', slippage: 1, money: 'today', to: TO, ...over });
const sum = (ts: LabTrade[]) => Math.round(ts.reduce((a, t) => a + t.net, 0));
const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, ddDays: c.drawdown.longestUnderwaterDays, sharpe: c.sharpe, calmar: c.calmar, worstMonthPct: c.worstMonthPct, worstYearPct: Math.min(...c.annual.map((y) => y.returnPct)), positiveYearsPct: c.positiveYearsPct });
const slice = (c: CurvePoint[], from: string, to: string) => c.filter((p) => p.date >= from && p.date <= to);
const scaled = (trades: LabTrade[], lots: number) => trades.map((t) => ({ ...t, net: t.net * lots, daily: t.daily.map((p) => ({ date: p.date, mtm: p.mtm * lots })) }));

/** Today's SPAN + exposure for one lot of the rule's position now (₹), or null. Labelled an estimate: old dates had other margins. */
async function marginPerLot(s: LabStrategy): Promise<number | null> {
  const p = await previewLab(s, data), d = span?.data.NIFTY;
  if (typeof p === 'string' || !d || !span) return null;
  const legs = p.legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strike: l.strike, qty: (l.side === 'BUY' ? 1 : -1) * l.lots * p.lot, pricePaise: Math.round(l.price * 100) }));
  const m = positionMargin(d, legs, Math.round(p.spot * 100), span.tradeDate);
  return m.missing.length ? null : Math.round(m.marginPaise / 100);
}

/** Model gap stress at entry for every trade: Black-76 IV from each leg's own entry price, re-priced under GAP_SHOCKS. ₹ per lot at today's size. */
function gapStress(trades: LabTrade[], lotToday: number, todayScale: (t: LabTrade) => number) {
  const per = GAP_SHOCKS.map(() => [] as number[]);
  let unpriced = 0;
  for (const t of trades) {
    const T0 = yearsBetween(t.entry, t.expiry);
    const F = t.spotIn * 100; // the index at entry stands in for the forward (parity forward not kept on the trade)
    const legs: ShockLeg[] = [];
    for (const l of t.legs) {
      if (l.kind === 'FUT' || l.added) continue;
      const iv = ivOf(l.kind, Math.round(l.entry * 100), F, Math.round(l.strike * 100), T0);
      if (iv == null) { legs.length = 0; break; }
      legs.push({ kind: l.kind, side: l.side, qty: l.lots * lotToday, strikePaise: Math.round(l.strike * 100), pricePaise: Math.round(l.entry * 100), iv, T: T0, forwardPaise: F });
    }
    if (!legs.length) { unpriced++; continue; }
    GAP_SHOCKS.forEach((s, i) => per[i].push((gapPnl(legs, s) / 100) * todayScale(t)));
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };
  return { unpriced, shocks: GAP_SHOCKS.map((s, i) => ({ gapPct: s.gapPct, ivMultiple: s.ivMultiple, worst: per[i].length ? Math.round(Math.min(...per[i])) : null, median: med(per[i]) })) };
}

type Combo = { rule: string; lots: number; stopPct: number; train: ReturnType<typeof brief>; validation: ReturnType<typeof brief>; all: ReturnType<typeof brief>; trades: number; winRatePct: number | null; marginUsePct: number | null; stopsHit: number };
const combos: Combo[] = [];
const perRule: Record<string, unknown> = {};
const lotsList = [1, 2, 3, 4], stops = [0, 3, 5];
for (const r of rules) {
  const t0 = Date.now();
  const base = await runLab(strat(r), data);
  const margin = await marginPerLot(strat(r));
  // Per lot at today's size: today's lot in units, and the index ratio puts an old trade's rupees at today's level.
  const stress = gapStress(base.trades, base.today.lot, (t) => base.today.spot / t.spotIn);
  // fragility
  const slip2 = await runLab(strat(r, { slippage: 2 }), data), slip3 = await runLab(strat(r, { slippage: 3 }), data);
  const late = await runLab(strat(r, { schedule: { every: 'expiry', cycle: 'monthly', daysBefore: r.daysBefore - 1 } }), data);
  const fr = { base: sum(base.trades), slippage2: sum(slip2.trades), slippage3: sum(slip3.trades), oneDayLate: sum(late.trades), tradesBase: base.trades.length, tradesLate: late.trades.length };
  // sizing grid
  const byStop = new Map<number, LabTrade[]>([[0, base.trades]]);
  const stopsHit = new Map<number, number>();
  const rows: Combo[] = [];
  for (const lots of lotsList) for (const stopPct of stops) {
    let trades: LabTrade[];
    if (stopPct === 0) trades = base.trades;
    else {
      const k = stopPct * 1000 + lots; // a per-lot stop depends on lots
      const rupees = Math.round((stopPct / 100) * CAPITAL / lots);
      const rr = await runLab(strat(r, { exit: { ...r.exit, stopRupees: rupees } }), data);
      trades = rr.trades; byStop.set(k, trades); stopsHit.set(k, trades.filter((t) => t.reason === 'stop').length);
    }
    const curve = equityFromTrades(days, CAPITAL, scaled(trades, lots));
    const tm = tradeMetrics(trades);
    rows.push({ rule: r.id, lots, stopPct, train: brief(curveMetrics(slice(curve, PERIODS.train.from, PERIODS.train.to))), validation: brief(curveMetrics(slice(curve, PERIODS.validation.from, PERIODS.validation.to))), all: brief(curveMetrics(curve)), trades: tm.trades, winRatePct: tm.winRatePct, marginUsePct: margin ? Math.round((margin * lots / CAPITAL) * 100) : null, stopsHit: stopsHit.get(stopPct * 1000 + lots) ?? 0 });
  }
  combos.push(...rows);
  // bootstrap on daily P&L at 2 lots, no stop (drawdown as % of capital)
  const curve2 = equityFromTrades(days, CAPITAL, scaled(base.trades, 2));
  const dailyPnl = curve2.slice(1).map((p, i) => p.equity - curve2[i].equity);
  const boot = blockBootstrap(dailyPnl, { draws: 2000, blockLen: 20, seed: 5, ddThresholds: [50_000, 100_000, 150_000, 200_000, 300_000] });
  perRule[r.id] = { marginPerLot: margin, fragility: fr, gapStressPerLot: stress, bootstrap2lots: { total: boot.total, maxDd: boot.maxDd, ddAtLeastPctOfCapital: boot.ddAtLeast.map((x) => ({ pct: x.threshold / CAPITAL * 100, share: x.share })), lossShare: boot.lossShare } };
  console.log(`\n${r.id}  (${((Date.now() - t0) / 1000).toFixed(0)} s)  margin/lot today ₹${margin}  total ₹${fr.base} | slip₹2 ${fr.slippage2} | slip₹3 ${fr.slippage3} | a day late ${fr.oneDayLate} (${fr.tradesLate} tr)`);
  console.log('  gap stress per lot (worst / median ₹):', stress.shocks.map((s) => `${s.gapPct}%: ${s.worst}/${s.median}`).join('  '), stress.unpriced ? `(${stress.unpriced} unpriced)` : '');
  console.log('  bootstrap 2 lots, daily P&L: DD p50/p95/p99 ₹', boot.maxDd.p50, boot.maxDd.p95, boot.maxDd.p99, '; P(DD ≥ 10% of capital)', boot.ddAtLeast[1].share);
  for (const c of rows) console.log(`  lots ${c.lots} stop ${c.stopPct}%  margin ${c.marginUsePct}%  train CAGR ${c.train.cagrPct}% DD ${c.train.maxDdPct}% | valid CAGR ${c.validation.cagrPct}% DD ${c.validation.maxDdPct}% worst month ${c.validation.worstMonthPct}% | all CAGR ${c.all.cagrPct}% DD ${c.all.maxDdPct}% Calmar ${c.all.calmar}  stops hit ${c.stopsHit}`);
}

const meets = combos.filter((c) => c.train.cagrPct >= 35 && c.validation.cagrPct >= 35 && c.train.maxDdPct <= 10 && c.validation.maxDdPct <= 10);
const under10 = combos.filter((c) => c.train.maxDdPct <= 10 && c.validation.maxDdPct <= 10 && (c.marginUsePct ?? 0) <= 70).sort((a, b) => b.all.cagrPct - a.all.cagrPct);
const bestCalmar = [...combos].filter((c) => (c.marginUsePct ?? 0) <= 70).sort((a, b) => (b.all.calmar ?? -9) - (a.all.calmar ?? -9)).slice(0, 5);
console.log('\nMeets 35% CAGR and ≤10% DD in BOTH periods:', meets.length ? meets.map((c) => `${c.rule} lots ${c.lots} stop ${c.stopPct}`) : 'none');
console.log('Highest CAGR with DD ≤ 10% in both periods (margin ≤ 70%):', under10.slice(0, 5).map((c) => `${c.rule} ×${c.lots} stop ${c.stopPct}: CAGR ${c.all.cagrPct}% DD ${c.all.maxDdPct}%`));
console.log('Best Calmar:', bestCalmar.map((c) => `${c.rule} ×${c.lots} stop ${c.stopPct}: CAGR ${c.all.cagrPct}% DD ${c.all.maxDdPct}% Calmar ${c.all.calmar}`));

const id = await register({
  name: 'A2 sizing, loss limits, stress and Monte Carlo for NIFTY monthly premium rules', family: 'A2',
  hypothesis: 'Some lot size and loss limit gives the premium rules ~35% a year with a drawdown under 10% on ₹10 lakh.',
  script: 'scripts/research/quant/a2-sizing-stress.ts',
  params: { rules: rules.map((r) => r.id), lots: lotsList, stopPctOfCapital: stops, capital: CAPITAL, stress: 'GAP_SHOCKS at entry, Black-76, IV from each leg\'s entry price', bootstrap: '2 lots, daily P&L, 20-day blocks, 2,000 draws' },
  period: { from: days[0], to: TO, role: 'train+validation' }, costs: COSTS.nifty,
  metrics: { combos, perRule, meetsTarget: meets, bestUnder10pctDd: under10.slice(0, 10), bestCalmar },
  validation: { holdoutTouched: false, note: 'Rules were fixed before this run (benchmark and paper rules from earlier studies, plus A1\'s most-picked setting); only size and the loss limit vary here.' },
  caveats: ['Margin is today\'s SPAN per lot (estimate for old dates).', 'Loss limits are seen at daily closes, so a real stop can fill well past the limit.', 'Gap stress is a model (Black-76 from entry prices, index as forward, lot-size changes ignored).', 'A one-day-late entry is approximated by entering one calendar day earlier in the schedule.', '₹1 slippage assumed; ₹2 and ₹3 shown.'],
  verdict: meets.length ? 'pass' : 'fail', notes: (readRegistry().some((e) => e.id === 'E-20261111-003') ? 'Supersedes E-20261111-003, whose gap stress was per index unit, not per lot. ' : '') + (meets.length ? `${meets.length} combinations meet the target` : `No size meets 35% with ≤10% drawdown. Best with DD ≤ 10%: ${under10[0] ? `${under10[0].rule} ×${under10[0].lots} stop ${under10[0].stopPct}% → CAGR ${under10[0].all.cagrPct}%` : 'none'}.`),
});
saveDetail(id, 'combos', combos);
await prisma.$disconnect();
