// Scalping study, step 4: the series' setups (part 5) as FIXED rules, simulated on NIFTY 50 spot 3-minute bars.
// Gross spot points (costs and option pricing come in step 5). Entries on a 3-min close at that close, only on bars
// opening 9:30–14:45; stops checked inside each bar (a bar opening past the stop exits at its open; stop and target in
// the same bar = stop first); everything out at the 14:57 bar's close (15:00). Rules built on 2023–2025; 2026 = holdout.
//
// A  first breakout of the 9:15–9:30 range (3-min close beyond it). Stop: other side of the range.
//    A1 exit Supertrend(5,2) flip · A2 exit close beyond the opposite EMA(9) band · A3 exit when the EMA state leaves
//    "strong" · A4 = A1 but a second attempt (either side) after the first one stops out.
// B  first pullback after a ≥ 60-min trend leg (EMA state never against for ≥ 20 bars into the day's high/low), before
//    13:30: price pulls back ≥ 15% of the day range (deeper than 35% cancels), then the EMA state turns strong again in
//    the trend direction → enter. Stop: the pullback extreme. B1 target the prior day high/low · B2 Supertrend trail.
// C  afternoon (entries 13:30–14:45).
//    C1 S1+S2 range < X × 5-day avg range (X 0.5/0.6/0.7): first close beyond the 9:15–13:30 range; stop TWAP; exit ST flip.
//    C2 same narrow-day filter: price has hugged TWAP (last 10 bars within ±0.15 avg range), then closes beyond
//       ±0.15 avg range from TWAP; stop TWAP; exit ST flip.
//    C3 mean reversion: at 13:30 the close is > 35% of the day range away from TWAP; enter when the EMA state turns
//       strong toward TWAP; target TWAP (at entry), stop the day's extreme.
// Every setup also shown with the filter "skip if the day's range at entry is already > 120% of the 5-day average".
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/setups.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import { resample } from '@mtv/rules';
import { emaBandState, istHm, sessionStats, supertrend, twap } from '@mtv/indicators';
import { MinuteStore, dateOfIst } from '../../../src/intraday/store';

const store = new MinuteStore();
const today = dateOfIst(Date.now() / 1000);
const mins = (await store.read('NIFTY', Date.parse('2023-01-01T00:00:00+05:30') / 1000)).filter((c) => dateOfIst(c.time) < today && istHm(c.time) >= 915 && istHm(c.time) < 1530);
// 3-min bars, special sessions (< 120 bars) dropped.
const all = resample(mins, '3m');
const perDay = new Map<string, Candle[]>();
for (const b of all) { const d = dateOfIst(b.time); (perDay.get(d) ?? perDay.set(d, []).get(d)!).push(b); }
const bars = [...perDay].filter(([, b]) => b.length >= 120).flatMap(([, b]) => b);
const st = supertrend(bars, 5, 2).direction, ema = emaBandState(bars, 9), tw = twap(bars), ss = sessionStats(bars, 5);
const days: { date: string; a: number; z: number }[] = []; // index range [a, z] per day
bars.forEach((b, i) => { const d = dateOfIst(b.time); if (days.at(-1)?.date === d) days.at(-1)!.z = i; else days.push({ date: d, a: i, z: i }); });

type Trade = { setup: string; date: string; dir: 1 | -1; entryTime: number; entry: number; exit: number; exitTime: number; pts: number; mae: number; reason: string; rangeVsAvg: number | null; entryIdx: number };
type Sim = { stop: number; target?: number; exitOn?: (j: number) => boolean };
const hm = (i: number) => istHm(bars[i].time);

function simulate(setup: string, date: string, z: number, i: number, dir: 1 | -1, s: Sim): Trade {
  const entry = bars[i].close;
  let mae = 0;
  const done = (j: number, px: number, reason: string): Trade => ({ setup, date, dir, entryTime: bars[i].time, entry, exit: px, exitTime: bars[j].time, pts: dir * (px - entry), mae, reason, rangeVsAvg: ss[i].rangeVsAvg, entryIdx: i });
  for (let j = i + 1; j <= z; j++) {
    const b = bars[j];
    const worst = dir === 1 ? b.low : b.high, best = dir === 1 ? b.high : b.low;
    if (dir * (s.stop - b.open) >= 0) return done(j, b.open, 'stop');
    if (dir * (s.stop - worst) >= 0) { mae = Math.max(mae, dir * (entry - s.stop)); return done(j, s.stop, 'stop'); }
    mae = Math.max(mae, dir * (entry - worst));
    if (s.target != null) {
      if (dir * (b.open - s.target) >= 0) return done(j, b.open, 'target');
      if (dir * (best - s.target) >= 0) return done(j, s.target, 'target');
    }
    if (s.exitOn?.(j)) return done(j, b.close, 'signal');
    if (hm(j) >= 1457) return done(j, b.close, '15:00');
  }
  return done(z, bars[z].close, 'day end');
}
const lastIdx = (a: number, z: number) => { let k = z; while (k > a && hm(k) > 1457) k--; return k; };
const inWindow = (i: number, from = 930, to = 1445) => hm(i) >= from && hm(i) <= to;
const stFlip = (dir: 1 | -1) => (j: number) => st[j] === -dir;

const trades: Trade[] = [];
for (const { date, a, z: zz } of days) {
  const z = lastIdx(a, zz);
  // ---- A: opening-range breakout
  let ih = -Infinity, il = Infinity, k = a;
  for (; k <= z && hm(k) < 930; k++) { ih = Math.max(ih, bars[k].high); il = Math.min(il, bars[k].low); }
  const firstBreak = (from: number) => { for (let i = from; i <= z && inWindow(i); i++) { if (bars[i].close > ih) return { i, dir: 1 as const }; if (bars[i].close < il) return { i, dir: -1 as const }; } return null; };
  const b1 = firstBreak(k);
  if (b1) {
    const stop = b1.dir === 1 ? il : ih;
    trades.push(simulate('A1 ORB, ST(5,2) exit', date, z, b1.i, b1.dir, { stop, exitOn: stFlip(b1.dir) }));
    trades.push(simulate('A2 ORB, EMA-band exit', date, z, b1.i, b1.dir, { stop, exitOn: (j) => (b1.dir === 1 ? bars[j].close < ema.low[j]! : bars[j].close > ema.high[j]!) }));
    trades.push(simulate('A3 ORB, exit when not strong', date, z, b1.i, b1.dir, { stop, exitOn: (j) => ema.state[j] !== 2 * b1.dir }));
    const t = simulate('A4 ORB + 2nd attempt', date, z, b1.i, b1.dir, { stop, exitOn: stFlip(b1.dir) });
    trades.push(t);
    if (t.reason === 'stop') {
      const exitIdx = bars.findIndex((b, j) => j > b1.i && b.time === t.exitTime);
      const b2 = firstBreak(exitIdx + 1);
      if (b2) trades.push(simulate('A4 ORB + 2nd attempt', date, z, b2.i, b2.dir, { stop: b2.dir === 1 ? il : ih, exitOn: stFlip(b2.dir) }));
    }
  }
  // ---- B: first pullback after a >= 60-min trend leg (one per day)
  let bDone = false;
  for (let i = a + 1; i <= z && !bDone && hm(i) < 1330; i++) {
    for (const dir of [1, -1] as const) {
      if (bDone || !inWindow(i)) continue;
      // extreme of the day before this bar, and where it was made
      let ext = dir === 1 ? -Infinity : Infinity, at = -1;
      for (let j = a; j < i; j++) { const v = dir === 1 ? bars[j].high : bars[j].low; if (dir * (v - ext) > 0) { ext = v; at = j; } }
      if (at < 0) continue;
      let leg = 0;
      for (let j = at; j >= a && ema.state[j] * dir > 0; j--) leg++;
      if (leg < 20) continue;
      const range = ss[i - 1].range;
      let pull = dir === 1 ? Infinity : -Infinity;
      for (let j = at + 1; j <= i; j++) pull = dir === 1 ? Math.min(pull, bars[j].low) : Math.max(pull, bars[j].high);
      const depth = dir * (ext - pull) / range;
      if (!(depth >= 0.15 && depth <= 0.35)) continue;
      if (ema.state[i] !== 2 * dir || ema.state[i - 1] === 2 * dir) continue;
      if (dir * (bars[i].close - ext) >= 0) continue; // already back at the high: no room to the target
      trades.push(simulate('B1 pullback, target prior extreme', date, z, i, dir, { stop: pull, target: ext }));
      trades.push(simulate('B2 pullback, ST trail', date, z, i, dir, { stop: pull, exitOn: stFlip(dir) }));
      bDone = true;
    }
  }
  // ---- C: afternoon
  const s13 = days.length && (() => { let j = a; while (j < z && hm(j + 1) < 1330) j++; return j; })(); // last bar before 13:30
  if (typeof s13 === 'number' && hm(s13) < 1330) {
    const st13 = ss[s13];
    const rh = st13.high, rl = st13.low;
    for (const x of [0.5, 0.6, 0.7]) {
      if (st13.avgRange == null || st13.range >= x * st13.avgRange) continue;
      for (let i = s13 + 1; i <= z && inWindow(i, 1330); i++) {
        const dir = bars[i].close > rh ? 1 : bars[i].close < rl ? -1 : 0;
        if (!dir) continue;
        trades.push(simulate(`C1 narrow<${x} range break`, date, z, i, dir, { stop: tw[i]!, exitOn: stFlip(dir) }));
        break;
      }
      for (let i = s13 + 1; i <= z && inWindow(i, 1330); i++) {
        const band = 0.15 * st13.avgRange, d = bars[i].close - tw[i]!;
        const hugged = [...Array(10).keys()].every((q) => Math.abs(bars[i - 1 - q].close - tw[i - 1 - q]!) <= band);
        if (!hugged || Math.abs(d) <= band) continue;
        const dir = d > 0 ? 1 : -1;
        trades.push(simulate(`C2 narrow<${x} TWAP expansion`, date, z, i, dir, { stop: tw[i]!, exitOn: stFlip(dir) }));
        break;
      }
    }
    const away = (bars[s13].close - tw[s13]!) / st13.range;
    if (Math.abs(away) > 0.35) {
      const dir = away > 0 ? -1 : 1;
      for (let i = s13 + 1; i <= z && inWindow(i, 1330); i++) {
        if (ema.state[i] !== 2 * dir) continue;
        if (dir * (tw[i]! - bars[i].close) <= 0) break;
        trades.push(simulate('C3 stretched → back to TWAP', date, z, i, dir, { stop: dir === 1 ? ss[i].low : ss[i].high, target: tw[i]! }));
        break;
      }
    }
  }
}

// ---- report
const med = (x: number[]) => { const s = [...x].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const lines: string[] = [];
const log = (s = '') => { lines.push(s); console.log(s); };
const years = ['2023', '2024', '2025', '2026'];
function row(name: string, t: Trade[]) {
  if (!t.length) return log(`  ${name.padEnd(44)} no trades`);
  const w = t.filter((x) => x.pts > 0), l = t.filter((x) => x.pts <= 0);
  let streak = 0, worstStreak = 0;
  for (const x of t) { streak = x.pts <= 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak); }
  const dev = t.filter((x) => x.date < '2026'), hold = t.filter((x) => x.date >= '2026');
  const avg = (x: Trade[]) => (x.length ? x.reduce((s, y) => s + y.pts, 0) / x.length : NaN);
  log(`  ${name.padEnd(44)} n ${String(t.length).padStart(4)}  win ${f(100 * w.length / t.length, 0)}%  avg ${f(avg(t)).padStart(5)}  (win ${f(avg(w), 0)} / loss ${f(avg(l), 0)})  2023-25 avg ${f(avg(dev)).padStart(5)} n${dev.length}  2026 avg ${f(avg(hold)).padStart(5)} n${hold.length}  worst ${f(Math.min(...t.map((x) => x.pts)), 0)}  lose-run ${worstStreak}  medMAE ${f(med(t.map((x) => x.mae)), 0)}`);
  log(`  ${''.padEnd(44)} by year ${years.map((y) => `${y}: ${f(t.filter((x) => x.date.startsWith(y)).reduce((s, x) => s + x.pts, 0), 0)}`).join('  ')}`);
}
const names = [...new Set(trades.map((t) => t.setup))];
log(`NIFTY spot 3-min setups, ${days[0].date} → ${days.at(-1)!.date} (${days.length} days). Gross spot points per trade.`);
for (const n of names) {
  const t = trades.filter((x) => x.setup === n);
  log(`\n${n}`);
  row('all', t);
  row('skip if range already > 120% of 5-day avg', t.filter((x) => x.rangeVsAvg != null && x.rangeVsAvg <= 1.2));
  row('  longs', t.filter((x) => x.dir === 1));
  row('  shorts', t.filter((x) => x.dir === -1));
}
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'setups-trades.json'), JSON.stringify(trades));
await writeFile(path.join(dir, 'setups.txt'), lines.join('\n'));
