// Evidence for every Screener preset: each preset's own formula, run through the screener's rules engine
// (packages/rules Evaluator, the same "as of" rules the live screener uses) on our NSE history, then what the stocks
// did next against the average stock over the same window (so a rising market is not counted as an edge).
//   daily presets: split/bonus-adjusted history 2011 -> today, all equity shares incl. delisted (no survivorship);
//     liquid only (close >= 5, volume >= 1,000,000 that day, the day-trader skill's floor);
//     swing presets: next 5 sessions close -> close; positional: next 20 sessions.
//   intraday presets: the last year of 1-minute bars (NIFTY 500 + F&O stocks, current list), put on the daily
//     history's adjusted basis like the screener; the first match of the day whose bar closes 09:30-15:00;
//     outcome: that bar's close -> the 15:14 minute's close (flat by 15:15).
// A match counts on every bar it is true (a state like "above all MAs" lasts many days), so the t values are rough;
// "years better" (months for intraday) is the steadier read. Writes .data/research/preset-evidence.json, which the
// screener shows next to each preset.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/preset-evidence.ts
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { Evaluator, PRESETS, parseFormula, resample, type Tf } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { allEquityShareSymbols, dailyHistory, loadEod, rawDays } from '../../src/eod/store';
import { adjustToEod, type DayInfo } from '../../src/intraday/adjust';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

const MIN_PRICE = 5, MIN_VOL = 1_000_000;
const BEARISH = new Set(['orb-15-breakdown', 'death-cross']);
const HORIZON = { swing: 5, positional: 20 } as const;
type Stat = { n: number; mean: number; t: number };
const stat = (xs: number[]): Stat => {
  const n = xs.length, m = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, mean: m, t: sd ? m / (sd / Math.sqrt(n)) : 0 };
};
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const node = (f: string) => { const p = parseFormula(f); if (!p.ok) throw new Error(p.error); return p.node; };

await loadEod(() => {});
const daily = PRESETS.filter((p) => p.tf === 'D');
const intra = PRESETS.filter((p) => p.tf !== 'D');
const result: Record<string, unknown> = {};

// ---------------------------------------------------------------- daily presets
type Ev = { date: string; ret: number };
const evs = new Map<string, Ev[]>(daily.map((p) => [p.id, []]));
const crowd = { 5: new Map<string, [number, number]>(), 20: new Map<string, [number, number]>() };
const nodes = daily.map((p) => ({ p, n: node(p.formula), h: HORIZON[p.horizon as 'swing' | 'positional'] }));
let stocks = 0, from = '9999', to = '0000';
const t0 = Date.now();
for (const s of allEquityShareSymbols()) {
  const hist = dailyHistory(s);
  if (!hist || hist.candles.length < 60) continue;
  stocks++;
  const c = hist.candles;
  const W = resample(c, 'W'), M = resample(c, 'M');
  const ev = new Evaluator((tf: Tf) => (tf === 'D' ? c : tf === 'W' ? W : tf === 'M' ? M : null));
  const liquid = c.map((k) => k.close >= MIN_PRICE && k.volume >= MIN_VOL);
  const dates = c.map((k) => dateOfIst(k.time));
  for (const h of [5, 20] as const) for (let i = 0; i + h < c.length; i++) if (liquid[i]) {
    const m = crowd[h].get(dates[i]) ?? [0, 0];
    m[0] += c[i + h].close / c[i].close - 1; m[1]++;
    crowd[h].set(dates[i], m);
  }
  for (const { p, n, h } of nodes) {
    let ser;
    try { ser = ev.series(n, 'D'); } catch { continue; }
    const list = evs.get(p.id)!;
    for (let i = 60; i + h < c.length; i++) if (ser[i] === 1 && liquid[i]) {
      list.push({ date: dates[i], ret: c[i + h].close / c[i].close - 1 });
      if (dates[i] < from) from = dates[i];
      if (dates[i] > to) to = dates[i];
    }
  }
}
console.log(`daily: ${stocks} stocks, ${from} -> ${to}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('preset'.padEnd(26) + 'days'.padStart(5) + 'signals'.padStart(10) + '   stock    crowd   excess      t  years better');
for (const { p, h } of nodes) {
  const list = evs.get(p.id)!;
  const ex = list.map((e) => { const m = crowd[h].get(e.date)!; return e.ret - m[0] / m[1]; });
  const s = stat(list.map((e) => e.ret)), x = stat(ex);
  const sign = BEARISH.has(p.id) ? -1 : 1;
  const years = [...new Set(list.map((e) => e.date.slice(0, 4)))].sort();
  const better = years.filter((y) => { const xs = list.map((e, i) => (e.date.startsWith(y) ? ex[i] : null)).filter((v): v is number => v != null); return sign * stat(xs).mean > 0; }).length;
  result[p.id] = { horizon: `${h} sessions`, signals: list.length, stock: s.mean, crowd: s.mean - x.mean, excess: x.mean, t: x.t, better, periods: years.length, period: 'years', from, to, bearish: BEARISH.has(p.id) };
  console.log(p.id.padEnd(26) + String(h).padStart(5) + String(list.length).padStart(10) + `  ${pc(s.mean).padStart(7)}  ${pc(s.mean - x.mean).padStart(7)}  ${pc(x.mean).padStart(7)}  ${x.t.toFixed(1).padStart(5)}  ${better}/${years.length}${BEARISH.has(p.id) ? ' (bearish: lagging counts)' : ''}`);
}

// ---------------------------------------------------------------- intraday presets
const store = new MinuteStore();
const syms = (await readdir(store.dir)).filter((x) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(x));
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const close1514 = new Map<string, Map<string, number>>(); // sym -> date -> 15:14 close
const slotCrowd = new Map<string, [number, number]>();    // `${date}|${minute}` -> sum, n of (15:14 close / close at that minute - 1)
const ievs = new Map<string, { date: string; key: string; ret: number }[]>(intra.map((p) => [p.id, []]));
const inodes = intra.map((p) => ({ p, n: node(p.formula) }));
const dayInfo = (symbol: string): DayInfo => {
  const raw = rawDays(symbol), adj = dailyHistory(symbol)?.candles ?? [];
  const out: DayInfo = new Map();
  for (const c of adj) { const d = dateOfIst(c.time), r = raw.get(d); if (r?.close) out.set(d, { rawOpen: r.open, adj: c.close / r.close }); }
  return out;
};
let iFrom = '9999', iTo = '0000';
for (const s of syms) {
  const hist = dailyHistory(s);
  if (!hist) continue;
  const minutes = adjustToEod(await store.read(s, Math.floor(Date.parse('2024-01-01') / 1000)), dayInfo(s)) as Candle[];
  if (minutes.length < 1000) continue;
  const byDay = new Map<string, Candle[]>();
  for (const b of minutes) { const m = ist(b.time); if (m >= 555 && m < 930) (byDay.get(dateOfIst(b.time)) ?? byDay.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b); }
  const closes = new Map<string, number>();
  for (const [d, list] of byDay) {
    const last = list.filter((b) => ist(b.time) <= 914).at(-1);
    if (!last || ist(last.time) < 900) continue;
    closes.set(d, last.close);
    for (const b of list) { const end = ist(b.time) + 1; if (end % 5 === 0 && end >= 570 && end <= 900) { const k = `${d}|${end}`; const m = slotCrowd.get(k) ?? [0, 0]; m[0] += last.close / b.close - 1; m[1]++; slotCrowd.set(k, m); } }
  }
  close1514.set(s, closes);
  const bars: Record<string, Candle[]> = { '5m': resample(minutes, '5m'), '15m': resample(minutes, '15m') };
  const ev = new Evaluator((tf: Tf) => (tf === 'D' ? hist.candles : bars[tf] ?? null));
  for (const { p, n } of inodes) {
    let ser;
    try { ser = ev.series(n, p.tf); } catch { continue; }
    const b = bars[p.tf], step = p.tf === '5m' ? 5 : 15, seen = new Set<string>();
    for (let i = 0; i < b.length; i++) {
      if (ser[i] !== 1) continue;
      const d = dateOfIst(b[i].time), end = ist(b[i].time) + step;
      if (seen.has(d) || end < 570 || end > 900 || !closes.has(d)) continue;
      seen.add(d);
      ievs.get(p.id)!.push({ date: d, key: `${d}|${end}`, ret: closes.get(d)! / b[i].close - 1 });
      if (d < iFrom) iFrom = d;
      if (d > iTo) iTo = d;
    }
  }
}
console.log(`\nintraday: ${close1514.size} stocks, ${iFrom} -> ${iTo}`);
console.log('preset'.padEnd(26) + 'signals'.padStart(10) + '   stock    crowd   excess      t  months better');
for (const { p } of inodes) {
  const list = ievs.get(p.id)!.filter((e) => slotCrowd.has(e.key));
  const ex = list.map((e) => { const m = slotCrowd.get(e.key)!; return e.ret - m[0] / m[1]; });
  const s = stat(list.map((e) => e.ret)), x = stat(ex);
  const sign = BEARISH.has(p.id) ? -1 : 1;
  const months = [...new Set(list.map((e) => e.date.slice(0, 7)))].sort();
  const better = months.filter((m) => { const xs = list.map((e, i) => (e.date.startsWith(m) ? ex[i] : null)).filter((v): v is number => v != null); return sign * stat(xs).mean > 0; }).length;
  result[p.id] = { horizon: 'to 15:15 the same day', signals: list.length, stock: s.mean, crowd: s.mean - x.mean, excess: x.mean, t: x.t, better, periods: months.length, period: 'months', from: iFrom, to: iTo, bearish: BEARISH.has(p.id) };
  console.log(p.id.padEnd(26) + String(list.length).padStart(10) + `  ${pc(s.mean).padStart(7)}  ${pc(s.mean - x.mean).padStart(7)}  ${pc(x.mean).padStart(7)}  ${x.t.toFixed(1).padStart(5)}  ${better}/${months.length}${BEARISH.has(p.id) ? ' (bearish: lagging counts)' : ''}`);
}

const OUT = path.resolve(import.meta.dirname, '../../.data/research');
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'preset-evidence.json'), JSON.stringify({ built: new Date().toISOString(), liquidity: { minPrice: MIN_PRICE, minVolume: MIN_VOL }, presets: result }, null, 1));
console.log('\nwritten .data/research/preset-evidence.json');
await prisma.$disconnect();
