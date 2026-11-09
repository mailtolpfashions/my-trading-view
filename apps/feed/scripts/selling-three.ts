// The three shortlisted positions, trade by trade, for the side-by-side screen: 0.16 strangle, 0.25 strangle, forward
// straddle, entered 45 days before monthly expiry. Every month is kept with its IV level, so the screen filters real trades
// and never recalculates a price. Written to .data/research/selling-three.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-three.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { boundedMark, deltaOf, ivAboveMedian, ivRank, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';
import { ivHistory } from '../src/selling/books';

const U = 'NIFTY', DAY = 86400_000, SLIP = 100, ENTRY = 45, R = Math.round;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, D = today.date;
// Real expiry dates (holiday-moved and relabelled contracts handled); the current month only once its monthly has expired.
const cal = await expiryCalendar(U, new Set(dates), D);
const lastOf = new Map<string, string>(cal.monthly.map((e) => [e.slice(0, 7), e]));
// A monthly expiry still ahead counts too, because a trade on it can already have finished. Only what is listed today.
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > D) lastOf.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...lastOf.values()].sort();
const history = await ivHistory(U);
const indexRows = await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, select: { date: true, openPaise: true, closePaise: true }, orderBy: { date: 'asc' } });
const bigDays = indexRows.slice(1).flatMap((r, i) => {
  const prev = indexRows[i].closePaise, gap = (r.openPaise / prev - 1) * 100, day = (r.closePaise / prev - 1) * 100;
  return Math.abs(gap) >= 2 || Math.abs(day) >= 3 ? [{ date: r.date, text: `${r.date}: gap ${gap.toFixed(1)}%, day ${day.toFixed(1)}%` }] : [];
});
const pick = (t: string) => dates.find((d) => d >= t) ?? null;
const back = (e: string, x: number) => new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10);
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; expiry: string };
type Day = { rows: Q[]; by: Map<string, Q> };
const cache = new Map<string, Day>();
async function load(d: string, e: string): Promise<Day> {
  const k = d + e; let v = cache.get(k);
  if (!v) {
    const all = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: { in: cal.labels(e) }, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Q[];
    const seen = new Map<string, Q>();
    for (const x of all) { const k2 = `${x.kind}${x.strikePaise}`, o = seen.get(k2); if (!o || (x.traded && !o.traded) || (x.expiry === e && o.expiry !== e && x.traded === o.traded)) seen.set(k2, x); }
    const rows = [...seen.values()];
    for (const kind of ['CE', 'PE']) { const l = rows.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    v = { rows, by: new Map(rows.map((x) => [`${x.kind}${x.strikePaise}`, x])) };
    cache.set(k, v);
  }
  return v;
}
const usable = (d: Day, k: string) => d.rows.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const quotes = (d: Day, k: string) => d.rows.filter((x) => x.kind === k).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
type Leg = { k: 'CE' | 'PE'; K: number; q: number; px: number; off?: number };
function strangle(r: Day, d: string, e: string, spot: number, target: number): Leg[] | null {
  const T = yearsBetween(d, e), F = parityForward(quotes(r, 'CE'), quotes(r, 'PE'), spot, T) ?? spot, out: Leg[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    // Like the rule engine: the nearest traded strike, however far. A trade 0.05 or more off the delta is flagged, not dropped.
    let best: Q | null = null, gap = Infinity;
    for (const x of usable(r, k)) { if (s * (x.strikePaise - F) <= 0) continue; const v = deltaOf(k, x.closePaise, F, x.strikePaise, T); if (v == null) continue; const g = Math.abs(Math.abs(v) - target); if (g < gap) { gap = g; best = x; } }
    if (!best) return null;
    out.push({ k, K: best.strikePaise, q: -1, px: best.closePaise, ...(gap >= 0.05 ? { off: Math.round((Math.abs(deltaOf(k, best.closePaise, F, best.strikePaise, T)!)) * 100) / 100 } : {}) });
  }
  return out;
}
function forward(r: Day, d: string, e: string, spot: number): Leg[] | null {
  const F = parityForward(quotes(r, 'CE'), quotes(r, 'PE'), spot, yearsBetween(d, e)) ?? spot, ce = new Set(usable(r, 'CE').map((x) => x.strikePaise));
  const p = usable(r, 'PE').filter((x) => ce.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - F) - Math.abs(b.strikePaise - F))[0];
  if (!p || Math.abs(p.strikePaise - F) > spot * 0.02) return null;
  return [{ k: 'CE', K: p.strikePaise, q: -1, px: r.by.get(`CE${p.strikePaise}`)!.closePaise }, { k: 'PE', K: p.strikePaise, q: -1, px: p.closePaise }];
}
function crashPut(r: Day, base: Leg[], spot: number): Leg[] | null {
  const tgt = spot * 0.85, w = usable(r, 'PE').sort((a, b) => Math.abs(a.strikePaise - tgt) - Math.abs(b.strikePaise - tgt))[0], sp = base.find((l) => l.k === 'PE')!;
  if (!w || Math.abs(w.strikePaise - tgt) > spot * 0.01 || w.strikePaise >= sp.K) return null;
  return [...base, { k: 'PE', K: w.strikePaise, q: 1, px: w.closePaise }];
}
const STRATS = [
  { id: 'n16', name: '0.16 strangle', make: (r: Day, d: string, e: string, s: number) => strangle(r, d, e, s, 0.16) },
  { id: 'n25', name: '0.25 strangle', make: (r: Day, d: string, e: string, s: number) => strangle(r, d, e, s, 0.25) },
  { id: 'fwd', name: 'Straddle at forward', make: forward },
];
type Trade = { entry: string; exit: string; expiry: string; hi: boolean; rank: number | null; net: number; worstMtm: number; worstMtmOn: string | null; credit: number; booked: boolean; offDelta: number | null; spotIn: number; spotOut: number; legs: string[]; bigDays: string[] };
async function run(st: (typeof STRATS)[number], exit: number, put: boolean, book: boolean) {
  const trades: Trade[] = [], skipped: { entry: string; hi: boolean; rank: number | null; why: string }[] = [];
  for (const e of monthly) {
    const d = pick(back(e, ENTRY)), x0 = pick(back(e, exit));
    if (!d || !x0 || d >= x0 || (Date.parse(e) - Date.parse(d)) / DAY > 50) continue;
    const hi = ivAboveMedian(history, d) === true, rank = ivRank(history, d), m = M.get(d)!;
    if (!m.spotPaise || !m.lotSize) { skipped.push({ entry: d, hi, rank, why: 'No index close that day' }); continue; }
    const r = await load(d, e), base = st.make(r, d, e, m.spotPaise);
    if (!base) { skipped.push({ entry: d, hi, rank, why: 'No traded strike for the position' }); continue; }
    const legs = put ? crashPut(r, base, m.spotPaise) : base;
    if (!legs) { skipped.push({ entry: d, hi, rank, why: 'No traded put near 15% below' }); continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot), sold = (l: Leg) => l.q < 0;
    const fills = legs.map((l) => ({ l, p: sold(l) ? Math.max(5, l.px - SLIP) : l.px + SLIP }));
    const entryCash = fills.reduce((t, f) => t + (sold(f.l) ? 1 : -1) * lot * f.p, 0), credit = legs.reduce((t, l) => t + -l.q * lot * l.px, 0);
    const entryCharges = fills.reduce((t, f) => t + computeOptionCharges({ side: sold(f.l) ? 'SELL' : 'BUY', qty: lot, premiumPaise: f.p, date: d }).total, 0);
    const last = new Map(fills.map((f) => [`${f.l.k}${f.l.K}`, f.p])); let worstMtm = 0, worstMtmOn: string | null = null, x = x0, booked = false;
    for (let j = idx.get(d)! + 1; j <= idx.get(x0)!; j++) {
      const t = dates[j], day = await load(t, e);
      // Untraded options: NSE's settlement price, kept between intrinsic value and the cheapest traded richer option.
      const sp = M.get(t)?.spotPaise ?? 0;
      for (const f of fills) { const v = boundedMark(day.rows, f.l.k, f.l.K, sp); if (v != null) last.set(`${f.l.k}${f.l.K}`, v); }
      const mtm = ((entryCash + fills.reduce((a, f) => a + (f.l.q > 0 ? 1 : -1) * lot * last.get(`${f.l.k}${f.l.K}`)!, 0) - entryCharges) * scale) / 100;
      if (mtm < worstMtm) { worstMtm = mtm; worstMtmOn = t; }
      const pnl = legs.reduce((a, l) => a + -l.q * lot * (l.px - last.get(`${l.k}${l.K}`)!), 0); // same sum as positionPnl in the rule engine
      if (book && pnl >= credit * 0.5) { x = t; booked = t < x0; break; }
    }
    const out = await load(x, e); let cash = entryCash, ch = entryCharges;
    for (const { l, p } of fills) {
      const mk = boundedMark(out.rows, l.k, l.K, M.get(x)?.spotPaise ?? 0) ?? p, c = sold(l) ? mk + SLIP : Math.max(5, mk - SLIP);
      cash += (sold(l) ? -1 : 1) * lot * c; ch += computeOptionCharges({ side: sold(l) ? 'BUY' : 'SELL', qty: lot, premiumPaise: c, date: x }).total;
    }
    trades.push({ entry: d, exit: x, expiry: e, hi, rank, net: R(((cash - ch) * scale) / 100), worstMtm: R(worstMtm), worstMtmOn, credit: R((credit * scale) / 100), booked, offDelta: legs.find((l) => l.off != null)?.off ?? null, spotIn: m.spotPaise / 100, spotOut: (M.get(x)!.spotPaise ?? 0) / 100, legs: legs.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${l.K / 100} ${l.k} @${(l.px / 100).toFixed(2)}`), bigDays: bigDays.filter((b) => b.date > d && b.date <= x).map((b) => b.text) });
  }
  return { trades, skipped };
}
// Margin on the latest close, for the 29 Dec expiry, from NSE's SPAN file.
const span = (await spanOn(D, U))?.data?.[U], E = '2026-12-29', dt = await load(D, E), margins: Record<string, Record<string, number | null>> = {};
for (const st of STRATS) {
  const base = st.make(dt, D, E, today.spotPaise!);
  const marginOf = (legs: Leg[] | null) => {
    if (!legs || !span) return null;
    const v = positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: E, strike: l.K / 100, qty: l.q * today.lotSize!, pricePaise: l.px })) as never, today.spotPaise!, D);
    return v.missing.length ? null : R(v.marginPaise / 100);
  };
  margins[st.id] = { none: marginOf(base), put: marginOf(base && crashPut(dt, base, today.spotPaise!)) };
}
const variants = [], tradingDays: Record<string, number> = {};
for (const d of dates) tradingDays[d.slice(0, 4)] = (tradingDays[d.slice(0, 4)] ?? 0) + 1;
for (const st of STRATS) for (const exit of [21, 25]) for (const put of [false, true]) for (const book of [false, true]) {
  const { trades, skipped } = await run(st, exit, put, book);
  variants.push({ strat: st.id, name: st.name, exit, put, book, trades, skipped });
  const line = (f: (t: Trade) => boolean) => {
    const a = trades.filter(f), s = a.reduce((v, t) => v + t.net, 0);
    return `n ${a.length} won ${a.length ? R((a.filter((t) => t.net > 0).length / a.length) * 100) : 0}% /yr ${R(s / (dates.length / 248))} worst ${a.length ? Math.min(...a.map((t) => t.net)) : 0} mtm ${a.length ? Math.min(...a.map((t) => t.worstMtm)) : 0}`;
  };
  console.log(`${st.id} exit ${exit} put ${put} book ${book} | high ${line((t) => t.hi)} | top ${line((t) => (t.rank ?? 0) >= 0.67)} | all ${line(() => true)} | last ${trades.at(-1)?.entry}>${trades.at(-1)?.exit}`);
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-three.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: dates[0], to: D, lot: today.lotSize, spot: today.spotPaise! / 100, tradingDays, margins, variants }));
console.log('margins', JSON.stringify(margins));
await prisma.$disconnect();
