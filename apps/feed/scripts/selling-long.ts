// Long-dated option selling. Three questions, on NSE's official NIFTY closes:
// 1. How much premium does each time frame pay, up to 2 years out, and how much is that per month?
// 2. Selling at each time frame and holding to 21 days left or to expiry: what did it really keep?
// 3. The slide: sell the December ATM straddle at the end of January, exit if India VIX crosses 30.
// Written to .data/research/selling-long.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-long.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { deltaOf, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../src/fno/span';

const U = 'NIFTY', DAY = 86400_000;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, D = today.date, lastDate = D;
const vix = new Map((await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true } })).map((r) => [r.date, r.closePaise / 100]));
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10 && idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of allExp) last.set(e.slice(0, 7), e);
const monthly = [...last.values()];
const daysTo = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const pick = (t: string) => dates.find((d) => d >= t) ?? null;
const back = (e: string, x: number) => new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10);
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; volume: bigint; oi: bigint };
const cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const k = d + e; let r = cache.get(k);
  if (!r) {
    r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, volume: true, oi: true } })) as Q[];
    for (const kind of ['CE', 'PE']) { const l = r.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    cache.set(k, r);
  }
  return r;
}
const quotes = (r: Q[], k: string) => r.filter((x) => x.kind === k).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
type Leg = { k: 'CE' | 'PE'; K: number; px: number };
/** The traded strike nearest the index that has both a call and a put. Within 2% of the index, or none. */
function straddle(r: Q[], spot: number): Leg[] | null {
  const ce = new Map(r.filter((x) => x.kind === 'CE' && x.traded && x.closePaise > 0).map((x) => [x.strikePaise, x]));
  const both = r.filter((x) => x.kind === 'PE' && x.traded && x.closePaise > 0 && ce.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - spot) - Math.abs(b.strikePaise - spot))[0];
  if (!both || Math.abs(both.strikePaise - spot) > spot * 0.02) return null;
  return [{ k: 'CE', K: both.strikePaise, px: ce.get(both.strikePaise)!.closePaise }, { k: 'PE', K: both.strikePaise, px: both.closePaise }];
}
function strangle(r: Q[], d: string, e: string, spot: number, target = 0.16): Leg[] | null {
  const T = yearsBetween(d, e), F = parityForward(quotes(r, 'CE'), quotes(r, 'PE'), spot, T) ?? spot, legs: Leg[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    let best: Q | null = null, gap = 0.05;
    for (const x of r) { if (x.kind !== k || !x.traded || !(x.closePaise > 0) || s * (x.strikePaise - F) <= 0) continue; const dl = deltaOf(k, x.closePaise, F, x.strikePaise, T); if (dl == null) continue; const g = Math.abs(Math.abs(dl) - target); if (g < gap) { gap = g; best = x; } }
    if (!best) return null;
    legs.push({ k, K: best.strikePaise, px: best.closePaise });
  }
  return legs;
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;

// ---- 1. Premium by time frame ----
const BUCKETS = [30, 45, 60, 90, 120, 180, 270, 365, 450, 540, 730];
const firsts = dates.filter((d, i) => i === 0 || d.slice(0, 7) !== dates[i - 1].slice(0, 7));
const seen: Record<number, { straddle: number[]; strangle: number[]; volume: number[]; recent: number[] }> = {};
for (const b of BUCKETS) seen[b] = { straddle: [], strangle: [], volume: [], recent: [] };
for (const d of firsts) {
  const spot = M.get(d)!.spotPaise; if (!spot) continue;
  const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10 && e > d);
  for (const b of BUCKETS) {
    const e = exps.filter((x) => Math.abs(daysTo(d, x) - b) <= Math.max(7, b * 0.12)).sort((p, q) => Math.abs(daysTo(d, p) - b) - Math.abs(daysTo(d, q) - b))[0];
    if (!e) continue;
    const r = await load(d, e), a = straddle(r, spot); if (!a) continue;
    const c = sum(a.map((l) => l.px)) / spot * 100, days = daysTo(d, e);
    seen[b].straddle.push(c); if (d >= '2023') seen[b].recent.push(c);
    const b16 = strangle(r, d, e, spot); if (b16) seen[b].strangle.push(sum(b16.map((l) => l.px)) / spot * 100);
    seen[b].volume.push(sum(r.filter((x) => x.strikePaise === a[0].K).map((x) => Number(x.volume))));
    void days;
  }
  cache.clear();
}
const curve = BUCKETS.map((b) => {
  const s = seen[b], st = median(s.straddle), sg = median(s.strangle), m = b / 30.4;
  return { days: b, months: Number(m.toFixed(1)), samples: s.straddle.length, straddlePct: st, strangle16Pct: sg, straddlePerMonth: st == null ? null : st / m, stranglePerMonth: sg == null ? null : sg / m, recentStraddlePct: median(s.recent), medianVolume: median(s.volume) };
});

// ---- Today's prices at every long expiry ----
const span = (await spanOn(D, U))?.data?.[U];
const lotT = today.lotSize!;
const todayExps = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry).filter((e) => e > D);
const todayCurve = [];
for (const e of todayExps) {
  const days = daysTo(D, e); if (days < 15 || days > 800) continue;
  const r = await load(D, e), row = (legs: Leg[] | null) => {
    if (!legs) return null;
    const credit = (sum(legs.map((l) => l.px)) * lotT) / 100;
    const mg = span ? positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: e, strike: l.K / 100, qty: -lotT, pricePaise: l.px })) as never, today.spotPaise!, D) : null;
    const margin = mg && !mg.missing.length ? mg.marginPaise / 100 : null;
    return { strikes: legs.map((l) => `${l.K / 100} ${l.k}`).join(' / '), credit: R(credit), margin: margin == null ? null : R(margin), pctOfMargin: margin ? (credit / margin) * 100 : null, perMonth: margin ? (credit / margin) * 100 / (days / 30.4) : null, volume: sum(legs.map((l) => Number(r.find((x) => x.kind === l.k && x.strikePaise === l.K)?.volume ?? 0))) };
  };
  todayCurve.push({ expiry: e, days, straddle: row(straddle(r, today.spotPaise!)), strangle: row(strangle(r, D, e, today.spotPaise!)) });
}

// ---- One held trade ----
type Result = { net: number; held: number; reason: string; entry: string; exit: string; spotIn: number; spotOut: number; open: boolean };
async function hold(e: string, d: string, legs: Leg[], stopDate: string, slip: number, vixExit: number | null, late: boolean): Promise<Result | null> {
  const m = M.get(d)!, lot = m.lotSize!, scale = todayN / (m.spotPaise! * lot);
  let cash = 0, ch = 0;
  for (const l of legs) { const p = Math.max(5, l.px - slip); cash += lot * p; ch += computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: p, date: d }).total; }
  let x = stopDate, reason = stopDate >= e ? 'expiry' : 'time', hit = false;
  const end = Math.min(idx.get(stopDate) ?? dates.length - 1, dates.length - 1);
  if (vixExit != null) for (let j = idx.get(d)! + 1; j <= end; j++) {
    const t = dates[j], v = vix.get(t);
    if (hit) { x = t; break; }
    if (v != null && v >= vixExit) { reason = 'vix'; x = t; if (late) { hit = true; continue; } break; }
  }
  const open = x > lastDate || (reason !== 'vix' && !idx.has(x));
  if (open) x = lastDate;
  const atExpiry = x === e && e <= lastDate;
  const rx = atExpiry ? [] : await load(x, e), ST = M.get(x)!.spotPaise ?? m.spotPaise!;
  for (const l of legs) {
    if (atExpiry) { const I = Math.max(0, l.k === 'CE' ? ST - l.K : l.K - ST); cash -= lot * I; }
    else { const q = rx.find((z) => z.kind === l.k && z.strikePaise === l.K), mk = q ? (q.traded ? q.closePaise : q.settlePaise) : l.px, p = mk + slip; cash -= lot * p; ch += computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: p, date: x }).total; }
  }
  void exerciseStt;
  return { net: ((cash - ch) * scale) / 100, held: daysTo(d, x), reason: open ? 'open' : reason, entry: d, exit: x, spotIn: m.spotPaise! / 100, spotOut: ST / 100, open };
}

// ---- 2. Each time frame, one trade per monthly expiry ----
const FRAMES = [30, 45, 60, 90, 120, 180, 270, 365, 450, 540, 730];
const frameRows = [];
for (const shape of ['strangle', 'straddle'] as const) for (const X of FRAMES) for (const exitLeft of [21, 0]) {
  if (exitLeft >= X) continue;
  const list: Result[] = []; let skip = 0;
  for (const e of monthly) {
    const d = pick(back(e, X)); if (!d || d >= e || Math.abs(daysTo(d, e) - X) > Math.max(7, X * 0.12)) { continue; }
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    const r = await load(d, e), legs = shape === 'straddle' ? straddle(r, m.spotPaise) : strangle(r, d, e, m.spotPaise);
    if (!legs) { skip++; continue; }
    const stop = exitLeft ? pick(back(e, exitLeft)) : e;
    if (!stop) continue;
    const t = await hold(e, d, legs, stop, 100, null, false); if (t && !t.open) list.push(t);
  }
  if (list.length < 3) { frameRows.push({ shape, days: X, exitLeft, trades: list.length, skipped: skip }); continue; }
  const n = list.map((t) => t.net), w = n.filter((v) => v > 0), l = n.filter((v) => v <= 0), held = sum(list.map((t) => t.held));
  frameRows.push({ shape, days: X, exitLeft, trades: list.length, skipped: skip, wonPct: (w.length / n.length) * 100, avgWin: R(sum(w) / (w.length || 1)), avgLoss: R(-sum(l) / (l.length || 1)), avgPerTrade: R(sum(n) / n.length), perMonthHeld: R(sum(n) / (held / 30.4)), worst: R(Math.min(...n)), best: R(Math.max(...n)), avgDays: R(held / n.length), first: list[0].entry });
  cache.clear();
}

// ---- 3. The slide ----
const years = [...new Set(dates.map((d) => Number(d.slice(0, 4))))];
const slide = [];
for (const [name, vixExit, late, slip] of [['Slide rule: exit if VIX crosses 30', 30, false, 100], ['Same, acting a day late', 30, true, 100], ['Same, ₹5 slippage', 30, false, 500], ['No VIX exit, hold to December expiry', null, false, 100]] as const) {
  const rows = [];
  for (const y of years) {
    const jan = dates.filter((d) => d.startsWith(`${y}-01`)).at(-1), e = [...monthly, ...todayExps].find((x) => x.startsWith(`${y}-12`) && (monthly.includes(x) || x > lastDate));
    if (!jan || !e) continue;
    const m = M.get(jan)!; if (!m.spotPaise || !m.lotSize) continue;
    const r = await load(jan, e), legs = straddle(r, m.spotPaise);
    if (!legs) { rows.push({ year: y, skipped: 'No traded December straddle at the end of January' }); continue; }
    const t = (await hold(e, jan, legs, e, slip, vixExit, late))!;
    rows.push({ year: y, entry: t.entry, exit: t.exit, reason: t.reason, strike: legs[0].K / 100, creditPerUnit: sum(legs.map((l) => l.px)) / 100, spotIn: t.spotIn, spotOut: t.spotOut, net: R(t.net), days: t.held, open: t.open });
  }
  const done = rows.filter((x) => 'net' in x && !x.open) as { net: number; days: number; reason: string }[], n = done.map((x) => x.net);
  slide.push({ name, rows, trades: done.length, won: n.length ? (n.filter((v) => v > 0).length / n.length) * 100 : null, perTrade: n.length ? R(sum(n) / n.length) : null, total: R(sum(n)), worst: n.length ? R(Math.min(...n)) : null, best: n.length ? R(Math.max(...n)) : null, vixExits: done.filter((x) => x.reason === 'vix').length, avgDays: done.length ? R(sum(done.map((x) => x.days)) / done.length) : null });
}
const decE = todayExps.find((e) => e === '2027-12-28'), r0 = decE ? await load(D, decE) : [], leg0 = decE ? straddle(r0, today.spotPaise!) : null;
const margin0 = span && leg0 ? positionMargin(span, leg0.map((l) => ({ kind: l.k, expiry: decE!, strike: l.K / 100, qty: -lotT, pricePaise: l.px })) as never, today.spotPaise!, D).marginPaise / 100 : null;

const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-long.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: dates[0], to: D, lot: lotT, curve, todayCurve, frames: frameRows, slide, straddleMarginToday: margin0, straddleToday: leg0 }));
console.log('CURVE'); for (const c of curve) console.log(`${String(c.days).padStart(3)}d n ${c.samples} straddle ${c.straddlePct?.toFixed(2)}% (/mo ${c.straddlePerMonth?.toFixed(2)}) strangle ${c.strangle16Pct?.toFixed(2)}% (/mo ${c.stranglePerMonth?.toFixed(2)}) recent ${c.recentStraddlePct?.toFixed(2)} vol ${c.medianVolume}`);
console.log('TODAY'); for (const c of todayCurve) console.log(`${c.expiry} ${c.days}d | straddle ${c.straddle?.strikes} ₹${c.straddle?.credit} margin ${c.straddle?.margin} ${c.straddle?.pctOfMargin?.toFixed(1)}% /mo ${c.straddle?.perMonth?.toFixed(2)} vol ${c.straddle?.volume} | strangle ${c.strangle?.strikes} ₹${c.strangle?.credit} margin ${c.strangle?.margin} ${c.strangle?.pctOfMargin?.toFixed(1)}% /mo ${c.strangle?.perMonth?.toFixed(2)} vol ${c.strangle?.volume}`);
console.log('FRAMES'); for (const f of frameRows) console.log(JSON.stringify(f));
console.log('SLIDE'); for (const s of slide) { console.log(s.name, JSON.stringify({ ...s, rows: undefined })); for (const r of s.rows) console.log('  ', JSON.stringify(r)); }
console.log('margin today, Dec 2027 straddle', margin0);
await prisma.$disconnect();
