// Check of a Chartink scan shared as "BLIND BUY ... ICHIMOKU GIVE 15% RETURNS WITH IN DAY":
//   Daily Close crossed above Daily Ichimoku Cloud Top (9,26,52)  AND  Daily Supertrend (7,3) crossed below Daily Close.
// As the post says to use it: the scan runs on the last daily close, buy at the next morning's open.
// Measured on that next day: best possible (open -> high), open -> close, how often the high reached +15%, and
// open -> close against the average liquid stock the same day; also the next 5 sessions (open -> close of day 5).
// NSE adjusted daily history 2011 -> today, all equity shares incl. delisted; liquid (close >= 5, volume >= 1 lakh
// shares on the signal day: a lower floor than our presets, since such posts are usually run on small stocks too).
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/blind-buy-check.ts
import { prisma } from '@mtv/db';
import { Evaluator, parseFormula } from '@mtv/rules';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';
import { fnoUnderlyings } from '../../src/fno/analytics';

// SCAN="<formula>" any daily scan (default: the blind-buy scan); FNO=1 today's F&O stocks only.
const FORMULA = process.env.SCAN ?? 'CROSSOVER(CLOSE, MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))) AND CROSSUNDER(SUPERTREND(7, 3), CLOSE)';
const p = parseFormula(FORMULA);
if (!p.ok) throw new Error(p.error);
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

await loadEod(() => {});
type T = { sym: string; date: string; best: number; oc: number; five: number; excess: number };
const crowd = new Map<string, [number, number]>(); // date -> open->close sum, n (liquid stocks)
const raw: Omit<T, 'excess'>[] = [];
const fno = process.env.FNO ? new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol)) : null;
for (const s of allEquityShareSymbols().filter((x) => !fno || fno.has(x))) {
  const c = dailyHistory(s)?.candles;
  if (!c || c.length < 120) continue;
  for (let i = 1; i < c.length; i++) if (c[i - 1].close >= 5 && c[i - 1].volume >= 100_000 && c[i].open > 0) {
    const d = dateOfIst(c[i].time), m = crowd.get(d) ?? [0, 0];
    m[0] += c[i].close / c[i].open - 1; m[1]++; crowd.set(d, m);
  }
  const ser = new Evaluator(() => c).series(p.node, 'D');
  for (let i = 60; i + 5 < c.length; i++) {
    if (ser[i] !== 1 || c[i].close < 5 || c[i].volume < 100_000) continue;
    const o = c[i + 1].open;
    if (!(o > 0)) continue;
    raw.push({ sym: s, date: dateOfIst(c[i + 1].time), best: c[i + 1].high / o - 1, oc: c[i + 1].close / o - 1, five: c[i + 5].close / o - 1 });
  }
}
const trades: T[] = raw.map((t) => { const m = crowd.get(t.date)!; return { ...t, excess: t.oc - m[0] / m[1] }; }).sort((a, b) => a.date.localeCompare(b.date));
const n = trades.length;
console.log(`formula: ${FORMULA}`);
console.log(`${n} signals, buy days ${trades[0]?.date} -> ${trades.at(-1)?.date}\n`);
console.log(`high reached +15% from the open:  ${trades.filter((t) => t.best >= 0.15).length} of ${n} (${((trades.filter((t) => t.best >= 0.15).length / n) * 100).toFixed(2)}%)`);
console.log(`high reached +5%:                 ${((trades.filter((t) => t.best >= 0.05).length / n) * 100).toFixed(1)}%`);
console.log(`best possible (open -> high):     mean ${pc(mean(trades.map((t) => t.best)))}  median ${pc(median(trades.map((t) => t.best)))}`);
console.log(`open -> close same day:           mean ${pc(mean(trades.map((t) => t.oc)))}  median ${pc(median(trades.map((t) => t.oc)))}  closed up ${((trades.filter((t) => t.oc > 0).length / n) * 100).toFixed(1)}%`);
console.log(`  vs the average stock that day:  mean ${pc(mean(trades.map((t) => t.excess)))}`);
console.log(`open -> close 5 sessions later:   mean ${pc(mean(trades.map((t) => t.five)))}  median ${pc(median(trades.map((t) => t.five)))}`);
console.log('\nyear   signals  hit15%  open->close  vs avg stock  closed up');
for (const y of [...new Set(trades.map((t) => t.date.slice(0, 4)))]) {
  const ts = trades.filter((t) => t.date.startsWith(y));
  console.log(`${y}  ${String(ts.length).padStart(8)}  ${String(ts.filter((t) => t.best >= 0.15).length).padStart(6)}  ${pc(mean(ts.map((t) => t.oc))).padStart(11)}  ${pc(mean(ts.map((t) => t.excess))).padStart(12)}  ${((ts.filter((t) => t.oc > 0).length / ts.length) * 100).toFixed(0).padStart(8)}%`);
}
const show = (t: T) => `${t.date} ${t.sym}: best ${pc(t.best)}, open->close ${pc(t.oc)}`;
console.log('\nfirst:', trades.slice(0, 3).map(show).join(' | '));
console.log('last: ', trades.slice(-3).map(show).join(' | '));
await prisma.$disconnect();
