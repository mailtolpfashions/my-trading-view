// The user's option pivot rule on our recorded NIFTY option minutes (apps/feed/.data/opt1m), with the same engine as the
// live paper test (src/tradelab/pivot-core.ts). Each day: the nearest expiry (expiry day included), the strike nearest
// NIFTY at 09:30, CE and PE each on their own; levels from that contract's previous-day high / low / close (NSE bhavcopy).
// Both versions: fixed (+15 / -20 points) and ladder (pivot-level trailing stop). 1 lot, charges included.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/pivot-option-test.ts
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { OptionStore } from '../../src/intraday/options';
import { MinuteStore } from '../../src/intraday/store';
import { DEFAULT_PIVOT_CFG, newSim, pivotLevels, stepSim, forceClose, type Point, type PivotTrade } from '../../src/tradelab/pivot-core';

const IST = 19800;
const minuteOf = (t: number) => Math.floor(((t + IST) % 86400) / 60);
const hhmm = (t: number) => { const m = minuteOf(t); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const rs = (p: number) => (p / 100).toFixed(2);
const opt = new OptionStore(), mins = new MinuteStore();
const days = (await readdir(path.join(opt.dir, 'NIFTY'))).map((f) => f.replace('.bin', '')).sort();
const nifty = await mins.read('NIFTY', Math.floor(Date.parse(`${days[0]}T00:00:00+05:30`) / 1000));
const totals: Record<string, { n: number; win: number; net: number }> = {};
const add = (k: string, net: number) => { const t = (totals[k] ??= { n: 0, win: 0, net: 0 }); t.n++; t.net += net; if (net > 0) t.win++; };

for (const day of days) {
  const rows = await opt.read('NIFTY', day);
  const expiry = [...new Set(rows.map((r) => r.expiry))].filter((e) => e >= day).sort()[0];
  const spotBar = nifty.find((b) => b.time >= Date.parse(`${day}T09:29:00+05:30`) / 1000);
  const meta = await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY', date: day } });
  const prevDay = (await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY', date: { lt: day } }, orderBy: { date: 'desc' } }))?.date;
  const first = rows.length ? hhmm(Math.min(...rows.map((r) => r.time))) : '-', last = rows.length ? hhmm(Math.max(...rows.map((r) => r.time))) : '-';
  if (!spotBar || !expiry || !prevDay || dateOf(spotBar.time) !== day) { console.log(`\n${day}: no NIFTY 09:29 minute or expiry; recorded ${first}–${last}`); continue; }
  const strikes = [...new Set(rows.filter((r) => r.expiry === expiry).map((r) => r.strike))];
  const atm = strikes.reduce((b, s) => (Math.abs(s - spotBar.close) < Math.abs(b - spotBar.close) ? s : b), strikes[0]);
  const lot = meta?.lotSize ?? 65;
  if (Math.abs(atm - spotBar.close) > 50) { console.log(`\n${day}: nearest recorded strike ${atm} is ${Math.abs(atm - spotBar.close).toFixed(0)} points from NIFTY ${spotBar.close}: the ATM strike was not recorded, day skipped`); continue; }
  console.log(`\n${day}  expiry ${expiry}  NIFTY 09:29 ${spotBar.close}  ATM ${atm}  lot ${lot}  minutes recorded ${first}–${last}`);
  for (const kind of ['CE', 'PE'] as const) {
    const prev = await prisma.fnoEod.findFirst({ where: { underlying: 'NIFTY', date: prevDay, expiry, kind, strikePaise: Math.round(atm * 100) } });
    if (!prev || !prev.traded) { console.log(`  ${atm} ${kind}: no traded previous-day candle (${prevDay})`); continue; }
    const levels = pivotLevels(prev.highPaise, prev.lowPaise, prev.closePaise);
    const bars = rows.filter((r) => r.expiry === expiry && r.strike === atm && r.right === kind).sort((a, b) => a.time - b.time);
    console.log(`  ${atm} ${kind}  prev ${prevDay} H ${rs(prev.highPaise)} L ${rs(prev.lowPaise)} C ${rs(prev.closePaise)}  levels ${levels.map((l) => `${l.name} ${rs(l.paise)}`).join(', ')}`);
    console.log(`    ${bars.length} minutes, open ${bars[0]?.open} → close ${bars.at(-1)?.close}, low ${Math.min(...bars.map((b) => b.low))}, high ${Math.max(...bars.map((b) => b.high))}`);
    for (const version of ['fixed', 'ladder'] as const) {
      const s = newSim(version);
      for (const b of bars) {
        const pt: Point = { time: b.time, minute: minuteOf(b.time), open: Math.round(b.open * 100), high: Math.round(b.high * 100), low: Math.round(b.low * 100), last: Math.round(b.close * 100), bid: Math.round(b.bid * 100), ask: Math.round(b.ask * 100), tick: false };
        stepSim(s, levels, DEFAULT_PIVOT_CFG, pt);
      }
      if (s.open && bars.length) forceClose(s, bars.at(-1)!.time, Math.round(bars.at(-1)!.close * 100), 'time');
      for (const t of s.trades as PivotTrade[]) {
        const gross = (t.exitPaise! - t.entryPaise) * lot;
        const ch = computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: t.entryPaise, date: day }).total + computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: t.exitPaise!, date: day }).total;
        add(`${version} ${kind}`, gross - ch); add(version, gross - ch);
        console.log(`    ${version.padEnd(6)} buy ${hhmm(t.entryAt)} at ${rs(t.entryPaise)} (crossed ${t.level})  sell ${hhmm(t.exitAt!)} at ${rs(t.exitPaise!)} ${t.why}${version === 'ladder' ? `, reached ${t.reached}` : ''}  ${(t.exitPaise! - t.entryPaise) >= 0 ? '+' : ''}${rs(t.exitPaise! - t.entryPaise)} pts  net ₹${((gross - ch) / 100).toFixed(0)}`);
      }
      if (!s.trades.length) console.log(`    ${version.padEnd(6)} no trade`);
    }
  }
}
function dateOf(t: number) { return new Date((t + IST) * 1000).toISOString().slice(0, 10); }
console.log('\nTotals (1 lot, after charges):');
for (const [k, t] of Object.entries(totals)) console.log(`  ${k.padEnd(10)} trades ${t.n}  won ${t.win}  net ₹${(t.net / 100).toFixed(0)}`);
await prisma.$disconnect();
