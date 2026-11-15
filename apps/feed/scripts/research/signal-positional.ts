// Positional signal study: does any indicator or candle pattern, on NIFTY's DAILY or WEEKLY bars, tell which way NIFTY
// goes over the next 5 / 10 / 20 trading days, well enough to choose the option side (sell puts when bullish, calls
// when bearish, both when "range")?
// - Data: NIFTY 50 daily OHLC (IndexEod), Jun 2011 → today. Weekly bars are built from it (a week's signal is known
//   only at that week's last close and is used from that day until the next week's close).
// - Indicators: @mtv/indicators (cross-checked against independent formulas: indicator-ref.py, all 33 match).
// - Each signal is a state read at a day's close (no look-ahead). Outcome: close → close H trading days later.
// - Edge = the signal's average move minus NIFTY's average move over the same days (NIFTY rises most of the time, so
//   "bullish" signals look good just by being long). Up-rate is compared with NIFTY's own up-rate too.
// - Overlapping H-day windows inflate certainty, so the t-value uses non-overlapping samples (every H-th signal day).
// - Chosen on 2011–2020, checked on 2021–2026 (both shown), and year by year: share of years the edge kept its sign.
// - Range signals ("quiet"): the size of the move (|return|) against the typical size. Small = good for strangles.
// Writes .data/research/signal-positional.json. Run: npx dotenv -e ../../.env -- npx tsx scripts/research/signal-positional.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import * as I from '@mtv/indicators';
import { findPatterns, PATTERNS } from '@mtv/rules';
import type { Candle } from '@mtv/shared';

const rows = await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, orderBy: { date: 'asc' } });
const D: Candle[] = rows.map((r) => ({ time: Date.parse(`${r.date}T00:00:00Z`) / 1000, open: r.openPaise / 100, high: r.highPaise / 100, low: r.lowPaise / 100, close: r.closePaise / 100, volume: 0 }));
const dates = rows.map((r) => r.date), N = D.length;

// ---- weekly bars from daily
const weekKey = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const W: Candle[] = [], wLastDay: number[] = [];
for (let i = 0; i < N; i++) {
  const k = weekKey(dates[i]), b = D[i], last = W.at(-1);
  if (last && weekKey(dates[wLastDay.at(-1)!]) === k) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; wLastDay[wLastDay.length - 1] = i; }
  else { W.push({ ...b }); wLastDay.push(i); }
}
/** A weekly series → daily, using the last COMPLETED week at each day's close. */
function weeklyToDaily<T>(s: T[]): (T | null)[] {
  const out: (T | null)[] = new Array(N).fill(null);
  let w = -1;
  for (let i = 0; i < N; i++) { while (w + 1 < wLastDay.length && wLastDay[w + 1] <= i) w++; out[i] = w >= 0 ? s[w] : null; }
  return out;
}

// ---- signals: +1 bullish, -1 bearish, 0 none, 'Q' quiet (range) for range signals
type Sig = { name: string; tf: 'D' | 'W'; kind: 'dir' | 'range'; state: (number | null)[] };
function build(c: Candle[], tf: 'D' | 'W'): Sig[] {
  const cl = c.map((b) => b.close), out: Sig[] = [];
  const add = (name: string, kind: Sig['kind'], s: (number | null)[]) => out.push({ name, tf, kind, state: tf === 'D' ? s : weeklyToDaily(s) });
  const cmp = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => (v == null || b[i] == null ? null : v > b[i]! ? 1 : -1));
  for (const n of [10, 20, 50, 100, 200]) add(`Close vs SMA${n}`, 'dir', cmp(cl, I.sma(cl, n)));
  for (const n of [20, 50]) add(`Close vs EMA${n}`, 'dir', cmp(cl, I.ema(cl, n)));
  add('EMA9 vs EMA21', 'dir', cmp(I.ema(cl, 9), I.ema(cl, 21)));
  add('SMA50 vs SMA200', 'dir', cmp(I.sma(cl, 50), I.sma(cl, 200)));
  const r = I.rsi(cl, 14);
  add('RSI14 above/below 50', 'dir', r.map((v) => (v == null ? null : v > 50 ? 1 : -1)));
  add('RSI14 <30 buy / >70 sell (reversal)', 'dir', r.map((v) => (v == null ? null : v < 30 ? 1 : v > 70 ? -1 : 0)));
  add('RSI14 >60 / <40 (momentum)', 'dir', r.map((v) => (v == null ? null : v > 60 ? 1 : v < 40 ? -1 : 0)));
  const m = I.macd(cl);
  add('MACD vs signal', 'dir', cmp(m.macd, m.signal));
  add('MACD above/below 0', 'dir', m.macd.map((v) => (v == null ? null : v > 0 ? 1 : -1)));
  for (const [p, f] of [[10, 3], [7, 2], [20, 2]] as const) add(`Supertrend ${p},${f}`, 'dir', I.supertrend(c, p, f).direction);
  const dm = I.dmi(c);
  add('ADX>25 with DI side', 'dir', dm.adx.map((a, i) => (a == null || dm.plus[i] == null ? null : a > 25 ? (dm.plus[i]! > dm.minus[i]! ? 1 : -1) : 0)));
  add('DI+ vs DI-', 'dir', cmp(dm.plus, dm.minus));
  add('ADX < 20 (no trend)', 'range', dm.adx.map((a) => (a == null ? null : a < 20 ? 1 : 0)));
  const bb = I.bollinger(cl);
  add('Close beyond Bollinger (reversal)', 'dir', cl.map((v, i) => (bb.upper[i] == null ? null : v < bb.lower[i]! ? 1 : v > bb.upper[i]! ? -1 : 0)));
  add('Close beyond Bollinger (breakout)', 'dir', cl.map((v, i) => (bb.upper[i] == null ? null : v > bb.upper[i]! ? 1 : v < bb.lower[i]! ? -1 : 0)));
  const bw = I.bbWidth(cl), bwMed = rollingMedian(bw, tf === 'D' ? 250 : 52);
  add('BB width below its 1y median (squeeze)', 'range', bw.map((v, i) => (v == null || bwMed[i] == null ? null : v < bwMed[i]! ? 1 : 0)));
  const st = I.stochastic(c);
  add('Stochastic <20 buy / >80 sell', 'dir', st.k.map((v) => (v == null ? null : v < 20 ? 1 : v > 80 ? -1 : 0)));
  add('Stochastic K vs D', 'dir', cmp(st.k, st.d));
  const sr = I.stochRsi(cl);
  add('StochRSI <20 buy / >80 sell', 'dir', sr.k.map((v) => (v == null ? null : v < 20 ? 1 : v > 80 ? -1 : 0)));
  add('Williams %R <-80 buy / >-20 sell', 'dir', I.williamsR(c).map((v) => (v == null ? null : v < -80 ? 1 : v > -20 ? -1 : 0)));
  const cc = I.cci(c.map((b) => (b.high + b.low + b.close) / 3));
  add('CCI >100 / <-100 (momentum)', 'dir', cc.map((v) => (v == null ? null : v > 100 ? 1 : v < -100 ? -1 : 0)));
  add('CCI <-100 buy / >100 sell (reversal)', 'dir', cc.map((v) => (v == null ? null : v < -100 ? 1 : v > 100 ? -1 : 0)));
  add('ROC9 above/below 0', 'dir', I.roc(cl, 9).map((v) => (v == null ? null : v > 0 ? 1 : -1)));
  add('TSI above/below 0', 'dir', I.tsi(cl).map((v) => (v == null ? null : v > 0 ? 1 : -1)));
  const ar = I.aroon(c);
  add('Aroon up>70&down<30 / reverse', 'dir', ar.up.map((u, i) => (u == null || ar.down[i] == null ? null : u > 70 && ar.down[i]! < 30 ? 1 : ar.down[i]! > 70 && u < 30 ? -1 : 0)));
  add('Parabolic SAR side', 'dir', cmp(cl, I.psar(c)));
  const ich = I.ichimoku(c);
  add('Ichimoku close vs base & conv vs base', 'dir', cl.map((v, i) => (ich.base[i] == null || ich.conversion[i] == null ? null : v > ich.base[i]! && ich.conversion[i]! > ich.base[i]! ? 1 : v < ich.base[i]! && ich.conversion[i]! < ich.base[i]! ? -1 : 0)));
  const ch = I.choppiness(c);
  add('Choppiness > 61.8 (range)', 'range', ch.map((v) => (v == null ? null : v > 61.8 ? 1 : 0)));
  const hv = I.historicalVolatility(cl, 20), hvMed = rollingMedian(hv, tf === 'D' ? 250 : 52);
  add('HV20 below its 1y median (calm)', 'range', hv.map((v, i) => (v == null || hvMed[i] == null ? null : v < hvMed[i]! ? 1 : 0)));
  const hh = I.highestBefore(c.map((b) => b.high), 20), ll = I.lowestBefore(c.map((b) => b.low), 20);
  add('20-bar high/low breakout (Donchian)', 'dir', cl.map((v, i) => (hh[i] == null ? null : v > hh[i]! ? 1 : v < ll[i]! ? -1 : 0)));
  const ha = I.heikinAshi(c);
  add('Heikin-Ashi candle colour', 'dir', ha.map((b) => (b.close > b.open ? 1 : b.close < b.open ? -1 : 0)));
  // candle patterns: bullish +1 / bearish -1 on the bar they complete
  const hits = findPatterns(c);
  for (const p of PATTERNS) {
    if (p.side === 'neutral') continue;
    const s: (number | null)[] = c.map(() => 0);
    for (const h of hits) if (h.name === p.name) s[h.index] = p.side === 'bullish' ? 1 : -1;
    add(`Pattern: ${p.name}`, 'dir', s);
  }
  return out;
}
function rollingMedian(s: (number | null)[], n: number) {
  return s.map((_, i) => { const w = s.slice(Math.max(0, i - n), i).filter((x): x is number => x != null); if (w.length < n * 0.8) return null; w.sort((a, b) => a - b); return w[w.length >> 1]; });
}

const sigs = [...build(D, 'D'), ...build(W, 'W')];
const H = [5, 10, 20];
const fwd = (h: number) => D.map((_, i) => (i + h < N ? D[i + h].close / D[i].close - 1 : null));
const F = Object.fromEntries(H.map((h) => [h, fwd(h)])) as Record<number, (number | null)[]>;
const yearOf = (i: number) => dates[i].slice(0, 4);
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

type Res = { name: string; tf: string; kind: string; h: number; side: number; n: number; edgePct: number; t: number; upRate: number; baseUp: number; medEdgePct: number; trainEdge: number; testEdge: number; trainT: number; testT: number; yearsSameSign: string };
const res: Res[] = [];
for (const s of sigs)
  for (const h of H) {
    const f = F[h];
    const sides = s.kind === 'dir' ? [1, -1] : [1];
    for (const side of sides) {
      const pick = (lo: string, hi: string) => {
        const on: number[] = [], all: number[] = [], idx: number[] = [];
        for (let i = 0; i < N; i++) {
          if (f[i] == null || s.state[i] == null || dates[i] < lo || dates[i] >= hi) continue;
          const v = s.kind === 'range' ? Math.abs(f[i]!) : f[i]!;
          all.push(v);
          if (s.state[i] === side) { on.push(v); idx.push(i); }
        }
        // non-overlapping subsample for t: keep signal days at least h apart
        const no: number[] = []; let last = -1e9;
        for (const i of idx) if (i - last >= h) { no.push(s.kind === 'range' ? Math.abs(f[i]!) : f[i]!); last = i; }
        const base = mean(all), edge = mean(on) - base;
        const t = no.length > 2 ? (mean(no) - base) / (sd(no) / Math.sqrt(no.length)) : 0;
        return { on, all, idx, edge, t, med: median(on) - median(all) };
      };
      const full = pick('0', '9999'), tr = pick('0', '2021'), te = pick('2021', '9999');
      if (full.on.length < 15) continue;
      const by = new Map<string, number[]>(), byAll = new Map<string, number[]>();
      for (let i = 0; i < N; i++) {
        if (f[i] == null || s.state[i] == null) continue;
        const v = s.kind === 'range' ? Math.abs(f[i]!) : f[i]!, y = yearOf(i);
        byAll.set(y, [...(byAll.get(y) ?? []), v]);
        if (s.state[i] === side) by.set(y, [...(by.get(y) ?? []), v]);
      }
      const want = s.kind === 'range' ? -1 : side; // range: smaller moves wanted
      let same = 0, tot = 0;
      for (const [y, v] of by) if (v.length >= 3) { tot++; if (Math.sign(mean(v) - mean(byAll.get(y)!)) === want) same++; }
      res.push({
        name: s.name, tf: s.tf, kind: s.kind, h, side, n: full.on.length, edgePct: full.edge * 100, t: full.t,
        upRate: s.kind === 'dir' ? (full.on.filter((x) => x > 0).length / full.on.length) * 100 : 0,
        baseUp: s.kind === 'dir' ? (full.all.filter((x) => x > 0).length / full.all.length) * 100 : 0,
        medEdgePct: full.med * 100, trainEdge: tr.edge * 100, testEdge: te.edge * 100, trainT: tr.t, testT: te.t, yearsSameSign: `${same}/${tot}`,
      });
    }
  }
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/signal-positional.json'), JSON.stringify({ from: dates[0], to: dates.at(-1), days: N, weeks: W.length, res }));

// A signal passes when, in its intended direction: train t ≥ 2, test edge same sign (and test t ≥ 1), median agrees,
// and the edge kept its sign in ≥ 60% of years.
const good = (r: Res) => {
  const w = r.kind === 'range' ? -1 : r.side;
  const [s, t] = r.yearsSameSign.split('/').map(Number);
  return w * r.trainT >= 2 && w * r.testT >= 1 && Math.sign(r.testEdge) === w && Math.sign(r.medEdgePct) === w && t > 0 && s / t >= 0.6;
};
const pass = res.filter(good);
console.log(`NIFTY ${dates[0]} → ${dates.at(-1)}: ${N} days, ${W.length} weeks; ${sigs.length} signals × ${H.length} horizons = ${res.length} tests`);
console.log(`\nPASSED (train t≥2, test same side t≥1, median agrees, ≥60% of years): ${pass.length}`);
const line = (r: Res) => `${r.tf} ${r.name.padEnd(42)} ${r.kind === 'dir' ? (r.side > 0 ? 'BULL' : 'BEAR') : 'QUIET'} H=${String(r.h).padStart(2)} n=${String(r.n).padStart(4)} edge=${r.edgePct.toFixed(2)}% (train ${r.trainEdge.toFixed(2)} t${r.trainT.toFixed(1)} / test ${r.testEdge.toFixed(2)} t${r.testT.toFixed(1)}) med=${r.medEdgePct.toFixed(2)} up=${r.upRate.toFixed(0)}% vs ${r.baseUp.toFixed(0)}% yrs=${r.yearsSameSign}`;
for (const r of pass.sort((a, b) => Math.abs(b.testT) - Math.abs(a.testT))) console.log(line(r));
console.log('\nStrongest on 2011–2020 that FAILED the check (for reference):');
for (const r of res.filter((r) => !good(r)).sort((a, b) => Math.abs(b.trainT) - Math.abs(a.trainT)).slice(0, 15)) console.log(line(r));
await prisma.$disconnect();
