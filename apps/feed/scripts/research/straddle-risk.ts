// 45 DTE ATM straddle (50% book, 2x stop, out at 21 days): ways to cut its risk, on the same data as tasty45.ts.
// Points = rupees after charges / lot at entry. Run after market hours:
// npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/straddle-risk.ts
import { prisma } from '@mtv/db';
import { runLab, type LabStrategy } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';

const data = await labData('NIFTY');
const lotOn = new Map(data.days.map((d) => [d.date, d.lotSize]));
const S = (strike: LabStrategy['legs'][number]['strike'], side: 'SELL' | 'BUY' = 'SELL', kind: 'CE' | 'PE' = 'CE') => ({ side, kind, lots: 1, strike, expiry: 0 as const });
const straddle = [S({ by: 'atm' }, 'SELL', 'CE'), S({ by: 'atm' }, 'SELL', 'PE')];
const base: LabStrategy = { name: 'x', underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: straddle, iv: 'any',
  exit: { daysLeft: 21, bookPct: 50, stopCredit: 1 }, missing: 'skip', slippage: 1, money: 'actual', from: '2019-01-01' };
const tests: [string, Partial<LabStrategy>][] = [
  ['straddle (video rule)', {}],
  ['+ VIX >25%', { vixAbove: 25 }],
  ['+ VIX >50%', { vixAbove: 50 }],
  ['stop at 1.5x premium', { exit: { daysLeft: 21, bookPct: 50, stopCredit: 0.5 } }],
  ['stop 1.5x + VIX >25%', { vixAbove: 25, exit: { daysLeft: 21, bookPct: 50, stopCredit: 0.5 } }],
  ['wings ±5% (iron fly)', { legs: [...straddle, S({ by: 'pct', pct: 5 }, 'BUY', 'CE'), S({ by: 'pct', pct: -5 }, 'BUY', 'PE')] }],
  ['wings ±8%', { legs: [...straddle, S({ by: 'pct', pct: 8 }, 'BUY', 'CE'), S({ by: 'pct', pct: -8 }, 'BUY', 'PE')] }],
  ['wings 0.05 delta', { legs: [...straddle, S({ by: 'delta', delta: 0.05 }, 'BUY', 'CE'), S({ by: 'delta', delta: 0.05 }, 'BUY', 'PE')] }],
  ['wings ±8% + VIX >25%', { vixAbove: 25, legs: [...straddle, S({ by: 'pct', pct: 8 }, 'BUY', 'CE'), S({ by: 'pct', pct: -8 }, 'BUY', 'PE')] }],
  ['exit at 28 days left', { exit: { daysLeft: 28, bookPct: 50, stopCredit: 1 } }],
];
for (const [name, p] of tests) {
  const r = await runLab({ ...base, ...p }, data);
  const a = r.trades.map((t) => ({ e: t.entry, pts: t.net / lotOn.get(t.entry)!, open: t.worstMtm / lotOn.get(t.entry)!, why: t.reason }));
  let eq = 0, peak = 0, dd = 0;
  for (const x of a) { eq += x.pts; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const won = a.filter((x) => x.pts > 0).length, worst = a.reduce((m, x) => (x.pts < m.pts ? x : m));
  const yrs: Record<string, number> = {}; for (const x of a) yrs[x.e.slice(0, 4)] = (yrs[x.e.slice(0, 4)] ?? 0) + x.pts;
  console.log(`${name.padEnd(24)} n ${String(a.length).padStart(3)} won ${String(Math.round((won / a.length) * 100)).padStart(3)}% total ${eq.toFixed(0).padStart(6)} maxDD ${dd.toFixed(0).padStart(6)} worst ${worst.pts.toFixed(0).padStart(5)} (${worst.e}) worstOpen ${Math.min(...a.map((x) => x.open)).toFixed(0).padStart(5)} stops ${a.filter((x) => x.why === 'stop').length} losingYrs ${Object.values(yrs).filter((v) => v < 0).length} skipped ${r.skipped.length}`);
}
await prisma.$disconnect();
