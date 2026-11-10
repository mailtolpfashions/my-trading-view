// The "blind buy" scan's two rules on 5-minute candles, traded intraday and replayed minute by minute:
//   signal: a 5-minute candle closes above the Ichimoku cloud top (9,26,52) AND Supertrend(7,3) crosses below the
//           close on that same candle (indicators run on the continuous 5-minute series, across days, as charting
//           sites do);
//   entry:  the open of the next 5-minute candle, 09:20 to 14:55; the first signal per stock per day only;
//   exit:   target +T / stop -S (points = rupees on the real traded price; also % targets), checked on 1-minute bars;
//           a minute touching both is unclear (shown both ways); otherwise the 14:59 close (every trade closed at 15:00; entries from 09:30).
//   chance: the same stock on the same day bought at a random 5-minute open between 09:20 and 14:55 (fixed seed),
//           same targets and stops: if the signal is worth anything it should beat this.
// Minute data: our Kite 1-minute store (NIFTY 500 + F&O stocks, about a year), real prices. Costs not included.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=4096 --import tsx scripts/research/blind-buy-5min.ts
import { readdir } from 'node:fs/promises';
import { Evaluator, parseFormula, resample } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';
import { fnoUnderlyings } from '../../src/fno/analytics';

// Any scan: SCAN="<formula>" (default: the blind-buy scan); FNO=1 keeps F&O stocks only; TF=15m|1h runs it on
// that candle size instead of 5 minutes; SHORT=1 sells instead of buys (target below the entry, stop above).
const TF = (process.env.TF ?? '5m') as '5m' | '15m' | '1h';
const SHORT = !!process.env.SHORT;
/** The owner's window: no entries before 09:30, every trade closed at 15:00 (minutes after midnight, IST). */
const START = 570, EXIT = 900;
const FORMULA = process.env.SCAN ?? 'CROSSOVER(CLOSE, MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))) AND CROSSUNDER(SUPERTREND(7, 3), CLOSE)';
const POINTS: [number, number][] = [[10, 10], [20, 10], [20, 20], [30, 10], [30, 20], [30, 30]];
const PCTS: [number, number][] = [[0.005, 0.005], [0.01, 0.005], [0.01, 0.01], [0.02, 0.01]];
const p = parseFormula(FORMULA);
if (!p.ok) throw new Error(p.error);
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
let seed = 42;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/** One trade: minutes from the entry minute to 15:14 of that day. */
type Trade = { sym: string; date: string; time: string; entry: number; path: { h: number; l: number; c: number }[] };
const signals: Trade[] = [], chance: Trade[] = [];
const store = new MinuteStore();
const fno = process.env.FNO ? new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol)) : null;
const syms = (await readdir(store.dir)).filter((x) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(x) && (!fno || fno.has(x)));
let from = '9999', to = '0000';
const tradeFrom = (sym: string, mins: Candle[], at: number): Trade | null => {
  const d = dateOfIst(mins[at].time), path: Trade['path'] = [];
  for (let k = at; k < mins.length && dateOfIst(mins[k].time) === d && ist(mins[k].time) < EXIT; k++) path.push({ h: mins[k].high, l: mins[k].low, c: mins[k].close });
  if (path.length < 2 || ist(mins[at + path.length - 1].time) < EXIT - 5) return null;
  const m = ist(mins[at].time);
  return { sym, date: d, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, entry: mins[at].open, path };
};
for (const s of syms) {
  const all = (await store.read(s, 0)).filter((b) => { const m = ist(b.time); return m >= 555 && m <= 929; });
  if (all.length < 5000) continue;
  const minuteAt = new Map(all.map((b, i) => [b.time, i]));
  const five = resample(all, TF);
  const ser = new Evaluator((tf) => (tf === TF ? five : null)).series(p.node, TF);
  const seen = new Set<string>(), days = new Map<string, number[]>(); // date -> minute indexes of 5-min opens 09:20-14:55
  for (let k = 0; k < five.length; k++) {
    const m = ist(five[k].time), d = dateOfIst(five[k].time), i = minuteAt.get(five[k].time);
    if (i == null || m < START || m > EXIT - 5) continue;
    (days.get(d) ?? days.set(d, []).get(d)!).push(i);
  }
  for (let k = 1; k < five.length; k++) {
    if (ser[k - 1] !== 1) continue; // the previous 5-minute candle closed with the signal: enter at this one's open
    const m = ist(five[k].time), d = dateOfIst(five[k].time);
    if (m < START || m > EXIT - 5 || seen.has(d) || dateOfIst(five[k - 1].time) !== d) continue;
    const i = minuteAt.get(five[k].time);
    if (i == null) continue;
    const t = tradeFrom(s, all, i);
    if (!t) continue;
    seen.add(d);
    signals.push(t);
    if (d < from) from = d;
    if (d > to) to = d;
    const opens = days.get(d)!;
    const c = tradeFrom(s, all, opens[Math.floor(rand() * opens.length)]);
    if (c) chance.push(c);
  }
}

type R = { win: number; loss: number; out: number; unclear: number; sum: number; sumBest: number };
function run(list: Trade[], tgt: (t: Trade) => number, stp: (t: Trade) => number, unit: (t: Trade, x: number) => number): R {
  const r: R = { win: 0, loss: 0, out: 0, unclear: 0, sum: 0, sumBest: 0 };
  for (const t of list) {
    const T = tgt(t), S = stp(t);
    let done = false;
    for (const b of t.path) {
      const hitT = SHORT ? b.l <= t.entry - T : b.h >= t.entry + T, hitS = SHORT ? b.h >= t.entry + S : b.l <= t.entry - S;
      if (hitT && hitS) { r.unclear++; r.loss++; r.sum -= unit(t, S); r.sumBest += unit(t, T); done = true; break; }
      if (hitS) { r.loss++; r.sum -= unit(t, S); r.sumBest -= unit(t, S); done = true; break; }
      if (hitT) { r.win++; r.sum += unit(t, T); r.sumBest += unit(t, T); done = true; break; }
    }
    if (!done) { const x = unit(t, (SHORT ? -1 : 1) * (t.path.at(-1)!.c - t.entry)); r.out++; r.sum += x; r.sumBest += x; }
  }
  return r;
}
const pctOf = (n: number, d: number) => `${((n / (d || 1)) * 100).toFixed(1)}%`;
const line = (label: string, list: Trade[], r: R, unitWord: string, digits: number) =>
  `${label.padEnd(22)} ${pctOf(r.win, list.length).padStart(7)} ${pctOf(r.loss, list.length).padStart(7)} ${pctOf(r.out, list.length).padStart(8)}   ${(r.sum / (list.length || 1)).toFixed(digits).padStart(7)} to ${(r.sumBest / (list.length || 1)).toFixed(digits).padStart(6)} ${unitWord}`;

console.log(`${SHORT ? 'SELL' : 'BUY'} on ${TF} candles: ${FORMULA}${fno ? ` (F&O stocks only: ${syms.length} with minute data)` : ''}`);
console.log(`${signals.length} signal trades (first per stock per day), ${from} -> ${to}; ${chance.length} random-time trades for comparison`);
const hours = new Map<string, number>();
for (const t of signals) hours.set(t.time.slice(0, 2), (hours.get(t.time.slice(0, 2)) ?? 0) + 1);
console.log('entries by hour: ' + [...hours].sort().map(([h, n]) => `${h}:00 ${n}`).join(', '));
console.log('\n                       target   stop  neither   avg per trade (unclear = loss .. = win)');
for (const [T, S] of POINTS) {
  const pts = (t: Trade, x: number) => x;
  console.log(`--- target ${T} pts, stop ${S} pts`);
  console.log(line('  signal', signals, run(signals, () => T, () => S, pts), 'pts', 2));
  console.log(line('  random time (chance)', chance, run(chance, () => T, () => S, pts), 'pts', 2));
}
for (const [T, S] of PCTS) {
  const pc = (t: Trade, x: number) => (x / t.entry) * 100;
  console.log(`--- target ${T * 100}%, stop ${S * 100}%`);
  console.log(line('  signal', signals, run(signals, (t) => t.entry * T, (t) => t.entry * S, pc), '%', 3));
  console.log(line('  random time (chance)', chance, run(chance, (t) => t.entry * T, (t) => t.entry * S, pc), '%', 3));
}
const show = (t: Trade) => `${t.date} ${t.time} ${t.sym} @₹${t.entry}`;
const sorted = [...signals].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
console.log('\nfirst:', sorted.slice(0, 3).map(show).join(' | '));
console.log('last: ', sorted.slice(-3).map(show).join(' | '));
