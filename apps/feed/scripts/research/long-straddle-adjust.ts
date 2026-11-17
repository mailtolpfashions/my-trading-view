// Part 2 of the YouTube "long-term short straddle": adjust only on a weekly close beyond a support / resistance level.
// Levels are weekly swing highs/lows known at the time (lab.ts swingLevel: 3 weeks each side, last 2 years, ≥3% away).
//  - Directional (+12% straddle): weekly close below support → exit both legs, re-enter an ATM straddle ("re-entry").
//  - Non-directional (ATM straddle): weekly close above resistance → buy back the call, sell a call 10% above the index;
//    below support → buy back the put, sell a put 10% below ("shifting"). 10% is our choice (he used ~11–18%).
// Jan → Dec and Jul → Dec, December expiry, money at today's size, settlement prices allowed (counted).
// Run after market hours: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/long-straddle-adjust.ts
import { prisma } from '@mtv/db';
import { runLab, type LabAdjust, type LabLeg, type LabStrategy } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';

const data = await labData('NIFTY');
const sell = (kind: 'CE' | 'PE', strike: LabLeg['strike']): LabLeg => ({ side: 'SELL', kind, lots: 1, strike, expiry: 0 });
const pair = (st: LabLeg['strike']) => [sell('CE', st), sell('PE', st)];
const reentry: LabAdjust = { when: { swing: 'support' }, dir: 'down', actions: [{ close: 0, lots: 1 }, { close: 1, lots: 1 }, { add: sell('CE', { by: 'atm' }) }, { add: sell('PE', { by: 'atm' }) }] };
// shifting of legs `c` (call) and `p` (put), active after adjustment `after`
const shift = (c: number, p: number, after?: number): LabAdjust[] => [
  { when: { swing: 'resistance' }, dir: 'up', after, actions: [{ close: c, lots: 1 }, { add: sell('CE', { by: 'pct', pct: 10, from: 'now' }) }] },
  { when: { swing: 'support' }, dir: 'down', after, actions: [{ close: p, lots: 1 }, { add: sell('PE', { by: 'pct', pct: -10, from: 'now' }) }] },
];
const variants: [string, LabLeg[], LabAdjust[] | undefined, 'daily' | 'weekly'][] = [
  ['+12% hold', pair({ by: 'pct', pct: 12 }), undefined, 'weekly'],
  ['+12% re-entry (weekly)', pair({ by: 'pct', pct: 12 }), [reentry], 'weekly'],
  ['+12% re-entry (daily)', pair({ by: 'pct', pct: 12 }), [reentry], 'daily'],
  ['+12% re-entry + shifting', pair({ by: 'pct', pct: 12 }), [reentry, ...shift(2, 3, 0)], 'weekly'],
  ['ATM hold', pair({ by: 'forward' }), undefined, 'weekly'],
  ['ATM shifting (weekly)', pair({ by: 'forward' }), shift(0, 1), 'weekly'],
];
const L = (n: number | null) => (n == null ? '–' : `${n < 0 ? '−' : ''}₹${(Math.abs(n) / 100000).toFixed(2)}L`);
for (const month of [1, 7]) {
  console.log(`\n===== ${month === 1 ? 'January → December' : 'July → December'}`);
  for (const [name, legs, adjust, check] of variants) {
    const s: LabStrategy = { name, underlying: 'NIFTY', schedule: { every: 'year', month, day: 'last-monday', expiryMonth: 12 }, legs, adjust, check, iv: 'any', exit: {}, missing: 'settlement', slippage: 1, money: 'today' };
    const r = await runLab(s, data), m = r.summary;
    const fired = r.trades.filter((t) => t.events.some((e) => / (above|below) /.test(e.text))).length;
    const losing = m.byYear.filter((y) => y.net < 0).length;
    console.log(`${name.padEnd(26)} n ${m.trades} won ${m.won} /yr ${L(m.perYear)} total ${L(m.total)} worst ${L(m.worst)} worstOpen ${L(m.worstMtm)} losingYrs ${losing} adjusted ${fired} settlementPriced ${m.modelPriced}`);
    console.log('   ' + r.trades.map((t) => `${t.entry.slice(0, 4)} ${t.net >= 0 ? '+' : ''}${Math.round(t.net / 1000)}k${t.events.some((e) => / (above|below) /.test(e.text)) ? 'A' : ''}`).join(' '));
    if (name === '+12% re-entry (weekly)' && month === 1) for (const t of r.trades.filter((x) => ['2015', '2020', '2022'].includes(x.entry.slice(0, 4)))) console.log(`     ${t.entry}: ${t.events.map((e) => `${e.date} ${e.text}`).join(' | ')}`);
    if (name === 'ATM shifting (weekly)' && month === 1) for (const t of r.trades.filter((x) => ['2020', '2023'].includes(x.entry.slice(0, 4)))) console.log(`     ${t.entry}: ${t.events.map((e) => `${e.date} ${e.text}`).join(' | ')}`);
  }
}
await prisma.$disconnect();
