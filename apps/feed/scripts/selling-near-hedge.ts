// The user's idea: the sold options are held from 45 to 21 days before monthly expiry, so buy the protection on the first
// expiry after that exit, not on the monthly itself. It pays only for the days held. Compared with no protection and with
// protection on the same monthly expiry, on the same entries. Weekly contracts exist from 2019, so this test starts there.
// Margin comes from NSE's SPAN file on the latest day. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-near-hedge.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { deltaOf, ivAboveMedian, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { ivHistory } from '../src/selling/books';

const U = 'NIFTY', DAY = 86400_000, SLIP = 100, FROM = '2019-03-01', TOL = Number(process.env.TOL ?? 0.015), why: Record<string, number> = {}, away: number[] = [];
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, D = today.date, YEARS = dates.filter((d) => d >= FROM).length / 248;
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10 && idx.has(e)).sort();
const lastOf = new Map<string, string>(); for (const e of allExp) lastOf.set(e.slice(0, 7), e);
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > D) lastOf.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...lastOf.values()].sort().filter((e) => e >= FROM);
const history = await ivHistory(U);
const pick = (t: string) => dates.find((d) => d >= t) ?? null;
const back = (e: string, x: number) => new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10);
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const k = d + e; let r = cache.get(k);
  if (!r) {
    r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[];
    for (const kind of ['CE', 'PE']) { const l = r.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((f, i) => { if (f) l[i].traded = false; }); }
    cache.set(k, r);
  }
  return r;
}
const expiriesOn = new Map<string, string[]>();
async function listedOn(d: string) {
  let v = expiriesOn.get(d);
  if (!v) { v = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry).filter((e) => e.length === 10 && e > d); expiriesOn.set(d, v); }
  return v;
}
const usable = (r: Q[], k: string) => r.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const near = (r: Q[], k: string, t: number) => usable(r, k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const quotes = (r: Q[], k: string) => r.filter((x) => x.kind === k).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
type Leg = { k: 'CE' | 'PE'; K: number; q: number; px: number; exp: string };
function strangle(r: Q[], d: string, e: string, spot: number, target: number): Leg[] | null {
  const T = yearsBetween(d, e), F = parityForward(quotes(r, 'CE'), quotes(r, 'PE'), spot, T) ?? spot, out: Leg[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    let best: Q | null = null, gap = 0.05;
    for (const x of usable(r, k)) { if (s * (x.strikePaise - F) <= 0) continue; const v = deltaOf(k, x.closePaise, F, x.strikePaise, T); if (v == null) continue; const g = Math.abs(Math.abs(v) - target); if (g < gap) { gap = g; best = x; } }
    if (!best) return null;
    out.push({ k, K: best.strikePaise, q: -1, px: best.closePaise, exp: e });
  }
  return out;
}
function forwardStraddle(r: Q[], d: string, e: string, spot: number): Leg[] | null {
  const F = parityForward(quotes(r, 'CE'), quotes(r, 'PE'), spot, yearsBetween(d, e)) ?? spot, ce = new Map(usable(r, 'CE').map((x) => [x.strikePaise, x]));
  const p = usable(r, 'PE').filter((x) => ce.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - F) - Math.abs(b.strikePaise - F))[0];
  if (!p || Math.abs(p.strikePaise - F) > spot * 0.02) return null;
  return [{ k: 'CE', K: p.strikePaise, q: -1, px: ce.get(p.strikePaise)!.closePaise, exp: e }, { k: 'PE', K: p.strikePaise, q: -1, px: p.closePaise, exp: e }];
}
/** The 2× shape's sold part: protection at the breakevens, then 2 lots further out at half its price. */
function shape2(r: Q[], base: Leg[] | null, spot: number): { legs: Leg[]; far: Record<string, number> } | null {
  if (!base) return null;
  const credit = base.reduce((t, l) => t + l.px, 0), legs = [...base], far: Record<string, number> = {};
  for (const l of base) {
    const s = l.k === 'CE' ? 1 : -1, be = l.K + s * credit, w = near(r, l.k, be);
    if (!w || Math.abs(w.strikePaise - be) > spot * 0.015) return null;
    legs.push({ k: l.k, K: w.strikePaise, q: 1, px: w.closePaise, exp: l.exp });
    const f = usable(r, l.k).filter((x) => s * (x.strikePaise - w.strikePaise) > 0).sort((a, b) => Math.abs(a.closePaise - w.closePaise / 2) - Math.abs(b.closePaise - w.closePaise / 2))[0];
    if (!f) return null;
    legs.push({ k: l.k, K: f.strikePaise, q: -2, px: f.closePaise, exp: l.exp }); far[l.k] = f.strikePaise;
  }
  return { legs, far };
}
type Mode = 'none' | 'same' | 'near';
type Protect = (spot: number, base: Leg[], far: Record<string, number>) => { k: 'CE' | 'PE'; target: number; q: number }[];
const POS: { id: string; name: string; make: (r: Q[], d: string, e: string, s: number) => { legs: Leg[]; far: Record<string, number> } | null; protect: Protect }[] = [
  { id: 'n16', name: '0.16 strangle, put 15% below', make: (r, d, e, s) => { const b = strangle(r, d, e, s, 0.16); return b && { legs: b, far: {} }; }, protect: (s) => [{ k: 'PE', target: s * 0.85, q: 1 }] },
  { id: 'n16b', name: '0.16 strangle, call and put 15% away', make: (r, d, e, s) => { const b = strangle(r, d, e, s, 0.16); return b && { legs: b, far: {} }; }, protect: (s) => [{ k: 'PE', target: s * 0.85, q: 1 }, { k: 'CE', target: s * 1.15, q: 1 }] },
  { id: 'n25', name: '0.25 strangle, put 15% below', make: (r, d, e, s) => { const b = strangle(r, d, e, s, 0.25); return b && { legs: b, far: {} }; }, protect: (s) => [{ k: 'PE', target: s * 0.85, q: 1 }] },
  { id: 'fwd', name: 'Forward straddle, buy at breakevens', make: (r, d, e, s) => { const b = forwardStraddle(r, d, e, s); return b && { legs: b, far: {} }; }, protect: (_s, b) => { const c = b.reduce((t, l) => t + l.px, 0), K = b[0].K; return [{ k: 'CE', target: K + c, q: 1 }, { k: 'PE', target: K - c, q: 1 }]; } },
  { id: 'g2', name: '2× shape on 0.16 strangle, final 2× hedge 4% out', make: (r, d, e, s) => shape2(r, strangle(r, d, e, s, 0.16), s), protect: (s, _b, far) => [{ k: 'CE', target: far.CE + s * 0.04, q: 2 }, { k: 'PE', target: far.PE - s * 0.04, q: 2 }] },
  { id: 's2', name: '2× shape on straddle, final 2× hedge 4% out', make: (r, d, e, s) => shape2(r, forwardStraddle(r, d, e, s), s), protect: (s, _b, far) => [{ k: 'CE', target: far.CE + s * 0.04, q: 2 }, { k: 'PE', target: far.PE - s * 0.04, q: 2 }] },
];
async function withProtection(p: (typeof POS)[number], d: string, e: string, x: string | null, spot: number, mode: Mode) {
  const r = await load(d, e), made = p.make(r, d, e, spot); if (!made) return null;
  if (mode === 'none') return made.legs;
  const base = made.legs.filter((l) => l.q === -1), hedgeExp = mode === 'same' ? e : (await listedOn(d)).find((z) => x != null && z > x);
  if (!hedgeExp || (mode === 'near' && hedgeExp >= e)) { why[p.id + ' no expiry'] = (why[p.id + ' no expiry'] ?? 0) + 1; return null; } // no expiry between the exit and the monthly is listed yet
  const hr = await load(d, hedgeExp), out = [...made.legs];
  for (const h of p.protect(spot, base, made.far)) {
    const w = near(hr, h.k, h.target);
    if (!w || Math.abs(w.strikePaise - h.target) > spot * TOL) { const k = p.id + ' ' + mode + ' no traded strike ' + h.k; why[k] = (why[k] ?? 0) + 1; return null; }
    if (mode === 'near') away.push(Math.abs(w.strikePaise - spot) / spot);
    out.push({ k: h.k, K: w.strikePaise, q: h.q, px: w.closePaise, exp: hedgeExp });
  }
  return out;
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;
async function run(p: (typeof POS)[number], mode: Mode, filter: 'high' | 'all') {
  const nets: { y: string; net: number; entry: string; exit: string; hedge: number; hedgeExp?: string }[] = []; let skip = 0;
  for (const e of monthly) {
    const d = pick(back(e, 45)), x = pick(back(e, 21));
    if (!d || !x || d >= x || (Date.parse(e) - Date.parse(d)) / DAY > 50) continue;
    if (filter === 'high' && ivAboveMedian(history, d) !== true) continue;
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    const legs = await withProtection(p, d, e, x, m.spotPaise, mode);
    if (!legs) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot); let cash = 0, ch = 0, hedge = 0, hedgeExp: string | undefined;
    for (const l of legs) {
      const qty = Math.abs(l.q) * lot, sell = l.q < 0, p0 = sell ? Math.max(5, l.px - SLIP) : l.px + SLIP;
      cash += (sell ? 1 : -1) * qty * p0; ch += computeOptionCharges({ side: sell ? 'SELL' : 'BUY', qty, premiumPaise: p0, date: d }).total;
      const q = (await load(x, l.exp)).find((z) => z.kind === l.k && z.strikePaise === l.K), mk = q ? (q.traded ? q.closePaise : q.settlePaise) : l.px, c = sell ? mk + SLIP : Math.max(5, mk - SLIP);
      cash += (sell ? -1 : 1) * qty * c; ch += computeOptionCharges({ side: sell ? 'BUY' : 'SELL', qty, premiumPaise: c, date: x }).total;
      if (l.exp !== e) { hedge += qty * p0; hedgeExp = l.exp; } else if (mode === 'same' && !sell && l.q > 0 && !(p.id.startsWith('g2') || p.id.startsWith('s2')) ) hedge += qty * p0;
    }
    nets.push({ y: x.slice(0, 4), net: ((cash - ch) * scale) / 100, entry: d, exit: x, hedge: (hedge * scale) / 100, hedgeExp });
  }
  return { nets, skip };
}
function stats(a: { y: string; net: number; hedge: number }[]) {
  const n = a.map((t) => t.net), w = n.filter((v) => v > 0), yrs: Record<string, number> = {};
  for (const t of a) yrs[t.y] = (yrs[t.y] ?? 0) + t.net;
  let eq = 0, peak = 0, dd = 0; for (const v of n) { eq += v; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { trades: a.length, won: a.length ? R((w.length / a.length) * 100) : 0, total: R(sum(n)), perYear: R(sum(n) / YEARS), worst: a.length ? R(Math.min(...n)) : 0, deepest: R(dd), hedgeCost: a.length ? R(sum(a.map((t) => t.hedge)) / a.length) : 0, losingYears: Object.values(yrs).filter((v) => v < 0).length, yearCount: Object.keys(yrs).length };
}
// Margin on the 3 Nov close: the 29 Dec trade, protected on the same expiry or on the last weekly listed before it.
const span = (await spanOn(D, U))?.data?.[U], E = '2026-12-29', listedNow = await listedOn(D), nearNow = [...listedNow].filter((e) => e < E).at(-1)!;
const marginOf = (legs: Leg[], tradeDate = D) => (span ? positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: l.exp, strike: l.K / 100, qty: l.q * today.lotSize!, pricePaise: l.px })) as never, today.spotPaise!, tradeDate) : null);
const out = [];
for (const p of POS) {
  const rows: Record<string, unknown> = { id: p.id, name: p.name };
  const m: Record<string, number | null> = {};
  for (const mode of ['none', 'same', 'near'] as Mode[]) {
    const r0 = await load(D, E), made = p.make(r0, D, E, today.spotPaise!);
    let legs: Leg[] | null = made?.legs ?? null;
    if (made && mode !== 'none') {
      const base = made.legs.filter((l) => l.q === -1), ex = mode === 'same' ? E : nearNow, hr = await load(D, ex);
      legs = [...made.legs];
      for (const h of p.protect(today.spotPaise!, base, made.far)) { const w = near(hr, h.k, h.target); if (!w) { legs = null; break; } legs.push({ k: h.k, K: w.strikePaise, q: h.q, px: w.closePaise, exp: ex }); }
    }
    const res = legs ? marginOf(legs) : null;
    m[mode] = res && !res.missing.length ? R(res.marginPaise / 100) : null;
    if (mode === 'near') { const onExpiry = legs ? marginOf(legs, nearNow) : null; rows.nearExpiryDayMargin = onExpiry && !onExpiry.missing.length ? R(onExpiry.marginPaise / 100) : null; rows.nearLegs = legs?.filter((l) => l.exp !== E).map((l) => `${l.q} ${l.K / 100} ${l.k} ${l.exp} @${l.px / 100}`); rows.sameLegsCredit = null; }
  }
  rows.margin = m;
  for (const filter of ['high', 'all'] as const) for (const mode of ['none', 'same', 'near'] as Mode[]) {
    const { nets, skip } = await run(p, mode, filter);
    rows[`${filter}-${mode}`] = { ...stats(nets), skip, roi: m[mode] ? ((sum(nets.map((t) => t.net)) / YEARS / m[mode]!) * 100) : null };
  }
  const nearSet = (await run(p, 'near', 'high')).nets, same = new Set(nearSet.map((t) => t.entry));
  rows.onNearTrades = { none: stats((await run(p, 'none', 'high')).nets.filter((t) => same.has(t.entry))), same: stats((await run(p, 'same', 'high')).nets.filter((t) => same.has(t.entry))), near: stats(nearSet), last: nearSet.at(-1) };
  out.push(rows);
  console.log(JSON.stringify(rows));
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-near-hedge-' + TOL + '.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: FROM, to: D, years: YEARS, nearNow, rows: out }));
console.log("WHY", JSON.stringify(why)); console.log("AWAY", away.length, Math.min(...away), Math.max(...away));
await prisma.$disconnect();
