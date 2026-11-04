// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
// The user's shape: sell the ATM straddle, buy protection at the breakevens, sell 2x or 3x further out to pay for it, then
// optionally buy the same number still further out. Enter 45 days, exit 21 days left, monthly NIFTY. Also the paper rule,
// each with and without trades touching a Budget or election-result month. EXAMPLE_ONLY prints today's numbers.
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { deltaOf, ivAboveMedian, parityForward, positionMargin, staleFlags, yearsBetween } from '@mtv/options';
import { spanOn } from '../../src/fno/span';
import { MARKET_EVENTS } from '../../src/research/nifty-days';

const U = 'NIFTY', SLIP = 100, DAY = 86400_000, ONLY = process.argv[2] === 'example';
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65, YEARS = dates.length / 248;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
// listed today: expiries still ahead whose trade can already have finished
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: today.date, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > today.date) last.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...last.values()].sort();
const eventMonths = new Set(MARKET_EVENTS.filter((e) => e.id.startsWith('budget') || e.id.startsWith('election')).map((e) => e.from.slice(0, 7)));
const ivRows = await prisma.fnoDerivedDay.findMany({ where: { underlying: U, atmIv: { not: null }, daysToExpiry: { gte: 25, lte: 60 } }, select: { date: true, atmIv: true }, orderBy: [{ date: 'asc' }, { daysToExpiry: 'asc' }] });
const seen = new Set<string>(), history: { date: string; iv: number }[] = [];
for (const r of ivRows) if (!seen.has(r.date)) { seen.add(r.date); history.push({ date: r.date, iv: r.atmIv! }); }
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const k = d + e; let r = cache.get(k);
  if (!r) {
    r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[];
    for (const kind of ['CE', 'PE']) { const l = r.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    cache.set(k, r);
  }
  return r;
}
const pickDate = (e: string, x: number) => { const t = new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10); return dates.find((d) => d >= t) ?? null; };
const usable = (r: Q[], k: string) => r.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
const near = (r: Q[], k: string, t: number) => usable(r, k).sort((a, b) => Math.abs(a.strikePaise - t) - Math.abs(b.strikePaise - t))[0];
const priceOf = (r: Q[], k: string, K: number, fb: number) => { const x = r.find((z) => z.kind === k && z.strikePaise === K); return x ? (x.traded ? x.closePaise : x.settlePaise) : fb; };
type Leg = { k: 'CE' | 'PE'; K: number; q: number; px: number };
/** The user's shape on one chain, or null when a leg did not trade. */
function build(rows: Q[], spot: number, mult: number, finalPct: number | null, awayPct = 0): Leg[] | null {
  const ce = near(rows, 'CE', spot * (1 + awayPct / 100)), pe = ce && (awayPct === 0 ? usable(rows, 'PE').find((r) => r.strikePaise === ce.strikePaise) : near(rows, 'PE', spot * (1 - awayPct / 100)));
  if (!ce || !pe) return null;
  const credit = ce.closePaise + pe.closePaise, legs: Leg[] = [{ k: 'CE', K: ce.strikePaise, q: -1, px: ce.closePaise }, { k: 'PE', K: pe.strikePaise, q: -1, px: pe.closePaise }];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    const breakeven = (k === 'CE' ? ce.strikePaise : pe.strikePaise) + s * credit, w = near(rows, k, breakeven);
    if (!w || Math.abs(w.strikePaise - breakeven) > spot * 0.01) return null;
    legs.push({ k, K: w.strikePaise, q: 1, px: w.closePaise });
    const far = usable(rows, k).filter((r) => s * (r.strikePaise - w.strikePaise) > 0).sort((a, b) => Math.abs(a.closePaise - w.closePaise / mult) - Math.abs(b.closePaise - w.closePaise / mult))[0];
    if (!far) return null;
    legs.push({ k, K: far.strikePaise, q: -mult, px: far.closePaise });
    if (finalPct != null) {
      const f = near(rows, k, far.strikePaise + s * spot * (finalPct / 100));
      if (!f || f === far || Math.abs(f.strikePaise - (far.strikePaise + s * spot * (finalPct / 100))) > spot * 0.015 || s * (f.strikePaise - far.strikePaise) <= 0) return null;
      legs.push({ k, K: f.strikePaise, q: mult, px: f.closePaise });
    }
  }
  return legs;
}
function rule(rows: Q[], spot: number, T: number): Leg[] | null {
  const F = parityForward(rows.filter((r) => r.kind === 'CE').map((r) => ({ strikePaise: r.strikePaise, pricePaise: r.closePaise, traded: r.traded })), rows.filter((r) => r.kind === 'PE').map((r) => ({ strikePaise: r.strikePaise, pricePaise: r.closePaise, traded: r.traded })), spot, T) ?? spot;
  const legs: Leg[] = [];
  for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
    let best: Q | null = null, gap = 9;
    for (const r of usable(rows, k)) { if (s * (r.strikePaise - F) <= 0) continue; const d = deltaOf(k, r.closePaise, F, r.strikePaise, T); if (d == null) continue; const g = Math.abs(Math.abs(d) - 0.16); if (g < gap) { gap = g; best = r; } }
    if (!best || gap > 0.05) return null;
    legs.push({ k, K: best.strikePaise, q: -1, px: best.closePaise });
  }
  const w = near(rows, 'PE', spot * 0.85);
  if (!w || Math.abs(w.strikePaise - spot * 0.85) > spot * 0.01 || w.strikePaise >= legs[1].K) return null;
  legs.push({ k: 'PE', K: w.strikePaise, q: 1, px: w.closePaise });
  return legs;
}
const R = Math.round, sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pretty = (l: Leg[]) => l.map((x) => `${x.q > 0 ? 'B' : 'S'}${Math.abs(x.q)} ${x.K / 100}${x.k}@${x.px / 100}`).join(', ');
const credit = (l: Leg[]) => sum(l.map((x) => -x.q * x.px)) / 100;
const span = (await spanOn(today.date, U))?.data?.[U], E = '2026-12-29', tr = await load(today.date, E);
for (const [mult, fin, away] of [[2, null, 0], [2, 4, 0], [3, null, 0], [2, null, 2], [2, 4, 2], [2, null, 3.5], [2, 4, 3.5], [2, null, 5], [2, 4, 5], [3, null, 5]] as const) {
  const l = build(tr, today.spotPaise!, mult, fin, away);
  if (!l) { console.log('Example', mult, fin, 'cannot build'); continue; }
  const mg = span ? positionMargin(span, l.map((x) => ({ kind: x.k, expiry: E, strike: x.K / 100, qty: x.q * 65, pricePaise: x.px })) as any, today.spotPaise!, today.date) : null;
  const payoff = (S: number) => R(sum(l.map((x) => -x.q * x.px / 100 + x.q * Math.max(0, x.k === 'CE' ? S - x.K / 100 : x.K / 100 - S))) * 65);
  console.log(`Example sold ${away}% out ${mult}x ${fin ? `final ${fin}%` : 'no final'}: ${pretty(l)} | credit ${credit(l).toFixed(2)} = ${R(credit(l) * 65)} | margin ${mg ? R(mg.marginPaise / 100) : '?'} missing ${mg?.missing.length} | at expiry 18000:${payoff(18000)} 20000:${payoff(20000)} 22000:${payoff(22000)} 23800:${payoff(23800)} 25500:${payoff(25500)} 27000:${payoff(27000)} 30000:${payoff(30000)}`);
}
if (ONLY) { await prisma.$disconnect(); process.exit(0); }
type Row = { y: string; net: number; event: boolean };
async function run(make: (rows: Q[], spot: number, T: number) => Leg[] | null, high: boolean) {
  const out: Row[] = []; let skip = 0, off = 0;
  for (const e of monthly) {
    const d = pickDate(e, 45), x = pickDate(e, 21);
    if (!d || !x || d >= x || Math.round((Date.parse(e) - Date.parse(d)) / DAY) > 50) { skip++; continue; }
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    if (high && ivAboveMedian(history, d) !== true) { off++; continue; }
    const rows = await load(d, e), legs = make(rows, m.spotPaise, yearsBetween(d, e));
    if (!legs) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot), r = await load(x, e); let cash = 0, ch = 0;
    for (const l of legs) {
      const qty = Math.abs(l.q) * lot, side = l.q < 0 ? 'SELL' : 'BUY', p = l.q < 0 ? Math.max(5, l.px - SLIP) : l.px + SLIP;
      cash += (l.q < 0 ? 1 : -1) * qty * p; ch += computeOptionCharges({ side, qty, premiumPaise: p, date: d }).total;
      const mk = priceOf(r, l.k, l.K, l.px), c = l.q < 0 ? mk + SLIP : Math.max(5, mk - SLIP);
      cash += (l.q < 0 ? -1 : 1) * qty * c; ch += computeOptionCharges({ side: l.q < 0 ? 'BUY' : 'SELL', qty, premiumPaise: c, date: x }).total;
    }
    const months = new Set<string>(); for (let t = Date.parse(d); t <= Date.parse(x); t += DAY) months.add(new Date(t).toISOString().slice(0, 7));
    out.push({ y: x.slice(0, 4), net: ((cash - ch) * scale) / 100, event: [...months].some((k) => eventMonths.has(k)) });
  }
  return { out, skip, off };
}
const line = (name: string, a: Row[], skip: number) => {
  if (!a.length) return console.log(name, 'no trades');
  const n = a.map((o) => o.net), w = n.filter((v) => v > 0), l = n.filter((v) => v <= 0), yrs: Record<string, number> = {};
  for (const o of a) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  console.log(`${name.padEnd(52)} n ${String(a.length).padStart(3)} skip ${skip} | won ${R(w.length / a.length * 100)}% | win ${R(sum(w) / (w.length || 1))} loss ${R(-sum(l) / (l.length || 1))} | worst ${R(Math.min(...n))} | /yr ${R(sum(n) / YEARS)} | net ${R(sum(n))} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | since23 ${R(sum(a.filter((o) => o.y >= '2023').map((o) => o.net)))}`);
};
console.log('\nYears', YEARS.toFixed(1), 'event months', eventMonths.size);
for (const high of [false, true]) {
  for (const [name, make] of [
    ['Paper rule (0.16 delta + 15% put)', (r: Q[], s: number, T: number) => rule(r, s, T)],
    ...[0, 2, 3.5, 5].flatMap((a) => [
      [`Sold ${a}% out, 2x, no final`, (r: Q[], sp: number) => build(r, sp, 2, null, a)],
      [`Sold ${a}% out, 2x, final 4%`, (r: Q[], sp: number) => build(r, sp, 2, 4, a)],
      [`Sold ${a}% out, 3x, no final`, (r: Q[], sp: number) => build(r, sp, 3, null, a)],
      [`Sold ${a}% out, 3x, final 4%`, (r: Q[], sp: number) => build(r, sp, 3, 4, a)],
    ] as const),
  ] as const) {
    const { out, skip } = await run(make, high);
    line(`${name}${high ? ', high IV' : ''}, all months`, out, skip);
    line(`${name}${high ? ', high IV' : ''}, no Budget/election`, out.filter((o) => !o.event), skip);
  }
}
await prisma.$disconnect(); process.exit(0);
