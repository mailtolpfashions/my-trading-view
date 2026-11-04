// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { positionMargin } from '@mtv/options';
import { spanOn } from '../../src/fno/span';
import { MARKET_EVENTS } from '../../src/research/nifty-days';

const U = 'NIFTY', SLIP = 100, FROM = '2019-03-01', BEFORE = 10;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65, T = today.spotPaise! / 100;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e) && e >= FROM).sort();
const lastOfMonth = new Map<string, string>(); for (const e of exps) lastOfMonth.set(e.slice(0, 7), e);
const monthly = [...lastOfMonth.values()];
const events = MARKET_EVENTS.filter((e) => e.id.startsWith('budget') || e.id.startsWith('election')).map((e) => e.from).sort(); // only events with a known date
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const cache = new Map<string, Q[]>();
const load = async (d: string, e: string) => {
  const k = d + e; let r = cache.get(k);
  if (!r) { r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[]; cache.set(k, r); }
  return r;
};
const usable = (r: Q[], k: string) => r.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const near = (r: Q[], k: string, t: number) => usable(r, k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const priceOn = async (d: string, l: Leg) => { const x = (await load(d, l.exp)).find((r) => r.kind === l.k && r.strikePaise === l.K); return x ? (x.traded ? x.closePaise : x.settlePaise) : l.last; };
const intr = (k: string, K: number, S: number) => Math.max(0, k === 'CE' ? S - K : K - S);
type Leg = { k: string; K: number; exp: string; q: number; px: number; last: number };
type Var = {
  name: string; shape: 'ratio' | 'condor';
  finalAway?: number;   // final 2x hedge at entry, points beyond the 2x strike
  touch?: boolean;      // buy the 2x final hedge when the index closes past the protection strike
  eventWeeks?: boolean; // weekly 2x final hedge only over weeks with a budget or election result
  width?: number;       // condor width in points
  limit?: number;       // exit everything at this loss, rupees at today's size
};
const L = 7500;
const vars: Var[] = [
  { name: 'A Your 2x, hold, no limit', shape: 'ratio' },
  { name: 'B Your 2x, exit at 7,500', shape: 'ratio', limit: L },
  { name: 'C Your 2x, exit at 5,000', shape: 'ratio', limit: 5000 },
  { name: 'D 2x + far final hedge 1000 out, hold', shape: 'ratio', finalAway: 1000 },
  { name: 'E 2x + far final hedge 1000 out, exit 7,500', shape: 'ratio', finalAway: 1000, limit: L },
  { name: 'F 2x + far final hedge 1500 out, exit 7,500', shape: 'ratio', finalAway: 1500, limit: L },
  { name: 'G 2x + hedge on touch, hold', shape: 'ratio', touch: true },
  { name: 'H 2x + hedge on touch, exit 7,500', shape: 'ratio', touch: true, limit: L },
  { name: 'I 2x + event-week hedge, hold', shape: 'ratio', eventWeeks: true },
  { name: 'J 2x + event-week hedge, exit 7,500', shape: 'ratio', eventWeeks: true, limit: L },
  { name: 'K Narrow condor, 150 wide, hold', shape: 'condor', width: 150 },
  { name: 'L Narrow condor, 100 wide, hold', shape: 'condor', width: 100 },
  { name: 'M Narrow condor, 200 wide, hold', shape: 'condor', width: 200 },
];
const R = (p: number) => Math.round(p / 100), sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const sp = 400 / T, wp = 200 / T;
console.log(`Monthly expiry, ${BEFORE} trading days before, ${FROM} to ${today.date}. Events: ${events.filter((e) => e >= FROM).length}`);
for (const v of vars) {
  const out: number[] = [], years: Record<string, number> = {};
  let skip = 0, limitHits = 0, touches = 0, eventBuys = 0;
  for (const e of monthly) {
    const i = idx.get(e)! - BEFORE; if (i < 0) continue;
    const d = dates[i], m = M.get(d)!, ST = M.get(e)!.spotPaise;
    if (!m.spotPaise || !m.lotSize || !ST) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot), rows = await load(d, e);
    let cash = 0, ch = 0, ok = true;
    const legs: Leg[] = [];
    const buySell = (l: Omit<Leg, 'px' | 'last' | 'q'> & { q: number }, px: number, date: string) => {
      const side = l.q < 0 ? 'SELL' : 'BUY', qty = Math.abs(l.q) * lot, p = l.q > 0 ? px + SLIP : Math.max(5, px - SLIP);
      cash += (l.q < 0 ? 1 : -1) * qty * p; ch += computeOptionCharges({ side, qty, premiumPaise: p, date }).total;
      legs.push({ ...l, px: p, last: px });
    };
    const twoStrike: Record<string, { K: number; s: number }> = {}, protect: Record<string, number> = {};
    for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
      const sh = near(rows, k, m.spotPaise * (1 + s * sp)); if (!sh) { ok = false; break; }
      buySell({ k, K: sh.strikePaise, exp: e, q: -1 }, sh.closePaise, d);
      if (v.shape === 'condor') {
        const w = near(rows, k, sh.strikePaise + s * m.spotPaise * (v.width! / T));
        if (!w || w === sh) { ok = false; break; }
        buySell({ k, K: w.strikePaise, exp: e, q: 1 }, w.closePaise, d);
        continue;
      }
      const w = near(rows, k, sh.strikePaise + s * m.spotPaise * wp);
      const two = w && usable(rows, k).filter((r) => s * (r.strikePaise - w.strikePaise) > 0).sort((a, b) => Math.abs(a.closePaise - w.closePaise / 2) - Math.abs(b.closePaise - w.closePaise / 2))[0];
      if (!w || !two) { ok = false; break; }
      buySell({ k, K: w.strikePaise, exp: e, q: 1 }, w.closePaise, d);
      buySell({ k, K: two.strikePaise, exp: e, q: -2 }, two.closePaise, d);
      twoStrike[k] = { K: two.strikePaise, s }; protect[k] = w.strikePaise;
      if (v.finalAway) {
        const f = near(rows, k, two.strikePaise + s * m.spotPaise * (v.finalAway / T));
        if (!f || f === two) { ok = false; break; }
        buySell({ k, K: f.strikePaise, exp: e, q: 2 }, f.closePaise, d);
      }
    }
    if (!ok) { skip++; continue; }
    const addEventHedge = async (t: string) => {
      const w = exps.find((x) => x > t);
      if (!w || w > e || !events.some((ev) => ev > t && ev <= w)) return;
      const wk = await load(t, w);
      for (const k of ['CE', 'PE']) {
        const h = near(wk, k, twoStrike[k].K + twoStrike[k].s * m.spotPaise * (500 / T));
        if (h && !legs.some((l) => l.k === k && l.exp === w && l.K === h.strikePaise)) { buySell({ k, K: h.strikePaise, exp: w, q: 2 }, h.closePaise, t); eventBuys++; }
      }
    };
    if (v.eventWeeks) await addEventHedge(d);
    let touched = false, pending = false, hit = false;
    const closeAll = async (t: string) => {
      for (const l of legs.splice(0)) {
        const qty = Math.abs(l.q) * lot, px = await priceOn(t, l), p = l.q > 0 ? Math.max(5, px - SLIP) : px + SLIP;
        cash += (l.q > 0 ? 1 : -1) * qty * p; ch += computeOptionCharges({ side: l.q > 0 ? 'SELL' : 'BUY', qty, premiumPaise: p, date: t }).total;
      }
    };
    for (let j = i + 1; j <= idx.get(e)!; j++) {
      const t = dates[j], spot = M.get(t)!.spotPaise;
      for (const l of [...legs]) {
        if (l.exp !== t) continue;
        const S = spot ?? ST, ii = intr(l.k, l.K, S), qty = Math.abs(l.q) * lot;
        cash += (l.q > 0 ? 1 : -1) * qty * ii; if (l.q > 0) ch += exerciseStt(qty, ii, t);
        legs.splice(legs.indexOf(l), 1);
      }
      if (!legs.length) break;
      if (pending) { await closeAll(t); break; }
      for (const l of legs) l.last = await priceOn(t, l);
      if (v.touch && !touched && spot) {
        for (const k of ['CE', 'PE']) {
          if (!(k === 'CE' ? spot >= protect[k] : spot <= protect[k])) continue;
          touched = true; touches++;
          const r = await load(t, e), h = near(r, k, twoStrike[k].K + twoStrike[k].s * m.spotPaise * (500 / T));
          if (h && !legs.some((l) => l.k === k && l.K === h.strikePaise && l.q > 0)) buySell({ k, K: h.strikePaise, exp: e, q: 2 }, h.closePaise, t);
        }
      }
      if (v.eventWeeks && exps.includes(t)) await addEventHedge(t);
      const open = legs.reduce((s, l) => s + (l.q > 0 ? 1 : -1) * Math.abs(l.q) * lot * l.last, 0);
      if (v.limit && (cash + open - ch) * scale <= -v.limit * 100 && !hit) { hit = true; limitHits++; pending = true; }
    }
    if (legs.length) await closeAll(e);
    const net = (cash - ch) * scale;
    out.push(net); years[e.slice(0, 4)] = (years[e.slice(0, 4)] ?? 0) + net;
  }
  const w = out.filter((x) => x > 0), l = out.filter((x) => x <= 0), yrs = Object.values(years);
  const aw = sum(w) / w.length, al = -sum(l) / l.length;
  const over = out.filter((x) => x < -L * 100).length;
  console.log(`${v.name.padEnd(44)} n ${out.length} skip ${skip} | won ${(w.length / out.length * 100).toFixed(0)}% | win ${R(aw)} loss ${R(al)} (${(al / aw).toFixed(1)}x) | worst ${R(Math.min(...out))} | net ${R(sum(out))} | lose yrs ${yrs.filter((x) => x < 0).length}/${yrs.length} | past 7500: ${over} | limit hits ${limitHits}${v.touch ? ` touches ${touches}` : ''}${v.eventWeeks ? ` event legs ${eventBuys}` : ''}`);
}
const E = '2026-11-23', r = await load(today.date, E), s = today.spotPaise!;
const span = (await spanOn(today.date, U))?.data?.[U];
for (const width of [100, 150, 200]) {
  const a = near(r, 'CE', s * (1 + sp)), b = near(r, 'CE', a.strikePaise + width * 100), c = near(r, 'PE', s * (1 - sp)), f = near(r, 'PE', c.strikePaise - width * 100);
  const credit = (a.closePaise - b.closePaise + c.closePaise - f.closePaise) / 100;
  const ml = Math.max(b.strikePaise - a.strikePaise, c.strikePaise - f.strikePaise) / 100 - credit;
  const mg = span ? positionMargin(span, [{ kind: 'CE', expiry: E, strike: a.strikePaise / 100, qty: -65 }, { kind: 'CE', expiry: E, strike: b.strikePaise / 100, qty: 65 }, { kind: 'PE', expiry: E, strike: c.strikePaise / 100, qty: -65 }, { kind: 'PE', expiry: E, strike: f.strikePaise / 100, qty: 65 }] as any, s, today.date).marginPaise : 0;
  console.log(`\nToday ${width} wide: S ${a.strikePaise / 100}CE ${a.closePaise / 100} B ${b.strikePaise / 100}CE ${b.closePaise / 100} S ${c.strikePaise / 100}PE ${c.closePaise / 100} B ${f.strikePaise / 100}PE ${f.closePaise / 100} | credit ${credit.toFixed(2)} = ${Math.round(credit * 65)} | max loss ${Math.round(ml * 65)} | margin ${R(mg)}`);
}
await prisma.$disconnect(); process.exit(0);
