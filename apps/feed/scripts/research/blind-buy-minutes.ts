// The "blind buy" Chartink scan, traded the way intraday traders do, replayed minute by minute:
//   signal: the scan's two daily rules on the last daily close (Close crosses above the Ichimoku cloud top AND
//           Supertrend(7,3) crosses below Close);
//   trade:  next morning, buy at the 09:15 open; target +T points, stop -S points (points = rupees on that stock's
//           real traded price, from our Kite minute bars); whichever is touched first ends the trade; if neither,
//           exit at the 15:14 minute's close (flat by 15:15).
//   A minute whose range touches both the target and the stop cannot say which came first: counted as the stop,
//   and shown the other way too (as the target) so the true answer lies between the two.
// Minute data: our Kite 1-minute store (NIFTY 500 + F&O stocks, about a year). Costs not included.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/blind-buy-minutes.ts
import { prisma } from '@mtv/db';
import { Evaluator, parseFormula } from '@mtv/rules';
import { dailyHistory, loadEod } from '../../src/eod/store';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';
import { readdir } from 'node:fs/promises';
import { fnoUnderlyings } from '../../src/fno/analytics';

// SCAN="<formula>" any daily scan (default: the blind-buy scan); FNO=1 F&O stocks only; SHORT=1 sells at the open.
const FORMULA = process.env.SCAN ?? 'CROSSOVER(CLOSE, MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))) AND CROSSUNDER(SUPERTREND(7, 3), CLOSE)';
const SHORT = !!process.env.SHORT;
const TARGETS = [10, 20, 30], STOPS = [10, 20, 30];
const p = parseFormula(FORMULA);
if (!p.ok) throw new Error(p.error);
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

await loadEod(() => {});
const store = new MinuteStore();
const fno = process.env.FNO ? new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol)) : null;
const syms = (await readdir(store.dir)).filter((x) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(x) && (!fno || fno.has(x)));
type Day = { sym: string; date: string; open: number; bars: { h: number; l: number; c: number }[] };
const days: Day[] = [];
let firstMinute = '9999';
for (const s of syms) {
  const c = dailyHistory(s)?.candles;
  if (!c || c.length < 120) continue;
  const ser = new Evaluator(() => c).series(p.node, 'D');
  const wanted = new Set<string>();
  for (let i = 60; i + 1 < c.length; i++) if (ser[i] === 1) wanted.add(dateOfIst(c[i + 1].time));
  if (!wanted.size) continue;
  const minutes = await store.read(s, 0);
  if (minutes.length && dateOfIst(minutes[0].time) < firstMinute) firstMinute = dateOfIst(minutes[0].time);
  const byDay = new Map<string, typeof minutes>();
  for (const b of minutes) { const d = dateOfIst(b.time); if (wanted.has(d)) (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(b); }
  for (const [d, list] of byDay) {
    const session = list.filter((b) => { const m = ist(b.time); return m >= 555 && m <= 914; });
    if (!session.length || ist(session[0].time) !== 555 || ist(session.at(-1)!.time) < 900) continue; // need the 09:15 open and a full day
    days.push({ sym: s, date: d, open: session[0].open, bars: session.map((b) => ({ h: b.high, l: b.low, c: b.close })) });
  }
}
days.sort((a, b) => a.date.localeCompare(b.date));
console.log(`${SHORT ? 'SELL' : 'BUY'} next morning, daily scan: ${FORMULA}`);
console.log(`minute data from ${firstMinute}; ${days.length} signal days with full minute data, ${days[0]?.date} -> ${days.at(-1)?.date}`);
console.log(`stock price at entry: median ₹${[...days].sort((a, b) => a.open - b.open)[Math.floor(days.length / 2)]?.open.toFixed(0)}\n`);

type R = { win: number; loss: number; timeOut: number; both: number; pts: number };
function run(list: Day[], T: number, S: number, unclearWins = false): R {
  const r: R = { win: 0, loss: 0, timeOut: 0, both: 0, pts: 0 };
  for (const d of list) {
    const tgt = SHORT ? d.open - T : d.open + T, stp = SHORT ? d.open + S : d.open - S;
    let done = false;
    for (const b of d.bars) {
      const hitT = SHORT ? b.l <= tgt : b.h >= tgt, hitS = SHORT ? b.h >= stp : b.l <= stp;
      if (hitT && hitS) { r.both++; if (unclearWins) { r.win++; r.pts += T; } else { r.loss++; r.pts -= S; } done = true; break; }
      if (hitS) { r.loss++; r.pts -= S; done = true; break; }
      if (hitT) { r.win++; r.pts += T; done = true; break; }
    }
    if (!done) { r.timeOut++; r.pts += (SHORT ? -1 : 1) * (d.bars.at(-1)!.c - d.open); }
  }
  return r;
}
const table = (title: string, list: Day[]) => {
  console.log(`${title} (${list.length} trades)`);
  console.log('target  stop   target hit   stop hit   neither (15:15)   avg pts/trade   total pts   avg pts if unclear = target');
  for (const T of TARGETS) for (const S of STOPS) {
    const r = run(list, T, S), best = run(list, T, S, true), n = list.length || 1;
    console.log(`${String(T).padStart(6)}  ${String(S).padStart(4)}   ${((r.win / n) * 100).toFixed(1).padStart(9)}%  ${((r.loss / n) * 100).toFixed(1).padStart(8)}%  ${((r.timeOut / n) * 100).toFixed(1).padStart(15)}%  ${(r.pts / n).toFixed(2).padStart(14)}  ${r.pts.toFixed(0).padStart(10)}  ${(best.pts / n).toFixed(2).padStart(14)}${r.both ? `   (${r.both} unclear minutes counted as stop)` : ''}`);
  }
  console.log('');
};
table('All signal stocks', days);
table('Stock price under ₹500', days.filter((d) => d.open < 500));
table('Stock price ₹500 - ₹2,000', days.filter((d) => d.open >= 500 && d.open < 2000));
table('Stock price ₹2,000 and above', days.filter((d) => d.open >= 2000));
const show = (d: Day) => `${d.date} ${d.sym} open ₹${d.open}`;
console.log('first:', days.slice(0, 3).map(show).join(' | '));
console.log('last: ', days.slice(-3).map(show).join(' | '));
await prisma.$disconnect();
