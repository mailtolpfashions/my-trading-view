// Scalping study, step 5 check: the Black-76 estimate (day's closing ATM IV, forward ratio) vs the recorded real
// 1-minute option prices (opt1m) for the 1-ITM call and put, on the fully recorded days. Also: how much a 1-ITM
// option really moved vs the model over 30-minute windows (what the scalp P&L depends on), and the real bid-ask spread.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/model-check.ts 2026-11-04 2026-11-05
import { prisma } from '@mtv/db';
import { black76 } from '@mtv/options';
import { istHm } from '@mtv/indicators';
import { MinuteStore } from '../../../src/intraday/store';
import { OptionStore } from '../../../src/intraday/options';

const dates = process.argv.slice(2);
const spotStore = new MinuteStore(), optStore = new OptionStore();
const errs: number[] = [], moveErr: number[] = [], spreads: number[] = [];
for (const date of dates) {
  const iv = await prisma.fnoDerivedDay.findMany({ where: { underlying: 'NIFTY', date }, orderBy: { expiry: 'asc' } });
  const r = iv.find((x) => x.daysToExpiry > 0 && x.atmIv && x.forwardPaise && x.spotPaise);
  if (!r) { console.log(`${date}: no IV row`); continue; }
  const ratio = r.forwardPaise! / r.spotPaise!, sigma = r.atmIv! > 3 ? r.atmIv! / 100 : r.atmIv!;
  const spot = (await spotStore.read('NIFTY', Date.parse(`${date}T00:00:00+05:30`) / 1000)).filter((c) => new Date((c.time + 19800) * 1000).toISOString().startsWith(date));
  const opts = (await optStore.read('NIFTY', date)).filter((o) => o.expiry === r.expiry);
  console.log(`\n${date}: expiry ${r.expiry} (${r.daysToExpiry} d), day IV ${(sigma * 100).toFixed(1)}%, option rows ${opts.length}`);
  const at = (hhmm: number) => spot.find((c) => istHm(c.time) === hhmm);
  const model = (right: 'CE' | 'PE', K: number, S: number, t: number) => black76(right, S * ratio, K, (Date.parse(`${r.expiry}T15:30:00+05:30`) / 1000 - t) / (365 * 86400), 0.065, sigma).price;
  for (const hhmm of [930, 1000, 1030, 1100, 1200, 1300, 1400, 1430]) {
    const c = at(hhmm), c2 = c && spot.find((x) => x.time === c.time + 1800);
    if (!c) continue;
    const atm = Math.round((c.close * ratio) / 100) * 100;
    for (const [right, K] of [['CE', atm - 100], ['PE', atm + 100]] as const) {
      const real = opts.find((o) => o.strike === K && o.right === right && o.time === c.time);
      if (!real) continue;
      const m = model(right, K, c.close, c.time + 60);
      errs.push(m - real.close);
      if (real.bid > 0 && real.ask > 0) spreads.push(real.ask - real.bid);
      const later = c2 && opts.find((o) => o.strike === K && o.right === right && o.time === c2.time);
      let mv = '';
      if (c2 && later) {
        const realMove = later.close - real.close, modelMove = model(right, K, c2.close, c2.time + 60) - m;
        moveErr.push(modelMove - realMove);
        mv = `  30-min move real ${realMove.toFixed(1)} model ${modelMove.toFixed(1)} (spot ${(c2.close - c.close).toFixed(1)})`;
      }
      console.log(`  ${hhmm} spot ${c.close.toFixed(1)} ${K}${right}: real ${real.close.toFixed(1)} (bid ${real.bid} ask ${real.ask}) model ${m.toFixed(1)}${mv}`);
    }
  }
}
await prisma.$disconnect();
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const mabs = (a: number[]) => mean(a.map(Math.abs));
console.log(`\nlevel: model − real mean ${mean(errs).toFixed(1)} pts, mean |error| ${mabs(errs).toFixed(1)} (n ${errs.length})`);
console.log(`30-min change: model − real mean ${mean(moveErr).toFixed(2)} pts, mean |error| ${mabs(moveErr).toFixed(2)} (n ${moveErr.length})`);
console.log(`real bid-ask spread: mean ${mean(spreads).toFixed(2)} pts, max ${Math.max(...spreads).toFixed(2)}`);
