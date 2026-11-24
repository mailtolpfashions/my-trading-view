// Scalping study, breadth (series part 4): weighted advance–decline lines for NIFTY 50's heavy / mid / light tiers,
// tested as a signal for NIFTY. ~1 year (stock minutes start 2025-11). Gross spot points; option costs via
// options-estimate.ts breadth-trades.json.
//
// Weights: today's NIFTY 50 list (NSE file); each stock's weight estimated by least squares of NIFTY's 1-minute
// returns on the 50 stocks' 1-minute returns over the last 40 sessions (the index IS a weighted sum, so R² ≈ 1 checks
// it). Tiers as the series: heavy ≥ 2%, mid 1–2%, light < 1%. Caveat: today's members and weights used for the whole
// year (stocks that joined or left during the year are not handled).
// Breadth line per tier: each minute Σ weight × (+1 if the stock's 1-min candle closed above its open, −1 below),
// summed through the day (reset each day). State: line above its own running mean since 9:15 (its TWAP) = up.
// Checks (3-min bars, decisions at bar close, entries 9:30–14:45, out by 15:00):
//   1. NIFTY's move over the next 21 min after each bar, split by tier state, vs NIFTY's own state (close vs TWAP).
//   2. Trades on state changes: heavy crosses (H), heavy + mid agreeing (HM), and the same on NIFTY's price vs its
//      TWAP (P, the no-breadth baseline). Exit at the opposite change or 15:00.
//   3. The series' use: opening-range breakout (A1 rules) taken only when heavy and mid agree with its direction.
// Halves: 2025-11 → 2026-05 (build) and 2026-06 → 2026-11 (check).
// Run (apps/feed): node --max-old-space-size=4096 --import tsx scripts/research/scalp/breadth.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import { resample } from '@mtv/rules';
import { istHm, supertrend, twap } from '@mtv/indicators';
import { MinuteStore, dateOfIst } from '../../../src/intraday/store';

const store = new MinuteStore();
const today = dateOfIst(Date.now() / 1000);
const FROM = Date.parse('2025-11-01T00:00:00+05:30') / 1000;
const inSession = (c: Candle) => istHm(c.time) >= 915 && istHm(c.time) < 1530;
const csv = await readFile(path.resolve(import.meta.dirname, '../../../.cache/indices/ind_nifty50list.csv'), 'utf8');
const head = csv.trim().split('\n')[0].split(',');
const symbols = csv.trim().split('\n').slice(1).map((l) => l.split(',')[head.indexOf('Symbol')].trim());

// NIFTY minutes define the time grid (regular full sessions only).
const niftyAll = (await store.read('NIFTY', FROM)).filter((c) => inSession(c) && dateOfIst(c.time) < today);
const dayCount = new Map<string, number>();
for (const c of niftyAll) dayCount.set(dateOfIst(c.time), (dayCount.get(dateOfIst(c.time)) ?? 0) + 1);
const nifty = niftyAll.filter((c) => dayCount.get(dateOfIst(c.time))! >= 370);
const T = nifty.length, pos = new Map(nifty.map((c, i) => [c.time, i]));
const dayOf = nifty.map((c) => dateOfIst(c.time));
console.log(`NIFTY minutes ${T}, days ${new Set(dayOf).size} (${dayOf[0]} → ${dayOf[T - 1]}), stocks ${symbols.length}`);

// Per stock, aligned to the grid: close (carried forward within the day) and the minute candle's sign.
const close: Float64Array[] = [], sign: Int8Array[] = [];
let coverage = 0;
for (const s of symbols) {
  const cl = new Float64Array(T).fill(NaN), sg = new Int8Array(T);
  for (const c of await store.read(s, FROM)) { const i = pos.get(c.time); if (i == null) continue; cl[i] = c.close; sg[i] = Math.sign(c.close - c.open) as -1 | 0 | 1; coverage++; }
  for (let i = 1; i < T; i++) if (Number.isNaN(cl[i]) && dayOf[i] === dayOf[i - 1]) cl[i] = cl[i - 1];
  close.push(cl); sign.push(sg);
}
console.log(`stock-minute coverage ${(100 * coverage / (T * symbols.length)).toFixed(1)}%`);

// ---- weights by least squares on the last 40 sessions
const days = [...new Set(dayOf)];
const fitFrom = days[Math.max(0, days.length - 40)];
const N = symbols.length, XtX = Array.from({ length: N }, () => new Float64Array(N)), Xty = new Float64Array(N);
let yy = 0, rows = 0;
const fitRows: { x: number[]; y: number }[] = [];
for (let t = 1; t < T; t++) {
  if (dayOf[t] < fitFrom || dayOf[t] !== dayOf[t - 1]) continue;
  const x = close.map((c) => (c[t] / c[t - 1] - 1));
  if (x.some((v) => !Number.isFinite(v))) continue;
  const y = nifty[t].close / nifty[t - 1].close - 1;
  for (let a = 0; a < N; a++) { Xty[a] += x[a] * y; for (let b = 0; b < N; b++) XtX[a][b] += x[a] * x[b]; }
  yy += y * y; rows++;
  if (fitRows.length < 200_000) fitRows.push({ x, y });
}
function solve(A: Float64Array[], bv: Float64Array): number[] {
  const n = bv.length, M = A.map((r, i) => [...r, bv[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const k = M[r][c] / M[c][c]; for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const beta = solve(XtX, Xty);
const sse = fitRows.reduce((s, r) => s + (r.y - r.x.reduce((a, v, i) => a + v * beta[i], 0)) ** 2, 0);
const r2 = 1 - sse / fitRows.reduce((s, r) => s + r.y * r.y, 0);
const total = beta.reduce((a, b) => a + b, 0);
const weight = beta.map((b) => (100 * b) / total);
const order = symbols.map((s, i) => ({ s, w: weight[i] })).sort((a, b) => b.w - a.w);
const tierOf = (w: number) => (w >= 2 ? 0 : w >= 1 ? 1 : 2);
const tiers = [0, 1, 2].map((k) => symbols.map((_, i) => i).filter((i) => tierOf(weight[i]) === k));
const lines: string[] = [];
const log = (s = '') => { lines.push(s); console.log(s); };
log(`Weights: least squares on ${rows} minutes since ${fitFrom}; R² ${r2.toFixed(4)}; raw sum of weights ${total.toFixed(3)} (1 = exact)`);
log(`  top: ${order.slice(0, 12).map((o) => `${o.s} ${o.w.toFixed(1)}`).join(', ')}`);
log(`  negative / tiny: ${order.filter((o) => o.w < 0.2).map((o) => `${o.s} ${o.w.toFixed(2)}`).join(', ') || 'none'}`);
log(`  tiers: heavy ${tiers[0].length} stocks ${tiers[0].reduce((a, i) => a + weight[i], 0).toFixed(1)}% | mid ${tiers[1].length} ${tiers[1].reduce((a, i) => a + weight[i], 0).toFixed(1)}% | light ${tiers[2].length} ${tiers[2].reduce((a, i) => a + weight[i], 0).toFixed(1)}%  (video: 13 / 61.9%, 14 / 20%, 23 / 18.1%)`);

// ---- breadth lines (per minute), their running mean, state
const line = tiers.map(() => new Float64Array(T)), mean = tiers.map(() => new Float64Array(T));
for (let k = 0; k < 3; k++) {
  let cum = 0, sum = 0, n = 0;
  for (let t = 0; t < T; t++) {
    if (t === 0 || dayOf[t] !== dayOf[t - 1]) { cum = 0; sum = 0; n = 0; }
    for (const i of tiers[k]) cum += Math.max(0, weight[i]) * sign[i][t];
    line[k][t] = cum; sum += cum; n++; mean[k][t] = sum / n;
  }
}

// ---- 3-min bars with the breadth state at each bar's last minute
const bars = resample(nifty, '3m');
const lastMin = bars.map((b) => pos.get(b.time + 120) ?? pos.get(b.time + 60) ?? pos.get(b.time)!);
const st = (k: number, j: number) => { const t = lastMin[j]; return line[k][t] > mean[k][t] ? 1 : line[k][t] < mean[k][t] ? -1 : 0; };
const tw = twap(bars), pState = (j: number) => Math.sign(bars[j].close - tw[j]!);
const hm = (j: number) => istHm(bars[j].time);
const bd = bars.map((b) => dateOfIst(b.time));
const half = (d: string) => (d < '2026-06' ? 'build' : 'check');

// 1. forward 21-min move by state
log('\n1. NIFTY move over the next 21 min (pts), by state at the bar close (bars 9:30–14:45)');
type S = { up: number[]; dn: number[] };
const groups: Record<string, S> = {};
const add = (g: string, s: number, v: number) => { const x = (groups[g] ??= { up: [], dn: [] }); if (s > 0) x.up.push(v); else if (s < 0) x.dn.push(v); };
for (let j = 0; j + 7 < bars.length; j++) {
  if (hm(j) < 930 || hm(j) > 1445 || bd[j + 7] !== bd[j]) continue;
  const fwd = bars[j + 7].close - bars[j].close;
  add('heavy', st(0, j), fwd); add('mid', st(1, j), fwd); add('light', st(2, j), fwd); add('price vs TWAP', pState(j), fwd);
  const agree = st(0, j) === st(1, j) ? st(0, j) : 0;
  add('heavy+mid agree', agree, fwd);
  if (pState(j) && st(0, j) && pState(j) !== st(0, j)) add('price vs TWAP disagrees with heavy → follow heavy', st(0, j), fwd);
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
for (const [g, x] of Object.entries(groups)) log(`  ${g.padEnd(52)} up: ${avg(x.up).toFixed(2).padStart(6)} (n ${x.up.length})  down: ${avg(x.dn).toFixed(2).padStart(6)} (n ${x.dn.length})  edge (up − down) ${(avg(x.up) - avg(x.dn)).toFixed(2)}`);

// 2 + 3. trades
type Trade = { setup: string; date: string; dir: 1 | -1; entryTime: number; exitTime: number; entry: number; exit: number; pts: number; rangeVsAvg: null };
const trades: Trade[] = [];
const dayIdx = new Map<string, [number, number]>();
bars.forEach((_, j) => { const d = bd[j], r = dayIdx.get(d); if (r) r[1] = j; else dayIdx.set(d, [j, j]); });
const stDir = supertrend(bars, 5, 2).direction;
function run(setup: string, a: number, z: number, i: number, dir: 1 | -1, exitOn: (j: number) => boolean, stop?: number) {
  for (let j = i + 1; j <= z; j++) {
    const b = bars[j];
    if (stop != null) {
      if (dir * (stop - b.open) >= 0) return push(j, b.open);
      if (dir * (stop - (dir === 1 ? b.low : b.high)) >= 0) return push(j, stop);
    }
    if (exitOn(j) || hm(j) >= 1457) return push(j, b.close);
  }
  return push(z, bars[z].close);
  function push(j: number, px: number) { trades.push({ setup, date: bd[i], dir, entryTime: bars[i].time, exitTime: bars[j].time, entry: bars[i].close, exit: px, pts: dir * (px - bars[i].close), rangeVsAvg: null }); return j; }
}
for (const [, [a, z]] of dayIdx) {
  // state-change trades, one position at a time
  const sig = { H: (j: number) => st(0, j), HM: (j: number) => (st(0, j) === st(1, j) ? st(0, j) : 0), P: (j: number) => pState(j) };
  for (const [name, f] of Object.entries(sig)) {
    let j = a + 1;
    while (j <= z) {
      const s = f(j), prev = f(j - 1);
      if (hm(j) >= 930 && hm(j) <= 1445 && s !== 0 && s !== prev) {
        const dir = s as 1 | -1;
        j = run(`${name} state change`, a, z, j, dir, (q) => (name === 'HM' ? st(0, q) === -dir : f(q) === -dir));
      }
      j++;
    }
  }
  // opening-range breakout (A1 rules), all vs breadth-confirmed
  let ih = -Infinity, il = Infinity, k = a;
  for (; k <= z && hm(k) < 930; k++) { ih = Math.max(ih, bars[k].high); il = Math.min(il, bars[k].low); }
  for (let i = k; i <= z && hm(i) <= 1445; i++) {
    const dir = bars[i].close > ih ? 1 : bars[i].close < il ? -1 : 0;
    if (!dir) continue;
    const stop = dir === 1 ? il : ih, ex = (q: number) => stDir[q] === -dir;
    run('A1 ORB (same year)', a, z, i, dir, ex, stop);
    if (st(0, i) === dir && st(1, i) === dir) run('A1 ORB, heavy+mid agree', a, z, i, dir, ex, stop);
    else run('A1 ORB, breadth disagrees', a, z, i, dir, ex, stop);
    break;
  }
}
log('\n2–3. Trades (gross spot points per trade)');
for (const name of [...new Set(trades.map((t) => t.setup))]) {
  const t = trades.filter((x) => x.setup === name);
  const part = (h: string) => { const z = t.filter((x) => half(x.date) === h); return `${h} ${avg(z.map((x) => x.pts)).toFixed(1).padStart(5)} (n ${z.length})`; };
  log(`  ${name.padEnd(30)} n ${String(t.length).padStart(5)}  avg ${avg(t.map((x) => x.pts)).toFixed(1).padStart(5)}  win ${(100 * t.filter((x) => x.pts > 0).length / t.length).toFixed(0)}%  per day ${(t.length / dayIdx.size).toFixed(1)}  | ${part('build')} | ${part('check')}`);
}
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
await writeFile(path.join(dir, 'breadth-trades.json'), JSON.stringify(trades));
await writeFile(path.join(dir, 'breadth.txt'), lines.join('\n'));
await writeFile(path.join(dir, 'breadth-weights.json'), JSON.stringify({ fitFrom, r2, total, weights: order }));
