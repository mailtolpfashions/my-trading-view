// Monte Carlo on the 45 DTE ATM straddle with India VIX > 25th percentile (2016 on): resample the real trades with
// replacement into 10,000 random histories and read the worst falls, losing years and capital needed. Reads
// .data/research/tasty45-from2016.json (tasty45.ts with FROM=2016-01-01). Money = points × today's lot (65).
// Stress: each history also gets one 8% gap trade, estimated as 8% of today's index − the average credit (at expiry value; ignores time value left).
// Run: npx tsx scripts/research/straddle-montecarlo.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const j = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../.data/research/tasty45-from2016.json'), 'utf8'));
const rows: { entry: string; pts: number; vixPct: number | null; rupees: number; spotIn: number; credit: number }[] = j.variants['ATM straddle'].rows;
const VIX = Number(process.env.VIX ?? 25); // 0 = no filter
const t = VIX ? rows.filter((r) => (r.vixPct ?? -1) > VIX / 100) : rows;
const LOT = 65, N = 10_000;
const SPOT = j.today.spot as number; // every trade rescaled to today's index: points × today / index at entry
const pts = t.map((r) => (r.pts * SPOT) / r.spotIn);
const years = (Date.parse('2026-11-02') - Date.parse(t[0].entry)) / (365.25 * 864e5);
const perYear = Math.round(t.length / years);
console.log(`trades ${t.length} from ${t[0].entry} to ${t.at(-1)!.entry}, ${years.toFixed(1)} years, ~${perYear}/yr; real total ${pts.reduce((a, b) => a + b, 0).toFixed(0)} pts`);

// seeded random for repeatable results
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const creditPct = t.reduce((a, r) => a + r.credit / r.spotIn, 0) / t.length; // average credit as a share of the index
const gap = -(0.08 - creditPct) * SPOT;
console.log(`stress trade (estimate): 8% gap = ${gap.toFixed(0)} pts (${Math.round(gap * LOT).toLocaleString('en-IN')} ₹)  [index ${SPOT}, average credit ${(creditPct * 100).toFixed(2)}% of index]`);

function run(stress: boolean) {
  const dd: number[] = [], tot: number[] = [], loseYr: number[] = [], worstYr: number[] = [];
  for (let k = 0; k < N; k++) {
    const seq = Array.from({ length: t.length }, () => pts[Math.floor(rnd() * pts.length)]);
    if (stress) seq[Math.floor(rnd() * seq.length)] = gap;
    let eq = 0, peak = 0, m = 0;
    for (const x of seq) { eq += x; peak = Math.max(peak, eq); m = Math.min(m, eq - peak); }
    dd.push(m); tot.push(eq);
    let lose = 0, wy = Infinity;
    for (let y = 0; y + perYear <= seq.length; y += perYear) { const s = seq.slice(y, y + perYear).reduce((a, b) => a + b, 0); if (s < 0) lose++; wy = Math.min(wy, s); }
    loseYr.push(lose / Math.floor(seq.length / perYear)); worstYr.push(wy);
  }
  const r = (p: number) => Math.round(p * LOT).toLocaleString('en-IN');
  console.log(`\n${stress ? 'WITH one 8% gap per history' : 'Real trades only'} (${N} histories of ${t.length} trades)`);
  console.log(`  worst fall: median ${q(dd, 0.5).toFixed(0)} pts (₹${r(q(dd, 0.5))}) | 1 in 20 worse than ${q(dd, 0.05).toFixed(0)} (₹${r(q(dd, 0.05))}) | 1 in 100 worse than ${q(dd, 0.01).toFixed(0)} (₹${r(q(dd, 0.01))})`);
  console.log(`  total: median ${q(tot, 0.5).toFixed(0)} pts | 1 in 20 below ${q(tot, 0.05).toFixed(0)} | histories losing overall ${((tot.filter((x) => x < 0).length / N) * 100).toFixed(1)}%`);
  console.log(`  chance a year (${perYear} trades) loses: ${((loseYr.reduce((a, b) => a + b, 0) / N) * 100).toFixed(1)}% | worst year, 1 in 20: ${q(worstYr, 0.05).toFixed(0)} pts (₹${r(q(worstYr, 0.05))})`);
  for (const cap of [300_000, 500_000, 1_100_000]) {
    const capPts = cap / LOT;
    const f = (lim: number) => ((dd.filter((x) => -x > lim * capPts).length / N) * 100).toFixed(1);
    console.log(`  capital ₹${cap.toLocaleString('en-IN')}: fall >20% in ${f(0.2)}% | >30% in ${f(0.3)}% | >50% in ${f(0.5)}% of histories`);
  }
  console.log(`  capital so the worst fall stays under 20% in 95% of histories: ₹${Math.round((-q(dd, 0.05) * LOT) / 0.2).toLocaleString('en-IN')}`);
}
run(false);
run(true);
