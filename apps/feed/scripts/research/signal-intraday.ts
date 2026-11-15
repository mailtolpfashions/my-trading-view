// Intraday signal study: does any indicator on NIFTY's 5-minute or 15-minute bars (plus daily context) tell which way
// NIFTY moves from a decision time to the 15:00 close (the owner's rule: enter 09:30–15:00, flat at 15:00)?
// - Data: NIFTY index one-minute bars (.data/1m/NIFTY), about one year. Index has no volume, so VWAP / OBV / MFI are
//   left out (NIFTY-FUT minutes exist only from Nov 2026).
// - Indicators run continuously across days, as on a TradingView chart. A signal is read on the bar that CLOSES at
//   the decision time (09:30, 09:45 … 14:30); outcome = 15:00 close / decision close − 1. No costs.
// - Edge vs the average move from the same decision time (so time-of-day drift is not counted as an edge).
// - First half of the sessions = choose, second half = check. Only ~250 sessions: weak evidence, labelled so.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/signal-intraday.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as I from '@mtv/indicators';
import type { Candle } from '@mtv/shared';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

const IST = 19800;
const mins = (t: number) => { const d = new Date((t + IST) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const raw = (await new MinuteStore().read('NIFTY', 0)).filter((b) => { const m = mins(b.time); return m >= 555 && m < 930; });
const days = [...new Set(raw.map((b) => dateOfIst(b.time)))].sort();
// keep only complete-ish sessions (≥ 350 of 375 minutes)
const per = new Map<string, number>();
for (const b of raw) per.set(dateOfIst(b.time), (per.get(dateOfIst(b.time)) ?? 0) + 1);
const okDays = new Set(days.filter((d) => per.get(d)! >= 350));
const m1 = raw.filter((b) => okDays.has(dateOfIst(b.time)));

function agg(bars: Candle[], n: number): Candle[] { // n-minute bars aligned to 09:15
  const out: Candle[] = []; let key = '';
  for (const b of bars) {
    const m = mins(b.time), k = `${dateOfIst(b.time)}|${Math.floor((m - 555) / n)}`;
    if (k !== key) { out.push({ ...b }); key = k; } else { const o = out.at(-1)!; o.high = Math.max(o.high, b.high); o.low = Math.min(o.low, b.low); o.close = b.close; }
  }
  return out;
}
// daily bars from minutes (for daily context and previous-day levels)
const daily = agg(m1, 375);
const dayIdx = new Map(daily.map((b, i) => [dateOfIst(b.time), i]));

const DECIDE = [570, 585, 600, 630, 660, 720, 780, 840, 870]; // 09:30 … 14:30, minutes after midnight IST (bar CLOSE time)
const EXIT = 900; // 15:00
const closeAt = new Map<string, number>(); // `${date}|${minute}` → close of the 1m bar ending at that minute
for (const b of m1) closeAt.set(`${dateOfIst(b.time)}|${mins(b.time) + 1}`, b.close);

type Sig = { name: string; tf: string; state: Map<string, number> }; // key `${date}|${decideMinute}` → +1/-1/0
function signals(c: Candle[], tf: number): Sig[] {
  const cl = c.map((b) => b.close), out: Sig[] = [];
  const endKey = c.map((b) => `${dateOfIst(b.time)}|${mins(b.time) + tf}`); // bar close time
  const add = (name: string, s: (number | null)[]) => { const m = new Map<string, number>(); s.forEach((v, i) => { if (v != null) m.set(endKey[i], v); }); out.push({ name, tf: `${tf}m`, state: m }); };
  const cmp = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => (v == null || b[i] == null ? null : v > b[i]! ? 1 : -1));
  add('EMA9 vs EMA21', cmp(I.ema(cl, 9), I.ema(cl, 21)));
  add('Close vs EMA20', cmp(cl, I.ema(cl, 20)));
  add('Close vs SMA50', cmp(cl, I.sma(cl, 50)));
  for (const [p, f] of [[10, 3], [7, 3], [10, 2]] as const) add(`Supertrend ${p},${f}`, I.supertrend(c, p, f).direction);
  const r = I.rsi(cl, 14);
  add('RSI >50 / <50', r.map((v) => (v == null ? null : v > 50 ? 1 : -1)));
  add('RSI >60 / <40 (momentum)', r.map((v) => (v == null ? null : v > 60 ? 1 : v < 40 ? -1 : 0)));
  add('RSI <30 buy / >70 sell (reversal)', r.map((v) => (v == null ? null : v < 30 ? 1 : v > 70 ? -1 : 0)));
  const m = I.macd(cl); add('MACD vs signal', cmp(m.macd, m.signal));
  const bb = I.bollinger(cl);
  add('Bollinger breakout', cl.map((v, i) => (bb.upper[i] == null ? null : v > bb.upper[i]! ? 1 : v < bb.lower[i]! ? -1 : 0)));
  add('Bollinger reversal', cl.map((v, i) => (bb.upper[i] == null ? null : v < bb.lower[i]! ? 1 : v > bb.upper[i]! ? -1 : 0)));
  const dm = I.dmi(c); add('ADX>25 with DI side', dm.adx.map((a, i) => (a == null || dm.plus[i] == null ? null : a > 25 ? (dm.plus[i]! > dm.minus[i]! ? 1 : -1) : 0)));
  const st = I.stochastic(c); add('Stochastic <20 / >80 (reversal)', st.k.map((v) => (v == null ? null : v < 20 ? 1 : v > 80 ? -1 : 0)));
  add('Parabolic SAR side', cmp(cl, I.psar(c)));
  const ha = I.heikinAshi(c); add('Heikin-Ashi colour', ha.map((b) => (b.close > b.open ? 1 : b.close < b.open ? -1 : 0)));
  return out;
}
// session-level signals (same for every timeframe)
function sessionSignals(): Sig[] {
  const orb = new Map<string, number>(), pdl = new Map<string, number>(), gap = new Map<string, number>(), dctx = new Map<string, number>(), dayMove = new Map<string, number>();
  const dcl = daily.map((b) => b.close), d20 = I.sma(dcl, 20);
  for (const d of okDays) {
    const i = dayIdx.get(d)!, bars = m1.filter((b) => dateOfIst(b.time) === d);
    const first15 = bars.filter((b) => mins(b.time) < 570), hi = Math.max(...first15.map((b) => b.high)), lo = Math.min(...first15.map((b) => b.low));
    const prev = i > 0 ? daily[i - 1] : null, open = bars[0].open;
    for (const t of DECIDE) {
      const c = closeAt.get(`${d}|${t}`); if (c == null) continue;
      const k = `${d}|${t}`;
      orb.set(k, c > hi ? 1 : c < lo ? -1 : 0);
      if (prev) { pdl.set(k, c > prev.high ? 1 : c < prev.low ? -1 : 0); gap.set(k, open > prev.close * 1.002 ? 1 : open < prev.close * 0.998 ? -1 : 0); }
      if (prev && d20[i - 1] != null) dctx.set(k, prev.close > d20[i - 1]! ? 1 : -1);
      dayMove.set(k, c > open ? 1 : -1);
    }
  }
  return [
    { name: 'Opening range (15m) break', tf: 'session', state: orb }, { name: 'Previous day high/low break', tf: 'session', state: pdl },
    { name: 'Gap direction (>0.2%)', tf: 'session', state: gap }, { name: 'Daily: yesterday above SMA20', tf: 'daily', state: dctx },
    { name: 'Price vs day open (momentum)', tf: 'session', state: dayMove },
  ];
}
const sigs = [...signals(agg(m1, 5), 5), ...signals(agg(m1, 15), 15), ...sessionSignals()];

const sorted = [...okDays].sort(), split = sorted[Math.floor(sorted.length / 2)];
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const outcome = new Map<string, number>();
for (const d of okDays) { const e = closeAt.get(`${d}|${EXIT}`); if (e == null) continue; for (const t of DECIDE) { const c = closeAt.get(`${d}|${t}`); if (c != null) outcome.set(`${d}|${t}`, e / c - 1); } }
const baseBy = new Map<number, number>();
for (const t of DECIDE) baseBy.set(t, mean([...outcome].filter(([k]) => k.endsWith(`|${t}`)).map(([, v]) => v)));

type Res = { name: string; tf: string; time: string; side: number; n: number; edgeBp: number; hit: number; trainT: number; testT: number; trainEdge: number; testEdge: number };
const res: Res[] = [];
for (const s of sigs) for (const t of DECIDE) for (const side of [1, -1]) {
  const part = (lo: string, hi: string) => {
    const x: number[] = [];
    for (const [k, v] of outcome) { const [d, tm] = k.split('|'); if (Number(tm) !== t || d < lo || d >= hi) continue; if (s.state.get(k) === side) x.push(v - baseBy.get(t)!); }
    return { x, edge: mean(x), t: x.length > 2 ? mean(x) / (sd(x) / Math.sqrt(x.length)) : 0 };
  };
  const all = part('0', '9999'), tr = part('0', split), te = part('9999' > split ? split : split, '9999');
  if (all.x.length < 20) continue;
  res.push({ name: s.name, tf: s.tf, time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, side, n: all.x.length, edgeBp: all.edge * 1e4,
    hit: (all.x.filter((v) => Math.sign(v) === side).length / all.x.length) * 100, trainT: tr.t, testT: te.t, trainEdge: tr.edge * 1e4, testEdge: te.edge * 1e4 });
}
const good = (r: Res) => r.side * r.trainT >= 2 && r.side * r.testT >= 1.5;
console.log(`NIFTY minutes ${sorted[0]} → ${sorted.at(-1)}: ${okDays.size} full sessions (split ${split}); ${sigs.length} signals × ${DECIDE.length} times × 2 sides = ${res.length} tests`);
console.log('By chance alone, about 1 in 40 tests passes "train t≥2" — and ~1 in 15 of those also the test half.');
console.log(`\nPASSED (train t≥2 and test t≥1.5 the same way): ${res.filter(good).length}`);
const line = (r: Res) => `${r.tf.padEnd(7)} ${r.name.padEnd(34)} ${r.side > 0 ? 'BULL' : 'BEAR'} @${r.time} n=${String(r.n).padStart(3)} edge=${r.edgeBp.toFixed(1)}bp right=${r.hit.toFixed(0)}% train ${r.trainEdge.toFixed(1)}bp t${r.trainT.toFixed(1)} / test ${r.testEdge.toFixed(1)}bp t${r.testT.toFixed(1)}`;
for (const r of res.filter(good)) console.log(line(r));
console.log('\nStrongest first-half results (reference):');
for (const r of [...res].sort((a, b) => b.side * b.trainT - a.side * a.trainT).slice(0, 12)) console.log(line(r));
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/signal-intraday.json'), JSON.stringify({ sessions: okDays.size, from: sorted[0], to: sorted.at(-1), res }));
