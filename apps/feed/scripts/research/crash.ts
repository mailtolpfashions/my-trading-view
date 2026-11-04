// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
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
const priceOf = (r: Q[], k: string, K: number, fb: number) => { const x = r.find((z) => z.kind === k && z.strikePaise === K); return x ? (x.traded ? x.closePaise : x.settlePaise) : fb; };
const ivRows = await prisma.fnoDerivedDay.findMany({ where: { underlying: U, atmIv: { not: null }, daysToExpiry: { gte: 25, lte: 60 } }, select: { date: true, atmIv: true }, orderBy: { date: 'asc' } });
const ivByDate = new Map<string, number>(); for (const r of ivRows) if (!ivByDate.has(r.date)) ivByDate.set(r.date, r.atmIv!);
const ivList = [...ivByDate.entries()];
const ivHigh = (d: string) => { const i = ivList.findIndex(([x]) => x >= d); if (i < 60) return null; const p = ivList.slice(Math.max(0, i - 250), i).map(([, v]) => v).sort((a, b) => a - b); return ivList[i][1] > p[Math.floor(p.length / 2)]; };
function shortFor(rows: Q[], k: 'CE' | 'PE', s: number, F: number, T: number) {
  let best: Q | null = null, gap = 9;
  for (const r of usable(rows, k)) { if (s * (r.strikePaise - F) <= 0) continue; const dl = deltaOf(k, r.closePaise, F, r.strikePaise, T); if (dl == null) continue; const g = Math.abs(Math.abs(dl) - 0.16); if (g < gap) { gap = g; best = r; } }
  return best && gap <= 0.05 ? best : null;
}
type H = { name: string; pct: number | null; sides: ('CE' | 'PE')[] };
const hedges: H[] = [
  { name: 'No crash hedge', pct: null, sides: [] },
  { name: 'Both sides 10% from index', pct: 10, sides: ['CE', 'PE'] },
  { name: 'Both sides 12%', pct: 12, sides: ['CE', 'PE'] },
  { name: 'Both sides 15%', pct: 15, sides: ['CE', 'PE'] },
  { name: 'Put side only 10%', pct: 10, sides: ['PE'] },
  { name: 'Put side only 12%', pct: 12, sides: ['PE'] },
  { name: 'Put side only 15%', pct: 15, sides: ['PE'] },
];
/** One trade, one lot at today's size, rupees. Null when a leg cannot be priced honestly. */
async function trade(e: string, h: H): Promise<{ net: number; hedgeCost: number } | null> {
  const d = pickDate(e, 45), x = pickDate(e, 21);
  if (!d || !x || d >= x || Math.round((Date.parse(e) - Date.parse(d)) / DAY) > 50) return null;
  const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) return null;
  const rows = await load(d, e), T = yearsBetween(d, e);
  const F = parityForward(rows.filter((r) => r.kind === 'CE').map(toQ), rows.filter((r) => r.kind === 'PE').map(toQ), m.spotPaise, T) ?? m.spotPaise;
  const legs: { k: string; K: number; q: number; px: number; last: number }[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    const sh = shortFor(rows, k, s, F, T); if (!sh) return null;
    legs.push({ k, K: sh.strikePaise, q: -1, px: Math.max(5, sh.closePaise - SLIP), last: sh.closePaise });
    if (h.pct != null && h.sides.includes(k)) {
      const tgt = m.spotPaise * (1 + s * h.pct / 100), w = near(rows, k, tgt);
      if (!w || Math.abs(w.strikePaise - tgt) > m.spotPaise * 0.01 || w.closePaise >= sh.closePaise || s * (w.strikePaise - sh.strikePaise) <= 0) return null;
      legs.push({ k, K: w.strikePaise, q: 1, px: w.closePaise + SLIP, last: w.closePaise });
    }
  }
  const lot = m.lotSize, scale = todayN / (m.spotPaise * lot), r = await load(x, e);
  let cash = 0, ch = 0, hedgeCost = 0;
  for (const l of legs) {
    cash += (l.q < 0 ? 1 : -1) * lot * l.px; ch += computeOptionCharges({ side: l.q < 0 ? 'SELL' : 'BUY', qty: lot, premiumPaise: l.px, date: d }).total;
    if (l.q > 0) hedgeCost += lot * l.px;
    const mk = priceOf(r, l.k, l.K, l.last), p = l.q < 0 ? mk + SLIP : Math.max(5, mk - SLIP);
    cash += (l.q < 0 ? -1 : 1) * lot * p; ch += computeOptionCharges({ side: l.q < 0 ? 'BUY' : 'SELL', qty: lot, premiumPaise: p, date: x }).total;
  }
  return { net: ((cash - ch) * scale) / 100, hedgeCost: (hedgeCost * scale) / 100 };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;
const rows: { e: string; y: string; high: boolean; net: number }[] = [];
for (const e of monthly) { const d = pickDate(e, 45), t = await trade(e, hedges[0]); if (!t || !d) continue; const hi = ivHigh(d); if (hi == null) continue; rows.push({ e, y: e.slice(0, 4), high: hi, net: t.net }); }
const hi = rows.filter((r) => r.high), lo = rows.filter((r) => !r.high);
const line = (n: string, a: typeof rows) => console.log(`${n}: n ${a.length} won ${R(a.filter((r) => r.net > 0).length / a.length * 100)}% net ${R(sum(a.map((r) => r.net)))} /yr ${R(sum(a.map((r) => r.net)) / YEARS)} worst ${R(Math.min(...a.map((r) => r.net)))}`);
line('High IV months', hi); line('Normal IV months', lo);
const span = (await spanOn(today.date, U))?.data?.[U];
console.log('\nLOT PLANS (years', YEARS.toFixed(1), ')');
for (const [name, loLots, hiLots] of [['1 lot every month', 1, 1], ['2 lots every month', 2, 2], ['2 lots high IV only', 0, 2], ['1 normal, 2 high IV', 1, 2], ['4 lots every month', 4, 4], ['4 lots high IV only', 0, 4], ['2 normal, 4 high IV', 2, 4]] as const) {
  const pts = rows.map((r) => ({ ...r, v: r.net * (r.high ? hiLots : loLots) })), yrs: Record<string, number> = {};
  for (const p of pts) yrs[p.y] = (yrs[p.y] ?? 0) + p.v;
  let eq = 0, peak = 0, dd = 0; for (const p of pts) { eq += p.v; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const trades = rows.reduce((s, r) => s + ((r.high ? hiLots : loLots) ? 1 : 0), 0);
  console.log(`${name.padEnd(24)} trades ${trades} | /yr ${R(sum(pts.map((p) => p.v)) / YEARS)} | worst trade ${R(Math.min(...pts.map((p) => p.v)))} | deepest fall ${R(dd)} | losing yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | worst yr ${R(Math.min(...Object.values(yrs)))}`);
}
console.log('\nCRASH HEDGES, high IV months, same trades compared');
const E = '2026-12-29';
for (const h of hedges) {
  const out: { e: string; net: number; base: number; cost: number; y: string }[] = [];
  for (const r of hi) { const t = await trade(r.e, h); if (t) out.push({ e: r.e, net: t.net, base: r.net, cost: t.hedgeCost, y: r.y }); }
  if (!out.length) { console.log(h.name, 'no trades'); continue; }
  const yrs: Record<string, number> = {}; for (const o of out) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  // today
  const tr = await load(today.date, E), T = yearsBetween(today.date, E), F = parityForward(tr.filter((r) => r.kind === 'CE').map(toQ), tr.filter((r) => r.kind === 'PE').map(toQ), today.spotPaise!, T) ?? today.spotPaise!;
  const legs: { k: 'CE' | 'PE'; K: number; q: number; px: number; iv: number }[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    const sh = shortFor(tr, k, s, F, T)!; legs.push({ k, K: sh.strikePaise, q: -1, px: sh.closePaise, iv: ivOf(k, sh.closePaise, F, sh.strikePaise, T) ?? 0.15 });
    if (h.pct != null && h.sides.includes(k)) { const w = near(tr, k, today.spotPaise! * (1 + s * h.pct / 100)); legs.push({ k, K: w.strikePaise, q: 1, px: w.closePaise, iv: ivOf(k, w.closePaise, F, w.strikePaise, T) ?? 0.15 }); }
  }
  const mg = span ? positionMargin(span, legs.map((l) => ({ kind: l.k, expiry: E, strike: l.K / 100, qty: l.q * 65, pricePaise: l.px })) as any, today.spotPaise!, today.date).marginPaise / 100 : 0;
  const shock = legs.map((l) => ({ kind: l.k, side: (l.q < 0 ? 'SELL' : 'BUY') as 'SELL' | 'BUY', qty: 65, strikePaise: l.K, pricePaise: l.px, iv: l.iv, T, forwardPaise: F }));
  const g = GAP_SHOCKS.filter((x) => Math.abs(x.gapPct) >= 8).map((x) => `${x.gapPct}%: ${R(gapPnl(shock, x) / 100)}`).join(' ');
  console.log(`${h.name.padEnd(28)} n ${out.length}/${hi.length} ${out[0].e}.. | won ${R(out.filter((o) => o.net > 0).length / out.length * 100)}% | net ${R(sum(out.map((o) => o.net)))} vs no hedge same trades ${R(sum(out.map((o) => o.base)))} | avg cost ${R(sum(out.map((o) => o.cost)) / out.length)} | worst ${R(Math.min(...out.map((o) => o.net)))} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | margin ${R(mg)} | ${g} | legs ${legs.filter((l) => l.q > 0).map((l) => `${l.K / 100}${l.k}@${l.px / 100}`).join(' ')}`);
}
await prisma.$disconnect(); process.exit(0);
