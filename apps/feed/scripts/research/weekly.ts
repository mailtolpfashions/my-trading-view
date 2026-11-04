// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../../src/fno/span';
const U = 'NIFTY', SLIP = 100, FROM = '2019-03-01';
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65, T = today.spotPaise! / 100;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e) && e >= FROM).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: today.date, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > today.date) last.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...last.values()].sort().filter((e) => idx.has(e)); // these tests hold to expiry, or need it to have passed
type R = { kind: string; strikePaise: number; closePaise: number };
const cache = new Map<string, R[]>();
const load = async (d: string, e: string) => {
  const k = d + e; let r = cache.get(k);
  if (!r) { r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] }, traded: true, closePaise: { gt: 0 } }, select: { kind: true, strikePaise: true, closePaise: true, traded: true } })) as (R & { traded: boolean })[]; for (const kind of ['CE', 'PE']) { const l = r.filter((x: { kind: string; traded?: boolean; closePaise: number }) => x.kind === kind && x.traded !== false && x.closePaise > 0).sort((a: { strikePaise: number }, b: { strikePaise: number }) => a.strikePaise - b.strikePaise); staleFlags(l.map((x: { closePaise: number }) => x.closePaise), kind === 'PE').forEach((f: boolean, i: number) => { if (f) l[i].traded = false; }); } r = r.filter((x) => (x as R & { traded: boolean }).traded); cache.set(k, r); }
  return r;
};
const near = (rows: R[], k: string, t: number) => rows.filter((r) => r.kind === k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const intr = (k: string, K: number, ST: number) => Math.max(0, k === 'CE' ? ST - K : K - ST);
const sp = 400 / T, wp = 200 / T;
type V = { name: string; ratio: boolean; hedge: 'none' | 'monthly' | 'weekly'; away: number };
const vars: V[] = [
  { name: 'Strangle, no hedge', ratio: false, hedge: 'none', away: 0 },
  { name: 'Strangle + monthly hedge 200 out', ratio: false, hedge: 'monthly', away: 200 },
  { name: 'Strangle + WEEKLY hedge 200 out', ratio: false, hedge: 'weekly', away: 200 },
  { name: 'Strangle + monthly hedge 400 out', ratio: false, hedge: 'monthly', away: 400 },
  { name: 'Strangle + WEEKLY hedge 400 out', ratio: false, hedge: 'weekly', away: 400 },
  { name: 'Your 2x version, no final hedge', ratio: true, hedge: 'none', away: 0 },
  { name: 'Your 2x + monthly final hedge 500 out', ratio: true, hedge: 'monthly', away: 500 },
  { name: 'Your 2x + WEEKLY final hedge 500 out', ratio: true, hedge: 'weekly', away: 500 },
];
for (const before of [10, 20]) {
  console.log(`\n=== Monthly, ${before} days before expiry, from ${FROM} ===`);
  for (const v of vars) {
    const out: number[] = []; let hedgeCost = 0, payout = 0, skip = 0, missed = 0, weeks = 0;
    const years: Record<string, number> = {};
    for (const e of monthly) {
      const i = idx.get(e)! - before; if (i < 0) continue;
      const d = dates[i], m = M.get(d)!, ST = M.get(e)!.spotPaise;
      if (!m.spotPaise || !m.lotSize || !ST) { skip++; continue; }
      const scale = todayN / (m.spotPaise * m.lotSize), lot = m.lotSize, rows = await load(d, e);
      let cash = 0, ch = 0, ok = true;
      const fill = (side: 'BUY' | 'SELL', qty: number, px: number, date: string) => {
        const p = side === 'BUY' ? px + SLIP : Math.max(5, px - SLIP);
        cash += (side === 'SELL' ? 1 : -1) * qty * p;
        ch += computeOptionCharges({ side, qty, premiumPaise: p, date }).total;
      };
      const refs: { k: string; s: number; ref: number; q: number }[] = [];
      for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
        const sh = near(rows, k, m.spotPaise * (1 + s * sp));
        if (!sh) { ok = false; break; }
        fill('SELL', lot, sh.closePaise, d); cash -= lot * intr(k, sh.strikePaise, ST);
        let ref = sh.strikePaise, q = 1;
        if (v.ratio) {
          const w = near(rows, k, sh.strikePaise + s * m.spotPaise * wp);
          const two = w && rows.filter((r) => r.kind === k && s * (r.strikePaise - w.strikePaise) > 0).sort((a, b) => Math.abs(a.closePaise - w.closePaise / 2) - Math.abs(b.closePaise - w.closePaise / 2))[0];
          if (!w || !two) { ok = false; break; }
          fill('BUY', lot, w.closePaise, d);
          const ii = intr(k, w.strikePaise, ST); cash += lot * ii; ch += exerciseStt(lot, ii, e);
          fill('SELL', 2 * lot, two.closePaise, d); cash -= 2 * lot * intr(k, two.strikePaise, ST);
          ref = two.strikePaise; q = 2;
        }
        refs.push({ k, s, ref, q });
      }
      if (!ok) { skip++; continue; }
      if (v.hedge === 'monthly') for (const r of refs) {
        const h = near(rows, r.k, r.ref + r.s * m.spotPaise * (v.away / T));
        if (!h) { ok = false; break; }
        const b0 = cash; fill('BUY', r.q * lot, h.closePaise, d); hedgeCost += (b0 - cash) * scale;
        const ii = intr(r.k, h.strikePaise, ST); cash += r.q * lot * ii; payout += r.q * lot * ii * scale; ch += exerciseStt(r.q * lot, ii, e);
      }
      if (v.hedge === 'weekly') {
        let t = d;
        while (t < e) {
          const w = exps.find((x) => x > t);
          if (!w || w > e) break;
          const wk = await load(t, w); const sT = M.get(t)!.spotPaise!, SW = M.get(w)!.spotPaise; weeks++;
          for (const r of refs) {
            const tgt = r.ref + r.s * m.spotPaise * (v.away / T), h = near(wk, r.k, tgt);
            if (!h || Math.abs(h.strikePaise - tgt) > sT * 0.01) { missed++; continue; }
            const b0 = cash; fill('BUY', r.q * lot, h.closePaise, t); hedgeCost += (b0 - cash) * scale;
            const ii = SW ? intr(r.k, h.strikePaise, SW) : 0;
            cash += r.q * lot * ii; payout += r.q * lot * ii * scale; ch += exerciseStt(r.q * lot, ii, w);
          }
          t = w;
        }
      }
      if (!ok) { skip++; continue; }
      const net = (cash - ch) * scale; out.push(net);
      years[e.slice(0, 4)] = (years[e.slice(0, 4)] ?? 0) + net;
    }
    const R = (p: number) => Math.round(p / 100), w = out.filter((x) => x > 0), l = out.filter((x) => x <= 0), sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const aw = sum(w) / w.length, al = -sum(l) / l.length, yrs = Object.values(years);
    console.log(`${v.name.padEnd(38)} n ${out.length} skip ${skip} | won ${(w.length / out.length * 100).toFixed(0)}% | win ${R(aw)} loss ${R(al)} (${(al / aw).toFixed(1)}x) | worst ${R(Math.min(...out))} | net ${R(sum(out))} | lose yrs ${yrs.filter((x) => x < 0).length}/${yrs.length} | hedge cost/trade ${R(hedgeCost / out.length)} back/trade ${R(payout / out.length)}${v.hedge === 'weekly' ? ` | weeks ${weeks} missed ${missed}` : ''}`);
  }
}
const D = today.date, E = '2026-11-23', W = '2026-11-09';
const mr = await load(D, E), wr = await load(D, W);
const q = (rows: R[], k: string, s: number) => (rows.find((r) => r.kind === k && r.strikePaise === s * 100)?.closePaise ?? 0) / 100;
console.log('\nprices', { m24400CE: q(mr, 'CE', 24400), w24400CE: q(wr, 'CE', 24400), m23200PE: q(mr, 'PE', 23200), w23200PE: q(wr, 'PE', 23200) });
const span = (await spanOn(D, U))?.data?.[U];
if (span) {
  const legs = (he: string) => [{ kind: 'CE', expiry: E, strike: 24200, qty: -65 }, { kind: 'PE', expiry: E, strike: 23400, qty: -65 }, { kind: 'CE', expiry: he, strike: 24400, qty: 65 }, { kind: 'PE', expiry: he, strike: 23200, qty: 65 }] as any;
  const mg = (he: string, dt: string) => { const r = positionMargin(span, legs(he), today.spotPaise!, dt); return `${Math.round(r.marginPaise / 100)} (missing ${r.missing.length})`; };
  console.log('margin monthly hedge', mg(E, D));
  console.log('margin weekly hedge', mg(W, D));
  console.log('margin weekly hedge on its expiry day', mg(W, W));
  console.log('margin naked', Math.round(positionMargin(span, [{ kind: 'CE', expiry: E, strike: 24200, qty: -65 }, { kind: 'PE', expiry: E, strike: 23400, qty: -65 }] as any, today.spotPaise!, D).marginPaise / 100));
}
await prisma.$disconnect(); process.exit(0);
