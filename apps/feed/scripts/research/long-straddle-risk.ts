// Part 3 of the YouTube "long-term short straddle": (1) is his planned risk (index − support) × lot the real loss when
// the support breaks? (2) does a weekly put bought at the support level every week (his gap hedge) pay for itself?
// Uses the +12% straddle, Jan → Dec, with re-entry on a weekly close below the weekly swing support (lab.ts).
// Money at today's size (index and lot), as the lab shows it. Weekly options exist from Feb 2019.
// Run after market hours: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/long-straddle-risk.ts
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { runLab, type LabLeg, type LabStrategy } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';

const data = await labData('NIFTY');
const day = new Map(data.days.map((d) => [d.date, d]));
const dates = data.days.map((d) => d.date);
const sell = (kind: 'CE' | 'PE', strike: LabLeg['strike']): LabLeg => ({ side: 'SELL', kind, lots: 1, strike, expiry: 0 });
const k = (n: number) => `${n < 0 ? '−' : ''}₹${Math.round(Math.abs(n) / 1000)}k`;

for (const month of [1, 7]) {
  const s: LabStrategy = {
    name: 'r', underlying: 'NIFTY', schedule: { every: 'year', month, day: 'last-monday', expiryMonth: 12 }, check: 'weekly', iv: 'any', exit: {}, missing: 'settlement', slippage: 1, money: 'today',
    legs: [sell('CE', { by: 'pct', pct: 12 }), sell('PE', { by: 'pct', pct: 12 })],
    adjust: [{ when: { swing: 'support' }, dir: 'down', actions: [{ close: 0, lots: 1 }, { close: 1, lots: 1 }, { add: sell('CE', { by: 'atm' }) }, { add: sell('PE', { by: 'atm' }) }] }],
  };
  const r = await runLab(s, data);
  const T = r.today, todayN = T.spot * T.lot; // ₹ per index point × lot today
  console.log(`\n===== ${month === 1 ? 'January' : 'July'} → December, +12% with re-entry`);

  // ---- (1) planned vs real loss at the support break
  console.log('planned risk = (index at entry − support) × lot, at today\'s size; real = money booked when the weekly close broke it');
  let plannedSum = 0, realSum = 0, n = 0;
  for (const t of r.trades) {
    const w = t.events.find((e) => e.text.startsWith('Watching support at'));
    if (!w) { console.log(`  ${t.entry}: no support level (${t.events[0]?.text ?? ''})`); continue; }
    const support = Number(/at (\d+)/.exec(w.text)![1]);
    const planned = -((t.spotIn - support) / t.spotIn) * todayN;
    const brk = t.events.find((e) => / below support /.test(e.text));
    if (!brk) { console.log(`  ${t.entry}: support ${support} (${(((t.spotIn - support) / t.spotIn) * 100).toFixed(1)}% below) never broke; planned ${k(planned)}, worst while open ${k(t.worstMtm)}, result ${k(t.net)}`); continue; }
    const real = t.daily.find((d) => d.date === brk.date)?.mtm ?? NaN;
    const closeAt = Number(/close (\d+)/.exec(brk.text)![1]);
    console.log(`  ${t.entry}: support ${support} (${(((t.spotIn - support) / t.spotIn) * 100).toFixed(1)}% below), broke ${brk.date} at a weekly close ${closeAt} (${(((closeAt - support) / support) * 100).toFixed(1)}% under it): planned ${k(planned)}, real ${k(real)} (${(real / planned).toFixed(1)}×)`);
    plannedSum += planned; realSum += real; n++;
  }
  if (n) console.log(`  average over ${n} breaks: planned ${k(plannedSum / n)}, real ${k(realSum / n)} (${(realSum / plannedSum).toFixed(2)}×)`);

  // ---- (2) the weekly hedge: each week, buy 1 lot of the nearest-expiry put at the support level, held to its expiry
  console.log('weekly hedge from 2019 (put at the support, nearest expiry, bought at the week\'s first close, held to expiry; ₹1 slippage, charges):');
  for (const t of r.trades.filter((x) => x.entry >= '2019-02-11')) {
    const w = t.events.find((e) => e.text.startsWith('Watching support at'));
    if (!w) continue;
    const support = Number(/at (\d+)/.exec(w.text)![1]) * 100;
    const until = t.events.find((e) => / below support /.test(e.text))?.date ?? t.exit;
    let cost = 0, payoff = 0, weeks = 0, missed = 0, prem: number[] = [];
    let wk = '';
    for (const b of dates.filter((d) => d >= t.entry && d < until)) {
      const mon = new Date(Date.parse(`${b}T00:00:00Z`) - ((new Date(`${b}T00:00:00Z`).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      if (mon === wk) continue;
      wk = mon;
      const e = data.expiries.find((x) => x > b);
      if (!e || e > until && e > t.exit) continue;
      const rows = (await data.chains(e, b, b)).get(b) ?? [];
      const puts = rows.filter((x) => x.kind === 'PE' && x.traded && x.closePaise > 0);
      const q = puts.reduce<(typeof puts)[number] | null>((best, x) => (!best || Math.abs(x.strikePaise - support) < Math.abs(best.strikePaise - support) ? x : best), null);
      if (!q || Math.abs(q.strikePaise - support) > support * 0.01) { missed++; continue; }
      const meta = day.get(b)!, lot = meta.lotSize!, spotB = meta.spotPaise!;
      const scale = todayN / ((spotB / 100) * lot); // this week's rupees → today's size
      const px = q.closePaise + 100; // ₹1 slippage
      const settle = day.get(e)?.spotPaise;
      if (settle == null) { missed++; continue; }
      const intrinsic = Math.max(0, q.strikePaise - settle);
      const ch = computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: px, date: b }).total + (intrinsic > 0 ? computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: intrinsic, date: e }).total : 0);
      cost += ((px * lot + ch) / 100) * scale; payoff += ((intrinsic * lot) / 100) * scale; weeks++; prem.push(q.closePaise / 100);
    }
    prem.sort((a, b) => a - b);
    console.log(`  ${t.entry.slice(0, 4)}: ${weeks} weeks hedged (${missed} with no traded put near ${support / 100}), median put ₹${prem[prem.length >> 1]?.toFixed(2) ?? '–'}, cost ${k(cost)}, paid back ${k(payoff)}, net ${k(payoff - cost)} | trade ${k(t.net)} → with hedge ${k(t.net + payoff - cost)}`);
  }
}
await prisma.$disconnect();
