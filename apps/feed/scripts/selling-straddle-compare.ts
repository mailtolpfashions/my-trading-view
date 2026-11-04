// The user's four straddle positions, compared directly: forward straddle, and forward plus spot straddle, each with and
// without protection, for exits at 21 and 25 days left, in high-IV months and every month. Protection buys a call and a put
// away from the strike by the straddle's own combined premium, so each straddle has its own pair at its breakevens.
// Written to .data/research/selling-compare.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-straddle-compare.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { GAP_SHOCKS, gapPnl, ivAboveMedian, ivOf, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { ivHistory } from '../src/selling/books';

const U = 'NIFTY', DAY = 86400_000;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, D = today.date, YEARS = dates.length / 248;
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10 && idx.has(e)).sort();
const lastOf = new Map<string, string>(); for (const e of allExp) lastOf.set(e.slice(0, 7), e);
// A monthly expiry still ahead counts too: its 21-day exit can already be behind us. Only what is listed today, because an
// older listing can carry a date that later moved.
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > D) lastOf.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...lastOf.values()].sort();
const history = await ivHistory(U);
// Big NIFTY days from NSE's official index file: a gap of 2% or more at the open, or a 3% move on the day.
const indexRows = await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, select: { date: true, openPaise: true, closePaise: true }, orderBy: { date: 'asc' } });
const bigDays = indexRows.slice(1).flatMap((r, i) => {
  const prev = indexRows[i].closePaise, gap = (r.openPaise / prev - 1) * 100, day = (r.closePaise / prev - 1) * 100;
  return Math.abs(gap) >= 2 || Math.abs(day) >= 3 ? [{ date: r.date, text: `${r.date}: gap ${gap.toFixed(1)}%, day ${day.toFixed(1)}%` }] : [];
});
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
const q = (d: Day, k: string) => d.rows.filter((x) => x.kind === k).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
function strikeAt(d: Day, target: number, spot: number) {
  const ce = new Set(usable(d, 'CE').map((x) => x.strikePaise));
  const b = usable(d, 'PE').filter((x) => ce.has(x.strikePaise)).sort((a, c) => Math.abs(a.strikePaise - target) - Math.abs(c.strikePaise - target))[0];
  return b && Math.abs(b.strikePaise - target) <= spot * 0.02 ? b.strikePaise : null;
}
type Leg = { k: 'CE' | 'PE'; K: number; q: number; px: number };
/** A straddle at one strike, plus a call and a put away from it by its combined premium when protected. */
function straddleAt(d: Day, K: number, spot: number, protect: boolean): Leg[] | null {
  const c = d.by.get(`CE${K}`), p = d.by.get(`PE${K}`); if (!c || !p) return null;
  const legs: Leg[] = [{ k: 'CE', K, q: -1, px: c.closePaise }, { k: 'PE', K, q: -1, px: p.closePaise }], credit = c.closePaise + p.closePaise;
  if (protect) for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    const t = K + s * credit, w = near(d, k, t);
    if (!w || Math.abs(w.strikePaise - t) > spot * 0.015 || s * (w.strikePaise - K) <= 0) return null;
    legs.push({ k, K: w.strikePaise, q: 1, px: w.closePaise });
  }
  return legs;
}
const POSITIONS = [
  { id: 'fwd', name: 'Forward straddle', both: false, protect: false },
  { id: 'fwdp', name: 'Forward straddle, protected', both: false, protect: true },
  { id: 'both', name: 'Forward + spot straddle', both: true, protect: false },
  { id: 'bothp', name: 'Forward + spot straddle, protected', both: true, protect: true },
];
function build(d: Day, dt: string, e: string, spot: number, pos: (typeof POSITIONS)[number]) {
  const T = yearsBetween(dt, e), F = parityForward(q(d, 'CE'), q(d, 'PE'), spot, T) ?? spot;
  const kf = strikeAt(d, F, spot), ks = pos.both ? strikeAt(d, spot, spot) : null;
  if (kf == null || (pos.both && ks == null)) return null;
  const a = straddleAt(d, kf, spot, pos.protect), b = pos.both ? straddleAt(d, ks!, spot, pos.protect) : [];
  return a && b ? [...a, ...b] : null;
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;
async function run(pos: (typeof POSITIONS)[number], exit: number, filter: 'high' | 'all', opts: { late?: boolean; slip?: number } = {}) {
  const SLIP = opts.slip ?? 100, trades = []; let skip = 0, thin = 0;
  for (const e of monthly) {
    const d0 = pick(back(e, 45)), x0 = pick(back(e, exit));
    if (!d0 || !x0 || d0 >= x0 || (Date.parse(e) - Date.parse(d0)) / DAY > 50) continue;
    if (filter === 'high' && ivAboveMedian(history, d0) !== true) continue;
    const m0 = M.get(d0)!; if (!m0.spotPaise || !m0.lotSize) { skip++; continue; }
    const legs = build(await load(d0, e), d0, e, m0.spotPaise, pos);
    if (!legs) { skip++; continue; }
    const d = opts.late ? dates[idx.get(d0)! + 1] : d0, x = opts.late ? dates[idx.get(x0)! + 1] : x0;
    if (!d || !x) continue;
    const dayIn = await load(d, e), dayOut = await load(x, e), lot = m0.lotSize, scale = todayN / (m0.spotPaise * lot);
    let cash = 0, ch = 0, ok = true, credit = 0;
    const fills: { l: Leg; p: number }[] = [];
    for (const l of legs) {
      const inQ = dayIn.by.get(`${l.k}${l.K}`), inPx = opts.late ? (inQ?.traded ? inQ.closePaise : null) : l.px;
      if (inPx == null) { ok = false; break; }
      const sell = l.q < 0, p = sell ? Math.max(5, inPx - SLIP) : inPx + SLIP;
      fills.push({ l, p });
      cash += (sell ? 1 : -1) * lot * p; credit += (sell ? 1 : -1) * inPx; ch += computeOptionCharges({ side: sell ? 'SELL' : 'BUY', qty: lot, premiumPaise: p, date: d }).total;
      const o = dayOut.by.get(`${l.k}${l.K}`); if (!o?.traded) thin++;
      const mk = o ? (o.traded ? o.closePaise : o.settlePaise) : inPx, c = sell ? mk + SLIP : Math.max(5, mk - SLIP);
      cash += (sell ? -1 : 1) * lot * c; ch += computeOptionCharges({ side: sell ? 'BUY' : 'SELL', qty: lot, premiumPaise: c, date: x }).total;
    }
    if (!ok) { skip++; continue; }
    // MTM at each close while the trade was open, from real closing prices, after entry costs. A contract that did not trade
    // that day uses NSE's settlement price. Exit costs are not in it, as nothing has been exited yet.
    const entryCash = fills.reduce((t, f) => t + (f.l.q < 0 ? 1 : -1) * lot * f.p, 0);
    const entryCharges = fills.reduce((t, f) => t + computeOptionCharges({ side: f.l.q < 0 ? 'SELL' : 'BUY', qty: lot, premiumPaise: f.p, date: d }).total, 0);
    let worstMtm = 0, worstMtmOn: string | null = null;
    const lastPrice = new Map(fills.map((f) => [`${f.l.k}${f.l.K}`, f.p]));
    for (let j = idx.get(d)! + 1; !opts.late && !opts.slip && j <= idx.get(x)!; j++) {
      const t = dates[j], day = await load(t, e);
      for (const k of lastPrice.keys()) { const z = day.by.get(k); if (z) lastPrice.set(k, z.traded ? z.closePaise : z.settlePaise); }
      const mtm = ((entryCash + fills.reduce((a, f) => a + (f.l.q > 0 ? 1 : -1) * lot * lastPrice.get(`${f.l.k}${f.l.K}`)!, 0) - entryCharges) * scale) / 100;
      if (mtm < worstMtm) { worstMtm = mtm; worstMtmOn = t; }
    }
    trades.push({ worstMtm: R(worstMtm), worstMtmOn, bigDays: bigDays.filter((b) => b.date > d && b.date <= x).map((b) => b.text), entry: d, exit: x, expiry: e, spotIn: M.get(d)!.spotPaise! / 100, spotOut: (M.get(x)!.spotPaise ?? 0) / 100, legs: legs.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${l.K / 100} ${l.k} @${(l.px / 100).toFixed(2)}`), credit: R((credit * lot * scale) / 100), net: R(((cash - ch) * scale) / 100) });
  }
  return { trades, skip, thin };
}
function stats(a: { entry: string; exit: string; net: number; worstMtm?: number; worstMtmOn?: string | null }[]) {
  const n = a.map((t) => t.net), w = n.filter((v) => v > 0), l = n.filter((v) => v <= 0), yrs: Record<string, number> = {};
  for (const t of a) yrs[t.exit.slice(0, 4)] = (yrs[t.exit.slice(0, 4)] ?? 0) + t.net;
  let eq = 0, peak = 0, dd = 0; const curve: [string, number][] = [];
  for (const t of a) { eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); curve.push([t.exit, R(eq)]); }
  const deep = a.reduce((b, t) => ((t.worstMtm ?? 0) < (b.worstMtm ?? 0) ? t : b), a[0]);
  return { worstMtm: deep?.worstMtm ?? 0, worstMtmOn: deep?.worstMtmOn ?? null, worstMtmTradeNet: deep?.net ?? 0, trades: a.length, won: a.length ? (w.length / a.length) * 100 : 0, avgWin: R(sum(w) / (w.length || 1)), avgLoss: R(-sum(l) / (l.length || 1)), perTrade: R(sum(n) / (a.length || 1)), perYear: R(sum(n) / YEARS), total: R(sum(n)), worst: R(Math.min(...n)), best: R(Math.max(...n)), deepest: R(dd), losingYears: Object.values(yrs).filter((v) => v < 0).length, yearCount: Object.keys(yrs).length, since2023: R(sum(a.filter((t) => t.entry >= '2023').map((t) => t.net))), to2022: R(sum(a.filter((t) => t.entry < '2023').map((t) => t.net))), years: Object.entries(yrs).map(([y, v]) => [y, R(v)]) as [string, number][], curve };
}
const span = (await spanOn(D, U))?.data?.[U], E = '2026-12-29', dt = await load(D, E), T = yearsBetween(D, E), F = parityForward(q(dt, 'CE'), q(dt, 'PE'), today.spotPaise!, T) ?? today.spotPaise!, lotT = today.lotSize!;
const out = [];
for (const pos of POSITIONS) {
  const legs = build(dt, D, E, today.spotPaise!, pos);
  const mg = legs && span ? positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: E, strike: l.K / 100, qty: l.q * lotT, pricePaise: l.px })) as never, today.spotPaise!, D) : null;
  const shock = legs?.map((l) => ({ kind: l.k, side: (l.q < 0 ? 'SELL' : 'BUY') as 'SELL' | 'BUY', qty: lotT, strikePaise: l.K, pricePaise: l.px, iv: ivOf(l.k, l.px, F, l.K, T) ?? 0.15, T, forwardPaise: F }));
  const now = legs ? { legs: legs.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${l.K / 100} ${l.k} @${(l.px / 100).toFixed(2)}`), credit: R(sum(legs.map((l) => -l.q * l.px)) * lotT / 100), margin: mg ? R(mg.marginPaise / 100) : null, gaps: GAP_SHOCKS.filter((g) => Math.abs(g.gapPct) >= 8).map((g) => ({ gapPct: g.gapPct, pnl: R(gapPnl(shock!, g) / 100) })) } : null;
  for (const exit of [21, 25]) for (const filter of ['high', 'all'] as const) {
    const base = await run(pos, exit, filter), late = await run(pos, exit, filter, { late: true }), dear = await run(pos, exit, filter, { slip: 200 });
    const s = stats(base.trades);
    out.push({ id: `${pos.id}-${exit}-${filter}`, position: pos.id, name: pos.name, exit, filter, skipped: base.skip, thinExits: base.thin, ...s, perLakh: now?.margin ? R((s.perYear / now.margin) * 100000) : null, latePerYear: stats(late.trades).perYear, lateWorst: stats(late.trades).worst, dearPerYear: stats(dear.trades).perYear, today: now, tradeRows: base.trades });
    console.log(`${pos.name.padEnd(36)} exit ${exit} ${filter.padEnd(4)} | n ${s.trades} skip ${base.skip} | won ${s.won.toFixed(0)}% | win ${s.avgWin} loss ${s.avgLoss} | /yr ${s.perYear} | worst ${s.worst} | fall ${s.deepest} | lose yrs ${s.losingYears}/${s.yearCount} | to22 ${s.to2022} s23 ${s.since2023} | late ${stats(late.trades).perYear} ₹2 ${stats(dear.trades).perYear} | margin ${now?.margin} per lakh ${now?.margin ? R((s.perYear / now.margin) * 100000) : '-'} | gap ${now?.gaps.map((g) => `${g.gapPct}:${g.pnl}`).join(' ')}`);
  }
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-compare.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: dates[0], to: D, lot: lotT, rows: out }));
await prisma.$disconnect();
