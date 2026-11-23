// Trade rule on the weekly "whole candle below lower Bollinger band (20,2)" signal (see weekly-below-bb.ts).
//   Entry: buy stop at the signal week's high + 2%, filled on daily bars at max(open, trigger); order lives 4 weeks.
//   Target: weekly upper band (last completed week's value), filled at max(open, band) when a day's high reaches it.
//   Stop: close below the 200 SMA, two versions:
//     D = daily close below the daily 200 SMA (exit at that close)
//     W = weekly close below the weekly 200 SMA (exit at that close)
//   A trade is only taken if price is above that SMA when the order fills (prior close), otherwise the stop is already hit.
//   Open trades at the end of data are marked to the last close. Costs: 0.25% round trip (estimate: STT + charges).
//   Same liquidity as weekly-below-bb.ts. Compared with NIFTY over the same days.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/weekly-below-bb-trade.ts
import { prisma } from '@mtv/db';
import { resample } from '@mtv/rules';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';

const MIN_PRICE = 20, MIN_VALUE = 1e7, COST = 0.0025, VALID_WEEKS = 4;
type T = { sym: string; sig: string; buy: string; sell: string; entry: number; exit: number; ret: number; days: number; why: string; nifty: number };
const sma = (xs: number[], n: number) => { const o: number[] = []; let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i >= n) s -= xs[i - n]; o.push(i >= n - 1 ? s / n : NaN); } return o; };
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const med = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; };

await loadEod(() => {});
const nf = dailyHistory('NIFTY')!.candles;
const nfBy = new Map(nf.map((k) => [dateOfIst(k.time), k.close]));
const nfAt = (date: string) => { let v = nfBy.get(date); if (v) return v; for (const k of nf) if (dateOfIst(k.time) <= date) v = k.close; return v!; };

const trades: Record<'D' | 'W', T[]> = { D: [], W: [] };
const counts = { signals: 0, filled: 0, aboveD: 0, aboveW: 0 };
for (const s of allEquityShareSymbols()) {
  const hist = dailyHistory(s);
  if (!hist || hist.candles.length < 250) continue;
  const d = hist.candles, W = resample(d, 'W');
  const wk: number[] = []; { let wi = 0; for (const k of d) { while (wi + 1 < W.length && W[wi + 1].time <= k.time) wi++; wk.push(wi); } }
  const lastDayOfWeek = d.map((_, j) => j + 1 >= d.length ? false : wk[j + 1] !== wk[j]); // the final stored week may be partial: not closed
  const val = new Map<number, [number, number]>();
  d.forEach((k, j) => { const v = val.get(wk[j]) ?? [0, 0]; v[0] += k.close * k.volume; v[1]++; val.set(wk[j], v); });
  const wc = W.map((w) => w.close), mid = sma(wc, 20);
  const sd = wc.map((_, i) => { if (i < 19) return NaN; let v = 0; for (let j = i - 19; j <= i; j++) v += (wc[j] - mid[i]) ** 2; return Math.sqrt(v / 20); });
  const ub = mid.map((m, i) => m + 2 * sd[i]), lb = mid.map((m, i) => m - 2 * sd[i]);
  const dS = sma(d.map((k) => k.close), 200), wS = sma(wc, 200);
  const sig = W.map((w, i) => !isNaN(lb[i]) && w.high < lb[i]); // high < LB => open, close, low too
  const liquid = (i: number) => { const v = val.get(i); return !!v && W[i].close >= MIN_PRICE && v[0] / v[1] >= MIN_VALUE; };
  const firstDay = new Map<number, number>(); wk.forEach((w, j) => { if (!firstDay.has(w)) firstDay.set(w, j); });

  for (let i = 20; i + 1 < W.length; i++) {
    if (!sig[i] || sig[i - 1] || !liquid(i)) continue;
    counts.signals++;
    const trig = W[i].high * 1.02;
    let f = -1;
    for (let j = firstDay.get(i + 1) ?? d.length; j < d.length && wk[j] <= i + VALID_WEEKS; j++) if (d[j].high >= trig) { f = j; break; }
    if (f < 0) continue;
    counts.filled++;
    const entry = Math.max(d[f].open, trig) * (1 + COST / 2);
    for (const v of ['D', 'W'] as const) {
      const above = v === 'D' ? d[f - 1].close > dS[f - 1] : wc[wk[f] - 1] > wS[wk[f] - 1];
      if (!above) continue;
      counts[v === 'D' ? 'aboveD' : 'aboveW']++;
      let exit = NaN, x = d.length - 1, why = 'open';
      for (let j = f; j < d.length; j++) {
        const tgt = ub[wk[j] - 1];
        if (j > f && !isNaN(tgt) && d[j].high >= tgt) { exit = Math.max(d[j].open, tgt); x = j; why = 'target'; break; }
        if (v === 'D' && d[j].close < dS[j]) { exit = d[j].close; x = j; why = 'stop'; break; }
        if (v === 'W' && lastDayOfWeek[j] && wc[wk[j]] < wS[wk[j]]) { exit = d[j].close; x = j; why = 'stop'; break; }
      }
      if (why === 'open') exit = d[x].close;
      exit *= 1 - COST / 2;
      const buy = dateOfIst(d[f].time), sell = dateOfIst(d[x].time);
      trades[v].push({ sym: s, sig: dateOfIst(W[i].time), buy, sell, entry, exit, ret: exit / entry - 1, days: x - f, why, nifty: nfAt(sell) / nfAt(buy) - 1 });
    }
  }
}

console.log(`fresh signals ${counts.signals}, entry hit (high+2% within ${VALID_WEEKS} wk) ${counts.filled}, of which above daily 200 SMA ${counts.aboveD}, above weekly 200 SMA ${counts.aboveW}`);
for (const v of ['D', 'W'] as const) {
  const t = trades[v], r = t.map((x) => x.ret);
  const by = (w: string) => t.filter((x) => x.why === w);
  console.log(`\n== Stop: ${v === 'D' ? 'daily close < daily 200 SMA' : 'weekly close < weekly 200 SMA'} ==`);
  console.log(`trades ${t.length}  avg ${pc(mean(r))}  median ${pc(med(r))}  win ${(100 * r.filter((x) => x > 0).length / (r.length || 1)).toFixed(0)}%  avg hold ${mean(t.map((x) => x.days)).toFixed(0)} sessions  NIFTY same days ${pc(mean(t.map((x) => x.nifty)))}`);
  for (const w of ['target', 'stop', 'open']) { const l = by(w); if (l.length) console.log(`  ${w.padEnd(6)} ${String(l.length).padStart(4)}  avg ${pc(mean(l.map((x) => x.ret))).padStart(7)}  hold ${mean(l.map((x) => x.days)).toFixed(0)} sessions`); }
  console.log('  year  n    avg     win%  NIFTY');
  for (const y of [...new Set(t.map((x) => x.buy.slice(0, 4)))].sort()) {
    const l = t.filter((x) => x.buy.startsWith(y)), rr = l.map((x) => x.ret);
    console.log(`  ${y} ${String(l.length).padStart(3)}  ${pc(mean(rr)).padStart(7)}  ${(100 * rr.filter((x) => x > 0).length / rr.length).toFixed(0).padStart(4)}  ${pc(mean(l.map((x) => x.nifty))).padStart(7)}`);
  }
  const srt = [...t].sort((a, b) => a.ret - b.ret);
  console.log('  worst:', srt.slice(0, 3).map((x) => `${x.sym} ${x.buy} ${pc(x.ret)} (${x.why})`).join(', '));
  console.log('  best :', srt.slice(-3).map((x) => `${x.sym} ${x.buy} ${pc(x.ret)} (${x.why})`).join(', '));
  const byBuy = [...t].sort((a, b) => a.buy.localeCompare(b.buy));
  console.log('  first:', byBuy.slice(0, 2).map((x) => `${x.sym} sig ${x.sig} buy ${x.buy} @${x.entry.toFixed(2)} sell ${x.sell} @${x.exit.toFixed(2)} ${x.why}`).join(' | '));
  console.log('  last :', byBuy.slice(-2).map((x) => `${x.sym} sig ${x.sig} buy ${x.buy} @${x.entry.toFixed(2)} sell ${x.sell} @${x.exit.toFixed(2)} ${x.why}`).join(' | '));
}
await prisma.$disconnect();
