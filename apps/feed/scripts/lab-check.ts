// Checks the option strategy lab (packages/backtest/src/lab.ts) against the studies it replaces: each template must give
// the study's trades, win rate and money. Study money was scaled to the index on the day the study ran, so it is
// rescaled to the lab's day before comparing. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/lab-check.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { runLab, type LabStrategy, type LabTrade } from '@mtv/backtest';
import { labData } from '../src/options-lab/data';

const RES = path.resolve(import.meta.dirname, '../.data/research');
const three = JSON.parse(readFileSync(path.join(RES, 'selling-three.json'), 'utf8'));
const ratio = JSON.parse(readFileSync(path.join(RES, 'selling-callratio.json'), 'utf8'));
const data = await labData('NIFTY');

const common = { underlying: 'NIFTY', missing: 'skip', slippage: 1, money: 'today' } as const;
const strangle = (delta: number, put: boolean): LabStrategy['legs'] => [
  { side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'delta', delta }, expiry: 0 },
  { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'delta', delta }, expiry: 0 },
  ...(put ? [{ side: 'BUY', kind: 'PE', lots: 1, strike: { by: 'pct', pct: -15 }, expiry: 0 } as const] : []),
];
type Study = { trades: { entry: string; net: number }[]; spot: number; lot: number };
const fromThree = (strat: string, exit: number, put: boolean, book: boolean, keep: (t: { hi: boolean; rank: number | null }) => boolean): Study => ({
  trades: three.variants.find((v: { strat: string; exit: number; put: boolean; book: boolean }) => v.strat === strat && v.exit === exit && v.put === put && v.book === book).trades.filter(keep),
  spot: three.spot, lot: three.lot,
});

const checks: { name: string; s: LabStrategy; study: Study }[] = [
  { name: 'Paper rule: 0.16 strangle + 15% put, 45→21, high IV', study: fromThree('n16', 21, true, false, (t) => t.hi),
    s: { ...common, name: 'p', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: strangle(0.16, true), iv: 'high', exit: { daysLeft: 21 } } },
  { name: '0.25 strangle, 45→21, high IV', study: fromThree('n25', 21, false, false, (t) => t.hi),
    s: { ...common, name: 'q', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, legs: strangle(0.25, false), iv: 'high', exit: { daysLeft: 21 } } },
  { name: 'Straddle at forward, 45→25, top third IV, book 50%', study: fromThree('fwd', 25, false, true, (t) => (t.rank ?? 0) >= 0.67),
    s: { ...common, name: 'r', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, iv: 'top-third', exit: { daysLeft: 25, bookPct: 50 },
      legs: [{ side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'forward' }, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'forward' }, expiry: 0 }] } },
  (() => {
    const t = ratio.tests.find((x: { base: number; months: number; scaled: boolean; up: boolean; down: string }) => x.base === 0.08 && x.months === 2 && !x.scaled && x.up && x.down === 'D1');
    return { name: 'Call ratio 8%, 2 months, upside adjustments + put buyback', study: { trades: t.rows, spot: ratio.spot, lot: ratio.lot },
      s: { ...common, name: 'c', missing: 'settlement', distanceFrom: 'atm', schedule: { every: 'after-expiry', months: 2 }, iv: 'any', exit: {},
        legs: [
          { side: 'BUY', kind: 'CE', lots: 1, strike: { by: 'atm' }, expiry: 0 },
          { side: 'SELL', kind: 'CE', lots: 2, strike: { by: 'pct', pct: 8 }, expiry: 0 },
          { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'pct', pct: -8 }, expiry: 0 },
        ],
        adjust: [
          { when: { leg: 1 }, dir: 'up', actions: [{ close: 1, lots: 1 }] },
          { when: { pct: 12 }, dir: 'up', after: 0, actions: [{ close: 0, lots: 1 }, { add: { side: 'BUY', kind: 'CE', lots: 1, strike: { by: 'pct', pct: 4 }, expiry: 0 } }] },
          { when: { leg: 2 }, dir: 'down', actions: [{ close: 2, lots: 1 }] },
        ] } as LabStrategy };
  })(),
  (() => {
    const t = ratio.tests.find((x: { base: number; months: number; up: boolean; down: string }) => x.base === 0.08 && x.months === 11 && x.up && x.down === 'D1');
    return { name: 'Call ratio 8%, January → December, upside adjustments + put buyback', study: { trades: t.rows, spot: ratio.spot, lot: ratio.lot },
      s: { ...common, name: 'y', missing: 'settlement', distanceFrom: 'atm', schedule: { every: 'year', month: 1, day: 'last-monday', expiryMonth: 12 }, iv: 'any', exit: {},
        legs: [
          { side: 'BUY', kind: 'CE', lots: 1, strike: { by: 'atm' }, expiry: 0 },
          { side: 'SELL', kind: 'CE', lots: 2, strike: { by: 'pct', pct: 8 }, expiry: 0 },
          { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'pct', pct: -8 }, expiry: 0 },
        ],
        adjust: [
          { when: { leg: 1 }, dir: 'up', actions: [{ close: 1, lots: 1 }] },
          { when: { pct: 12 }, dir: 'up', after: 0, actions: [{ close: 0, lots: 1 }, { add: { side: 'BUY', kind: 'CE', lots: 1, strike: { by: 'pct', pct: 4 }, expiry: 0 } }] },
          { when: { leg: 2 }, dir: 'down', actions: [{ close: 2, lots: 1 }] },
        ] } as LabStrategy };
  })(),
];

for (const c of checks) {
  const t0 = performance.now();
  const r = await runLab(c.s, data);
  const k = (r.today.spot * r.today.lot) / (c.study.spot * c.study.lot); // study money → today's
  const mine = new Map(r.trades.map((t: LabTrade) => [t.entry, t.net]));
  const theirs = new Map(c.study.trades.map((t) => [t.entry, Math.round(t.net * k)]));
  const both = [...theirs.keys()].filter((d) => mine.has(d));
  const off = both.filter((d) => Math.abs(mine.get(d)! - theirs.get(d)!) > 2);
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const won = (m: Map<string, number>) => [...m.values()].filter((v) => v > 0).length;
  console.log(`\n${c.name}  (${Math.round(performance.now() - t0)} ms)`);
  console.log(`  lab:   ${mine.size} trades, ${won(mine)} won, total ₹${sum(mine)}`);
  console.log(`  study: ${theirs.size} trades, ${won(theirs)} won, total ₹${sum(theirs)} (rescaled ×${k.toFixed(4)})`);
  console.log(`  only in lab: ${[...mine.keys()].filter((d) => !theirs.has(d)).join(', ') || 'none'}`);
  console.log(`  only in study: ${[...theirs.keys()].filter((d) => !mine.has(d)).join(', ') || 'none'}`);
  console.log(`  same entry, money differs by more than ₹2: ${off.length}${off.length ? ' e.g. ' + off.slice(0, 5).map((d) => `${d} lab ${mine.get(d)} study ${theirs.get(d)}`).join('; ') : ''}`);
}
await prisma.$disconnect();
