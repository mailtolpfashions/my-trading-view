// Curves for the A2 sizing study (E-20261111-004), which saved only a table of numbers per combination. Re-runs the
// same 5 rules × lots 1–4 × stop none/3%/5% of capital (deterministic, same data, holdout locked) and writes
// .data/research/quant/E-20261111-004-curves.json: one daily equity curve on ₹10 lakh per combination, plus the
// trade list. Registers nothing (the experiment's numbers are unchanged).
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=3072 -- npx tsx scripts/research/quant/a2-curves.ts
import { prisma } from '@mtv/db';
import { runLab, equityFromTrades, guardHoldout, PERIODS, type LabStrategy, type LabLeg, type LabTrade } from '@mtv/backtest';
import { labData } from '../../../src/options-lab/data';
import { saveDetail } from './registry';

const ID = 'E-20261111-004';
const TO = guardHoldout(PERIODS.validation.to);
const CAPITAL = 1_000_000;
const data = await labData('NIFTY');
const days = data.days.map((d) => d.date).filter((d) => d <= TO);
const sell = (kind: 'CE' | 'PE', delta: number): LabLeg => ({ side: 'SELL', kind, lots: 1, strike: { by: 'delta', delta }, expiry: 0 });
const strangle = (d: number) => [sell('CE', d), sell('PE', d)];
const straddle: LabLeg[] = [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }];
type Rule = { id: string; legs: LabLeg[]; daysBefore: number; exit: LabStrategy['exit']; iv: LabStrategy['iv'] };
// The same rules, in the same order, as a2-sizing-stress.ts recorded in E-20261111-004.
const rules: Rule[] = [
  { id: 's25 45→21 high (benchmark)', legs: strangle(0.25), daysBefore: 45, exit: { daysLeft: 21 }, iv: 'high' },
  { id: 's16 45→21 high', legs: strangle(0.16), daysBefore: 45, exit: { daysLeft: 21 }, iv: 'high' },
  { id: 's25 45→21 any', legs: strangle(0.25), daysBefore: 45, exit: { daysLeft: 21 }, iv: 'any' },
  { id: 'straddle 45→25 top-third book50 (paper)', legs: straddle, daysBefore: 45, exit: { daysLeft: 25, bookPct: 50 }, iv: 'top-third' },
  { id: 'straddle 60→7 high (A1 most picked)', legs: straddle, daysBefore: 60, exit: { daysLeft: 7 }, iv: 'high' },
];
const strat = (r: Rule, over: Partial<LabStrategy> = {}): LabStrategy => ({ name: r.id, underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: r.daysBefore }, legs: r.legs, iv: r.iv, exit: r.exit, missing: 'skip', slippage: 1, money: 'today', to: TO, ...over });
const scaled = (ts: LabTrade[], lots: number) => ts.map((t) => ({ ...t, net: t.net * lots, daily: t.daily.map((p) => ({ date: p.date, mtm: p.mtm * lots })) }));

const out: { p: { rule: string; lots: number; stopPct: number }; curve: { date: string; equity: number }[]; trades: { entry: string; exit: string; expiry: string; net: number; worstMtm: number; reason: string; spotIn: number; spotOut: number; legs: string[] }[] }[] = [];
for (const r of rules) {
  const base = await runLab(strat(r), data);
  for (const lots of [1, 2, 3, 4]) for (const stopPct of [0, 3, 5]) {
    const trades = stopPct === 0 ? base.trades : (await runLab(strat(r, { exit: { ...r.exit, stopRupees: Math.round((stopPct / 100) * CAPITAL / lots) } }), data)).trades;
    const curve = equityFromTrades(days, CAPITAL, scaled(trades, lots)).map((c) => ({ date: c.date, equity: Math.round(c.equity) }));
    out.push({ p: { rule: r.id, lots, stopPct }, curve, trades: trades.map((t) => ({ entry: t.entry, exit: t.exit, expiry: t.expiry, net: Math.round(t.net * lots), worstMtm: Math.round(t.worstMtm * lots), reason: t.reason, spotIn: t.spotIn, spotOut: t.spotOut, legs: t.legs.map((l) => `${l.side} ${l.lots * lots}× ${l.strike} ${l.kind} ${l.entry}→${l.exit}`) })) });
  }
  console.log(`${r.id}: ${base.trades.length} trades; final equity at 1 lot no stop ₹${out.find((o) => o.p.rule === r.id && o.p.lots === 1 && o.p.stopPct === 0)!.curve.at(-1)!.equity}`);
}
saveDetail(ID, 'curves', out);
console.log(`wrote ${out.length} curves for ${ID}`);
await prisma.$disconnect();
