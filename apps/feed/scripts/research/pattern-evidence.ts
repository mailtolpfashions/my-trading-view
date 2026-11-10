// Evidence for every candlestick pattern (packages/rules patterns.ts, the same rules the chart markers and the
// screener use), on our NSE daily history:
//   split/bonus-adjusted daily bars 2011 -> today, all equity shares incl. delisted (no survivorship);
//   liquid only (close >= 5, volume >= 1,000,000 that day);
//   a pattern counts once, on the bar it completes; outcome: that bar's close -> the close 5 sessions later,
//   skipping price-band days (close at the day's high or low and the move within 0.1% of a 2/5/10/20% band: the
//   stock is locked at its limit and cannot be bought or sold at that close; pattern-check.ts showed these days
//   made up most of the Dragonfly doji and Marubozu results);
//   against the average liquid stock over the same 5 sessions (so a rising market is not counted as an edge).
// The median is kept too (the typical match against the typical liquid stock day): a few huge moves can carry the
// mean, so an "edge" needs the median on its side as well.
// Bearish patterns work when the stock lags; neutral ones (Doji, Spinning top) have no direction to test and are
// reported for reference. Costs are not included. Writes .data/research/pattern-evidence.json for the chart.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/pattern-evidence.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { PATTERNS, findPatterns } from '@mtv/rules';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';

const MIN_PRICE = 5, MIN_VOL = 1_000_000, H = 5;
const BANDS = [0.02, 0.05, 0.1, 0.2];
/** Locked at a price band: closed at the day's high or low with the move on a band (the 0.1% allows for rounding). */
const atBand = (c: { close: number; high: number; low: number }, prevClose: number) => {
  const move = Math.abs(c.close / prevClose - 1);
  return (c.close === c.high || c.close === c.low) && BANDS.some((b) => Math.abs(move - b) < 0.001);
};
let banded = 0;
type Stat = { n: number; mean: number; t: number };
const stat = (xs: number[]): Stat => {
  const n = xs.length, m = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: m, t: sd ? m / (sd / Math.sqrt(n)) : 0 };
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;

await loadEod(() => {});
const evs = new Map<string, { date: string; ret: number }[]>(PATTERNS.map((p) => [p.name, []]));
const crowd = new Map<string, [number, number]>();
let stocks = 0, from = '9999', to = '0000';
const t0 = Date.now();
for (const s of allEquityShareSymbols()) {
  const hist = dailyHistory(s);
  if (!hist || hist.candles.length < 60) continue;
  stocks++;
  const c = hist.candles;
  const liquid = c.map((k) => k.close >= MIN_PRICE && k.volume >= MIN_VOL);
  const dates = c.map((k) => dateOfIst(k.time));
  for (let i = 0; i + H < c.length; i++) if (liquid[i]) {
    const m = crowd.get(dates[i]) ?? [0, 0];
    m[0] += c[i + H].close / c[i].close - 1; m[1]++;
    crowd.set(dates[i], m);
  }
  for (const h of findPatterns(c)) {
    const i = h.index;
    if (i < 20 || i + H >= c.length || !liquid[i]) continue;
    if (atBand(c[i], c[i - 1].close)) { banded++; continue; }
    evs.get(h.name)!.push({ date: dates[i], ret: c[i + H].close / c[i].close - 1 });
    if (dates[i] < from) from = dates[i];
    if (dates[i] > to) to = dates[i];
  }
}
// The typical stock day: the median excess over all liquid stock-days (single stocks are skewed, so a typical stock
// trails the average one; a pattern's median is compared with this, not with zero).
const all: number[] = [];
for (const s of allEquityShareSymbols()) {
  const c = dailyHistory(s)?.candles;
  if (!c || c.length < 60) continue;
  for (let i = 20; i + H < c.length; i++) if (c[i].close >= MIN_PRICE && c[i].volume >= MIN_VOL) {
    const m = crowd.get(dateOfIst(c[i].time))!;
    all.push(c[i + H].close / c[i].close - 1 - m[0] / m[1]);
  }
}
const typical = median(all);
all.length = 0;
console.log(`typical stock day: median excess ${pc(typical)}`);
console.log(`${stocks} stocks, ${from} -> ${to}, ${((Date.now() - t0) / 1000).toFixed(0)} s; ${banded} pattern days at a price band left out`);
console.log('pattern'.padEnd(22) + 'side'.padEnd(9) + 'signals'.padStart(9) + '   stock    crowd   excess   median      t  years better');
const result: Record<string, unknown> = {};
for (const p of PATTERNS) {
  const list = evs.get(p.name)!;
  const ex = list.map((e) => { const m = crowd.get(e.date)!; return e.ret - m[0] / m[1]; });
  const s = stat(list.map((e) => e.ret)), x = stat(ex);
  const sign = p.side === 'bearish' ? -1 : 1;
  const years = [...new Set(list.map((e) => e.date.slice(0, 4)))].sort();
  const better = years.filter((y) => { const xs = list.map((e, i) => (e.date.startsWith(y) ? ex[i] : null)).filter((v): v is number => v != null); return sign * stat(xs).mean > 0; }).length;
  const mid = median(ex) - typical; // the typical match against the typical stock day: a few huge moves can carry the mean alone
  result[p.name] = { horizon: `${H} sessions`, signals: list.length, stock: s.mean, crowd: s.mean - x.mean, excess: x.mean, median: mid, t: x.t, better, periods: years.length, period: 'years', from, to, bearish: p.side === 'bearish', neutral: p.side === 'neutral' };
  console.log(p.name.padEnd(22) + p.side.padEnd(9) + String(list.length).padStart(9) + `  ${pc(s.mean).padStart(7)}  ${pc(s.mean - x.mean).padStart(7)}  ${pc(x.mean).padStart(7)}  ${pc(mid).padStart(7)}  ${x.t.toFixed(1).padStart(5)}  ${better}/${years.length}`);
}

const OUT = path.resolve(import.meta.dirname, '../../.data/research');
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'pattern-evidence.json'), JSON.stringify({ built: new Date().toISOString(), liquidity: { minPrice: MIN_PRICE, minVolume: MIN_VOL }, bandDaysLeftOut: banded, patterns: result }, null, 1));
console.log('\nwritten .data/research/pattern-evidence.json');
await prisma.$disconnect();
