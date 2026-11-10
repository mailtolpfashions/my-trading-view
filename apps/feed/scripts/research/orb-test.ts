// Price action: opening-range breakout, buy only, F&O stocks, replayed minute by minute on our Kite data.
//   range:  high and low of 09:15-09:29 (no trades in the first 15 minutes);
//   signal: 09:30-14:55, the first 5-minute candle that closes above the range high with volume above the average
//           of the previous 20 five-minute candles; entry at that candle's close time (the next minute's open);
//   exits:  A) target +20 pts, stop -10 pts;  B) stop at the range low, target 2x that risk;  closed at 15:00;
//           a minute touching both counts as the stop (strict);
//   chance: every stock-day (not only breakout days, which are mostly up days), bought at a random 5-minute open
//           from 09:30 to 14:55 with the same exits.
// Costs not included. Run: npx dotenv -e ../../.env -- node --max-old-space-size=4096 --import tsx scripts/research/orb-test.ts
import { readdir } from 'node:fs/promises';
import { resample } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { fnoUnderlyings } from '../../src/fno/analytics';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

/** The owner's window: entries from 09:30, every trade closed at 15:00. */
const EXIT = 900;
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
let seed = 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
type Exit = { tgt: number; stp: number }; // prices
type Trade = { entry: number; path: Candle[]; a: Exit; b: Exit | null; month: string };

function play(t: Trade, e: Exit): number {
  for (const b of t.path) {
    if (b.low <= e.stp) return e.stp - t.entry;
    if (b.high >= e.tgt) return e.tgt - t.entry;
  }
  return t.path.at(-1)!.close - t.entry;
}

const fno = new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol));
const store = new MinuteStore();
const syms = (await readdir(store.dir)).filter((x) => fno.has(x));
const sig: Trade[] = [], rnd: Trade[] = [];
let days = 0, from = '9999', to = '0000';
for (const s of syms) {
  const all = (await store.read(s, 0)).filter((b) => { const m = ist(b.time); return m >= 555 && m <= 929; });
  const five = resample(all, '5m');
  const byDay = new Map<string, number[]>(); // date -> indexes into five
  five.forEach((b, i) => { const d = dateOfIst(b.time); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(i); });
  const mins = new Map<string, Candle[]>();
  for (const b of all) { const d = dateOfIst(b.time); (mins.get(d) ?? mins.set(d, []).get(d)!).push(b); }
  for (const [d, idx] of byDay) {
    const m = mins.get(d)!;
    if (ist(m[0].time) !== 555 || ist(m.at(-1)!.time) < 900) continue;
    days++;
    const or = m.filter((b) => ist(b.time) < 570);
    if (or.length < 10) continue;
    const hi = Math.max(...or.map((b) => b.high)), lo = Math.min(...or.map((b) => b.low));
    const pathFrom = (minute: number) => m.filter((b) => ist(b.time) >= minute && ist(b.time) < EXIT);
    const make = (minute: number): Trade | null => {
      const path = pathFrom(minute);
      if (path.length < 2) return null;
      const entry = path[0].open, risk = entry - lo;
      return { entry, path, a: { tgt: entry + 20, stp: entry - 10 }, b: risk > 0 ? { tgt: entry + 2 * risk, stp: lo } : null, month: d.slice(0, 7) };
    };
    const slots = idx.filter((i) => { const t = ist(five[i].time); return t >= 570 && t < EXIT - 5; });
    if (slots.length) { const r = make(ist(five[slots[Math.floor(rand() * slots.length)]].time)); if (r) rnd.push(r); }
    for (const i of slots) {
      const b = five[i], closeAt = ist(b.time) + 5;
      if (i < 20 || b.close <= hi || closeAt >= EXIT) continue;
      const avgVol = five.slice(i - 20, i).reduce((a, x) => a + x.volume, 0) / 20;
      if (b.volume <= avgVol) continue;
      const t = make(closeAt);
      if (!t) break;
      sig.push(t);
      if (d < from) from = d;
      if (d > to) to = d;
      break;
    }
  }
}

const sum = (list: Trade[], which: 'a' | 'b') => {
  const used = list.filter((t) => t[which]);
  const res = used.map((t) => play(t, t[which]!));
  const pct = used.map((t, i) => (res[i] / t.entry) * 100);
  const win = res.filter((x) => x > 0).length;
  return { n: used.length, pts: res.reduce((a, b) => a + b, 0) / (used.length || 1), pct: pct.reduce((a, b) => a + b, 0) / (used.length || 1), win: (win / (used.length || 1)) * 100, res, used };
};
console.log(`${sig.length} breakout trades on ${days} stock-days (${syms.length} F&O stocks), ${from} -> ${to}\n`);
for (const [w, label] of [['a', 'A) target 20 pts, stop 10 pts'], ['b', 'B) stop at range low, target 2x risk']] as const) {
  const s = sum(sig, w), r = sum(rnd, w);
  console.log(label);
  console.log(`  breakout:     ${s.n} trades, ended in profit ${s.win.toFixed(1)}%, avg ${s.pts >= 0 ? '+' : ''}${s.pts.toFixed(2)} pts (${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(3)}%)`);
  console.log(`  random time:  ${r.n} trades, ended in profit ${r.win.toFixed(1)}%, avg ${r.pts >= 0 ? '+' : ''}${r.pts.toFixed(2)} pts (${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(3)}%)`);
  const months = [...new Set(s.used.map((t) => t.month))].sort();
  const good = months.filter((mo) => { const xs = s.used.map((t, i) => (t.month === mo ? (s.res[i] / t.entry) * 100 : null)).filter((x): x is number => x != null); return xs.reduce((a, b) => a + b, 0) > 0; }).length;
  console.log(`  months in profit (breakout): ${good} of ${months.length}\n`);
}
