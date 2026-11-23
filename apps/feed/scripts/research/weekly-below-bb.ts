// Backtest: whole weekly candle below the weekly lower Bollinger band (20, 2).
//   Weekly Close < LB, Open < LB, High < LB, Low < LB (High < LB implies the rest; all four are checked anyway).
//   Bands: SMA20 of weekly closes ± 2 × population stdev (TradingView's ta.stdev), on split/bonus-adjusted NSE history,
//   all equity shares incl. delisted (no survivorship). Liquid only: weekly close >= 20 and average daily traded value
//   over the signal week >= Rs 1 crore.
//   Signal known at the week's close -> buy the NEXT week's open. Only fresh signals count (previous week not a signal).
//   Outcomes: (a) hold 1/4/13/26/52 weeks to that week's close, vs the average liquid stock bought the same open;
//             (b) rule exit: first weekly close >= middle band (SMA20), else close after 52 weeks.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/weekly-below-bb.ts
import { prisma } from '@mtv/db';
import { resample } from '@mtv/rules';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';

const H = [1, 4, 13, 26, 52];
const MIN_PRICE = 20, MIN_VALUE = 1e7;
type Ev = { sym: string; date: string; entry: number; rets: (number | null)[]; rule: { ret: number; weeks: number; why: string } | null };
const evs: Ev[] = [];
const crowd = H.map(() => new Map<string, [number, number]>()); // entry week -> sum, n
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const now: string[] = [];

await loadEod(() => {});
let stocks = 0;
for (const s of allEquityShareSymbols()) {
  const hist = dailyHistory(s);
  if (!hist || hist.candles.length < 150) continue;
  stocks++;
  const d = hist.candles;
  const W = resample(d, 'W');
  // traded value per week (approx: close × volume per day)
  const val = new Map<number, [number, number]>();
  { let wi = 0; for (const k of d) { while (wi + 1 < W.length && W[wi + 1].time <= k.time) wi++; const v = val.get(wi) ?? [0, 0]; v[0] += k.close * k.volume; v[1]++; val.set(wi, v); } }
  const liquid = W.map((w, i) => { const v = val.get(i); return !!v && w.close >= MIN_PRICE && v[0] / v[1] >= MIN_VALUE; });
  const mid: number[] = [], lb: number[] = [];
  for (let i = 0; i < W.length; i++) {
    if (i < 19) { mid.push(NaN); lb.push(NaN); continue; }
    let m = 0; for (let j = i - 19; j <= i; j++) m += W[j].close; m /= 20;
    let v = 0; for (let j = i - 19; j <= i; j++) v += (W[j].close - m) ** 2;
    mid.push(m); lb.push(m - 2 * Math.sqrt(v / 20));
  }
  const sig = W.map((w, i) => !isNaN(lb[i]) && w.close < lb[i] && w.open < lb[i] && w.high < lb[i] && w.low < lb[i]);
  // crowd: every liquid stock bought at next week's open
  for (let i = 19; i + 1 < W.length; i++) if (liquid[i]) {
    const date = dateOfIst(W[i + 1].time);
    H.forEach((h, k) => { const x = W[i + h]; if (!x) return; const m = crowd[k].get(date) ?? [0, 0]; m[0] += x.close / W[i + 1].open - 1; m[1]++; crowd[k].set(date, m); });
  }
  for (let i = 20; i < W.length; i++) {
    if (!sig[i] || sig[i - 1] || !liquid[i]) continue;
    if (i + 1 >= W.length) { now.push(s); continue; }
    const entry = W[i + 1].open;
    const rets = H.map((h) => (W[i + h] ? W[i + h].close / entry - 1 : null));
    let rule: Ev['rule'] = null;
    for (let j = i + 1; j < W.length; j++) {
      if (W[j].close >= mid[j]) { rule = { ret: W[j].close / entry - 1, weeks: j - i, why: 'mid' }; break; }
      if (j - i >= 52) { rule = { ret: W[j].close / entry - 1, weeks: 52, why: 'time' }; break; }
    }
    evs.push({ sym: s, date: dateOfIst(W[i + 1].time), entry, rets, rule });
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const med = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; };
console.log(`${stocks} stocks, ${evs.length} fresh signals, ${evs[0] ? evs.map((e) => e.date).sort()[0] : '-'} -> ${evs.map((e) => e.date).sort().at(-1)}`);
console.log('\nFixed hold (buy next week open)\nweeks  n      avg     median  win%   crowd   excess  years better');
H.forEach((h, k) => {
  const l = evs.filter((e) => e.rets[k] != null && crowd[k].has(e.date));
  const r = l.map((e) => e.rets[k]!), c = l.map((e) => { const m = crowd[k].get(e.date)!; return m[0] / m[1]; });
  const ex = r.map((x, i) => x - c[i]);
  const years = [...new Set(l.map((e) => e.date.slice(0, 4)))].sort();
  const better = years.filter((y) => mean(l.map((e, i) => (e.date.startsWith(y) ? ex[i] : NaN)).filter((v) => !isNaN(v))) > 0).length;
  console.log(`${String(h).padStart(4)} ${String(l.length).padStart(5)}  ${pc(mean(r)).padStart(7)}  ${pc(med(r)).padStart(7)}  ${(100 * r.filter((x) => x > 0).length / r.length).toFixed(0).padStart(4)}  ${pc(mean(c)).padStart(7)}  ${pc(mean(ex)).padStart(7)}  ${better}/${years.length}`);
});

const ru = evs.filter((e) => e.rule).map((e) => e.rule!);
console.log(`\nRule exit (weekly close back at middle band, max 52 weeks): n ${ru.length}, avg ${pc(mean(ru.map((r) => r.ret)))}, median ${pc(med(ru.map((r) => r.ret)))}, win ${(100 * ru.filter((r) => r.ret > 0).length / ru.length).toFixed(0)}%, avg hold ${mean(ru.map((r) => r.weeks)).toFixed(1)} wk, hit mid ${ru.filter((r) => r.why === 'mid').length}, timed out ${ru.filter((r) => r.why === 'time').length}`);
const worst = evs.filter((e) => e.rule).sort((a, b) => a.rule!.ret - b.rule!.ret).slice(0, 5);
console.log('worst rule trades:', worst.map((e) => `${e.sym} ${e.date} ${pc(e.rule!.ret)}`).join(', '));

console.log('\nBy year (13-week hold / rule exit)\nyear  n     13w avg  13w excess  rule avg  rule win%');
const years = [...new Set(evs.map((e) => e.date.slice(0, 4)))].sort();
for (const y of years) {
  const l = evs.filter((e) => e.date.startsWith(y));
  const l13 = l.filter((e) => e.rets[2] != null && crowd[2].has(e.date));
  const r13 = l13.map((e) => e.rets[2]!), x13 = l13.map((e) => { const m = crowd[2].get(e.date)!; return e.rets[2]! - m[0] / m[1]; });
  const rr = l.filter((e) => e.rule).map((e) => e.rule!.ret);
  console.log(`${y}  ${String(l.length).padStart(4)}  ${l13.length ? pc(mean(r13)).padStart(7) : '      -'}  ${l13.length ? pc(mean(x13)).padStart(9) : '        -'}  ${rr.length ? pc(mean(rr)).padStart(8) : '       -'}  ${rr.length ? (100 * rr.filter((x) => x > 0).length / rr.length).toFixed(0).padStart(6) : '     -'}`);
}
const first = [...evs].sort((a, b) => a.date.localeCompare(b.date));
console.log('\nfirst trades:', first.slice(0, 3).map((e) => `${e.sym} ${e.date} @${e.entry.toFixed(2)}`).join(', '));
console.log('last trades:', first.slice(-3).map((e) => `${e.sym} ${e.date} @${e.entry.toFixed(2)}`).join(', '));
console.log(`matching on the latest week (no outcome yet): ${now.join(', ') || 'none'}`);
await prisma.$disconnect();
