// Tasty Trade "45 DTE" test on NIFTY monthly options, as described in a YouTube episode (The Long and the Short):
// sell at 45 calendar days before the monthly expiry, exit at 50% of credit (target), premium at 200% (stop) or 21 days
// before expiry. Variants: ATM straddle, 0.30 and 0.16 delta strangles. Filter: India VIX percentile at entry against the
// previous 252 sessions (>25, >50, >75; nested). Our data is end of day: entry at the close, exits checked at each close
// (the video checks hourly). Points = rupees after charges / lot size at entry.
// Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/tasty45.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { runLab, type LabStrategy, type LabTrade } from '@mtv/backtest';
import { ivRank } from '@mtv/options';
import { labData } from '../../src/options-lab/data';

const data = await labData('NIFTY');
const lotOn = new Map(data.days.map((d) => [d.date, d.lotSize]));
const vix = (await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true }, orderBy: { date: 'asc' } }))
  .map((r) => ({ date: r.date, iv: r.closePaise / 100 }));

const FROM = process.env.FROM ?? '2019-01-01';
const TO = process.env.TO; // optional
const legs = (strike: LabStrategy['legs'][number]['strike']): LabStrategy['legs'] => [
  { side: 'SELL', kind: 'CE', lots: 1, strike, expiry: 0 },
  { side: 'SELL', kind: 'PE', lots: 1, strike, expiry: 0 },
];
const variants: [string, LabStrategy['legs']][] = [
  ['ATM straddle', legs({ by: 'atm' })],
  ['0.30 delta strangle', legs({ by: 'delta', delta: 0.3 })],
  ['0.16 delta strangle', legs({ by: 'delta', delta: 0.16 })],
];

type Row = { spotIn: number; credit: number; entry: string; exit: string; reason: string; pts: number; worstPts: number; vixPct: number | null; vix: number | null; rupees: number };
const out: Record<string, unknown> = { from: FROM, to: TO ?? null, variants: {} as Record<string, unknown>, today: null as unknown };

for (const [name, l] of variants) {
  const s: LabStrategy = {
    name, underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: l, iv: 'any',
    exit: { daysLeft: 21, bookPct: 50, stopCredit: 1 }, missing: 'skip', slippage: 1, money: 'actual', from: FROM, ...(TO ? { to: TO } : {}),
  };
  const r = await runLab(s, data);
  const rows: Row[] = r.trades.map((t: LabTrade) => {
    const lot = lotOn.get(t.entry)!;
    const v = vix.find((x) => x.date === t.entry)?.iv ?? null;
    return { spotIn: t.spotIn, credit: t.credit / lot, entry: t.entry, exit: t.exit, reason: t.reason, pts: t.net / lot, worstPts: t.worstMtm / lot, vixPct: ivRank(vix, t.entry, 252), vix: v, rupees: t.net };
  });
  (out.variants as Record<string, unknown>)[name] = { rows, skipped: r.skipped }; out.today = r.today;

  console.log(`\n=== ${name}  (${rows[0]?.entry} → ${rows.at(-1)?.exit}; skipped ${r.skipped.length}: ${r.skipped.map((x) => `${x.date} ${x.reason}`).join('; ')})`);
  for (const [label, keep] of [['no filter', () => true], ['VIX pct > 25', (x: Row) => (x.vixPct ?? -1) > 0.25], ['VIX pct > 50', (x: Row) => (x.vixPct ?? -1) > 0.5], ['VIX pct > 75', (x: Row) => (x.vixPct ?? -1) > 0.75]] as const) {
    const a = rows.filter(keep as (x: Row) => boolean);
    if (!a.length) { console.log(`  ${label}: no trades`); continue; }
    const won = a.filter((x) => x.pts > 0).length, tot = a.reduce((p, x) => p + x.pts, 0);
    let eq = 0, peak = 0, dd = 0;
    for (const x of a) { eq += x.pts; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
    const best = a.reduce((m, x) => (x.pts > m.pts ? x : m)), worst = a.reduce((m, x) => (x.pts < m.pts ? x : m));
    const by = (k: string) => a.filter((x) => x.reason === k).length;
    console.log(`  ${label.padEnd(13)} n ${String(a.length).padStart(3)}  won ${String(Math.round((won / a.length) * 100)).padStart(3)}%  total ${tot.toFixed(0).padStart(6)} pts  avg ${(tot / a.length).toFixed(1).padStart(6)}  maxDD ${dd.toFixed(0).padStart(6)}  target ${by('booked')} stop ${by('stop')} 21d ${by('days-left')}  best ${best.pts.toFixed(0)} (${best.entry})  worst ${worst.pts.toFixed(0)} (${worst.entry})  worst open ${Math.min(...a.map((x) => x.worstPts)).toFixed(0)}`);
  }
  const years: Record<string, Row[]> = {};
  for (const x of rows) (years[x.exit.slice(0, 4)] ??= []).push(x);
  console.log('  by year (no filter): ' + Object.entries(years).map(([y, a]) => `${y} ${a.length}t ${Math.round((a.filter((x) => x.pts > 0).length / a.length) * 100)}% ${a.reduce((p, x) => p + x.pts, 0).toFixed(0)}`).join(' | '));
  const y75: Record<string, number> = {};
  for (const x of rows) if ((x.vixPct ?? -1) > 0.75) y75[x.entry.slice(0, 4)] = (y75[x.entry.slice(0, 4)] ?? 0) + 1;
  console.log('  trades/yr VIX>75: ' + Object.keys(years).map((y) => `${y} ${y75[y] ?? 0}`).join(' | '));
  console.log(`  first: ${rows[0]?.entry} ${rows[0]?.reason} ${rows[0]?.pts.toFixed(1)}  last: ${rows.at(-1)?.entry} ${rows.at(-1)?.reason} ${rows.at(-1)?.pts.toFixed(1)}`);
}

const file = path.resolve(import.meta.dirname, '../../.data/research/tasty45.json');
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\nsaved ${file}`);
await prisma.$disconnect();
