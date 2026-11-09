// The user's call-ratio rule (2026-11-09): buy 1 ATM CE, sell 2 CE ~2,000 points up, sell 1 PE ~2,000 points down
// (at 25,000 that is 8%, so distances are a share of the index). Also run at 10%, 12% and 15%; the adjustment levels scale
// with the distance. Upside adjustments, the user's:
//   U1 – NIFTY closes at or above the sold-call strike: buy back one of the two sold calls
//   U2 – NIFTY closes at or above +1.5× the distance (28,000): sell the long call, buy the call at +0.5× (26,000)
// Downside adjustments (the user asked me to choose; three versions fixed before running):
//   D0 – none; D1 – NIFTY closes at or below the sold put: buy the put back;
//   D2 – NIFTY closes at or below −0.5× the distance: buy a put at −1.5× (the short put becomes a spread)
// Frames: expiry 1, 2, 3 and 6 months after entry, entered at the close of the first trading day after a monthly expiry,
// one position at a time; and "11" = the user's yearly trade: enter at the close of the last Monday of January, hold to
// that year's December expiry. Distances: fixed 8%, or 8% × √(months/11) ("scaled": the yearly shape shrunk to the time).
// Long contracts have coarse strikes and few trades: a leg with no traded strike near its target uses NSE's settlement
// price and is counted as model-priced. Adjustments are checked at daily closes and filled at that close.
// Money at today's index level and lot size, after charges and ₹1 slippage per leg.
// Writes .data/research/selling-callratio.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-callratio.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';

const U = 'NIFTY', SLIP = 100, R = Math.round, BASES = [0.08, 0.1, 0.12, 0.15], FRAMES = [1, 2, 3, 6, 11]; // 11 = January → December
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
    const rows = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: { in: ['CE', 'PE'] }, expiry: { in: cal.labels(e) } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Q[];
    const by = new Map<string, Q>();
    for (const x of rows) { const k = `${x.kind}${x.strikePaise}`, o = by.get(k); if (!o || (x.traded && !o.traded) || (x.expiry === e && o.expiry !== e && x.traded === o.traded)) by.set(k, x); }
    for (const kind of ['CE', 'PE']) { const l = [...by.values()].filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    v = by; cache.set(key, v);
  }
  return v;
}
// Nearest strike to a target: a traded one within `tol` of the index first, else NSE's settlement price (model-priced).
function strike(day: Map<string, Q>, kind: 'CE' | 'PE', target: number, spot: number, tol: number) {
  const rows = [...day.values()].filter((x) => x.kind === kind), by = (a: Q, b: Q) => Math.abs(a.strikePaise - target) - Math.abs(b.strikePaise - target);
  const t = rows.filter((x) => x.traded && x.closePaise > 0 && Math.abs(x.strikePaise - target) <= spot * tol).sort(by)[0];
  if (t) return { q: t, px: t.closePaise, model: false };
  const s = rows.filter((x) => x.settlePaise > 0 && Math.abs(x.strikePaise - target) <= spot * tol).sort(by)[0];
  return s ? { q: s, px: boundedMark(rows, kind, s.strikePaise, spot) ?? s.settlePaise, model: true } : null;
}

type Leg = { k: 'CE' | 'PE'; K: number; q: number; fill: number };
type Setup = { entry: string; expiry: string; spot: number; lot: number; scale: number; dist: number; atmK: number; legs: Leg[]; model: number; tol: number };
async function setup(N: number, scaled: boolean, BASE: number, d: string | undefined, e: string): Promise<Setup | string> {
  if (!d || d >= e) return 'No trading day';
  const m = M.get(d)!; if (!m.spotPaise || !m.lotSize || !M.get(e)?.spotPaise) return 'No index close';
  const day = await load(d, e), spot = m.spotPaise, dist = scaled ? BASE * Math.sqrt(N / 11) : BASE, tol = N <= 3 ? 0.01 : 0.025;
  const atm = strike(day, 'CE', spot, spot, tol); if (!atm) return 'No ATM call';
  const sc = strike(day, 'CE', atm.q.strikePaise * (1 + dist), spot, tol), sp = strike(day, 'PE', atm.q.strikePaise * (1 - dist), spot, tol);
  if (!sc || !sp || sc.q.strikePaise <= atm.q.strikePaise || sp.q.strikePaise >= atm.q.strikePaise) return 'A needed strike had no price';
  const legs: Leg[] = [
    { k: 'CE', K: atm.q.strikePaise, q: 1, fill: atm.px + SLIP }, { k: 'CE', K: sc.q.strikePaise, q: -2, fill: Math.max(5, sc.px - SLIP) }, { k: 'PE', K: sp.q.strikePaise, q: -1, fill: Math.max(5, sp.px - SLIP) },
  ];
  return { entry: d, expiry: e, spot, lot: m.lotSize, scale: todayN / (spot * m.lotSize), dist, atmK: atm.q.strikePaise, legs, model: [atm, sc, sp].filter((x) => x.model).length, tol };
}

async function play(s: Setup, up: boolean, down: 'D0' | 'D1' | 'D2') {
  const lot = s.lot, money = (p: number) => (p * s.scale) / 100;
  const open: Leg[] = s.legs.map((l) => ({ ...l })), events: string[] = [];
  let cash = 0, charges = 0, model = s.model;
  const trade = (l: Leg, qty: number, p: number, date: string) => { // qty > 0 buys, < 0 sells
    cash -= qty * lot * p; charges += computeOptionCharges({ side: qty > 0 ? 'BUY' : 'SELL', qty: Math.abs(qty) * lot, premiumPaise: p, date }).total;
  };
  for (const l of open) trade(l, l.q, l.fill, s.entry);
  let u1 = false, u2 = false, d1 = false, d2 = false, worst = 0, worstOn = s.entry;
  const marks = new Map<string, number>(open.map((l) => [`${l.k}${l.K}`, l.fill]));
  for (let j = idx.get(s.entry)! + 1; j < idx.get(s.expiry)!; j++) {
    const t = dates[j], day = await load(t, s.expiry), spot = M.get(t)?.spotPaise; if (!spot) continue;
    for (const l of open) { const v = boundedMark(day.values(), l.k, l.K, spot); if (v != null) marks.set(`${l.k}${l.K}`, v); }
    const at = (l: Leg) => marks.get(`${l.k}${l.K}`)!;
    const close = (l: Leg, qty: number) => { const p = qty > 0 ? at(l) + SLIP : Math.max(5, at(l) - SLIP); trade(l, qty, p, t); l.q += qty; };
    const buyNew = (kind: 'CE' | 'PE', target: number) => {
      const x = strike(day, kind, target, spot, s.tol); if (!x) return null;
      if (x.model) model++;
      const l: Leg = { k: kind, K: x.q.strikePaise, q: 0, fill: x.px + SLIP }; trade(l, 1, l.fill, t); l.q = 1; open.push(l); marks.set(`${kind}${l.K}`, x.px); return l;
    };
    const shortCall = open.find((l) => l.k === 'CE' && l.q < 0), shortPut = open.find((l) => l.k === 'PE' && l.q < 0);
    if (up && !u1 && shortCall && spot >= shortCall.K) { close(shortCall, 1); u1 = true; events.push(`${t} U1 bought back 1× ${shortCall.K / 100} CE`); }
    if (up && u1 && !u2 && spot >= s.atmK * (1 + 1.5 * s.dist)) {
      const lc = open.find((l) => l.k === 'CE' && l.q > 0 && l.K === s.atmK);
      if (lc) { close(lc, -1); const n = buyNew('CE', s.atmK * (1 + 0.5 * s.dist)); u2 = true; events.push(`${t} U2 sold ${lc.K / 100} CE, bought ${n ? n.K / 100 : 'nothing (no price)'} CE`); }
    }
    if (down === 'D1' && !d1 && shortPut && shortPut.q < 0 && spot <= shortPut.K) { close(shortPut, 1); d1 = true; events.push(`${t} D1 bought back ${shortPut.K / 100} PE`); }
    if (down === 'D2' && !d2 && spot <= s.atmK * (1 - 0.5 * s.dist)) { const n = buyNew('PE', s.atmK * (1 - 1.5 * s.dist)); d2 = true; events.push(`${t} D2 bought ${n ? n.K / 100 : 'nothing (no price)'} PE`); }
    const mtm = money(cash - charges + open.reduce((a, l) => a + l.q * lot * at(l), 0));
    if (mtm < worst) { worst = mtm; worstOn = t; }
  }
  const out = M.get(s.expiry)!.spotPaise!;
  for (const l of open) if (l.q !== 0) {
    const iv = Math.max(0, l.k === 'CE' ? out - l.K : l.K - out);
    cash += l.q * lot * iv; charges += expirySettlementCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: Math.abs(l.q) * lot, intrinsicPaise: iv, date: s.expiry });
  }
  const net = money(cash - charges);
  return { net: R(net), worstMtm: R(Math.min(worst, net)), worstOn, events, model };
}

const stat = (xs: number[], years: number) => {
  const w = xs.filter((x) => x > 0), l = xs.filter((x) => x <= 0), s = xs.reduce((a, b) => a + b, 0);
  return { n: xs.length, won: xs.length ? R((w.length / xs.length) * 100) : 0, total: R(s), perYear: R(s / years), avgWin: w.length ? R(w.reduce((a, b) => a + b, 0) / w.length) : 0, avgLoss: l.length ? R(l.reduce((a, b) => a + b, 0) / l.length) : 0, worst: xs.length ? Math.min(...xs) : 0 };
};
function lastMondayOfJan(y: number) {
  for (let d = 31; d >= 25; d--) { const t = new Date(Date.UTC(y, 0, d)); if (t.getUTCDay() === 1) return t.toISOString().slice(0, 10); }
  return `${y}-01-25`;
}
const tests = [];
for (const BASE of BASES) for (const N of FRAMES) for (const scaled of N === 11 ? [false] : [false, true]) {
  const setups: Setup[] = [], skipped: Record<string, number> = {};
  if (N === 11) for (const e of monthly.filter((x) => x.slice(5, 7) === '12')) {
    const y = Number(e.slice(0, 4)), mon = lastMondayOfJan(y), s = await setup(N, scaled, BASE, dates.find((x) => x >= mon), e);
    if (typeof s === 'string') skipped[s] = (skipped[s] ?? 0) + 1; else setups.push(s);
  }
  else for (let k = N; k < monthly.length;) {
    const s = await setup(N, scaled, BASE, dates[idx.get(monthly[k - N])! + 1], monthly[k]);
    if (typeof s === 'string') { skipped[s] = (skipped[s] ?? 0) + 1; k += 1; } else { setups.push(s); k += N; }
  }
  if (!setups.length) { console.log(`${N}m ${scaled ? 'scaled' : 'fixed'}: no trades`, JSON.stringify(skipped)); continue; }
  const years = (Date.parse(setups.at(-1)!.expiry) - Date.parse(setups[0].entry)) / (365.25 * 86400_000);
  for (const up of [false, true]) for (const down of ['D0', 'D1', 'D2'] as const) {
    if (!up && down !== 'D0') continue; // baseline: no adjustment at all
    const rows = [];
    for (const s of setups) {
      const r = await play(s, up, down);
      rows.push({ entry: s.entry, expiry: s.expiry, spotIn: s.spot / 100, spotOut: M.get(s.expiry)!.spotPaise! / 100, legs: s.legs.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${Math.abs(l.q)}× ${l.K / 100} ${l.k}`), ...r });
    }
    const byYear: Record<string, number> = {}; for (const r of rows) byYear[r.expiry.slice(0, 4)] = (byYear[r.expiry.slice(0, 4)] ?? 0) + r.net;
    const clean = rows.filter((r) => !r.model);
    const t = { base: BASE, months: N, scaled, dist: R(setups[0].dist * 1000) / 10, up, down, years: R(years * 10) / 10, skipped, modelPriced: rows.length - clean.length,
      all: stat(rows.map((r) => r.net), years), traded: stat(clean.map((r) => r.net), years), since2023: stat(rows.filter((r) => r.entry >= '2023-01-01').map((r) => r.net), (Date.parse(D) - Date.parse('2023-01-01')) / (365.25 * 86400_000)),
      worstMtm: Math.min(...rows.map((r) => r.worstMtm)), losingYears: Object.values(byYear).filter((v) => v < 0).length, yearCount: Object.keys(byYear).length, byYear, rows };
    tests.push(t);
    console.log(`b${BASE * 100} ${N}m ${scaled ? 'scaled' : 'fixed '} ${t.dist}% | ${up ? 'U' : '-'}${down} | n ${t.all.n} (model ${t.modelPriced}) won ${t.all.won}% total ${t.all.total} /yr ${t.all.perYear} worst ${t.all.worst} worstMTM ${t.worstMtm} | losing yrs ${t.losingYears}/${t.yearCount} | traded-only n ${t.traded.n} total ${t.traded.total} /yr ${t.traded.perYear} | since23 ${t.since2023.total} | skip ${JSON.stringify(skipped)}`);
  }
}
// Today's margin for each frame's starting shape, from NSE's SPAN file.
const margins: Record<string, number | null> = {};
try {
  const span = (await spanOn(D, U))?.data?.[U];
  const ahead = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry);
  const lastIn = new Map<string, string>(); for (const e of ahead) lastIn.set(e.slice(0, 7), e);
  const mons = [...lastIn.values()], monthsAway = (e: string) => R((Date.parse(e) - Date.parse(D)) / (30.44 * 86400_000));
  for (const BASE of BASES) for (const N of FRAMES) for (const scaled of [false, true]) {
    const key = `${N}${scaled ? 's' : 'f'}-${Math.round(BASE * 100)}`;
    const e = N === 11 ? mons.find((x) => x.slice(5, 7) === '12' && monthsAway(x) >= 11) : mons.find((x) => monthsAway(x) >= N); if (!span || !e) continue;
    const day = await load(D, e), spot = today.spotPaise!, dist = scaled ? BASE * Math.sqrt(N / 11) : BASE, tol = N <= 3 ? 0.01 : 0.025;
    const a = strike(day, 'CE', spot, spot, tol), c = a && strike(day, 'CE', a.q.strikePaise * (1 + dist), spot, tol), p = a && strike(day, 'PE', a.q.strikePaise * (1 - dist), spot, tol);
    if (!a || !c || !p) { margins[key] = null; continue; }
    const legs = [[a, 1], [c, -2], [p, -1]] as const;
    const v = positionMargin(span, legs.map(([x, q]) => ({ kind: x.q.kind, expiry: e, strike: x.q.strikePaise / 100, qty: q * today.lotSize!, pricePaise: x.px })) as never, spot, D);
    margins[key] = v.missing.length ? null : R(v.marginPaise / 100);
    console.log(`margin ${key} ${N}m ${scaled ? 'scaled' : 'fixed'} on ${e}: B1 ${a.q.strikePaise / 100}CE S2 ${c.q.strikePaise / 100}CE S1 ${p.q.strikePaise / 100}PE ₹${margins[key]}`);
  }
} catch (err) { console.log('margin skipped', String(err)); }
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-callratio.json'), JSON.stringify({ ranAt: new Date().toISOString(), bases: BASES, lot: today.lotSize, spot: today.spotPaise! / 100, margins, tests }));
console.log('written');
await prisma.$disconnect();
