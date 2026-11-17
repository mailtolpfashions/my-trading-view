// Rules from a 5-part YouTube short-straddle series, tested on our best option rule: the 45 DTE NIFTY ATM straddle with
// India VIX above its 25th percentile (book 50%, stop at 2× credit, out at 21 days left).
//  1. gap: exit at the open when the index opens beyond the break-even (part 2)
//  2. rebalance when one leg is worth 2× the other, at a close: 'away' (defensive) or 'closer' (aggressive), max 3 (part 4)
//  3. a loss cap in ₹ (1–1.5% or 3% of ~₹10 lakh: ₹10k, ₹15k, ₹30k), checked at closes (part 2)
// Money at today's size; Monte Carlo capital from the lab. Run after market hours:
// npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/straddle-rules.ts
import { prisma } from '@mtv/db';
import { runLab, type LabStrategy } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';

const data = await labData('NIFTY');
const base: LabStrategy = {
  name: 'base', underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, iv: 'any', vixAbove: 25,
  legs: [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'atm' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'atm' }, expiry: 0 }],
  exit: { daysLeft: 21, bookPct: 50, stopCredit: 1 }, missing: 'skip', slippage: 1, money: 'today',
};
const v: [string, Partial<LabStrategy>][] = [
  ['45 DTE straddle, VIX>25 (base)', {}],
  ['1. + gap exit', { exit: { ...base.exit, gap: true } }],
  ['2a. + rebalance 2× away', { rebalance: { ratio: 2, mode: 'away', max: 3 } }],
  ['2b. + rebalance 2× closer', { rebalance: { ratio: 2, mode: 'closer', max: 3 } }],
  ['3a. + loss cap ₹10k', { exit: { ...base.exit, stopRupees: 10000 } }],
  ['3b. + loss cap ₹15k', { exit: { ...base.exit, stopRupees: 15000 } }],
  ['3c. + loss cap ₹30k', { exit: { ...base.exit, stopRupees: 30000 } }],
  ['all: gap + away + ₹30k', { exit: { ...base.exit, gap: true, stopRupees: 30000 }, rebalance: { ratio: 2, mode: 'away', max: 3 } }],
];
const k = (n: number | null | undefined) => (n == null ? '–' : `${n < 0 ? '−' : ''}₹${(Math.abs(n) / 1000).toFixed(0)}k`);
for (const [name, p] of v) {
  const r = await runLab({ ...base, ...p, name }, data), m = r.summary, mc = r.monteCarlo;
  const gaps = r.trades.filter((t) => t.reason === 'gap'), rb = r.trades.reduce((a, t) => a + t.events.filter((e) => e.text.startsWith('Rebalance')).length, 0);
  const stops = r.trades.filter((t) => t.reason === 'stop').length;
  console.log(`${name.padEnd(30)} n ${m.trades} won ${Math.round(m.winRatePct ?? 0)}% /yr ${k(m.perYear)} worst ${k(m.worst)} worstOpen ${k(m.worstMtm)} losingYrs ${m.losingYears}/${m.byYear.length} stops ${stops} gaps ${gaps.length} rebalances ${rb} | MC capital ${k(mc?.capital)} return ${mc?.returnPct ?? '–'}% 1in20 ${k(mc?.fall1in20)}`);
  if (gaps.length) console.log('   gap exits: ' + gaps.map((t) => `${t.exit} ${k(t.net)}${t.events.some((e) => e.text.includes('no opening trade')) ? '*' : ''}`).join(', '));
}
await prisma.$disconnect();
