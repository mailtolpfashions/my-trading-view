// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { GAP_SHOCKS, deltaOf, gapPnl, ivOf, parityForward, positionMargin, yearsBetween } from '@mtv/options';
import { spanOn } from '../../src/fno/span';

const U = 'NIFTY', SLIP = 100, DAY = 86400_000, BASE = 7.5;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65, YEARS = dates.length / 248;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
const monthly = [...last.values()];
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const cache = new Map<string, Q[]>();
const load = async (d: string, e: string) => {
  const k = d + e; let r = cache.get(k);
  if (!r) { r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[]; cache.set(k, r); }
  return r;
};
const toQ = (r: Q) => ({ strikePaise: r.strikePaise, pricePaise: r.traded ? r.closePaise : r.settlePaise, traded: r.traded });
const pickDate = (e: string, x: number) => { const t = new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10); return dates.find((d) => d >= t) ?? null; };
const usable = (r: Q[], k: string) => r.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const near = (r: Q[], k: string, t: number) => usable(r, k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const intr = (k: string, K: number, S: number) => Math.max(0, k === 'CE' ? S - K : K - S);
const priceOf = (r: Q[], k: string, K: number, fb: number) => { const x = r.find((z) => z.kind === k && z.strikePaise === K); return x ? (x.traded ? x.closePaise : x.settlePaise) : fb; };

// IV high: this entry's ATM IV is above the median of the previous 250 days, using only earlier days.
const ivRows = await prisma.fnoDerivedDay.findMany({ where: { underlying: U, atmIv: { not: null }, daysToExpiry: { gte: 25, lte: 60 } }, select: { date: true, atmIv: true }, orderBy: { date: 'asc' } });
const ivByDate = new Map<string, number>(); for (const r of ivRows) if (!ivByDate.has(r.date)) ivByDate.set(r.date, r.atmIv!);
const ivList = [...ivByDate.entries()];
const ivHigh = (d: string) => {
  const i = ivList.findIndex(([x]) => x >= d); if (i < 60) return null;
  const past = ivList.slice(Math.max(0, i - 250), i).map(([, v]) => v).sort((a, b) => a - b);
  return ivList[i][1] > past[Math.floor(past.length / 2)];
};

function shortFor(rows: Q[], k: 'CE' | 'PE', s: number, F: number, T: number, target: number) {
  let best: Q | null = null, gap = 9;
  for (const r of usable(rows, k)) { if (s * (r.strikePaise - F) <= 0) continue; const dl = deltaOf(k, r.closePaise, F, r.strikePaise, T); if (dl == null) continue; const g = Math.abs(Math.abs(dl) - target); if (g < gap) { gap = g; best = r; } }
  return best && gap <= 0.05 ? best : null;
}
type Var = { name: string; wing: number | null; ivOnly?: boolean; stop?: number; target?: number };
const vars: Var[] = [];
for (const wing of [null, 2, 4, 6, 8]) for (const ivOnly of [false, true]) for (const stop of [undefined, 15000, 25000]) vars.push({ name: `${wing == null ? 'Naked' : `Hedge ${wing}%`}${ivOnly ? ', high IV' : ''}${stop ? `, exit ${stop}` : ''}`, wing, ivOnly, stop });
vars.push({ name: 'Naked, book 50%', wing: null, target: 50 }, { name: 'Naked, high IV, book 50%', wing: null, ivOnly: true, target: 50 }, { name: 'Naked, high IV, exit 25000, book 50%', wing: null, ivOnly: true, stop: 25000, target: 50 }, { name: 'Hedge 6%, high IV, book 50%', wing: 6, ivOnly: true, target: 50 });

const span = (await spanOn(today.date, U))?.data?.[U];
const R = (p: number) => Math.round(p / 100), sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const size = (perYear: number, worst: number, margin: number | null) => [500000, 1000000].map((cap) => {
  if (!margin) return 'margin ?';
  const lots = Math.floor((cap * 0.6) / margin); // keep 40% free for adjustments and margin jumps
  return `${cap / 100000}L: ${lots} lots ${(BASE + (lots * perYear / cap) * 100).toFixed(1)}%/yr worst ${lots ? ((lots * worst / cap) * 100).toFixed(0) : 0}%`;
}).join(' | ');
const E = '2026-12-29';
const legsToday = async (wing: number | null) => {
  const rows = await load(today.date, E), T = yearsBetween(today.date, E), calls = rows.filter((r) => r.kind === 'CE').map(toQ), puts = rows.filter((r) => r.kind === 'PE').map(toQ);
  const F = parityForward(calls, puts, today.spotPaise!, T) ?? today.spotPaise!, out: { k: string; K: number; q: number; px: number; iv: number }[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    const sh = shortFor(rows, k, s, F, T, 0.16)!;
    out.push({ k, K: sh.strikePaise, q: -1, px: sh.closePaise, iv: ivOf(k, sh.closePaise, F, sh.strikePaise, T) ?? 0.15 });
    if (wing != null) { const w = near(rows, k, sh.strikePaise + s * today.spotPaise! * (wing / 100)); out.push({ k, K: w.strikePaise, q: 1, px: w.closePaise, iv: ivOf(k, w.closePaise, F, w.strikePaise, T) ?? 0.15 }); }
  }
  return { out, F, T };
};
const marginCache = new Map<string, number | null>();
const marginOf = async (wing: number | null) => {
  const key = String(wing); if (marginCache.has(key)) return marginCache.get(key)!;
  const { out } = await legsToday(wing);
  const m = span ? positionMargin(span, out.map((l) => ({ kind: l.k, expiry: E, strike: l.K / 100, qty: l.q * 65, pricePaise: l.px })) as any, today.spotPaise!, today.date).marginPaise / 100 : null;
  marginCache.set(key, m); return m;
};
console.log(`Enter 45 days, exit 21 days left. ${dates[0]} to ${dates.at(-1)}, ${YEARS.toFixed(1)} years. Margin on ${E} legs.`);
for (const v of vars) {
  const out: { y: string; net: number }[] = []; let skip = 0, filtered = 0, stops = 0;
  for (const e of monthly) {
    const d = pickDate(e, 45), x = pickDate(e, 21);
    if (!d || !x || d >= x || Math.round((Date.parse(e) - Date.parse(d)) / DAY) > 50) { skip++; continue; }
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    if (v.ivOnly) { const h = ivHigh(d); if (h !== true) { filtered++; continue; } }
    const rows = await load(d, e), T = yearsBetween(d, e), calls = rows.filter((r) => r.kind === 'CE').map(toQ), puts = rows.filter((r) => r.kind === 'PE').map(toQ);
    const F = parityForward(calls, puts, m.spotPaise, T) ?? m.spotPaise, legs: { k: string; K: number; q: number; px: number; last: number }[] = []; let ok = true;
    for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
      const sh = shortFor(rows, k, s, F, T, 0.16); if (!sh) { ok = false; break; }
      legs.push({ k, K: sh.strikePaise, q: -1, px: Math.max(5, sh.closePaise - SLIP), last: sh.closePaise });
      if (v.wing != null) {
        const tgt = sh.strikePaise + s * m.spotPaise * (v.wing / 100), w = near(rows, k, tgt);
        if (!w || Math.abs(w.strikePaise - tgt) > m.spotPaise * 0.01 || w.closePaise >= sh.closePaise) { ok = false; break; }
        legs.push({ k, K: w.strikePaise, q: 1, px: w.closePaise + SLIP, last: w.closePaise });
      }
    }
    if (!ok) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot);
    let cash = 0, ch = 0, credit = 0;
    for (const l of legs) { cash += (l.q < 0 ? 1 : -1) * lot * l.px; credit += (l.q < 0 ? 1 : -1) * lot * l.px; ch += computeOptionCharges({ side: l.q < 0 ? 'SELL' : 'BUY', qty: lot, premiumPaise: l.px, date: d }).total; }
    let exitOn = x, pending = false;
    for (let j = idx.get(d)! + 1; j <= idx.get(x)!; j++) {
      const t = dates[j], r = await load(t, e);
      for (const l of legs) l.last = priceOf(r, l.k, l.K, l.last);
      if (pending || t === x) { exitOn = t; break; }
      const pnl = (cash + legs.reduce((s, l) => s + (l.q > 0 ? 1 : -1) * lot * l.last, 0) - ch) * scale / 100;
      if (v.stop && pnl <= -v.stop) { pending = true; stops++; }
      if (v.target && (cash + legs.reduce((s, l) => s + (l.q > 0 ? 1 : -1) * lot * l.last, 0)) >= credit * (v.target / 100)) pending = true;
    }
    for (const l of legs) { const p = l.q < 0 ? l.last + SLIP : Math.max(5, l.last - SLIP); cash += (l.q < 0 ? -1 : 1) * lot * p; ch += computeOptionCharges({ side: l.q < 0 ? 'BUY' : 'SELL', qty: lot, premiumPaise: p, date: exitOn }).total; }
    out.push({ y: exitOn.slice(0, 4), net: (cash - ch) * scale });
  }
  if (out.length < 20) { console.log(v.name, 'too few trades', out.length); continue; }
  const nets = out.map((o) => o.net), w = nets.filter((n) => n > 0), l = nets.filter((n) => n <= 0), yrs: Record<string, number> = {};
  for (const o of out) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  const net = sum(nets), perYear = net / 100 / YEARS, worst = Math.abs(Math.min(...nets)) / 100, margin = await marginOf(v.wing);
  console.log(`${v.name.padEnd(38)} n ${out.length} skip ${skip} off ${filtered} | won ${(w.length / out.length * 100).toFixed(0)}% win ${R(sum(w) / w.length)} loss ${R(-sum(l) / (l.length || 1))} | worst ${R(Math.min(...nets))} | net ${R(net)} /yr ${Math.round(perYear)} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | since23 ${R(sum(out.filter((o) => o.y >= '2023').map((o) => o.net)))} | stops ${stops} | margin ${margin ? Math.round(margin) : '?'} | ${size(perYear, worst, margin)}`);
}

// Calendars: sell the near monthly, buy the next monthly, same strikes, 21 days before the near expiry, until it settles.
for (const away of [0, 2, 4]) {
  const out: { y: string; net: number }[] = []; let skip = 0;
  for (let i = 0; i + 1 < monthly.length; i++) {
    const e = monthly[i], far = monthly[i + 1], d = pickDate(e, 21); if (!d || d >= e) { skip++; continue; }
    const m = M.get(d)!, ST = M.get(e)!.spotPaise; if (!m.spotPaise || !m.lotSize || !ST) { skip++; continue; }
    const nr = await load(d, e), fr = await load(d, far), lot = m.lotSize, scale = todayN / (m.spotPaise * lot); let cash = 0, ch = 0, ok = true;
    const exitRows = await load(e, far);
    for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
      const a = near(nr, k, m.spotPaise * (1 + s * away / 100)); if (!a) { ok = false; break; }
      const b = usable(fr, k).find((r) => r.strikePaise === a.strikePaise); if (!b) { ok = false; break; }
      const p1 = Math.max(5, a.closePaise - SLIP), p2 = b.closePaise + SLIP, ii = intr(k, a.strikePaise, ST);
      const mk = priceOf(exitRows, k, a.strikePaise, b.closePaise), p3 = Math.max(5, mk - SLIP);
      cash += lot * (p1 - ii - p2 + p3);
      ch += computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: p1, date: d }).total + computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: p2, date: d }).total + computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: p3, date: e }).total;
    }
    if (!ok) { skip++; continue; }
    out.push({ y: e.slice(0, 4), net: (cash - ch) * scale });
  }
  const nets = out.map((o) => o.net), w = nets.filter((n) => n > 0), yrs: Record<string, number> = {};
  for (const o of out) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  console.log(`Double calendar ${away}% out: n ${out.length} skip ${skip} | won ${(w.length / out.length * 100).toFixed(0)}% | worst ${R(Math.min(...nets))} | net ${R(sum(nets))} /yr ${Math.round(sum(nets) / 100 / YEARS)} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | since23 ${R(sum(out.filter((o) => o.y >= '2023').map((o) => o.net)))}`);
}

// Gap test on today's legs, one lot, model estimate.
for (const wing of [null, 4, 8]) {
  const { out, F, T } = await legsToday(wing);
  const shock = out.map((l) => ({ kind: l.k as 'CE' | 'PE', side: (l.q < 0 ? 'SELL' : 'BUY') as 'SELL' | 'BUY', qty: 65, strikePaise: l.K, pricePaise: l.px, iv: l.iv, T, forwardPaise: F }));
  console.log(`Gap, ${wing == null ? 'naked' : `hedge ${wing}%`}: legs ${out.map((l) => `${l.q < 0 ? 'S' : 'B'} ${l.K / 100}${l.k}@${l.px / 100}`).join(' ')} | ` + GAP_SHOCKS.map((g) => `${g.gapPct}%: ${R(gapPnl(shock, g))}`).join('  '));
}
await prisma.$disconnect(); process.exit(0);
