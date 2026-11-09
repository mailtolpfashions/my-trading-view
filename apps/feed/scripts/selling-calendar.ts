// Put calendars across month pairs (the user's idea, 2026-11-09: sell the 2nd month, buy the 3rd, not only current/next).
// Rules fixed before running:
//   pairs   sell month a, buy month b, both puts on the same strike: (1,2), (1,3), (2,3); month 1 = the first monthly expiry
//           after entry, so a "1" leg has about 4–5 weeks left at entry.
//   strike  ATM, 2% below, 4% below the index (nearest strike where both legs traded that day).
//   exit    "expiry": at the sold leg's expiry (sold leg settles at intrinsic value, the bought leg is sold at that close);
//           "21": at the first close with 21 days or fewer left on the sold leg.
// Entry at the close of the first trading day after a monthly expiry, one position at a time. Each trade is tagged with
// that day's IV level (above the prior-250-day median, and its rank) so the screen can filter high- or low-IV months.
// Untraded days are priced with boundedMark. NIFTY, money at today's index level and lot size, after charges and ₹1 slippage.
// Writes .data/research/selling-calendar.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-calendar.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, ivAboveMedian, ivRank, positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';
import { ivHistory } from '../src/selling/books';

const U = 'NIFTY', SLIP = 100, R = Math.round, DAY = 86400_000;
const PAIRS = [[1, 2], [1, 3], [2, 3]] as const, OFFSETS = [0, 0.02, 0.04], EXITS = ['expiry', '21'] as const;
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; expiry: string };
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
const cal = await expiryCalendar(U, new Set(dates), D);
const monthly = cal.monthly, lastOf = new Map(monthly.map((e) => [e.slice(0, 7), e]));
// Expiries still running today, so a trade's bought leg can be on a contract that has not expired yet.
const listed = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'PE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry);
const ahead = new Map<string, string>(); for (const e of listed) if (e > D) ahead.set(e.slice(0, 7), e);
const series = [...monthly, ...[...ahead.values()].filter((e) => !lastOf.has(e.slice(0, 7)))].sort();
const history = await ivHistory(U);

const cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const key = d + e; let v = cache.get(key);
  if (!v) {
    const rows = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: 'PE', expiry: { in: cal.labels(e) } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Q[];
    const by = new Map<number, Q>();
    for (const x of rows) { const o = by.get(x.strikePaise); if (!o || (x.traded && !o.traded) || (x.expiry === e && o.expiry !== e && x.traded === o.traded)) by.set(x.strikePaise, x); }
    v = [...by.values()];
    const l = v.filter((x) => x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise);
    staleFlags(l.map((x) => x.closePaise), true).forEach((s, i) => { if (s) l[i].traded = false; });
    cache.set(key, v);
  }
  return v;
}
const traded = (rows: Q[], K: number) => rows.find((x) => x.strikePaise === K && x.traded && x.closePaise > 0) ?? null;

type Trade = { entry: string; exit: string; sold: string; bought: string; strike: number; spotIn: number; spotOut: number; move: number; hi: boolean | null; rank: number | null; debit: number; net: number; worstMtm: number; worstOn: string };
async function run(a: number, b: number, off: number, exit: (typeof EXITS)[number]) {
  const trades: Trade[] = [], skipped: Record<string, number> = {};
  const skip = (w: string) => { skipped[w] = (skipped[w] ?? 0) + 1; };
  let k = 1;
  while (k < monthly.length) {
    const d = dates[idx.get(monthly[k - 1])! + 1], es = series[series.indexOf(monthly[k - 1]) + a], eb = series[series.indexOf(monthly[k - 1]) + b];
    if (!d || !es || !eb) { skip('No entry day or contract'); k++; continue; }
    if (es > D) break; // the sold leg has not expired yet: the trade is still open
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip('No index close'); k++; continue; }
    const spot = m.spotPaise, ns = await load(d, es), nb = await load(d, eb), target = spot * (1 - off);
    // Nearest strike within 1% of the target where both legs traded.
    const K = ns.filter((x) => x.traded && x.closePaise > 0 && traded(nb, x.strikePaise) && Math.abs(x.strikePaise - target) <= spot * 0.01).sort((p, q) => Math.abs(p.strikePaise - target) - Math.abs(q.strikePaise - target))[0]?.strikePaise;
    if (K == null) { skip('No strike where both months traded'); k++; continue; }
    const xDate = exit === 'expiry' ? es : dates.find((t) => t > d && (Date.parse(es) - Date.parse(t)) / DAY <= 21) ?? es;
    if (!idx.has(xDate)) { skip('No exit day'); k++; continue; }
    const lot = m.lotSize, scale = todayN / (spot * lot), money = (p: number) => (p * scale) / 100;
    const sPx = traded(ns, K)!.closePaise, bPx = traded(nb, K)!.closePaise, sFill = Math.max(5, sPx - SLIP), bFill = bPx + SLIP;
    let cash = lot * (sFill - bFill), charges = computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: sFill, date: d }).total + computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: bFill, date: d }).total;
    let ls = sPx, lb = bPx, worst = 0, worstOn = d;
    for (let j = idx.get(d)! + 1; j < idx.get(xDate)!; j++) {
      const t = dates[j], sp = M.get(t)?.spotPaise; if (!sp) continue;
      ls = boundedMark(await load(t, es), 'PE', K, sp) ?? ls; lb = boundedMark(await load(t, eb), 'PE', K, sp) ?? lb;
      const v = money(cash - charges - lot * ls + lot * lb); if (v < worst) { worst = v; worstOn = t; }
    }
    const out = M.get(xDate)!.spotPaise!;
    if (exit === 'expiry') {
      const iv = Math.max(0, K - out); cash -= lot * iv; charges += expirySettlementCharges({ side: 'SELL', qty: lot, intrinsicPaise: iv, date: xDate });
    } else {
      const p = (boundedMark(await load(xDate, es), 'PE', K, out) ?? ls) + SLIP; cash -= lot * p; charges += computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: p, date: xDate }).total;
    }
    const pb = Math.max(5, (boundedMark(await load(xDate, eb), 'PE', K, out) ?? lb) - SLIP); cash += lot * pb; charges += computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: pb, date: xDate }).total;
    const net = money(cash - charges);
    trades.push({ entry: d, exit: xDate, sold: es, bought: eb, strike: K / 100, spotIn: spot / 100, spotOut: out / 100, move: Math.round((out / spot - 1) * 1000) / 10, hi: ivAboveMedian(history, d), rank: ivRank(history, d), debit: R(money(lot * (bFill - sFill))), net: R(net), worstMtm: R(Math.min(worst, net)), worstOn });
    // Next entry: the first trading day after the next monthly expiry on or after this exit.
    k = monthly.findIndex((e) => e >= xDate) + 1; if (k <= 0) break;
  }
  return { trades, skipped };
}

const stat = (xs: number[], years: number) => {
  const w = xs.filter((x) => x > 0), s = xs.reduce((p, q) => p + q, 0);
  return { n: xs.length, won: xs.length ? R((w.length / xs.length) * 100) : 0, total: R(s), perYear: R(s / years), worst: xs.length ? Math.min(...xs) : 0 };
};
const tests = [];
for (const [a, b] of PAIRS) for (const off of OFFSETS) for (const exit of EXITS) {
  const { trades, skipped } = await run(a, b, off, exit);
  if (!trades.length) { console.log(a, b, off, exit, 'no trades', JSON.stringify(skipped)); continue; }
  const years = (Date.parse(trades.at(-1)!.exit) - Date.parse(trades[0].entry)) / (365.25 * DAY);
  const t = { a, b, off: R(off * 100), exit, years: Math.round(years * 10) / 10, skipped, trades };
  tests.push(t);
  const line = (f: (x: Trade) => boolean) => { const s = stat(trades.filter(f).map((x) => x.net), years); return `n ${s.n} won ${s.won}% total ${s.total} /yr ${s.perYear} worst ${s.worst}`; };
  console.log(`sell ${a} buy ${b} | ${R(off * 100)}% below | exit ${exit.padEnd(6)} | all ${line(() => true)} | low IV ${line((x) => x.hi === false)} | high IV ${line((x) => x.hi === true)} | worstMTM ${Math.min(...trades.map((x) => x.worstMtm))} | since23 ${stat(trades.filter((x) => x.entry >= '2023').map((x) => x.net), 1).total} | skip ${JSON.stringify(skipped)}`);
}
// Today's margin for each pair and strike, from NSE's SPAN file on the latest day.
const margins: Record<string, number | null> = {};
try {
  const span = (await spanOn(D, U))?.data?.[U], next = [...ahead.values()].sort();
  for (const [a, b] of PAIRS) for (const off of OFFSETS) {
    const es = next[a - 1], eb = next[b - 1]; if (!span || !es || !eb) continue;
    const ns = await load(D, es), nb = await load(D, eb), spot = today.spotPaise!, target = spot * (1 - off);
    const K = ns.filter((x) => x.traded && traded(nb, x.strikePaise)).sort((p, q) => Math.abs(p.strikePaise - target) - Math.abs(q.strikePaise - target))[0]?.strikePaise;
    if (K == null) { margins[`${a}${b}-${R(off * 100)}`] = null; continue; }
    const v = positionMargin(span, [{ kind: 'PE', expiry: es, strike: K / 100, qty: -today.lotSize!, pricePaise: traded(ns, K)!.closePaise }, { kind: 'PE', expiry: eb, strike: K / 100, qty: today.lotSize!, pricePaise: traded(nb, K)!.closePaise }] as never, spot, D);
    margins[`${a}${b}-${R(off * 100)}`] = v.missing.length ? null : R(v.marginPaise / 100);
  }
  console.log('margins', JSON.stringify(margins));
} catch (err) { console.log('margin skipped', String(err)); }
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-calendar.json'), JSON.stringify({ ranAt: new Date().toISOString(), lot: today.lotSize, spot: today.spotPaise! / 100, margins, tests }));
console.log('written');
await prisma.$disconnect();
