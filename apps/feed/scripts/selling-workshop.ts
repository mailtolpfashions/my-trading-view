// Strategies 4–12 from the workshop slides the user shared (2026-11-09), not tested before. Rules fixed before running:
//   cc        4  Covered call: buy the future, sell 1 call +d. "roll": when NIFTY closes at or above the call, buy it back and
//                sell a new one +d from that close (same expiry), as often as needed.
//   collar    5  Covered call + buy 1 put −2d. Same roll.
//   putcal    6  Put calendar: sell the near ATM put, buy the next-month ATM put. Close everything at the near expiry.
//   callcal   7  Call calendar: sell the near ATM call, buy the next-month ATM call, sell a next-month call +2d.
//   dblcal    8  Double calendar: put calendar at −d plus call calendar at +d.
//   putback   9  Sell 1 put d in the money, buy 2 puts d out of the money.
//   callback 10  Sell 1 call d in the money, buy 2 calls d out of the money.
//   dblback  11  Both back spreads.
//   fly      12  Buy 1 call −w, sell 2 ATM calls, buy 1 call +w; w = d and w = 2d.
// d = 2% of the index for 1 month, × √months for 2 and 3 months. Calendars: near = 1 month (or 2), far = the next monthly.
// Entry at the close of the first trading day after a monthly expiry, one position at a time. Strikes: nearest traded strike
// within 1% of the target, else the entry is skipped. Checked and adjusted at daily closes. NIFTY, money at today's index level
// and lot size, after charges and ₹1 slippage per leg. Daily MTM is kept per trade for the portfolio step.
// Writes .data/research/selling-workshop.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-workshop.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeFuturesCharges, computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';

const U = 'NIFTY', SLIP = 100, R = Math.round, BASE = 0.02;
type Kind = 'FUT' | 'CE' | 'PE';
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; expiry: string };
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
// Real expiry dates (holiday-moved and relabelled contracts handled); the current month only once its monthly has expired.
const cal = await expiryCalendar(U, new Set(dates), D);
const monthly = cal.monthly;

const cache = new Map<string, Map<string, Q>>();
async function load(d: string, e: string) {
  const key = d + e; let v = cache.get(key);
  if (!v) {
    const rows = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: { in: cal.labels(e) } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Q[];
    const by = new Map<string, Q>();
    for (const x of rows) { const k = `${x.kind}${x.strikePaise}`, o = by.get(k); if (!o || (x.traded && !o.traded) || (x.expiry === e && o.expiry !== e && x.traded === o.traded)) by.set(k, x); }
    for (const kind of ['CE', 'PE']) { const l = [...by.values()].filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    v = by; cache.set(key, v);
  }
  return v;
}
function near(day: Map<string, Q>, kind: 'CE' | 'PE', target: number, spot: number) {
  let best: Q | null = null;
  for (const x of day.values()) if (x.kind === kind && x.traded && x.closePaise > 0 && (!best || Math.abs(x.strikePaise - target) < Math.abs(best.strikePaise - target))) best = x;
  return best && Math.abs(best.strikePaise - target) <= spot * 0.01 ? best : null;
}

type Leg = { k: Kind; K: number; q: number; e: string; fill: number };
type Ctx = { near: Map<string, Q>; far: Map<string, Q> | null; spot: number; d: number; e: string; fe: string | null; atm: number };
type Def = { id: string; slide: number; name: string; calendar?: boolean; roll?: boolean; build: (c: Ctx) => Omit<Leg, 'fill'>[] | null };
const opt = (c: Ctx, which: 'near' | 'far', k: 'CE' | 'PE', target: number, q: number) => {
  const day = which === 'near' ? c.near : c.far; if (!day) return null;
  const x = near(day, k, target, c.spot); return x ? { k, K: x.strikePaise, q, e: which === 'near' ? c.e : c.fe! } : null;
};
const fut = (c: Ctx) => (c.near.get('FUT0')?.closePaise ? { k: 'FUT' as const, K: 0, q: 1, e: c.e } : null);
const all = <T,>(xs: (T | null)[]) => (xs.every((x) => x) ? (xs as T[]) : null);
// The far leg of a calendar uses the near leg's strike if it traded, so the two legs match.
const same = (c: Ctx, l: { k: 'CE' | 'PE'; K: number } | null, q: number) => { if (!l || !c.far) return null; const x = c.far.get(`${l.k}${l.K}`); return x && x.traded && x.closePaise > 0 ? { k: l.k, K: l.K, q, e: c.fe! } : null; };
const DEFS: Def[] = [
  { id: 'cc', slide: 4, name: 'Covered call', build: (c) => all([fut(c), opt(c, 'near', 'CE', c.spot * (1 + c.d), -1)]) },
  { id: 'cc-roll', slide: 4, name: 'Covered call, rolled up', roll: true, build: (c) => all([fut(c), opt(c, 'near', 'CE', c.spot * (1 + c.d), -1)]) },
  { id: 'collar', slide: 5, name: 'Collar', build: (c) => all([fut(c), opt(c, 'near', 'CE', c.spot * (1 + c.d), -1), opt(c, 'near', 'PE', c.spot * (1 - 2 * c.d), 1)]) },
  { id: 'collar-roll', slide: 5, name: 'Collar, rolled up', roll: true, build: (c) => all([fut(c), opt(c, 'near', 'CE', c.spot * (1 + c.d), -1), opt(c, 'near', 'PE', c.spot * (1 - 2 * c.d), 1)]) },
  { id: 'putcal', slide: 6, name: 'Put calendar', calendar: true, build: (c) => { const n = opt(c, 'near', 'PE', c.atm, -1); return all([n, same(c, n, 1)]); } },
  { id: 'callcal', slide: 7, name: 'Call calendar + far OTM call', calendar: true, build: (c) => { const n = opt(c, 'near', 'CE', c.atm, -1); return all([n, same(c, n, 1), opt(c, 'far', 'CE', c.atm * (1 + 2 * c.d), -1)]); } },
  { id: 'dblcal', slide: 8, name: 'Double calendar', calendar: true, build: (c) => { const p = opt(c, 'near', 'PE', c.atm * (1 - c.d), -1), k = opt(c, 'near', 'CE', c.atm * (1 + c.d), -1); return all([p, same(c, p, 1), k, same(c, k, 1)]); } },
  { id: 'putback', slide: 9, name: 'Put back spread', build: (c) => all([opt(c, 'near', 'PE', c.atm * (1 + c.d), -1), opt(c, 'near', 'PE', c.atm * (1 - c.d), 2)]) },
  { id: 'callback', slide: 10, name: 'Call back spread', build: (c) => all([opt(c, 'near', 'CE', c.atm * (1 - c.d), -1), opt(c, 'near', 'CE', c.atm * (1 + c.d), 2)]) },
  { id: 'dblback', slide: 11, name: 'Double back spread', build: (c) => all([opt(c, 'near', 'PE', c.atm * (1 + c.d), -1), opt(c, 'near', 'PE', c.atm * (1 - c.d), 2), opt(c, 'near', 'CE', c.atm * (1 - c.d), -1), opt(c, 'near', 'CE', c.atm * (1 + c.d), 2)]) },
  { id: 'fly', slide: 12, name: 'Butterfly, wings 1×', build: (c) => all([opt(c, 'near', 'CE', c.atm * (1 - c.d), 1), opt(c, 'near', 'CE', c.atm, -2), opt(c, 'near', 'CE', c.atm * (1 + c.d), 1)]) },
  { id: 'fly-wide', slide: 12, name: 'Butterfly, wings 2×', build: (c) => all([opt(c, 'near', 'CE', c.atm * (1 - 2 * c.d), 1), opt(c, 'near', 'CE', c.atm, -2), opt(c, 'near', 'CE', c.atm * (1 + 2 * c.d), 1)]) },
];

async function run(def: Def, N: number) {
  const trades = [], skipped: Record<string, number> = {}, d0 = BASE * Math.sqrt(N);
  for (let k = N; k < monthly.length;) {
    const e = monthly[k], fe = def.calendar ? monthly[k + 1] ?? null : null, entry = dates[idx.get(monthly[k - N])! + 1];
    const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; k += 1; };
    if (!entry || entry >= e || (def.calendar && !fe)) { skip('No trading day or no next expiry'); continue; }
    const m = M.get(entry)!; if (!m.spotPaise || !m.lotSize || !M.get(e)?.spotPaise) { skip('No index close'); continue; }
    const spot = m.spotPaise, nd = await load(entry, e), fd = fe ? await load(entry, fe) : null, atm = near(nd, 'CE', spot, spot);
    if (!atm) { skip('No ATM option traded'); continue; }
    const shape = def.build({ near: nd, far: fd, spot, d: d0, e, fe, atm: atm.strikePaise });
    if (!shape) { skip('A needed strike had no trade'); continue; }
    const lot = m.lotSize, scale = todayN / (spot * lot), money = (p: number) => (p * scale) / 100;
    const px = (l: Omit<Leg, 'fill'>, day: Map<string, Q>) => (l.k === 'FUT' ? day.get('FUT0')!.closePaise : day.get(`${l.k}${l.K}`)!.closePaise);
    const open: Leg[] = shape.map((l) => { const p = px(l, l.e === e ? nd : fd!); return { ...l, fill: l.q > 0 ? p + SLIP : Math.max(5, p - SLIP) }; });
    let cash = 0, charges = 0;
    const deal = (l: Leg, qty: number, p: number, date: string) => {
      cash -= qty * lot * p; const side = qty > 0 ? 'BUY' : 'SELL', n = Math.abs(qty) * lot;
      charges += (l.k === 'FUT' ? computeFuturesCharges({ side, qty: n, pricePaise: p, date }) : computeOptionCharges({ side, qty: n, premiumPaise: p, date })).total;
    };
    for (const l of open) deal(l, l.q, l.fill, entry);
    const marks = new Map(open.map((l) => [`${l.e}${l.k}${l.K}`, l.fill])), events: string[] = [], mtm: [string, number][] = [];
    let worst = 0, worstOn = entry;
    for (let j = idx.get(entry)! + 1; j < idx.get(e)!; j++) {
      const t = dates[j], s = M.get(t)?.spotPaise; if (!s) continue;
      const days = new Map<string, Map<string, Q>>(); for (const x of new Set(open.map((l) => l.e))) days.set(x, await load(t, x));
      for (const l of open) { const v = l.k === 'FUT' ? days.get(l.e)!.get('FUT0')?.closePaise ?? null : boundedMark(days.get(l.e)!.values(), l.k, l.K, s); if (v) marks.set(`${l.e}${l.k}${l.K}`, v); }
      const at = (l: Leg) => marks.get(`${l.e}${l.k}${l.K}`)!;
      if (def.roll) {
        const sc = open.find((l) => l.k === 'CE' && l.q < 0);
        if (sc && s >= sc.K) {
          const nx = near(days.get(e)!, 'CE', s * (1 + d0), s);
          if (nx && nx.strikePaise > sc.K) {
            deal(sc, 1, at(sc) + SLIP, t); sc.q = 0;
            const nl: Leg = { k: 'CE', K: nx.strikePaise, q: -1, e, fill: Math.max(5, nx.closePaise - SLIP) }; deal(nl, -1, nl.fill, t); open.push(nl); marks.set(`${e}CE${nl.K}`, nx.closePaise);
            events.push(`${t}: rolled ${sc.K / 100} CE to ${nl.K / 100} CE`);
          }
        }
      }
      const v = money(cash - charges + open.reduce((a, l) => a + l.q * lot * at(l), 0));
      mtm.push([t, R(v)]); if (v < worst) { worst = v; worstOn = t; }
    }
    // At the near expiry: legs on that expiry settle at intrinsic value (the future at the index); later legs are sold at the close.
    const out = M.get(e)!.spotPaise!, ed = fe ? await load(e, fe) : null;
    for (const l of open) {
      if (l.q === 0) continue;
      if (l.e === e) {
        const iv = l.k === 'FUT' ? out : Math.max(0, l.k === 'CE' ? out - l.K : l.K - out);
        cash += l.q * lot * iv;
        if (l.k !== 'FUT') charges += expirySettlementCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: Math.abs(l.q) * lot, intrinsicPaise: iv, date: e });
      } else {
        const base = boundedMark(ed!.values(), l.k as 'CE' | 'PE', l.K, out) ?? marks.get(`${l.e}${l.k}${l.K}`)!, p = l.q > 0 ? Math.max(5, base - SLIP) : base + SLIP;
        deal(l, -l.q, p, e);
      }
    }
    const net = money(cash - charges); mtm.push([e, R(net)]);
    trades.push({ entry, exit: e, spotIn: spot / 100, spotOut: out / 100, move: Math.round((out / spot - 1) * 1000) / 10, net: R(net), worstMtm: R(Math.min(worst, net)), worstOn, legs: shape.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${Math.abs(l.q)}× ${l.k === 'FUT' ? 'FUT' : `${l.K / 100} ${l.k}`}${l.e !== e ? ' (next month)' : ''}`), events, mtm });
    k += N;
  }
  return { trades, skipped };
}

const stat = (xs: number[], years: number) => {
  const w = xs.filter((x) => x > 0), l = xs.filter((x) => x <= 0), s = xs.reduce((a, b) => a + b, 0);
  return { n: xs.length, won: xs.length ? R((w.length / xs.length) * 100) : 0, total: R(s), perYear: R(s / years), avgWin: w.length ? R(w.reduce((a, b) => a + b, 0) / w.length) : 0, avgLoss: l.length ? R(l.reduce((a, b) => a + b, 0) / l.length) : 0, worst: xs.length ? Math.min(...xs) : 0 };
};
const tests = [];
for (const def of DEFS) for (const N of def.calendar ? [1, 2] : [1, 2, 3]) {
  const { trades, skipped } = await run(def, N);
  if (!trades.length) { console.log(def.id, N, 'no trades', JSON.stringify(skipped)); continue; }
  const years = (Date.parse(trades.at(-1)!.exit) - Date.parse(trades[0].entry)) / (365.25 * 86400_000);
  const byYear: Record<string, number> = {}; for (const t of trades) byYear[t.exit.slice(0, 4)] = (byYear[t.exit.slice(0, 4)] ?? 0) + t.net;
  const t = { id: def.id, slide: def.slide, name: def.name, months: N, dist: Math.round(BASE * Math.sqrt(N) * 1000) / 10, years: Math.round(years * 10) / 10, skipped, all: stat(trades.map((x) => x.net), years),
    since2023: stat(trades.filter((x) => x.entry >= '2023-01-01').map((x) => x.net), (Date.parse(D) - Date.parse('2023-01-01')) / (365.25 * 86400_000)),
    worstMtm: Math.min(...trades.map((x) => x.worstMtm)), losingYears: Object.values(byYear).filter((v) => v < 0).length, yearCount: Object.keys(byYear).length, byYear, trades };
  tests.push(t);
  console.log(`${def.id.padEnd(11)} ${N}m d${t.dist}% | n ${t.all.n} won ${t.all.won}% total ${t.all.total} /yr ${t.all.perYear} avgW ${t.all.avgWin} avgL ${t.all.avgLoss} worst ${t.all.worst} mtm ${t.worstMtm} | losing ${t.losingYears}/${t.yearCount} | since23 ${t.since2023.total} | skip ${JSON.stringify(skipped)}`);
}
// Today's margin for each starting shape, from NSE's SPAN file on the latest day.
const margins: Record<string, number | null> = {};
try {
  const span = (await spanOn(D, U))?.data?.[U];
  const ahead = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry);
  const lastIn = new Map<string, string>(); for (const e of ahead) lastIn.set(e.slice(0, 7), e);
  const mons = [...lastIn.values()].filter((e) => e > D);
  for (const def of DEFS) for (const N of def.calendar ? [1, 2] : [1, 2, 3]) {
    const e = mons[N - 1], fe = def.calendar ? mons[N] : null; if (!span || !e || (def.calendar && !fe)) continue;
    const nd = await load(D, e), fd = fe ? await load(D, fe) : null, spot = today.spotPaise!, atm = near(nd, 'CE', spot, spot);
    const shape = atm && def.build({ near: nd, far: fd, spot, d: BASE * Math.sqrt(N), e, fe, atm: atm.strikePaise });
    if (!shape) { margins[`${def.id}-${N}`] = null; continue; }
    const legs = shape.map((l) => ({ kind: l.k, expiry: l.e, strike: l.K / 100, qty: l.q * today.lotSize!, pricePaise: l.k === 'FUT' ? (l.e === e ? nd : fd!).get('FUT0')?.closePaise : (l.e === e ? nd : fd!).get(`${l.k}${l.K}`)?.closePaise }));
    const v = positionMargin(span, legs as never, spot, D);
    margins[`${def.id}-${N}`] = v.missing.length ? null : R(v.marginPaise / 100);
  }
  console.log('margins', JSON.stringify(margins));
} catch (err) { console.log('margin skipped', String(err)); }
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-workshop.json'), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, lot: today.lotSize, spot: today.spotPaise! / 100, margins, tests }));
console.log('written');
await prisma.$disconnect();
