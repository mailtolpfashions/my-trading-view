// Do the day-trader scanner skill's setups beat chance on NSE? Same rules as trader-scanner/scan.py, on our own
// split/bonus-adjusted NSE history (all equity shares, delisted ones included, so no survivorship bias).
//
//  A. The five daily setups (closes only): breakout_20d, bull_flag, reclaim_ma20, oversold, oversold_bounce.
//     Liquidity as the skill: close >= 5 and volume >= 1,000,000 shares on the signal day.
//     Outcomes (the signal is known after the close; the trade is the next session):
//       next day open -> close (a day trade, as the skill is used) and next 5 sessions close -> close (swing).
//     Each compared with the same day's average over every liquid stock (the market's own move), so a setup only
//     counts if it beats the crowd, not just a rising market. Year by year.
//  B. The opening-range breakout on the last year of 1-minute bars (NIFTY 500 + F&O stocks, current list):
//     range 09:15-09:30, entry = first 5-minute close above the range high between 09:30 and 15:00 (the NSE
//     defaults), stop at the range midpoint, target 2R, flat at 15:15. Stop checked first in a bar. Month by month.
//     Costs: an ESTIMATE of 0.06% of the trade value round trip (brokerage, STT, exchange, GST, stamp) is shown
//     separately from the gross result.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/scanner-setups.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

const MIN_PRICE = 5, MIN_VOL = 1_000_000, COST = 0.0006;
const out: Record<string, unknown> = {};

// ---------------------------------------------------------------- A. daily setups
console.time('load');
await loadEod(() => {});
console.timeEnd('load');
const symbols = allEquityShareSymbols();
type Ev = { setup: string; date: string; next: number; fwd5: number | null };
const events: Ev[] = [];
const dayAll = new Map<string, { sum: number; n: number; sum5: number; n5: number }>(); // the crowd, per signal day
const rsiSeries = (c: number[]) => {
  const r: (number | null)[] = c.map(() => null);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= 14) { g += up / 14; l += dn / 14; if (i === 14) r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    else { g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return r;
};
let used = 0;
for (const s of symbols) {
  const h = dailyHistory(s);
  if (!h || h.candles.length < 40) continue;
  used++;
  const k = h.candles, c = k.map((x) => x.close), rsi = rsiSeries(c);
  for (let i = 30; i < k.length - 1; i++) {
    if (!(c[i] >= MIN_PRICE && k[i].volume >= MIN_VOL)) continue;
    const date = dateOfIst(k[i].time), nx = k[i + 1];
    if (!(nx.open > 0)) continue;
    const next = nx.close / nx.open - 1;
    const fwd5 = i + 5 < k.length ? c[i + 5] / c[i] - 1 : null;
    const d = dayAll.get(date) ?? { sum: 0, n: 0, sum5: 0, n5: 0 };
    d.sum += next; d.n++;
    if (fwd5 != null) { d.sum5 += fwd5; d.n5++; }
    dayAll.set(date, d);
    const last = c[i], hi20 = Math.max(...c.slice(i - 20, i));
    const ma = (j: number) => c.slice(j - 19, j + 1).reduce((a, b) => a + b, 0) / 20;
    const run = c[i - 5] / c[i - 15] - 1, w = c.slice(i - 4, i + 1), rng5 = (Math.max(...w) - Math.min(...w)) / last;
    const tags: string[] = [];
    if (last > hi20) tags.push('breakout_20d');
    if (run > 0.10 && rng5 < 0.05) tags.push('bull_flag');
    if (c[i - 1] < ma(i - 1) && last > ma(i)) tags.push('reclaim_ma20');
    if (rsi[i] != null && rsi[i]! < 30) tags.push('oversold');
    if (rsi[i - 1] != null && rsi[i - 1]! < 30 && last > c[i - 1]) tags.push('oversold_bounce');
    for (const t of tags) events.push({ setup: t, date, next, fwd5 });
  }
}
console.log(`stocks with history ${used} of ${symbols.length}; liquid stock-days ${[...dayAll.values()].reduce((a, d) => a + d.n, 0)}; setup events ${events.length}`);

const SETUPS = ['breakout_20d', 'bull_flag', 'reclaim_ma20', 'oversold', 'oversold_bounce'];
const stat = (xs: number[]) => {
  const n = xs.length, m = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: m, t: sd ? m / (sd / Math.sqrt(n)) : 0 };
};
const pc = (x: number, d = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const daily: Record<string, unknown> = {};
console.log('\n=== A. Daily setups vs the same day\'s average liquid stock (excess). t > 2 or < -2 = unlikely to be chance (days overlap, so treat t as rough) ===');
console.log('setup'.padEnd(17) + 'events'.padStart(8) + '   next day O->C: won  setup  crowd  excess   t' + '      5 days: setup   crowd  excess   t');
for (const s of SETUPS) {
  const ev = events.filter((e) => e.setup === s);
  const exNext = ev.map((e) => e.next - dayAll.get(e.date)!.sum / dayAll.get(e.date)!.n);
  const ev5 = ev.filter((e) => e.fwd5 != null);
  const ex5 = ev5.map((e) => e.fwd5! - dayAll.get(e.date)!.sum5 / dayAll.get(e.date)!.n5);
  const won = ev.filter((e) => e.next > 0).length / Math.max(1, ev.length);
  const a = stat(ev.map((e) => e.next)), x = stat(exNext), b = stat(ev5.map((e) => e.fwd5!)), y = stat(ex5);
  console.log(s.padEnd(17) + String(ev.length).padStart(8) + `   ${(won * 100).toFixed(1).padStart(16)}% ${pc(a.mean).padStart(7)} ${pc(a.mean - x.mean).padStart(6)} ${pc(x.mean).padStart(7)} ${x.t.toFixed(1).padStart(5)}` +
    `      ${pc(b.mean).padStart(7)} ${pc(b.mean - y.mean).padStart(7)} ${pc(y.mean).padStart(7)} ${y.t.toFixed(1).padStart(5)}`);
  const years: Record<string, unknown> = {};
  for (const yr of [...new Set(ev.map((e) => e.date.slice(0, 4)))].sort()) {
    const e2 = ev.filter((e) => e.date.startsWith(yr));
    const xs = e2.map((e) => e.next - dayAll.get(e.date)!.sum / dayAll.get(e.date)!.n);
    const e25 = e2.filter((e) => e.fwd5 != null).map((e) => e.fwd5! - dayAll.get(e.date)!.sum5 / dayAll.get(e.date)!.n5);
    years[yr] = { n: e2.length, excessNext: stat(xs).mean, excess5: stat(e25).mean };
  }
  daily[s] = { events: ev.length, wonNext: won, next: a.mean, excessNext: x.mean, tNext: x.t, fwd5: b.mean, excess5: y.mean, t5: y.t, years };
}
console.log('\nYear by year, excess next day O->C | excess 5 days (n):');
const yrs = [...new Set(events.map((e) => e.date.slice(0, 4)))].sort();
console.log('year  ' + SETUPS.map((s) => s.padStart(26)).join(''));
for (const yr of yrs) console.log(yr + '  ' + SETUPS.map((s) => { const y = (daily[s] as { years: Record<string, { n: number; excessNext: number; excess5: number }> }).years[yr]; return y ? `${pc(y.excessNext)} | ${pc(y.excess5)} (${y.n})`.padStart(26) : '-'.padStart(26); }).join(''));
out.daily = daily;

// ---------------------------------------------------------------- B. opening-range breakout, 1-minute bars
const store = new MinuteStore();
const syms = (await import('node:fs/promises')).readdir(store.dir);
const list = (await syms).filter((x) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(x));
type Tr = { sym: string; date: string; r: number; ret: number; how: string };
const trades: Tr[] = [];
let days = 0, noTrigger = 0;
const hm = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
for (const s of list) {
  const bars = await store.read(s, Math.floor(Date.parse('2024-01-01') / 1000));
  const byDay = new Map<string, typeof bars>();
  for (const b of bars) { const m = hm(b.time); if (m < 555 || m >= 930) continue; (byDay.get(dateOfIst(b.time)) ?? byDay.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b); }
  for (const [date, mins] of byDay) {
    if (mins.length < 300) continue;
    mins.sort((a, b) => a.time - b.time);
    // 5-minute bars on the session grid
    const five = new Map<number, { o: number; h: number; l: number; c: number; start: number }>();
    for (const b of mins) { const slot = Math.floor((hm(b.time) - 555) / 5); const f = five.get(slot); if (!f) five.set(slot, { o: b.open, h: b.high, l: b.low, c: b.close, start: slot }); else { f.h = Math.max(f.h, b.high); f.l = Math.min(f.l, b.low); f.c = b.close; } }
    const or = [0, 1, 2].map((k) => five.get(k));
    if (or.some((x) => !x) || or[0]!.o < MIN_PRICE) continue;
    days++;
    const oh = Math.max(...or.map((x) => x!.h)), ol = Math.min(...or.map((x) => x!.l));
    let entry: number | null = null, at = -1;
    for (let k = 3; k < 69; k++) { const f = five.get(k); if (f && f.c > oh) { entry = f.c; at = k; break; } } // closes by 15:00 (bar 68 ends 15:00)
    if (entry == null) { noTrigger++; continue; }
    const stop = Math.floor(((oh + ol) / 2) * 100) / 100, risk = entry - stop;
    if (!(risk > entry * 0.0005)) continue; // the skill refuses a stop inside 0.05% of the price
    const target = entry + 2 * risk;
    let exit = entry, how = 'flat 15:15';
    for (let k = at + 1; k < 72; k++) { // to the bar ending 15:15
      const f = five.get(k);
      if (!f) continue;
      if (f.l <= stop) { exit = stop; how = 'stop'; break; }
      if (f.h >= target) { exit = target; how = 'target'; break; }
      exit = f.c;
    }
    trades.push({ sym: s, date, r: (exit - entry) / risk, ret: exit / entry - 1, how });
  }
}
const sr = stat(trades.map((t) => t.r)), sret = stat(trades.map((t) => t.ret));
const won = trades.filter((t) => t.ret > 0).length / Math.max(1, trades.length);
console.log(`\n=== B. Opening-range breakout, ${list.length} stocks, ${days} stock-days, ${trades.length} trades (${noTrigger} days without a trigger) ===`);
console.log(`won ${(won * 100).toFixed(1)}% · avg R ${sr.mean.toFixed(3)} (t ${sr.t.toFixed(1)}) · avg return gross ${pc(sret.mean, 3)} · after the ESTIMATED 0.06% costs ${pc(sret.mean - COST, 3)}`);
console.log(`exits: target ${trades.filter((t) => t.how === 'target').length}, stop ${trades.filter((t) => t.how === 'stop').length}, flat at 15:15 ${trades.filter((t) => t.how === 'flat 15:15').length}`);
console.log('month     trades  won    avg R   gross    after est. costs');
const months: Record<string, unknown> = {};
for (const m of [...new Set(trades.map((t) => t.date.slice(0, 7)))].sort()) {
  const tm = trades.filter((t) => t.date.startsWith(m)), a = stat(tm.map((t) => t.r)), b = stat(tm.map((t) => t.ret));
  const w = tm.filter((t) => t.ret > 0).length / tm.length;
  console.log(`${m}  ${String(tm.length).padStart(6)}  ${(w * 100).toFixed(0).padStart(3)}%  ${a.mean.toFixed(3).padStart(6)}  ${pc(b.mean, 3).padStart(7)}  ${pc(b.mean - COST, 3).padStart(7)}`);
  months[m] = { trades: tm.length, won: w, avgR: a.mean, gross: b.mean, net: b.mean - COST };
}
out.orb = { stocks: list.length, stockDays: days, trades: trades.length, noTrigger, won, avgR: sr.mean, tR: sr.t, gross: sret.mean, netEstimate: sret.mean - COST, months };

const OUT = path.resolve(import.meta.dirname, '../../.data/research');
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'scanner-setups.json'), JSON.stringify(out, null, 1));
console.log('\nwritten .data/research/scanner-setups.json');
await prisma.$disconnect();
