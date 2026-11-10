// Phase 1 of the user's "NIFTY 50 Intraday Option-Selling Engine v14": measure what the spec says must be measured
// before any check may carry weight (spec rules 5–7, steps 2, 4, 15 and the base-rate section).
//
//  1. Base rates on NSE daily data, 2011 → today and the last year alone (value + n + dates).
//  2. The ten directional checks on the 1-minute history (last ~252 sessions), at decision times after 4+ completed
//     15-minute candles; outcome = NIFTY at the decision time → 15:30 (last minute's close). Weight by the spec rule.
//     Then the Pressure Ratio with those weights: in-sample, and honestly (weights from the first half, scored on the
//     second half).
//  3. E4 = P(NIFTY stays within ±0.25×ATR of the spot at T until 15:30), and extension odds beyond the day's high/low.
//
// Definitions the spec leaves open are marked JUDGMENT in the output. The intraday OI shift can't be measured (option
// minutes only from 2026-11-04) and the VWAP proxy has no history (NIFTYBEES not recorded): a time-weighted average
// since the open stands in for it, labelled as such.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/seller-v14-phase1.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

const out: Record<string, unknown> = {};
const pct = (x: number | null) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const band = (n: number) => (n ? 1.96 * Math.sqrt(0.25 / n) : 0);

// ---- daily data and ATR(14, Wilder) -------------------------------------------------------------------------------
const daily = (await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, orderBy: { date: 'asc' } }))
  .map((r) => ({ date: r.date, o: r.openPaise / 100, h: r.highPaise / 100, l: r.lowPaise / 100, c: r.closePaise / 100 }));
const atrOf = new Map<string, number>(); // ATR known at the START of that date (from days before it)
{
  let atr: number | null = null;
  const trs: number[] = [];
  for (let i = 1; i < daily.length; i++) {
    atrOf.set(daily[i].date, atr ?? NaN);
    const d = daily[i], p = daily[i - 1];
    const tr = Math.max(d.h - d.l, Math.abs(d.h - p.c), Math.abs(d.l - p.c));
    if (atr == null) { trs.push(tr); if (trs.length === 14) atr = trs.reduce((a, b) => a + b, 0) / 14; } else atr = (atr * 13 + tr) / 14;
  }
}
console.log(`NIFTY daily ${daily.length} (${daily[0].date} → ${daily.at(-1)!.date}); ATR seeded from ${daily[1].date}, so not seed-heavy after 2011`);

// ---- 1. base rates ------------------------------------------------------------------------------------------------
function baseRates(from: string) {
  const rows = daily.map((d, i) => ({ d, p: daily[i - 1] })).filter((x) => x.p && x.d.date >= from);
  const gaps = rows.filter((x) => x.d.o !== x.p.c);
  const up = gaps.filter((x) => x.d.o > x.p.c), down = gaps.filter((x) => x.d.o < x.p.c);
  const cont = gaps.filter((x) => (x.d.o > x.p.c ? x.d.c > x.d.o : x.d.c < x.d.o)).length;
  const fill = gaps.filter((x) => (x.d.o > x.p.c ? x.d.l <= x.p.c : x.d.h >= x.p.c)).length;
  const body = rows.map((x) => Math.abs(x.d.c - x.d.o) / Math.max(1e-9, x.d.h - x.d.l));
  const share = (f: (b: number) => boolean) => body.filter(f).length;
  // Large gap → large range: day range/ATR on the top quarter of |gap|/ATR vs the rest
  const g = rows.filter((x) => Number.isFinite(atrOf.get(x.d.date)!)).map((x) => { const atr = atrOf.get(x.d.date)!; return { gap: Math.abs(x.d.o - x.p.c) / atr, range: (x.d.h - x.d.l) / atr }; }).sort((a, b) => a.gap - b.gap);
  const q = Math.floor(g.length * 0.75), mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const r = {
    dates: `${rows[0].d.date} → ${rows.at(-1)!.d.date}`, days: rows.length,
    gapContinues: { k: cont, n: gaps.length },
    afterGapDownCloseAboveOpen: { k: down.filter((x) => x.d.c > x.d.o).length, n: down.length },
    afterGapUpCloseBelowOpen: { k: up.filter((x) => x.d.c < x.d.o).length, n: up.length },
    gapFills: { k: fill, n: gaps.length },
    largeGapRange: { topQuarterRangeAtr: mean(g.slice(q).map((x) => x.range)), restRangeAtr: mean(g.slice(0, q).map((x) => x.range)), n: g.length },
    bodyShare: { under35: { k: share((b) => b < 0.35), n: body.length }, atLeast50: { k: share((b) => b >= 0.5), n: body.length }, atLeast65: { k: share((b) => b >= 0.65), n: body.length } },
  };
  const f = (x: { k: number; n: number }) => `${pct(x.k / x.n)} (${x.k}/${x.n})`;
  console.log(`\n=== 1. Base rates ${r.dates} (${r.days} days) ===`);
  console.log(`  gap direction continues open→close   ${f(r.gapContinues)}   [spec: 53% (116/219)]`);
  console.log(`  after gap DOWN, close above open     ${f(r.afterGapDownCloseAboveOpen)}   [spec: 45% (47/104)]`);
  console.log(`  after gap UP, close below open       ${f(r.afterGapUpCloseBelowOpen)}   [spec: 49% (56/115)]`);
  console.log(`  gap fills intraday                   ${f(r.gapFills)}   [spec: 52% (113/219)]`);
  console.log(`  largest-quarter gaps: range ${r.largeGapRange.topQuarterRangeAtr.toFixed(2)} ATR vs ${r.largeGapRange.restRangeAtr.toFixed(2)} ATR on other days   [spec: no signal, n=244]`);
  console.log(`  body < 35% of range (indecisive)     ${f(r.bodyShare.under35)}   [spec: 33% (85/259)]`);
  console.log(`  body ≥ 50% / ≥ 65% of range          ${f(r.bodyShare.atLeast50)} / ${f(r.bodyShare.atLeast65)}   [spec "trend day" 63% (162/259): definition not given]`);
  return r;
}
const oneYearAgo = new Date(Date.parse(daily.at(-1)!.date) - 365 * 86400_000).toISOString().slice(0, 10);
out.baseRates = { all: baseRates('2011-01-01'), lastYear: baseRates(oneYearAgo) };

// ---- 2. intraday checks -----------------------------------------------------------------------------------------
const store = new MinuteStore();
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const hm = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
async function sessions(sym: string) {
  const bars = (await store.read(sym, Math.floor(Date.parse('2024-01-01') / 1000))) as Bar[];
  const m = new Map<string, Bar[]>();
  for (const b of bars) { const mm = hm(b.time); if (mm < 555 || mm >= 930) continue; (m.get(dateOfIst(b.time)) ?? m.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b); }
  for (const v of m.values()) v.sort((a, b) => a.time - b.time);
  return m;
}
const HEAVY = ['HDFCBANK', 'ICICIBANK', 'RELIANCE', 'INFY', 'TCS'];
const N = await sessions('NIFTY'), BN = await sessions('BANKNIFTY');
const H = Object.fromEntries(await Promise.all(HEAVY.map(async (s) => [s, await sessions(s)] as const)));
const days = [...N.keys()].filter((d) => (N.get(d)!.length >= 360) && atrOf.has(d)).sort();
console.log(`\nNIFTY full sessions ${days.length} (${days[0]} → ${days.at(-1)}); sessions with < 360 minutes skipped: ${N.size - days.length}`);

// Continuous 15-minute closes for RSI(14, Wilder) across sessions
const c15: { day: string; end: number; close: number }[] = [];
for (const d of [...N.keys()].sort()) { const bars = N.get(d)!; for (let s = 555; s < 930; s += 15) { const inC = bars.filter((b) => hm(b.time) >= s && hm(b.time) < s + 15); if (inC.length) c15.push({ day: d, end: s + 15, close: inC.at(-1)!.close }); } }
const rsiAt = new Map<string, number>();
{ let g = 0, l = 0, n = 0; for (let i = 1; i < c15.length; i++) { const ch = c15[i].close - c15[i - 1].close, up = Math.max(ch, 0), dn = Math.max(-ch, 0); if (n < 14) { g += up / 14; l += dn / 14; n++; } else { g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; } if (n >= 14) rsiAt.set(`${c15[i].day}|${c15[i].end}`, l === 0 ? 100 : 100 - 100 / (1 + g / l)); } }

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0) as 1 | -1 | 0;
const prevDay = (m: Map<string, Bar[]>, d: string) => { const ks = [...m.keys()].filter((k) => k < d).sort(); return ks.length ? m.get(ks.at(-1)!)! : null; };
const vwap = (bars: Bar[]) => { let pv = 0, v = 0; for (const b of bars) { pv += ((b.high + b.low + b.close) / 3) * b.volume; v += b.volume; } return v ? pv / v : null; };
const CHECKS = ['1 Price vs reference close', '2 Price vs TWAP (VWAP stand-in)', '3 15m structure (HH-HL / LH-LL)', '4 15m RSI(14) side of 50', '5 Opening range (above/below)', '6 Heavyweights green (≥4 / ≤1 of 5)', '7 Heavyweights vs own VWAP (≥4 / ≤1)', '9 Bank Nifty vs its ref close', '10 Last 30-min drift'] as const;
const TIMES = [10 * 60 + 15, 10 * 60 + 30, 11 * 60 + 15, 12 * 60, 13 * 60, 14 * 60, 14 * 60 + 45];
const tName = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
type Obs = { day: string; t: number; v: (1 | -1 | 0)[]; move: number; spot: number; atr: number; hiAfter: number; loAfter: number; dayHi: number; dayLo: number };
const obs: Obs[] = [];
let disputed = 0, disputeChecked = 0;
for (const d of days) {
  const bars = N.get(d)!, prev = prevDay(N, d);
  if (!prev) continue;
  const atr = atrOf.get(d)!;
  const ref = prev.at(-1)!.close; // previous session's last minute close (15:29)
  const official = daily.find((x) => x.date === [...N.keys()].filter((k) => k < d).sort().at(-1))?.c;
  if (official) { disputeChecked++; if (Math.abs(official - ref) > 0.15 * atr) disputed++; }
  const last = bars.at(-1)!;
  if (hm(last.time) < 929) continue; // need the 15:29 minute as the deadline price
  const orb = bars.filter((b) => hm(b.time) < 570);
  for (const T of TIMES) {
    const before = bars.filter((b) => hm(b.time) < T), after = bars.filter((b) => hm(b.time) >= T);
    if (before.length < 30 || !after.length) continue;
    const spot = before.at(-1)!.close;
    const done15 = c15.filter((c) => c.day === d && c.end <= T);
    const v: (1 | -1 | 0)[] = [];
    v.push(sign(spot - ref));
    v.push(sign(spot - before.reduce((a, b) => a + b.close, 0) / before.length));
    const [a, b2] = done15.slice(-2);
    const hh = (k: number) => { const s = k - 15; const cb = bars.filter((x) => hm(x.time) >= s && hm(x.time) < k); return { h: Math.max(...cb.map((x) => x.high)), l: Math.min(...cb.map((x) => x.low)) }; };
    if (a && b2) { const A = hh(a.end), B = hh(b2.end); v.push(B.h > A.h && B.l > A.l ? 1 : B.h < A.h && B.l < A.l ? -1 : 0); } else v.push(0);
    const rsi = rsiAt.get(`${d}|${done15.at(-1)?.end}`);
    v.push(rsi == null || rsi > 70 || rsi < 30 ? 0 : sign(rsi - 50)); // spec rule 10: extremes score zero
    v.push(spot > Math.max(...orb.map((x) => x.high)) ? 1 : spot < Math.min(...orb.map((x) => x.low)) ? -1 : 0);
    let green = 0, aboveV = 0, seen = 0;
    for (const s of HEAVY) {
      const hb = H[s].get(d)?.filter((x) => hm(x.time) < T), hp = prevDay(H[s], d);
      if (!hb?.length || !hp) continue;
      seen++;
      if (hb.at(-1)!.close > hp.at(-1)!.close) green++;
      const vw = vwap(hb); if (vw != null && hb.at(-1)!.close > vw) aboveV++;
    }
    v.push(seen < 5 ? 0 : green >= 4 ? 1 : green <= 1 ? -1 : 0);
    v.push(seen < 5 ? 0 : aboveV >= 4 ? 1 : aboveV <= 1 ? -1 : 0);
    const bnb = BN.get(d)?.filter((x) => hm(x.time) < T), bnp = prevDay(BN, d);
    v.push(bnb?.length && bnp ? sign(bnb.at(-1)!.close - bnp.at(-1)!.close) : 0);
    const ago = before.filter((x) => hm(x.time) < T - 30).at(-1);
    v.push(ago ? sign(spot - ago.close) : 0);
    obs.push({ day: d, t: T, v, move: last.close - spot, spot, atr, hiAfter: Math.max(...after.map((x) => x.high)), loAfter: Math.min(...after.map((x) => x.low)), dayHi: Math.max(...before.map((x) => x.high)), dayLo: Math.min(...before.map((x) => x.low)) });
  }
}
console.log(`Reference close dispute (official close vs last traded minute, > 0.15×ATR): ${disputed} of ${disputeChecked} sessions`);

const weight = (hit: number | null, n: number) => (hit == null ? 0.5 : hit >= 0.6 && n >= 200 ? 1 : hit >= 0.55 ? 0.5 : 0);
function hitTable(list: Obs[]) {
  return CHECKS.map((_, i) => {
    const act = list.filter((o) => o.v[i] !== 0 && o.move !== 0);
    const hit = act.length ? act.filter((o) => sign(o.move) === o.v[i]).length / act.length : null;
    return { hit, n: act.length, of: list.length };
  });
}
const checksOut: Record<string, unknown> = {};
console.log('\n=== 2. The ten directional checks: hit rate to 15:30 (n = sessions where the check had a side) ===');
console.log('check'.padEnd(40) + TIMES.map((t) => tName(t).padStart(14)).join(''));
const tables = Object.fromEntries(TIMES.map((t) => [t, hitTable(obs.filter((o) => o.t === t))]));
CHECKS.forEach((c, i) => {
  console.log(c.padEnd(40) + TIMES.map((t) => { const x = tables[t][i]; return `${pct(x.hit)} (${x.n})`.padStart(14); }).join(''));
  checksOut[c] = Object.fromEntries(TIMES.map((t) => [tName(t), { ...tables[t][i], weight: weight(tables[t][i].hit, tables[t][i].n), chanceBand: band(tables[t][i].n) }]));
});
console.log('8 Intraday OI shift'.padEnd(40) + '   not measurable (option minutes from 2026-11-04) → ±0.5, hit rate UNKNOWN');
console.log('\nSpec weights (≥60% over 200+ → 1, 55–60% → 0.5, <55% → 0):');
CHECKS.forEach((c, i) => console.log('  ' + c.padEnd(38) + TIMES.map((t) => String(weight(tables[t][i].hit, tables[t][i].n)).padStart(6)).join('')));
console.log('Beats chance (hit rate outside the 95% coin-flip band):');
CHECKS.forEach((c, i) => console.log('  ' + c.padEnd(38) + TIMES.map((t) => { const x = tables[t][i]; return (x.hit != null && Math.abs(x.hit - 0.5) > band(x.n) ? (x.hit > 0.5 ? 'yes' : 'WORSE') : '·').padStart(6); }).join('')));
out.checks = checksOut;

// Redundancy (rule 8 / step 4A): how often two price checks give the same side when both have one
const PRICE = [0, 1, 2, 4, 8];
console.log('\nRedundancy: same side when both checks have one (all decision times)');
const red: Record<string, number> = {};
for (let a = 0; a < PRICE.length; a++) for (let b = a + 1; b < PRICE.length; b++) {
  const both = obs.filter((o) => o.v[PRICE[a]] !== 0 && o.v[PRICE[b]] !== 0);
  const same = both.filter((o) => o.v[PRICE[a]] === o.v[PRICE[b]]).length / Math.max(1, both.length);
  red[`${CHECKS[PRICE[a]]} ~ ${CHECKS[PRICE[b]]}`] = same;
  console.log(`  ${CHECKS[PRICE[a]].slice(0, 30).padEnd(31)} ~ ${CHECKS[PRICE[b]].slice(0, 30).padEnd(31)} ${pct(same)} (${both.length})`);
}
out.redundancy = red;

// Pressure Ratio with measured weights (+ OI shift unknown at ±0.5 but no value → contributes to the denominator only when it has a side; it never has one here)
function pressure(list: Obs[], weightsFrom: Obs[]) {
  const W = Object.fromEntries(TIMES.map((t) => [t, hitTable(weightsFrom.filter((o) => o.t === t)).map((x) => weight(x.hit, x.n))]));
  const buckets: Record<string, { k: number; n: number }> = { 'Strong (≥0.50)': { k: 0, n: 0 }, 'Moderate (0.30–0.50)': { k: 0, n: 0 }, 'No edge (<0.30)': { k: 0, n: 0 }, 'No live weight': { k: 0, n: 0 } };
  for (const o of list) {
    const w = W[o.t];
    const den = o.v.reduce((s, x, i) => s + (x !== 0 ? w[i] : 0), 0), num = o.v.reduce((s, x, i) => s + x * w[i], 0);
    if (!den) { buckets['No live weight'].n++; continue; }
    const pr = num / den, key = Math.abs(pr) >= 0.5 ? 'Strong (≥0.50)' : Math.abs(pr) >= 0.3 ? 'Moderate (0.30–0.50)' : 'No edge (<0.30)';
    buckets[key].n++;
    if (key !== 'No edge (<0.30)' && sign(o.move) === sign(pr)) buckets[key].k++;
  }
  return buckets;
}
const half = days[Math.floor(days.length / 2)];
const first = obs.filter((o) => o.day < half), second = obs.filter((o) => o.day >= half);
const inS = pressure(obs, obs), oos = pressure(second, first);
console.log(`\nPressure Ratio, measured weights. In-sample (weights and score on all ${days.length} sessions) | honest (weights ${days[0]}→${half}, scored ${half}→${days.at(-1)}):`);
for (const k of Object.keys(inS)) console.log(`  ${k.padEnd(22)} in-sample ${k.startsWith('No') ? `${inS[k].n} obs` : `${pct(inS[k].n ? inS[k].k / inS[k].n : null)} (${inS[k].n})`}   honest ${k.startsWith('No') ? `${oos[k].n} obs` : `${pct(oos[k].n ? oos[k].k / oos[k].n : null)} (${oos[k].n})`}`);
out.pressure = { inSample: inS, honest: oos, split: half };

// ---- 3. E4 and extension odds ---------------------------------------------------------------------------------------
console.log('\n=== 3. E4 and extension odds, by decision time (n sessions) ===');
console.log('time      n   E4 stay ±0.25 ATR   new high or low after T: +0     +0.10 ATR  +0.25 ATR  +0.50 ATR   (high side / low side at +0.25)');
const e4: Record<string, unknown> = {};
for (const T of TIMES) {
  const L = obs.filter((o) => o.t === T), n = L.length;
  const stay = L.filter((o) => o.hiAfter <= o.spot + 0.25 * o.atr && o.loAfter >= o.spot - 0.25 * o.atr).length;
  const ext = (k: number) => L.filter((o) => o.hiAfter > o.dayHi + k * o.atr || o.loAfter < o.dayLo - k * o.atr).length / n;
  const hiS = L.filter((o) => o.hiAfter > o.dayHi + 0.25 * o.atr).length / n, loS = L.filter((o) => o.loAfter < o.dayLo - 0.25 * o.atr).length / n;
  console.log(`${tName(T)}  ${String(n).padStart(4)}   ${pct(stay / n).padStart(8)} (${stay})          ${[0, 0.1, 0.25, 0.5].map((k) => pct(ext(k)).padStart(9)).join('  ')}    ${pct(hiS)} / ${pct(loS)}`);
  e4[tName(T)] = { n, stay, e4: stay / n, beyondExtreme: Object.fromEntries([0, 0.1, 0.25, 0.5].map((k) => [k, ext(k)])), highSide025: hiS, lowSide025: loS };
}
out.e4 = e4;
out.meta = { sessions: days.length, from: days[0], to: days.at(-1), times: TIMES.map(tName), referenceDispute: { disputed, checked: disputeChecked } };

const OUT = path.resolve(import.meta.dirname, '../../.data/research');
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'seller-v14-phase1.json'), JSON.stringify(out, null, 1));
console.log('\nwritten .data/research/seller-v14-phase1.json');
await prisma.$disconnect();
