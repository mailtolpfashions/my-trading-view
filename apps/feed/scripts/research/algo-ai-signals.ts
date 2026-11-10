// Are algo_ai's intraday option-BUYING signals worth anything? Each signal is rebuilt from algo_ai's own formulas
// (D:\AI-Plus-Algo-Trading\algo_ai\option_signal.py) on real NSE data and scored on whether NIFTY then moved its way.
//
// Two tests:
//  A. 2011 → today, daily data: signals known at the open (gap, PCR, OI walls, ATM OI change, large gap, CPR width,
//     VIX expected move). Outcome: NIFTY open → close (NSE index close, 15:30; algo_ai exits at 15:15).
//  B. The last year of 1-minute NIFTY bars: the same signals plus opening-range breakout (15 min) and momentum, at
//     09:30, 10:00, 11:00 and 13:00. Outcome: NIFTY at the decision time → 15:15 (algo_ai's forced exit).
//
// Approximations, all labelled in the output: open interest is the previous day's NSE close (algo_ai reads live OI
// during the day); OI change = previous day vs the day before (algo_ai: today vs yesterday). VWAP (needs futures
// minutes) and the AI news read (no history) cannot be tested and count as neutral, exactly like algo_ai's own fallback.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/algo-ai-signals.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

type Bias = 1 | -1 | 0;
// algo_ai settings.json defaults
const PCR_T = 0.15, GAP_F = 0.5, RANGE_DAYS = 5, HIST_DAYS = 15, ATM_T = 0.1, CLAMP = 0.5, WINDOW = 5, MOM_MIN = 0.25, MOM_MAX = 0.65;

// ---- daily data -----------------------------------------------------------------------------------------------
const idx = (await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, orderBy: { date: 'asc' } }))
  .map((r) => ({ date: r.date, o: r.openPaise / 100, h: r.highPaise / 100, l: r.lowPaise / 100, c: r.closePaise / 100 }));
const vix = new Map((await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true } })).map((r) => [r.date, r.closePaise / 100]));
console.log(`NIFTY days ${idx.length} (${idx[0].date} → ${idx.at(-1)!.date}), VIX days ${vix.size}`);

// Nearest-expiry NIFTY option open interest per strike, per day (one query; nearest expiry = earliest not yet expired).
type Row = { date: string; expiry: string; kind: string; strike: number; oi: number };
console.time('oi');
const raw = await prisma.$queryRawUnsafe<{ date: string; expiry: string; kind: string; strikePaise: number; oi: bigint }[]>(`
  SELECT f.date, f.expiry, f.kind, f."strikePaise", f.oi FROM "FnoEod" f
  JOIN (SELECT date, MIN(expiry) AS e FROM "FnoDerivedDay" WHERE underlying = 'NIFTY' AND "daysToExpiry" >= 0 GROUP BY date) n
    ON f.date = n.date AND f.expiry = n.e
  WHERE f.underlying = 'NIFTY' AND f.kind IN ('CE', 'PE')`);
console.timeEnd('oi');
const oiByDate = new Map<string, Row[]>();
for (const r of raw) {
  const row = { date: r.date, expiry: r.expiry, kind: r.kind, strike: r.strikePaise / 100, oi: Number(r.oi) };
  (oiByDate.get(r.date) ?? oiByDate.set(r.date, []).get(r.date)!).push(row);
}
console.log(`option-OI days ${oiByDate.size}, rows ${raw.length}`);

/** algo_ai's option-chain signals from one day's nearest-expiry OI (and the day before's for OI change), at `spot`. */
function chainSignals(prev: string, before: string | undefined, spot: number) {
  const rows = oiByDate.get(prev);
  if (!rows?.length) return null;
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  const steps = strikes.slice(1).map((s, i) => s - strikes[i]).filter((d) => d >= 50);
  const step = steps.length ? Math.min(...steps) : 50; // NIFTY lists 50s; some old years only 100s
  const atm = Math.round(spot / step) * step;
  const target = new Set(Array.from({ length: 2 * WINDOW + 1 }, (_, i) => atm + (i - WINDOW) * step));
  const oi: Record<number, { CE: number; PE: number }> = {};
  for (const r of rows) if (target.has(r.strike)) (oi[r.strike] ??= { CE: 0, PE: 0 })[r.kind as 'CE' | 'PE'] = r.oi;
  if (Object.keys(oi).length < WINDOW) return null;
  // OI change ratios vs the day before, same expiry (none across an expiry roll, as in algo_ai when history is missing)
  const old = before ? oiByDate.get(before)?.filter((r) => r.expiry === rows[0].expiry) : undefined;
  const ratio = (strike: number, kind: 'CE' | 'PE') => { const o = old?.find((r) => r.strike === strike && r.kind === kind)?.oi; const n = oi[strike]?.[kind]; return o && n != null ? n / o : null; };
  const mult = (r: number | null) => (r == null ? 1 : Math.min(1 + CLAMP, Math.max(1 - CLAMP, r)));
  const prox = (s: number) => Math.max(0, 1 - Math.abs(s - spot) / (WINDOW * step));
  // walls (compute_oi_walls) and base probability (compute_direction_probability)
  let rs = 0, ro = 0, ss = 0, so = 0;
  for (const [k, v] of Object.entries(oi)) { const s = +k; if (s > atm && v.CE > ro) { rs = s; ro = v.CE; } if (s < atm && v.PE > so) { ss = s; so = v.PE; } }
  const wS = so * prox(ss) * mult(ss ? ratio(ss, 'PE') : null), wR = ro * prox(rs) * mult(rs ? ratio(rs, 'CE') : null);
  const base = wS + wR > 0 ? wS / (wS + wR) : 0.5;
  // weighted PCR (compute_oi_bias with change multipliers on the walls and ATM, as engine.py does)
  const changed = new Set([rs, ss, atm]);
  let wc = 0, wp = 0;
  for (const [k, v] of Object.entries(oi)) { const s = +k; wc += v.CE * prox(s) * (changed.has(s) ? mult(ratio(s, 'CE')) : 1); wp += v.PE * prox(s) * (changed.has(s) ? mult(ratio(s, 'PE')) : 1); }
  const wpcr = wc > 0 ? wp / wc : Infinity;
  const pcr: Bias = wpcr > 1 + PCR_T ? 1 : wpcr < 1 - PCR_T ? -1 : 0;
  // ATM OI change (compute_atm_oi_change_bias): ratios are today/yesterday, so subtract 1 = fractional change
  const rc = ratio(atm, 'CE'), rp = ratio(atm, 'PE');
  const diff = rc != null && rp != null ? rp - rc : null;
  const atmOi: Bias = diff == null ? 0 : diff > ATM_T ? 1 : diff < -ATM_T ? -1 : 0;
  return { base, walls: (base > 0.5 ? 1 : base < 0.5 ? -1 : 0) as Bias, pcr, atmOi, wpcr };
}

// ---- scoring helpers --------------------------------------------------------------------------------------------
type Obs = { year: number; bias: Bias; move: number };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function score(list: Obs[]) {
  const active = list.filter((o) => o.bias !== 0 && o.move !== 0);
  const hits = active.filter((o) => Math.sign(o.move) === o.bias).length;
  const pts = active.reduce((a, o) => a + o.bias * o.move, 0);
  const band = active.length ? 1.96 * Math.sqrt(0.25 / active.length) : 0; // a coin flip lands inside 50% ± this, 95% of the time
  return { n: active.length, of: list.length, hit: active.length ? hits / active.length : null, band, avgPts: active.length ? pts / active.length : null };
}
const PERIODS: [string, (y: number) => boolean][] = [['2011–15', (y) => y <= 2015], ['2016–20', (y) => y >= 2016 && y <= 2020], ['2021–26', (y) => y >= 2021]];
const out: Record<string, unknown> = {};
function report(title: string, signals: Record<string, Obs[]>, periods = true) {
  console.log(`\n=== ${title} ===`);
  console.log('signal'.padEnd(28) + 'days'.padStart(7) + 'hit'.padStart(8) + '  coin-flip band   avg pts its way' + (periods ? '   by period (hit, n)' : ''));
  const res: Record<string, unknown> = {};
  for (const [name, list] of Object.entries(signals)) {
    const s = score(list);
    const per = periods ? PERIODS.map(([p, f]) => { const x = score(list.filter((o) => f(o.year))); return `${p} ${x.hit == null ? '–' : pct(x.hit)} (${x.n})`; }).join('  ') : '';
    const verdict = s.hit == null ? '' : Math.abs(s.hit - 0.5) <= s.band ? '  ≈ coin flip' : s.hit > 0.5 ? '  BETTER than chance' : '  WORSE than chance';
    console.log(name.padEnd(28) + String(s.n).padStart(7) + (s.hit == null ? '–' : pct(s.hit)).padStart(8) + `  50% ± ${pct(s.band)}`.padEnd(17) + (s.avgPts == null ? '–' : s.avgPts.toFixed(1)).padStart(15) + '   ' + per + verdict);
    res[name] = { ...s, periods: periods ? Object.fromEntries(PERIODS.map(([p, f]) => [p, score(list.filter((o) => f(o.year)))])) : undefined };
  }
  out[title] = res;
}

// ---- A. daily, 2011 → today ------------------------------------------------------------------------------------
const A: Record<string, Obs[]> = { 'Gap direction': [], 'PCR (weighted)': [], 'OI walls (base prob)': [], 'ATM OI change': [], 'Combined → CALL/PUT': [], 'Up day (always CALL)': [] };
const bigGap = { big: [] as number[], normal: [] as number[] };
const cprRows: { ratio: number; range: number; oc: number }[] = [];
const vixRows: { exp: number; oc: number }[] = [];
for (let i = HIST_DAYS + 1; i < idx.length; i++) {
  const d = idx[i], p = idx[i - 1], year = +d.date.slice(0, 4);
  const move = d.c - d.o;
  const gap = d.o - p.c;
  const gapB: Bias = gap > 0 ? 1 : gap < 0 ? -1 : 0;
  A['Gap direction'].push({ year, bias: gapB, move });
  A['Up day (always CALL)'].push({ year, bias: 1, move });
  const avgRange = idx.slice(i - RANGE_DAYS, i).reduce((a, x) => a + (x.h - x.l), 0) / RANGE_DAYS;
  (Math.abs(gap) > avgRange * GAP_F ? bigGap.big : bigGap.normal).push(Math.abs(move));
  // CPR width of yesterday vs yesterday's range (algo_ai's narrow-CPR bonus) against today's size of move
  const piv = (p.h + p.l + p.c) / 3, bc = (p.h + p.l) / 2, cpr = Math.abs(2 * piv - bc - bc);
  if (p.h > p.l) cprRows.push({ ratio: cpr / (p.h - p.l), range: d.h - d.l, oc: Math.abs(move) });
  const v = vix.get(p.date); // known at the open: yesterday's VIX close (today's close would be look-ahead)
  if (v) {
    const vixMove = d.o * (v / 100) * Math.sqrt(1 / 252);
    const hist = idx.slice(i - HIST_DAYS, i).reduce((a, x) => a + Math.abs(x.c - x.o), 0) / HIST_DAYS;
    vixRows.push({ exp: (vixMove + hist) / 2, oc: Math.abs(move) });
  }
  const ch = chainSignals(p.date, idx[i - 2]?.date, d.o);
  if (!ch) continue;
  A['PCR (weighted)'].push({ year, bias: ch.pcr, move });
  A['OI walls (base prob)'].push({ year, bias: ch.walls, move });
  A['ATM OI change'].push({ year, bias: ch.atmOi, move });
  const net = ch.pcr + gapB + ch.atmOi; // + VWAP, ORB, AI, momentum = untestable or not known at the open → neutral
  const up = Math.max(0.05, Math.min(0.95, ch.base + 0.05 * net));
  A['Combined → CALL/PUT'].push({ year, bias: up >= 0.55 ? 1 : up <= 0.45 ? -1 : 0, move });
}
report('A. Signals known at the open, NIFTY open → close, 2011 → today (OI = previous day close)', A);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`\nLarge gap (> half the 5-day average range): ${bigGap.big.length} days, average |open→close| ${mean(bigGap.big).toFixed(1)} pts vs ${mean(bigGap.normal).toFixed(1)} on other days`);
cprRows.sort((a, b) => a.ratio - b.ratio);
const third = Math.floor(cprRows.length / 3);
const cprOut = [['narrowest third', cprRows.slice(0, third)], ['middle third', cprRows.slice(third, 2 * third)], ['widest third', cprRows.slice(2 * third)]] as const;
console.log('CPR width (yesterday) vs today\'s move:'); for (const [n, r] of cprOut) console.log(`  ${n.padEnd(16)} day range ${mean(r.map((x) => x.range)).toFixed(1)}  |open→close| ${mean(r.map((x) => x.oc)).toFixed(1)}`);
const beat = vixRows.filter((r) => r.oc >= r.exp).length;
console.log(`Expected move (VIX + 15-day average, blended): realised |open→close| reached it on ${beat} of ${vixRows.length} days (${pct(beat / vixRows.length)}); average expected ${mean(vixRows.map((r) => r.exp)).toFixed(1)} vs realised ${mean(vixRows.map((r) => r.oc)).toFixed(1)}`);
out.extras = { largeGap: { days: bigGap.big.length, avgMove: mean(bigGap.big), otherAvg: mean(bigGap.normal) }, cpr: cprOut.map(([n, r]) => ({ n, range: mean(r.map((x) => x.range)), oc: mean(r.map((x) => x.oc)) })), expectedMove: { reached: beat, days: vixRows.length } };

// ---- B. intraday, the last year of minutes ----------------------------------------------------------------------
const store = new MinuteStore();
const mins = await store.read('NIFTY', Math.floor(Date.parse('2024-01-01') / 1000));
const byDay = new Map<string, typeof mins>();
for (const b of mins) (byDay.get(dateOfIst(b.time)) ?? byDay.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b);
const hhmm = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(11, 16);
const days = [...byDay.keys()].sort();
console.log(`\nNIFTY minute days ${days.length} (${days[0]} → ${days.at(-1)})`);
const pos = new Map(idx.map((d, i) => [d.date, i]));
for (const T of ['09:30', '10:00', '11:00', '13:00']) {
  const B: Record<string, Obs[]> = { 'ORB (15 min)': [], 'Momentum (25–65% of exp.)': [], 'Gap direction': [], 'PCR (weighted)': [], 'OI walls (base prob)': [], 'ATM OI change': [], 'Combined → CALL/PUT': [], 'Up move (always CALL)': [] };
  for (const day of days) {
    const bars = byDay.get(day)!.sort((a, b) => a.time - b.time);
    const i = pos.get(day);
    if (i == null || i < HIST_DAYS + 2) continue;
    const before = bars.filter((b) => hhmm(b.time) < T), orb = bars.filter((b) => hhmm(b.time) < '09:30');
    const exitBar = bars.filter((b) => hhmm(b.time) < '15:15').at(-1);
    if (before.length < 10 || !orb.length || !exitBar || hhmm(exitBar.time) < '15:00') continue;
    const open = bars[0].open, now = before.at(-1)!.close, move = exitBar.close - now, year = +day.slice(0, 4);
    const prev = idx[i - 1];
    const orbB: Bias = now > Math.max(...orb.map((b) => b.high)) ? 1 : now < Math.min(...orb.map((b) => b.low)) ? -1 : 0;
    const v = vix.get(prev.date);
    const vixMove = v ? open * (v / 100) * Math.sqrt(1 / 252) : null;
    const hist = idx.slice(i - HIST_DAYS, i).reduce((a, x) => a + Math.abs(x.c - x.o), 0) / HIST_DAYS;
    const exp = vixMove != null ? (vixMove + hist) / 2 : hist;
    const frac = Math.abs(now - open) / exp;
    const momB: Bias = frac >= MOM_MIN && frac <= MOM_MAX ? (now > open ? 1 : -1) : 0;
    const gap = open - prev.c, gapB: Bias = gap > 0 ? 1 : gap < 0 ? -1 : 0;
    B['ORB (15 min)'].push({ year, bias: orbB, move });
    B['Momentum (25–65% of exp.)'].push({ year, bias: momB, move });
    B['Gap direction'].push({ year, bias: gapB, move });
    B['Up move (always CALL)'].push({ year, bias: 1, move });
    const ch = chainSignals(prev.date, idx[i - 2]?.date, now);
    if (!ch) continue;
    B['PCR (weighted)'].push({ year, bias: ch.pcr, move });
    B['OI walls (base prob)'].push({ year, bias: ch.walls, move });
    B['ATM OI change'].push({ year, bias: ch.atmOi, move });
    const up = Math.max(0.05, Math.min(0.95, ch.base + 0.05 * (ch.pcr + orbB + gapB + ch.atmOi + momB)));
    B['Combined → CALL/PUT'].push({ year, bias: up >= 0.55 ? 1 : up <= 0.45 ? -1 : 0, move });
  }
  report(`B. Decision at ${T}, NIFTY ${T} → 15:15, last year of minutes`, B, false);
}

const OUT = path.resolve(import.meta.dirname, '../../.data/research');
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'algo-ai-signals.json'), JSON.stringify(out, null, 1));
console.log('\nwritten .data/research/algo-ai-signals.json');
await prisma.$disconnect();
