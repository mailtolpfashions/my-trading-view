// Every entry from 1 month to 2 years, every exit, every position we discussed, with and without the high-IV filter.
// NIFTY monthly expiries, one trade per expiry, entered and exited at the close, no stops or adjustments. Written to
// .data/research/selling-matrix.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-matrix.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { deltaOf, ivAboveMedian, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { ivHistory } from '../src/selling/books';

const U = 'NIFTY', DAY = 86400_000, SLIP = 100;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, D = today.date;
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10 && idx.has(e)).sort();
const lastOf = new Map<string, string>(); for (const e of allExp) lastOf.set(e.slice(0, 7), e);
// A monthly expiry still ahead counts too, because a trade on it can already have finished. Only what is listed today:
// an older listing can carry a date that later moved for a holiday.
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > D) lastOf.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...lastOf.values()].sort();
const history = await ivHistory(U);
const daysTo = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const pick = (t: string) => dates.find((d) => d >= t) ?? null;
const back = (e: string, x: number) => new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10);
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
let cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const k = d + e; let r = cache.get(k);
  if (!r) {
    r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[];
    for (const kind of ['CE', 'PE']) { const l = r.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    cache.set(k, r);
  }
  return r;
}
const usable = (r: Q[], k: string) => r.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const near = (r: Q[], k: string, t: number) => usable(r, k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const quotes = (r: Q[], k: string) => r.filter((x) => x.kind === k).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
type Leg = { k: 'CE' | 'PE'; K: number; q: number; px: number };
function byDelta(r: Q[], d: string, e: string, spot: number, target: number) {
  const T = yearsBetween(d, e), F = parityForward(quotes(r, 'CE'), quotes(r, 'PE'), spot, T) ?? spot, out: Q[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    let best: Q | null = null, gap = 0.05;
    for (const x of usable(r, k)) { if (s * (x.strikePaise - F) <= 0) continue; const v = deltaOf(k, x.closePaise, F, x.strikePaise, T); if (v == null) continue; const g = Math.abs(Math.abs(v) - target); if (g < gap) { gap = g; best = x; } }
    if (!best) return null;
    out.push(best);
  }
  return out;
}
const strangle = (r: Q[], d: string, e: string, s: number, delta: number): Leg[] | null => { const a = byDelta(r, d, e, s, delta); return a && [{ k: 'CE', K: a[0].strikePaise, q: -1, px: a[0].closePaise }, { k: 'PE', K: a[1].strikePaise, q: -1, px: a[1].closePaise }]; };
function straddle(r: Q[], spot: number): Leg[] | null {
  const ce = new Map(usable(r, 'CE').map((x) => [x.strikePaise, x]));
  const b = usable(r, 'PE').filter((x) => ce.has(x.strikePaise)).sort((a, c) => Math.abs(a.strikePaise - spot) - Math.abs(c.strikePaise - spot))[0];
  if (!b || Math.abs(b.strikePaise - spot) > spot * 0.02) return null;
  return [{ k: 'CE', K: b.strikePaise, q: -1, px: ce.get(b.strikePaise)!.closePaise }, { k: 'PE', K: b.strikePaise, q: -1, px: b.closePaise }];
}
function wings(r: Q[], base: Leg[] | null, spot: number, pct: number): Leg[] | null {
  if (!base) return null;
  const out = [...base];
  for (const l of base) {
    const s = l.k === 'CE' ? 1 : -1, tgt = l.K + s * spot * (pct / 100), w = near(r, l.k, tgt);
    if (!w || Math.abs(w.strikePaise - tgt) > spot * 0.015 || s * (w.strikePaise - l.K) <= 0 || w.closePaise >= l.px) return null;
    out.push({ k: l.k, K: w.strikePaise, q: 1, px: w.closePaise });
  }
  return out;
}
function crashPut(r: Q[], base: Leg[] | null, spot: number): Leg[] | null {
  if (!base) return null;
  const tgt = spot * 0.85, w = near(r, 'PE', tgt), sp = base.find((l) => l.k === 'PE')!;
  if (!w || Math.abs(w.strikePaise - tgt) > spot * 0.01 || w.strikePaise >= sp.K) return null;
  return [...base, { k: 'PE', K: w.strikePaise, q: 1, px: w.closePaise }];
}
/** The user's shape: sold options, protection at the breakevens, a far sale that pays for it, and maybe a final buy. */
function shape(r: Q[], base: Leg[] | null, spot: number, mult: number, finalPct: number | null): Leg[] | null {
  if (!base) return null;
  const credit = base.reduce((t, l) => t + l.px, 0), legs = [...base];
  for (const l of base) {
    const s = l.k === 'CE' ? 1 : -1, be = l.K + s * credit, w = near(r, l.k, be);
    if (!w || Math.abs(w.strikePaise - be) > spot * 0.015) return null;
    legs.push({ k: l.k, K: w.strikePaise, q: 1, px: w.closePaise });
    const far = usable(r, l.k).filter((x) => s * (x.strikePaise - w.strikePaise) > 0).sort((a, b) => Math.abs(a.closePaise - w.closePaise / mult) - Math.abs(b.closePaise - w.closePaise / mult))[0];
    if (!far) return null;
    legs.push({ k: l.k, K: far.strikePaise, q: -mult, px: far.closePaise });
    if (finalPct != null) {
      const tgt = far.strikePaise + s * spot * (finalPct / 100), f = near(r, l.k, tgt);
      if (!f || Math.abs(f.strikePaise - tgt) > spot * 0.015 || s * (f.strikePaise - far.strikePaise) <= 0) return null;
      legs.push({ k: l.k, K: f.strikePaise, q: mult, px: f.closePaise });
    }
  }
  return legs;
}
type Maker = (r: Q[], d: string, e: string, s: number) => Leg[] | null;
const STRATS: { id: string; name: string; group: string; make: Maker }[] = [
  { id: 'n10', name: 'Strangle 0.10 delta', group: 'Plain', make: (r, d, e, s) => strangle(r, d, e, s, 0.1) },
  { id: 'n16', name: 'Strangle 0.16 delta', group: 'Plain', make: (r, d, e, s) => strangle(r, d, e, s, 0.16) },
  { id: 'n25', name: 'Strangle 0.25 delta', group: 'Plain', make: (r, d, e, s) => strangle(r, d, e, s, 0.25) },
  { id: 'atm', name: 'Straddle', group: 'Plain', make: (r, _d, _e, s) => straddle(r, s) },
  { id: 'paper', name: 'Paper rule: 0.16 with 15% crash put', group: 'Protected', make: (r, d, e, s) => crashPut(r, strangle(r, d, e, s, 0.16), s) },
  { id: 'p25', name: '0.25 strangle with 15% crash put', group: 'Protected', make: (r, d, e, s) => crashPut(r, strangle(r, d, e, s, 0.25), s) },
  { id: 'ic2', name: 'Iron condor 0.16, 2% wings', group: 'Protected', make: (r, d, e, s) => wings(r, strangle(r, d, e, s, 0.16), s, 2) },
  { id: 'ic4', name: 'Iron condor 0.16, 4% wings', group: 'Protected', make: (r, d, e, s) => wings(r, strangle(r, d, e, s, 0.16), s, 4) },
  { id: 'ifly', name: 'Iron fly, straddle with 4% wings', group: 'Protected', make: (r, _d, _e, s) => wings(r, straddle(r, s), s, 4) },
  { id: 's2', name: 'Your shape: straddle, 2×', group: 'Your shape', make: (r, _d, _e, s) => shape(r, straddle(r, s), s, 2, null) },
  { id: 's3', name: 'Your shape: straddle, 3×', group: 'Your shape', make: (r, _d, _e, s) => shape(r, straddle(r, s), s, 3, null) },
  { id: 's2f', name: 'Your shape: straddle, 2×, final hedge', group: 'Your shape', make: (r, _d, _e, s) => shape(r, straddle(r, s), s, 2, 4) },
  { id: 'g2', name: 'Your shape: 0.16 strangle, 2×', group: 'Your shape', make: (r, d, e, s) => shape(r, strangle(r, d, e, s, 0.16), s, 2, null) },
  { id: 'g3', name: 'Your shape: 0.16 strangle, 3×', group: 'Your shape', make: (r, d, e, s) => shape(r, strangle(r, d, e, s, 0.16), s, 3, null) },
  { id: 'g2f', name: 'Your shape: 0.16 strangle, 2×, final hedge', group: 'Your shape', make: (r, d, e, s) => shape(r, strangle(r, d, e, s, 0.16), s, 2, 4) },
];
const ENTRIES = [30, 45, 60, 90, 120, 180, 270, 365, 450, 540, 730];
const EXITS = [0, 7, 14, 21, 30, 45, 60, 90, 120, 180];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;
const allowed = new Map<string, boolean | null>();
const high = (d: string) => { if (!allowed.has(d)) allowed.set(d, ivAboveMedian(history, d)); return allowed.get(d) === true; };

// Margin on today's prices, for the listed expiry nearest each entry time.
const span = (await spanOn(D, U))?.data?.[U], listed = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry).filter((e) => e > D);
const margins: Record<string, number | null> = {};
for (const st of STRATS) for (const X of ENTRIES) {
  const e = [...listed].sort((a, b) => Math.abs(daysTo(D, a) - X) - Math.abs(daysTo(D, b) - X))[0], r = await load(D, e), legs = st.make(r, D, e, today.spotPaise!);
  if (!legs || !span || Math.abs(daysTo(D, e) - X) > Math.max(10, X * 0.2)) { margins[`${st.id}|${X}`] = null; continue; }
  const m = positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: e, strike: l.K / 100, qty: l.q * today.lotSize!, pricePaise: l.px })) as never, today.spotPaise!, D);
  margins[`${st.id}|${X}`] = m.missing.length ? null : R(m.marginPaise / 100);
}

const rows: Record<string, unknown>[] = [];
for (const X of ENTRIES) {
  cache = new Map();
  for (const st of STRATS) {
    const entries: { e: string; d: string; legs: Leg[]; lot: number; scale: number; hi: boolean }[] = []; let skip = 0;
    for (const e of monthly) {
      const d = pick(back(e, X)); if (!d || d >= e || Math.abs(daysTo(d, e) - X) > Math.max(7, X * 0.12)) continue;
      const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
      const r = await load(d, e), legs = st.make(r, d, e, m.spotPaise);
      if (!legs) { skip++; continue; }
      entries.push({ e, d, legs, lot: m.lotSize, scale: todayN / (m.spotPaise * m.lotSize), hi: high(d) });
    }
    for (const Y of EXITS) {
      if (X - Y < 7) continue;
      const res: { net: number; hi: boolean; year: string; held: number; recent: boolean }[] = []; let thin = 0;
      for (const t of entries) {
        const x = Y ? pick(back(t.e, Y)) : t.e; if (!x || x <= t.d || x > D) continue;
        const atExpiry = Y === 0, ST = M.get(x)!.spotPaise, r = atExpiry ? [] : await load(x, t.e);
        if (atExpiry && !ST) continue;
        let cash = 0, ch = 0;
        for (const l of t.legs) {
          const qty = Math.abs(l.q) * t.lot, sell = l.q < 0, p = sell ? Math.max(5, l.px - SLIP) : l.px + SLIP;
          cash += (sell ? 1 : -1) * qty * p; ch += computeOptionCharges({ side: sell ? 'SELL' : 'BUY', qty, premiumPaise: p, date: t.d }).total;
          if (atExpiry) { const I = Math.max(0, l.k === 'CE' ? ST! - l.K : l.K - ST!); cash += (sell ? -1 : 1) * qty * I; if (!sell) ch += exerciseStt(qty, I, x); }
          else {
            const q = r.find((z) => z.kind === l.k && z.strikePaise === l.K); if (!q?.traded) thin++;
            const mk = q ? (q.traded ? q.closePaise : q.settlePaise) : l.px, c = sell ? mk + SLIP : Math.max(5, mk - SLIP);
            cash += (sell ? -1 : 1) * qty * c; ch += computeOptionCharges({ side: sell ? 'BUY' : 'SELL', qty, premiumPaise: c, date: x }).total;
          }
        }
        res.push({ net: ((cash - ch) * t.scale) / 100, hi: t.hi, year: x.slice(0, 4), held: daysTo(t.d, x), recent: t.d >= '2023' });
      }
      for (const iv of ['all', 'high'] as const) {
        const a = iv === 'high' ? res.filter((x) => x.hi) : res; if (!a.length) continue;
        const n = a.map((x) => x.net), w = n.filter((v) => v > 0), l = n.filter((v) => v <= 0), held = sum(a.map((x) => x.held)), yrs: Record<string, number> = {};
        for (const x of a) yrs[x.year] = (yrs[x.year] ?? 0) + x.net;
        const margin = margins[`${st.id}|${X}`], perMonth = sum(n) / (held / 30.4);
        rows.push({ s: st.id, x: X, y: Y, iv, n: a.length, sk: skip, won: R((w.length / n.length) * 100), win: R(sum(w) / (w.length || 1)), loss: R(-sum(l) / (l.length || 1)), avg: R(sum(n) / n.length), pm: R(perMonth), worst: R(Math.min(...n)), held: R(held / n.length), ly: Object.values(yrs).filter((v) => v < 0).length, yc: Object.keys(yrs).length, s23: R(sum(a.filter((x) => x.recent).map((x) => x.net))), thin, m: margin, pml: margin ? R((perMonth / margin) * 100000) : null });
      }
    }
  }
  console.log(X, 'days done, rows', rows.length);
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-matrix.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: dates[0], to: D, entries: ENTRIES, exits: EXITS, strategies: STRATS.map(({ id, name, group }) => ({ id, name, group })), rows }));
console.log('rows', rows.length);
await prisma.$disconnect();
