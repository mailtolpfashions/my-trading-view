// A deep test of the short NIFTY straddle: entry and exit days, strike, IV filter, profit target, stop, protection and
// re-centring. Rules are ranked on the years up to 2022, then checked on 2023 to today, which they never saw.
// Daily closes only. Written to .data/research/selling-straddle.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-straddle.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { GAP_SHOCKS, gapPnl, ivOf, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { ivHistory } from '../src/selling/books';

const U = 'NIFTY', DAY = 86400_000;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, D = today.date, YEARS = dates.length / 248;
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10 && idx.has(e)).sort();
const lastOf = new Map<string, string>(); for (const e of allExp) lastOf.set(e.slice(0, 7), e);
const monthly = [...lastOf.values()];
const history = await ivHistory(U);
const ivAt = new Map(history.map((p, i) => [p.date, i]));
/** Share of the previous 250 days with lower IV. */
function ivRank(d: string) {
  const i = history.findIndex((p) => p.date >= d); if (i < 60) return null;
  const past = history.slice(Math.max(0, i - 250), i), v = history[i].iv;
  return past.filter((p) => p.iv < v).length / past.length;
}
void ivAt;
const daysTo = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const pick = (t: string) => dates.find((d) => d >= t) ?? null;
const back = (e: string, x: number) => new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10);
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
type Day = { rows: Q[]; by: Map<string, Q> };
const cache = new Map<string, Day>();
async function load(d: string, e: string): Promise<Day> {
  const k = d + e; let v = cache.get(k);
  if (!v) {
    const rows = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[];
    for (const kind of ['CE', 'PE']) { const l = rows.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    v = { rows, by: new Map(rows.map((x) => [`${x.kind}${x.strikePaise}`, x])) };
    cache.set(k, v);
  }
  return v;
}
const usable = (d: Day, k: string) => d.rows.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const near = (d: Day, k: string, t: number) => usable(d, k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const q = (d: Day) => (k: string) => d.rows.filter((x) => x.kind === k).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
function atmStrike(d: Day, target: number, spot: number) {
  const ce = new Set(usable(d, 'CE').map((x) => x.strikePaise));
  const b = usable(d, 'PE').filter((x) => ce.has(x.strikePaise)).sort((a, c) => Math.abs(a.strikePaise - target) - Math.abs(c.strikePaise - target))[0];
  return b && Math.abs(b.strikePaise - target) <= spot * 0.02 ? b.strikePaise : null;
}
type Leg = { k: 'CE' | 'PE'; K: number; q: number; sold: number; last: number; wing?: boolean };
type V = { entry: number; exit: number; atm: 'spot' | 'forward'; filter: 'all' | 'high' | 'top'; target: number | null; stop: number | null; protect: 'none' | 'put15' | 'w5' | 'w8'; recentre: number | null; late?: boolean; slip?: number };
const vars: V[] = [];
for (const entry of [40, 45, 50, 60]) for (const exit of [30, 25, 21, 14]) for (const atm of ['spot', 'forward'] as const) for (const filter of ['all', 'high', 'top'] as const)
  for (const target of [null, 25, 50]) for (const stop of [null, 1, 2]) for (const protect of ['none', 'put15', 'w5', 'w8'] as const) for (const recentre of [null, 3, 5]) vars.push({ entry, exit, atm, filter, target, stop, protect, recentre });
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;
const key = (v: V) => `${v.entry}|${v.exit}|${v.atm}|${v.filter}|${v.target}|${v.stop}|${v.protect}|${v.recentre}`;
const rankOf = new Map<string, number | null>();

async function run(v: V) {
  const SLIP = v.slip ?? 100, out: { date: string; net: number; held: number; reason: string; adj: number }[] = []; let skip = 0;
  for (const e of monthly) {
    const dd = pick(back(e, v.entry)), x = v.exit ? pick(back(e, v.exit)) : e;
    if (!dd || !x || dd >= x || Math.abs(daysTo(dd, e) - v.entry) > 6) continue;
    if (!rankOf.has(dd)) rankOf.set(dd, ivRank(dd));
    const rk = rankOf.get(dd);
    if (v.filter !== 'all' && (rk == null || rk < (v.filter === 'high' ? 0.5 : 0.67))) continue;
    const m = M.get(dd)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    const day = await load(dd, e), T = yearsBetween(dd, e), spot = m.spotPaise;
    const F = v.atm === 'forward' ? parityForward(q(day)('CE'), q(day)('PE'), spot, T) ?? spot : spot, K = atmStrike(day, F, spot);
    if (K == null) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (spot * lot);
    let cash = 0, ch = 0, adj = 0;
    const legs: Leg[] = [];
    const fill = (sell: boolean, px: number) => (sell ? Math.max(5, px - SLIP) : px + SLIP);
    const open = (k: 'CE' | 'PE', K2: number, qty: number, px: number, date: string, wing = false) => { const sell = qty < 0, p = fill(sell, px); cash += (sell ? 1 : -1) * lot * p; ch += computeOptionCharges({ side: sell ? 'SELL' : 'BUY', qty: lot, premiumPaise: p, date }).total; legs.push({ k, K: K2, q: qty, sold: px, last: px, wing }); };
    const close = (l: Leg, date: string) => { const sell = l.q > 0, p = fill(sell, l.last); cash += (sell ? 1 : -1) * lot * p; ch += computeOptionCharges({ side: sell ? 'SELL' : 'BUY', qty: lot, premiumPaise: p, date }).total; legs.splice(legs.indexOf(l), 1); };
    const addProtect = (d: Day, strike: number, date: string, sp: number) => {
      if (v.protect === 'none') return true;
      if (v.protect === 'put15') { const tgt = sp * 0.85, w = near(d, 'PE', tgt); if (!w || Math.abs(w.strikePaise - tgt) > sp * 0.01) return false; open('PE', w.strikePaise, 1, w.closePaise, date, true); return true; }
      const pct = v.protect === 'w5' ? 5 : 8;
      for (const [k, s] of [['CE', 1], ['PE', -1]] as const) { const tgt = strike + s * sp * (pct / 100), w = near(d, k, tgt); if (!w || Math.abs(w.strikePaise - tgt) > sp * 0.015) return false; open(k, w.strikePaise, 1, w.closePaise, date, true); }
      return true;
    };
    const ce = day.by.get(`CE${K}`)!, pe = day.by.get(`PE${K}`)!;
    open('CE', K, -1, ce.closePaise, dd); open('PE', K, -1, pe.closePaise, dd);
    if (!addProtect(day, K, dd, spot)) { skip++; continue; }
    const credit = (legs.reduce((t, l) => t + (l.q < 0 ? 1 : -1) * l.sold, 0)) * lot;
    let reason = 'time', pending: 'exit' | 'recentre' | null = null, done = false;
    for (let j = idx.get(dd)! + 1; j <= idx.get(x)!; j++) {
      const t = dates[j], d = await load(t, e), sp = M.get(t)!.spotPaise ?? spot;
      for (const l of legs) { const z = d.by.get(`${l.k}${l.K}`); if (z) l.last = z.traded ? z.closePaise : z.settlePaise; }
      if (t === e) break;
      const act = (what: 'exit' | 'recentre') => {
        if (what === 'exit') { for (const l of [...legs]) close(l, t); done = true; return; }
        const nk = atmStrike(d, sp, sp), cur = legs.find((l) => !l.wing)!.K; if (nk == null || nk === cur) return;
        const c2 = d.by.get(`CE${nk}`)!, p2 = d.by.get(`PE${nk}`)!;
        for (const l of [...legs]) if (!l.wing || v.protect !== 'put15') close(l, t);
        open('CE', nk, -1, c2.closePaise, t); open('PE', nk, -1, p2.closePaise, t); adj++;
        if (v.protect === 'w5' || v.protect === 'w8') addProtect(d, nk, t, sp);
      };
      if (pending) { act(pending); pending = null; if (done) break; }
      if (t === x) { for (const l of [...legs]) close(l, t); done = true; break; }
      const pnl = cash + legs.reduce((s, l) => s + (l.q > 0 ? 1 : -1) * lot * l.last, 0) - ch;
      let w: 'exit' | 'recentre' | null = null;
      if (v.stop != null && pnl <= -credit * v.stop) { w = 'exit'; reason = 'stop'; }
      else if (v.target != null && pnl >= (credit * v.target) / 100) { w = 'exit'; reason = 'target'; }
      else if (v.recentre != null && adj < 2) { const k0 = legs.find((l) => !l.wing)!.K; if (Math.abs(sp / k0 - 1) >= v.recentre / 100) w = 'recentre'; }
      if (w) { if (v.late) pending = w; else { act(w); if (done) break; } }
    }
    if (!done) {
      const ST = M.get(e)!.spotPaise; if (!ST) { skip++; continue; }
      for (const l of legs) { const I = Math.max(0, l.k === 'CE' ? ST - l.K : l.K - ST); cash += (l.q > 0 ? 1 : -1) * lot * I; if (l.q > 0) ch += exerciseStt(lot, I, e); }
      reason = 'expiry';
    }
    out.push({ date: dd, net: ((cash - ch) * scale) / 100, held: daysTo(dd, x), reason, adj });
  }
  return { out, skip };
}
function stats(v: V, r: Awaited<ReturnType<typeof run>>) {
  const a = r.out, n = a.map((t) => t.net), w = n.filter((x) => x > 0), l = n.filter((x) => x <= 0), yrs: Record<string, number> = {};
  for (const t of a) yrs[t.date.slice(0, 4)] = (yrs[t.date.slice(0, 4)] ?? 0) + t.net;
  let eq = 0, peak = 0, dd = 0; for (const x of n) { eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const before = a.filter((t) => t.date < '2023'), after = a.filter((t) => t.date >= '2023'), bw = before.map((t) => t.net);
  let e2 = 0, p2 = 0, d2 = 0; for (const x of bw) { e2 += x; p2 = Math.max(p2, e2); d2 = Math.max(d2, p2 - e2); }
  return { ...v, n: a.length, skip: r.skip, won: a.length ? R((w.length / a.length) * 100) : 0, win: R(sum(w) / (w.length || 1)), loss: R(-sum(l) / (l.length || 1)), avg: R(sum(n) / (a.length || 1)), year: R(sum(n) / YEARS), worst: a.length ? R(Math.min(...n)) : 0, dd: R(dd), ly: Object.values(yrs).filter((y) => y < 0).length, yc: Object.keys(yrs).length, net: R(sum(n)), to22: R(sum(bw)), n22: bw.length, score22: d2 > 0 ? sum(bw) / d2 : 0, s23: R(sum(after.map((t) => t.net))), n23: after.length, won23: after.length ? R((after.filter((t) => t.net > 0).length / after.length) * 100) : 0, overlap: v.entry - v.exit > 28, adj: sum(a.map((t) => t.adj)), yrs };
}
console.time('grid');
const results = [];
let done = 0;
for (const v of vars) { results.push(stats(v, await run(v))); if (++done % 500 === 0) console.log(done, 'of', vars.length); }
console.timeEnd('grid');
const clean = results.filter((x) => !x.overlap);
const base = (o: Partial<V>) => clean.find((x) => key(x) === key({ entry: 45, exit: 21, atm: 'spot', filter: 'high', target: null, stop: null, protect: 'none', recentre: null, ...o }));
const factors = [
  ['Baseline: 45 to 21 days, high IV, spot strike', {}],
  ['Entry 40 days', { entry: 40 }], ['Entry 50 days', { entry: 50 }], ['Exit 30 days left', { exit: 30 }], ['Exit 25 days left', { exit: 25 }], ['Exit 14 days left', { exit: 14 }],
  ['Every month, no IV filter', { filter: 'all' }], ['Only the top third of IV', { filter: 'top' }], ['Strike at the forward', { atm: 'forward' }],
  ['Book 25% profit', { target: 25 }], ['Book 50% profit', { target: 50 }], ['Stop at 1× credit', { stop: 1 }], ['Stop at 2× credit', { stop: 2 }],
  ['Add 15% crash put', { protect: 'put15' }], ['Wings 8% away', { protect: 'w8' }], ['Wings 5% away', { protect: 'w5' }], ['Re-centre after a 3% move', { recentre: 3 }], ['Re-centre after a 5% move', { recentre: 5 }],
] as [string, Partial<V>][];
const chosen = [...clean].filter((x) => x.n22 >= 30).sort((a, b) => b.score22 - a.score22).slice(0, 25);
const finalists = [];
for (const c of chosen.slice(0, 10)) {
  const v: V = { entry: c.entry, exit: c.exit, atm: c.atm, filter: c.filter, target: c.target, stop: c.stop, protect: c.protect, recentre: c.recentre };
  finalists.push({ ...c, lateYear: stats(v, await run({ ...v, late: true })).year, lateWorst: stats(v, await run({ ...v, late: true })).worst, dearYear: stats(v, await run({ ...v, slip: 200 })).year, fiveYear: stats(v, await run({ ...v, slip: 500 })).year });
}
// Today's prices: margin and gap for each protection, on the nearest expiry to 45 days.
const E = '2026-12-29', dt = await load(D, E), K0 = atmStrike(dt, today.spotPaise!, today.spotPaise!)!, span = (await spanOn(D, U))?.data?.[U], T = yearsBetween(D, E), F = parityForward(q(dt)('CE'), q(dt)('PE'), today.spotPaise!, T) ?? today.spotPaise!;
const today2 = [];
for (const [label, wings] of [['No protection', []], ['15% crash put', [['PE', today.spotPaise! * 0.85]]], ['Wings 8% away', [['CE', K0 + today.spotPaise! * 0.08], ['PE', K0 - today.spotPaise! * 0.08]]], ['Wings 5% away', [['CE', K0 + today.spotPaise! * 0.05], ['PE', K0 - today.spotPaise! * 0.05]]]] as [string, ['CE' | 'PE', number][]][]) {
  const legs = [{ k: 'CE' as const, K: K0, s: 'SELL' as const, px: dt.by.get(`CE${K0}`)!.closePaise }, { k: 'PE' as const, K: K0, s: 'SELL' as const, px: dt.by.get(`PE${K0}`)!.closePaise }, ...wings.map(([k, t]) => { const w = near(dt, k, t); return { k, K: w.strikePaise, s: 'BUY' as const, px: w.closePaise }; })];
  const lot = today.lotSize!, mg = span ? positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: E, strike: l.K / 100, qty: (l.s === 'SELL' ? -1 : 1) * lot, pricePaise: l.px })) as never, today.spotPaise!, D).marginPaise / 100 : null;
  const shock = legs.map((l) => ({ kind: l.k, side: l.s, qty: lot, strikePaise: l.K, pricePaise: l.px, iv: ivOf(l.k, l.px, F, l.K, T) ?? 0.15, T, forwardPaise: F }));
  today2.push({ label, legs: legs.map((l) => `${l.s === 'SELL' ? 'Sell' : 'Buy'} ${l.K / 100} ${l.k} @${l.px / 100}`), credit: R(legs.reduce((t, l) => t + (l.s === 'SELL' ? 1 : -1) * l.px, 0) * lot / 100), margin: mg == null ? null : R(mg), gaps: GAP_SHOCKS.map((g) => ({ gapPct: g.gapPct, pnl: R(gapPnl(shock, g) / 100) })) });
}
const slim = ({ yrs, ...x }: (typeof results)[number]) => x;
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-straddle.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: dates[0], to: D, tested: results.length, factors: factors.map(([label, o]) => ({ label, ...(base(o) ? slim(base(o)!) : {}) })), baseYears: base({})?.yrs, chosen: chosen.map(slim), finalists: finalists.map((f) => ({ ...slim(f as never), years: f.yrs })), today: today2 }));
const P = (x: ReturnType<typeof stats>) => `n ${x.n} won ${x.won}% avg ${x.avg} /yr ${x.year} worst ${x.worst} dd ${x.dd} ly ${x.ly}/${x.yc} to22 ${x.to22} s23 ${x.s23} (${x.n23}, ${x.won23}%) adj ${x.adj}`;
console.log('FACTORS'); for (const [l, o] of factors) { const b = base(o); console.log(l.padEnd(44), b ? P(b) : 'none'); }
console.log('CHOSEN on years to 2022'); for (const c of finalists) console.log(`${c.entry}-${c.exit} ${c.atm} ${c.filter} t${c.target} s${c.stop} ${c.protect} r${c.recentre} | ${P(c as never)} | late ${c.lateYear} worst ${c.lateWorst} ₹2 ${c.dearYear} ₹5 ${c.fiveYear}`);
console.log('TODAY'); for (const t of today2) console.log(t.label, 'credit', t.credit, 'margin', t.margin, t.gaps.filter((g) => Math.abs(g.gapPct) >= 8).map((g) => `${g.gapPct}:${g.pnl}`).join(' '));
await prisma.$disconnect();
