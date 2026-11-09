// The user's second proposal (a paid-course write-up, "195% in 12 weeks"): every Monday buy 2 lots of the monthly NIFTY
// future and 2 lots of the ATM weekly put; version B also buys 2 lots of a put ~100 points in the money (100 of 20,550,
// scaled to the index). Future + put = call, so A is two bought ATM calls and B is close to a bought straddle.
// Loss limit ₹5,000. The write-up's profit exit is vague ("exit if profits fade"), so four exits were fixed before running:
//   hold   – hold to the weekly expiry, stop at −₹5,000
//   pm5k   – stop at −₹5,000, take profit at +₹5,000
//   trail  – stop at −₹5,000; once the profit reaches ₹5,000, exit when it falls below half its best close
//   day2   – exit at the second close after entry (the write-up quotes "second day profit"), stop at −₹5,000
// Entry is the close of the first trading day of each week (the write-up says 9:30 AM, which daily data cannot show), on the
// first weekly expiry after that day. Checks are at daily closes. Money is at today's index level and lot size, after charges
// and ₹1 slippage per leg. Writes .data/research/selling-weekly-buy.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-weekly-buy.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeFuturesCharges, computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';

const U = 'NIFTY', SLIP = 100, R = Math.round, LOTS = 2, LIMIT = 5000, ITM = 100 / 20550;
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'PE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10).sort();
const cal = await expiryCalendar(U, new Set(dates), D);
const real = cal.expired; // every expiry that has passed, weekly ones too, on its real date
const futExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'FUT' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).sort();
// Weekly expiries exist from early 2019; before that the gap between expiries is about a month.
const weeklyFrom = real.find((e, i) => i > 0 && (Date.parse(e) - Date.parse(real[i - 1])) / 86400_000 <= 8)!;

const cache = new Map<string, Map<number, Q>>();
async function load(d: string, e: string) {
  const key = d + e; let v: Map<number, Q> | undefined = cache.get(key);
  if (!v) {
    const all = await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: 'PE', expiry: { in: cal.labels(e) } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } });
    const seen = new Map<number, (typeof all)[number]>();
    for (const x of all) { const o = seen.get(x.strikePaise); if (!o || (x.expiry === e && o.expiry !== e)) seen.set(x.strikePaise, x); }
    const rows = [...seen.values()] as Q[], l = rows.filter((x) => x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise);
    staleFlags(l.map((x) => x.closePaise), true).forEach((s, i) => { if (s) l[i].traded = false; });
    v = new Map(rows.map((x) => [x.strikePaise, x]));
    cache.set(key, v);
  }
  return v;
}
const futOn = async (d: string, e: string) => (await prisma.fnoEod.findFirst({ where: { underlying: U, date: d, kind: 'FUT', expiry: e }, select: { closePaise: true } }))?.closePaise ?? null;
const mark = (q: Q | undefined) => (q ? (q.traded && q.closePaise > 0 ? q.closePaise : q.settlePaise) : null);
function near(day: Map<number, Q>, target: number, spot: number) {
  let best: Q | null = null;
  for (const x of day.values()) if (x.traded && x.closePaise > 0 && (!best || Math.abs(x.strikePaise - target) < Math.abs(best.strikePaise - target))) best = x;
  return best && Math.abs(best.strikePaise - target) <= spot * 0.004 ? best : null;
}
const weekOf = (d: string) => { const t = new Date(d + 'T00:00:00Z'), day = (t.getUTCDay() + 6) % 7; return new Date(t.getTime() - day * 86400_000).toISOString().slice(0, 10); };
const entries = dates.filter((d, i) => d >= weeklyFrom && (i === 0 || weekOf(dates[i - 1]) !== weekOf(d)));

type Leg = { k: 'FUT' | 'PE'; K: number; px: number; fill: number };
type Wk = { entry: string; expiry: string; fut: string; scale: number; lot: number; spotIn: number; spotOut: number; legs: Leg[]; days: { date: string; marks: number[] }[]; settle: number[] };
async function build(withItm: boolean) {
  const weeks: Wk[] = [], skipped: { entry: string; why: string }[] = [];
  for (const d of entries) {
    const e = real.find((x) => x > d), m = M.get(d)!;
    if (!e || (Date.parse(e) - Date.parse(d)) / 86400_000 > 8) { skipped.push({ entry: d, why: 'No weekly expiry within 8 days' }); continue; }
    const fe = futExp.find((x) => x >= e);
    if (!m.spotPaise || !m.lotSize || !fe || !M.get(e)?.spotPaise) { skipped.push({ entry: d, why: 'No index close or future' }); continue; }
    const day = await load(d, e), spot = m.spotPaise, atm = near(day, spot, spot), fp = await futOn(d, fe);
    const itm = withItm && atm ? near(day, atm.strikePaise + spot * ITM, spot) : null;
    if (!atm || !fp || (withItm && (!itm || itm.strikePaise <= atm.strikePaise))) { skipped.push({ entry: d, why: 'A needed contract had no trade' }); continue; }
    const legs: Leg[] = [{ k: 'FUT', K: 0, px: fp, fill: fp + SLIP }, { k: 'PE', K: atm.strikePaise, px: atm.closePaise, fill: atm.closePaise + SLIP }];
    if (itm) legs.push({ k: 'PE', K: itm.strikePaise, px: itm.closePaise, fill: itm.closePaise + SLIP });
    const last = legs.map((l) => l.px), days: Wk['days'] = [];
    for (let j = idx.get(d)! + 1; j <= idx.get(e)!; j++) {
      const t = dates[j], td = await load(t, e), f = await futOn(t, fe);
      const sp = M.get(t)?.spotPaise ?? 0;
      legs.forEach((l, i) => { const v = l.k === 'FUT' ? f : boundedMark(td.values(), 'PE', l.K, sp); if (v != null && v > 0) last[i] = v; });
      days.push({ date: t, marks: [...last] });
    }
    const out = M.get(e)!.spotPaise!;
    // At the weekly expiry the puts settle at intrinsic value; the monthly future is sold at that day's close.
    const settle = legs.map((l, i) => (l.k === 'FUT' ? days.at(-1)?.marks[i] ?? l.px : Math.max(0, l.K - out)));
    weeks.push({ entry: d, expiry: e, fut: fe, scale: todayN / (spot * m.lotSize), lot: m.lotSize, spotIn: spot / 100, spotOut: out / 100, legs, days, settle });
  }
  return { weeks, skipped };
}

function play(w: Wk, rule: 'hold' | 'pm5k' | 'trail' | 'day2') {
  const qty = LOTS * w.lot, money = (p: number) => (p * w.scale) / 100;
  const chg = (l: Leg, side: 'BUY' | 'SELL', p: number, date: string) => (l.k === 'FUT' ? computeFuturesCharges({ side, qty, pricePaise: p, date }) : computeOptionCharges({ side, qty, premiumPaise: p, date })).total;
  let charges = w.legs.reduce((t, l) => t + chg(l, 'BUY', l.fill, w.entry), 0);
  const mtm = (marks: number[]) => money(w.legs.reduce((t, l, i) => t + qty * (marks[i] - l.fill), 0));
  let best = 0, exitAt = -1;
  for (let j = 0; j < w.days.length - 1; j++) { // the last day is the expiry, settled below
    const v = mtm(w.days[j].marks); best = Math.max(best, v);
    if (v <= -LIMIT) { exitAt = j; break; }
    if (rule === 'pm5k' && v >= LIMIT) { exitAt = j; break; }
    if (rule === 'trail' && best >= LIMIT && v < best / 2) { exitAt = j; break; }
    if (rule === 'day2' && j === 1) { exitAt = j; break; }
  }
  let gross = 0;
  if (exitAt >= 0) {
    const x = w.days[exitAt];
    w.legs.forEach((l, i) => { const p = Math.max(5, x.marks[i] - SLIP); gross += qty * (p - l.fill); charges += chg(l, 'SELL', p, x.date); });
  } else {
    w.legs.forEach((l, i) => {
      if (l.k === 'FUT') { const p = w.settle[i] - SLIP; gross += qty * (p - l.fill); charges += chg(l, 'SELL', p, w.expiry); }
      else { gross += qty * (w.settle[i] - l.fill); charges += expirySettlementCharges({ side: 'BUY', qty, intrinsicPaise: w.settle[i], date: w.expiry }); }
    });
  }
  // Time value paid for the puts at entry, in today's rupees: the cost this position must earn back from the move.
  const tv = money(w.legs.reduce((t, l) => t + (l.k === 'PE' ? qty * Math.max(0, l.px - Math.max(0, l.K - w.spotIn * 100)) : 0), 0));
  return { net: R(money(gross - charges)), exit: exitAt >= 0 ? w.days[exitAt].date : w.expiry, timeValue: R(tv) };
}

const stat = (xs: number[], years: number) => {
  const w = xs.filter((x) => x > 0), l = xs.filter((x) => x <= 0), s = xs.reduce((a, b) => a + b, 0);
  return { n: xs.length, won: xs.length ? R((w.length / xs.length) * 100) : 0, total: R(s), perYear: R(s / years), avgWin: w.length ? R(w.reduce((a, b) => a + b, 0) / w.length) : 0, avgLoss: l.length ? R(l.reduce((a, b) => a + b, 0) / l.length) : 0, worst: xs.length ? Math.min(...xs) : 0 };
};
const tests = [];
for (const withItm of [false, true]) {
  const { weeks, skipped } = await build(withItm);
  const years = (Date.parse(weeks.at(-1)!.expiry) - Date.parse(weeks[0].entry)) / (365.25 * 86400_000);
  for (const rule of ['hold', 'pm5k', 'trail', 'day2'] as const) {
    const rows = weeks.map((w) => ({ entry: w.entry, expiry: w.expiry, spotIn: w.spotIn, spotOut: w.spotOut, ...play(w, rule), legs: w.legs.map((l) => `Buy ${LOTS}× ${l.k === 'FUT' ? `FUT ${w.fut}` : `${l.K / 100} PE`} @${(l.px / 100).toFixed(2)}`) }));
    const byYear: Record<string, { n: number; net: number }> = {};
    for (const r of rows) { const y = (byYear[r.entry.slice(0, 4)] ??= { n: 0, net: 0 }); y.n++; y.net += r.net; }
    // Every run of 12 weeks in a row, as the write-up's "195% in 12 weeks" claim is about one such run.
    const runs = rows.slice(11).map((_, i) => rows.slice(i, i + 12).reduce((a, r) => a + r.net, 0)).sort((a, b) => a - b);
    const q = (p: number) => R(runs[Math.min(runs.length - 1, Math.floor(runs.length * p))]);
    const t = { version: withItm ? 'B: future + ATM put + ITM put' : 'A: future + ATM put', rule, years: Math.round(years * 10) / 10, skipped: skipped.length, all: stat(rows.map((r) => r.net), years), since2023: stat(rows.filter((r) => r.entry >= '2023-01-01').map((r) => r.net), (Date.parse(D) - Date.parse('2023-01-01')) / (365.25 * 86400_000)),
      losingYears: Object.values(byYear).filter((y) => y.net < 0).length, yearCount: Object.keys(byYear).length, avgTimeValue: R(rows.reduce((a, r) => a + r.timeValue, 0) / rows.length),
      twelveWeeks: { runs: runs.length, worst: q(0), p25: q(0.25), median: q(0.5), p75: q(0.75), best: q(1), at195: runs.filter((x) => x >= 175500).length }, byYear, rows };
    tests.push(t);
    const s = t.all;
    console.log(`${t.version} | ${rule} | n ${s.n} won ${s.won}% total ${s.total} /yr ${s.perYear} avgWin ${s.avgWin} avgLoss ${s.avgLoss} worst ${s.worst} | losing yrs ${t.losingYears}/${t.yearCount} | since23 ${t.since2023.total} | avg time value paid ${t.avgTimeValue} | 12wk median ${t.twelveWeeks.median} best ${t.twelveWeeks.best} worst ${t.twelveWeeks.worst} >=195% ${t.twelveWeeks.at195}/${t.twelveWeeks.runs} | skip ${t.skipped}`);
    console.log('   years', Object.entries(byYear).map(([y, v]) => `${y}:${R(v.net)}`).join(' '));
  }
}
// Today's margin for 2 lots, from NSE's SPAN file on the latest day.
const margins: Record<string, number | null> = {};
try {
  const span = (await spanOn(D, U))?.data?.[U], e = real.find((x) => x > D) ?? allExp.find((x) => x > D)!, fe = futExp.find((x) => x >= e)!;
  const day = await load(D, e), spot = today.spotPaise!, atm = near(day, spot, spot), itm = atm && near(day, atm.strikePaise + spot * ITM, spot), fp = await futOn(D, fe);
  for (const [name, puts] of [['A', [atm]], ['B', [atm, itm]]] as const) {
    if (!span || !fp || puts.some((p) => !p)) { margins[name] = null; continue; }
    const legs = [{ kind: 'FUT', expiry: fe, strike: 0, qty: LOTS * today.lotSize!, pricePaise: fp }, ...puts.map((p) => ({ kind: 'PE', expiry: e, strike: p!.strikePaise / 100, qty: LOTS * today.lotSize!, pricePaise: p!.closePaise }))];
    const v = positionMargin(span, legs as never, spot, D);
    margins[name] = v.missing.length ? null : R(v.fundsPaise / 100); // margin plus the premium paid
  }
} catch (err) { console.log('margin skipped', String(err)); }
console.log('funds needed today for 2 lots (margin + premium):', JSON.stringify(margins), 'weekly from', weeklyFrom);
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-weekly-buy.json'), JSON.stringify({ ranAt: new Date().toISOString(), lots: LOTS, limit: LIMIT, slipPaise: SLIP, weeklyFrom, margins, tests }));
console.log('written');
await prisma.$disconnect();
