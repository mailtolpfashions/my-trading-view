// What-if research on NSE's own data: how well can we predict tomorrow's option premiums if we know tomorrow's
// NIFTY level? For every trading day d, predict day d+1's NSE closing premium of each liquid NIFTY option (nearest
// two expiries, ±10 strikes around ATM) from day d's chain and the ACTUAL d+1 spot, with four IV models, and compare
// with NSE's actual d+1 close. The spot-vol model is fitted only on days before d (no look-ahead).
// Writes the fitted spot-vol coefficients to packages/options/src/data/spot-vol-fit.json (used by the what-if panel).
// Run: npx tsx --env-file=../../.env scripts/research-whatif.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { black76, yearsToExpiry } from '@mtv/options';
import { RISK_FREE, expiriesOn, getChain, type Chain } from '../src/fno/chain';

const MIN_VOLUME = 100; // contracts traded on the day: below this a close is too thin to trust
const MIN_PREMIUM = 5_00; // paise: % errors on sub-₹5 premiums are meaningless
const BIG_MOVE = 0.015;
const MODELS = ['flat', 'strike', 'moneyness', 'spotvol'] as const;
type Model = (typeof MODELS)[number];
const asOf = (date: string) => Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600;

/** IV smile from the out-of-the-money side of each traded, liquid strike (calls above the forward, puts below). */
function smile(c: Chain): { k: number; iv: number }[] {
  const F = c.forwardPaise!;
  const pts: { k: number; iv: number }[] = [];
  for (const r of c.rows) {
    const s = r.strikePaise >= F ? r.CE : r.PE;
    if (s?.traded && s.iv != null && s.volume >= MIN_VOLUME) pts.push({ k: r.strikePaise, iv: s.iv });
  }
  return pts;
}
function ivAt(sm: { k: number; iv: number }[], k: number): number {
  if (k <= sm[0].k) return sm[0].iv;
  if (k >= sm[sm.length - 1].k) return sm[sm.length - 1].iv;
  let i = 1;
  while (sm[i].k < k) i++;
  const a = sm[i - 1], b = sm[i];
  return a.iv + ((b.iv - a.iv) * (k - a.k)) / (b.k - a.k);
}

// Spot-vol fit: ΔATM IV = a + bUp·max(r,0) + bDown·min(r,0), per days-to-expiry bucket, by least squares.
const DTE = (days: number) => (days <= 1 ? '0-1' : days <= 3 ? '2-3' : days <= 7 ? '4-7' : '8+');
type Acc = { xtx: number[][]; xty: number[]; n: number };
const newAcc = (): Acc => ({ xtx: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], xty: [0, 0, 0], n: 0 });
const fits = new Map<string, Acc>(), pooled = newAcc();
const addSample = (acc: Acc, r: number, dIv: number) => {
  const x = [1, Math.max(r, 0), Math.min(r, 0)];
  for (let i = 0; i < 3; i++) { acc.xty[i] += x[i] * dIv; for (let j = 0; j < 3; j++) acc.xtx[i][j] += x[i] * x[j]; }
  acc.n++;
};
function solve(acc: Acc): number[] | null {
  const m = acc.xtx.map((row, i) => [...row, acc.xty[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}
const coef = (bucket: string) => { const a = fits.get(bucket); return (a && a.n >= 30 && solve(a)) || (pooled.n >= 30 && solve(pooled)) || [0, 0, 0]; };

type Row = { model: Model; absPaise: number; pct: number; big: boolean; money: string; dte: string; date: string };
const rows: Row[] = [];
const samples: { date: string; k: number; right: string; actual: number; pred: Record<Model, number> }[] = [];

const days = (await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY', spotPaise: { not: null } }, orderBy: { date: 'asc' }, select: { date: true } })).map((d) => d.date);
console.log(`${days.length} days ${days[0]} → ${days.at(-1)}`);
let pairs = 0;
for (let i = 0; i + 1 < days.length; i++) {
  const d = days[i], d1 = days[i + 1];
  const exps = (await expiriesOn('NIFTY', d)).filter((e) => e > d1).slice(0, 2);
  const daySamples: [string, number, number][] = [];
  for (const E of exps) {
    const [c0, c1] = await Promise.all([getChain('NIFTY', d, E), getChain('NIFTY', d1, E)]);
    if (!c0?.forwardPaise || !c1?.forwardPaise || !c0.spotPaise || !c1.spotPaise) continue;
    const sm0 = smile(c0), sm1 = smile(c1);
    if (sm0.length < 3 || sm1.length < 3) continue;
    const S0 = c0.spotPaise, S1 = c1.spotPaise, F0 = c0.forwardPaise;
    const r = S1 / S0 - 1;
    const T0 = yearsToExpiry(asOf(d), E), T1 = yearsToExpiry(asOf(d1), E);
    const carry = Math.log(F0 / S0) / T0;
    const F1 = S1 * Math.exp(carry * T1); // predicted forward: today's carry applied to tomorrow's spot
    const atm0 = ivAt(sm0, F0);
    const bucket = DTE(T1 * 365);
    const [a, bUp, bDn] = coef(bucket);
    const dIv = a + bUp * Math.max(r, 0) + bDn * Math.min(r, 0);
    const step = 50_00, atm1 = Math.round(S1 / step) * step;
    for (const row of c1.rows) {
      if (Math.abs(row.strikePaise - atm1) > 10 * step) continue;
      for (const right of ['CE', 'PE'] as const) {
        const s = row[right];
        if (!s?.traded || s.volume < MIN_VOLUME || s.closePaise < MIN_PREMIUM) continue;
        const K = row.strikePaise;
        const ivs: Record<Model, number> = {
          flat: atm0,
          strike: ivAt(sm0, K),
          moneyness: ivAt(sm0, (K * F0) / F1),
          spotvol: Math.max(0.01, ivAt(sm0, (K * F0) / F1) + dIv),
        };
        const pred = {} as Record<Model, number>;
        for (const m of MODELS) pred[m] = black76(right, F1 / 100, K / 100, T1, RISK_FREE, ivs[m]).price * 100;
        const mny = Math.abs(K / F1 - 1);
        const money = mny < 0.005 ? 'ATM' : (right === 'CE') === K < F1 ? `ITM` : mny < 0.02 ? 'OTM near' : 'OTM far';
        for (const m of MODELS) rows.push({ model: m, absPaise: Math.abs(pred[m] - s.closePaise), pct: Math.abs(pred[m] - s.closePaise) / s.closePaise, big: Math.abs(r) >= BIG_MOVE, money, dte: bucket, date: d1 });
        if (d1 === '2024-06-04' && E === exps[0] && K % 200_00 === 0) samples.push({ date: `${d}→${d1} (${E}, NIFTY ${(r * 100).toFixed(2)}%)`, k: K / 100, right, actual: s.closePaise / 100, pred: Object.fromEntries(MODELS.map((m) => [m, Math.round(pred[m]) / 100])) as Record<Model, number> });
      }
    }
    daySamples.push([bucket, r, ivAt(sm1, c1.forwardPaise) - atm0]);
  }
  for (const [b, r, dv] of daySamples) { const acc = fits.get(b) ?? newAcc(); addSample(acc, r, dv); fits.set(b, acc); addSample(pooled, r, dv); } // only after predicting d+1
  pairs++;
  if (pairs % 100 === 0) console.log(`  ${pairs} day pairs, ${rows.length / MODELS.length} predictions`);
}

// ---- report ----
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rup = (p: number) => `₹${(p / 100).toFixed(2)}`;
function table(title: string, filter: (r: Row) => boolean) {
  console.log(`\n${title}`);
  for (const m of MODELS) {
    const sel = rows.filter((r) => r.model === m && filter(r));
    console.log(`  ${m.padEnd(10)} n=${String(sel.length).padStart(6)}  median ${pct(q(sel.map((r) => r.pct), 0.5)).padStart(6)} / ${rup(q(sel.map((r) => r.absPaise), 0.5)).padStart(8)}   p90 ${pct(q(sel.map((r) => r.pct), 0.9)).padStart(6)} / ${rup(q(sel.map((r) => r.absPaise), 0.9)).padStart(8)}`);
  }
}
console.log(`\n${pairs} day pairs, ${rows.length / MODELS.length} option predictions (volume ≥ ${MIN_VOLUME}, premium ≥ ₹${MIN_PREMIUM / 100})`);
console.log(`big-move days (|NIFTY| ≥ ${BIG_MOVE * 100}%): ${new Set(rows.filter((r) => r.big).map((r) => r.date)).size}`);
table('ALL DAYS — next-day premium error (median / p90)', () => true);
table('BIG-MOVE DAYS', (r) => r.big);
for (const money of ['ATM', 'OTM near', 'OTM far', 'ITM']) table(`ALL DAYS, ${money}`, (r) => r.money === money);
for (const money of ['ATM', 'OTM near', 'OTM far']) table(`BIG-MOVE DAYS, ${money}`, (r) => r.big && r.money === money);
for (const dte of ['0-1', '2-3', '4-7', '8+']) table(`ALL DAYS, ${dte} days to expiry`, (r) => r.dte === dte);

console.log('\nSpot-vol fit (full sample): ΔATM IV (vol points) = a + bUp·r⁺ + bDown·r⁻, r in %');
const out: Record<string, { a: number; bUp: number; bDown: number; n: number }> = {};
for (const b of ['0-1', '2-3', '4-7', '8+']) {
  const acc = fits.get(b);
  const c = acc && solve(acc);
  if (!acc || !c) continue;
  out[b] = { a: c[0], bUp: c[1], bDown: c[2], n: acc.n };
  console.log(`  DTE ${b.padEnd(4)} n=${acc.n}  a ${(c[0] * 100).toFixed(2)}  per +1%: ${(c[1] * 100 / 100).toFixed(2)} pts  per −1%: ${(-c[2] * 100 / 100).toFixed(2)} pts`);
}
writeFileSync(path.resolve(import.meta.dirname, '../../../packages/options/src/data/spot-vol-fit.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), from: days[0], to: days.at(-1), dteBuckets: out }, null, 2) + '\n');

console.log('\nExample: 3 → 4 Jun 2024 (election results), nearest expiry, actual NSE close vs predictions');
for (const s of samples) console.log(`  ${s.date} ${s.k} ${s.right}: actual ₹${s.actual}  flat ₹${s.pred.flat}  strike ₹${s.pred.strike}  moneyness ₹${s.pred.moneyness}  spotvol ₹${s.pred.spotvol}`);
await prisma.$disconnect();
