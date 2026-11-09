// Put calendars pushed further out (the user, 2026-11-09: "sell the 3rd, buy the 4th… up to 12 months"). NSE lists every
// monthly NIFTY contract only three months ahead; after that come quarterlies (Mar/Jun/Sep/Dec) and half-yearlies (Jun/Dec).
// So the test uses the contracts actually listed on the entry day: sell the n-th listed monthly-type contract, buy the next
// one, for every n whose sold contract expires within about 12 months (380 days). Rules fixed before running:
//   strike  ATM or 4% below the index (nearest strike within 1% where both legs traded that day)
//   exit    "expiry": at the sold leg's expiry; "21": at the first close with 21 days or fewer left on the sold leg
// Entry at the close of the first trading day after a monthly expiry, one position at a time. IV-tagged per trade.
// Untraded days are priced with boundedMark. NIFTY, money at today's index level and lot size, after charges and ₹1 slippage.
// Writes .data/research/selling-calendar-far.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-calendar-far.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, ivAboveMedian, ivRank, staleFlags } from '@mtv/options';
import { ivHistory } from '../src/selling/books';
import { expiryCalendar } from '../src/selling/expiries';

const U = 'NIFTY', SLIP = 100, R = Math.round, DAY = 86400_000, MAX_DAYS = 380;
const OFFSETS = [0, 0.04], EXITS = ['expiry', '21'] as const;
type Q = { strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; expiry: string };
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
const cal = await expiryCalendar(U, new Set(dates), D);
const monthly = cal.monthly, monthlySet = new Set(monthly);
// A stored label → the real expiry: itself if it traded on its own day, else the monthly expiry within 7 days (NSE moved it).
const realOf = (l: string): string | null => cal.realOf(l);
const history = await ivHistory(U);

// Monthly-type contracts listed on a day (the last expiry of each calendar month), as real expiry dates, nearest first.
async function listedOn(d: string) {
  const labels = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: 'PE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry);
  const last = new Map<string, string>();
  for (const l of labels) { const r = realOf(l); if (!r || r <= d) continue; if (r <= D && !monthlySet.has(r)) continue; const k = r.slice(0, 7); if (!last.has(k) || last.get(k)! < r) last.set(k, r); }
  return [...last.values()].sort();
}
const cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const key = d + e; let v = cache.get(key);
  if (!v) {
    const rows = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, kind: 'PE', expiry: { in: cal.labels(e) } }, select: { strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Q[];
    const by = new Map<number, Q>();
    for (const x of rows) { const o = by.get(x.strikePaise); if (!o || (x.traded && !o.traded) || (x.expiry === e && o.expiry !== e && x.traded === o.traded)) by.set(x.strikePaise, x); }
    v = [...by.values()];
    const l = v.filter((x) => x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise);
    staleFlags(l.map((x) => x.closePaise), true).forEach((s, i) => { if (s) l[i].traded = false; });
    cache.set(key, v);
  }
  return v;
}
const withKind = (rows: Q[]) => rows.map((x) => ({ ...x, kind: 'PE' }));
const traded = (rows: Q[], K: number) => rows.find((x) => x.strikePaise === K && x.traded && x.closePaise > 0) ?? null;

type Trade = { entry: string; exit: string; sold: string; bought: string; soldDays: number; boughtDays: number; strike: number; spotIn: number; spotOut: number; move: number; hi: boolean | null; rank: number | null; debit: number; net: number; worstMtm: number; worstOn: string };
async function run(n: number, off: number, exit: (typeof EXITS)[number]) {
  const trades: Trade[] = [], skipped: Record<string, number> = {};
  const skip = (w: string) => { skipped[w] = (skipped[w] ?? 0) + 1; };
  let k = 1;
  while (k < monthly.length) {
    const d = dates[idx.get(monthly[k - 1])! + 1]; if (!d) break;
    const list = await listedOn(d), es = list[n - 1], eb = list[n];
    if (!es || !eb) { skip('Contract not listed'); k++; continue; }
    if ((Date.parse(es) - Date.parse(d)) / DAY > MAX_DAYS) { skip('Sold contract more than 12 months away'); k++; continue; }
    if (es > D) break; // the sold leg has not expired yet: still open
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip('No index close'); k++; continue; }
    const spot = m.spotPaise, ns = await load(d, es), nb = await load(d, eb), target = spot * (1 - off);
    const K = ns.filter((x) => x.traded && x.closePaise > 0 && traded(nb, x.strikePaise) && Math.abs(x.strikePaise - target) <= spot * 0.01).sort((p, q) => Math.abs(p.strikePaise - target) - Math.abs(q.strikePaise - target))[0]?.strikePaise;
    if (K == null) { skip('No strike where both contracts traded'); k++; continue; }
    const xDate = exit === 'expiry' ? es : dates.find((t) => t > d && (Date.parse(es) - Date.parse(t)) / DAY <= 21) ?? es;
    if (!idx.has(xDate)) { skip('No exit day'); k++; continue; }
    const lot = m.lotSize, scale = todayN / (spot * lot), money = (p: number) => (p * scale) / 100;
    const sPx = traded(ns, K)!.closePaise, bPx = traded(nb, K)!.closePaise, sFill = Math.max(5, sPx - SLIP), bFill = bPx + SLIP;
    let cash = lot * (sFill - bFill), charges = computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: sFill, date: d }).total + computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: bFill, date: d }).total;
    let ls = sPx, lb = bPx, worst = 0, worstOn = d;
    for (let j = idx.get(d)! + 1; j < idx.get(xDate)!; j++) {
      const t = dates[j], sp = M.get(t)?.spotPaise; if (!sp) continue;
      ls = boundedMark(withKind(await load(t, es)), 'PE', K, sp) ?? ls; lb = boundedMark(withKind(await load(t, eb)), 'PE', K, sp) ?? lb;
      const v = money(cash - charges - lot * ls + lot * lb); if (v < worst) { worst = v; worstOn = t; }
    }
    const out = M.get(xDate)!.spotPaise!;
    if (exit === 'expiry') { const iv = Math.max(0, K - out); cash -= lot * iv; charges += expirySettlementCharges({ side: 'SELL', qty: lot, intrinsicPaise: iv, date: xDate }); }
    else { const p = (boundedMark(withKind(await load(xDate, es)), 'PE', K, out) ?? ls) + SLIP; cash -= lot * p; charges += computeOptionCharges({ side: 'BUY', qty: lot, premiumPaise: p, date: xDate }).total; }
    const pb = Math.max(5, (boundedMark(withKind(await load(xDate, eb)), 'PE', K, out) ?? lb) - SLIP); cash += lot * pb; charges += computeOptionCharges({ side: 'SELL', qty: lot, premiumPaise: pb, date: xDate }).total;
    const net = money(cash - charges);
    trades.push({ entry: d, exit: xDate, sold: es, bought: eb, soldDays: R((Date.parse(es) - Date.parse(d)) / DAY), boughtDays: R((Date.parse(eb) - Date.parse(d)) / DAY), strike: K / 100, spotIn: spot / 100, spotOut: out / 100, move: Math.round((out / spot - 1) * 1000) / 10, hi: ivAboveMedian(history, d), rank: ivRank(history, d), debit: R(money(lot * (bFill - sFill))), net: R(net), worstMtm: R(Math.min(worst, net)), worstOn });
    k = monthly.findIndex((e) => e >= xDate) + 1; if (k <= 0) break;
  }
  return { trades, skipped };
}

const tests = [];
for (let n = 1; n <= 11; n++) for (const off of OFFSETS) for (const exit of EXITS) {
  const { trades, skipped } = await run(n, off, exit);
  if (!trades.length) { console.log(`sell #${n} buy #${n + 1} | ${R(off * 100)}% | ${exit} | no trades ${JSON.stringify(skipped)}`); continue; }
  const years = (Date.parse(trades.at(-1)!.exit) - Date.parse(trades[0].entry)) / (365.25 * DAY), nets = trades.map((t) => t.net), total = nets.reduce((a, b) => a + b, 0);
  const avg = (f: (t: Trade) => number) => R(trades.reduce((a, t) => a + f(t), 0) / trades.length);
  tests.push({ n, off: R(off * 100), exit, years: Math.round(years * 10) / 10, skipped, trades });
  console.log(`sell #${n} (~${avg((t) => t.soldDays)}d) buy #${n + 1} (~${avg((t) => t.boughtDays)}d) | ${R(off * 100)}% | ${exit.padEnd(6)} | n ${trades.length} won ${R((nets.filter((x) => x > 0).length / nets.length) * 100)}% total ${R(total)} /yr ${R(total / years)} worst ${Math.min(...nets)} worstMTM ${Math.min(...trades.map((t) => t.worstMtm))} | first ${trades[0].entry} | skip ${JSON.stringify(skipped)}`);
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-calendar-far.json'), JSON.stringify({ ranAt: new Date().toISOString(), lot: today.lotSize, spot: today.spotPaise! / 100, tests }));
console.log('written');
await prisma.$disconnect();
