// The user's "volatile + range-bound" proposal (from a video write-up), tested as written on 15 years of NSE closes.
//  Part 1 "volatile": buy the future, buy a put ~1,000 points in the money, buy a put ~1,000 points out of the money.
//          Exit the whole part at +₹5,000 or −₹5,000 (checked at each day's close), else at expiry.
//  Part 2 "range-bound": sell ~500 points OTM call and put, buy ~1,000 points OTM call and put. Hold to expiry,
//          or (second version) book once the profit reaches half the credit.
// Distances are the article's points as a share of the index (500 and 1,000 of 49,200), so they mean the same in 2011 and
// today. "Wider" versions stretch them by √months for the longer frames. Entry is the close of the first trading day after
// a monthly expiry (the article enters at 9:30 AM, which daily data cannot show). Frames: 1, 2, 3 and 6 months, one
// position at a time. Futures are listed only 3 months ahead, so where none is listed Part 1 uses the call at the
// in-the-money put's strike, which has the same payoff (future + put = call); such trades are flagged.
// Money is at today's index level and lot size, after charges and ₹1 slippage per leg. Stale closes are set aside.
// Writes .data/research/selling-combo.json. Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-combo.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeFuturesCharges, computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';

const SLIP = 100, R = Math.round, D1 = 500 / 49200, D2 = 1000 / 49200, TARGET = 5000, FRAMES = [1, 2, 3, 6];
type Kind = 'FUT' | 'CE' | 'PE';
type Leg = { part: 1 | 2; k: Kind; K: number; q: number; px: number; fill: number };
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
type Cycle = { entry: string; expiry: string; spotIn: number; spotOut: number; scale: number; lot: number; synthetic: boolean; legs: Leg[]; days: { date: string; marks: number[] }[]; settle: number[] };

const result: Record<string, unknown> = {};
for (const U of ['BANKNIFTY', 'NIFTY']) {
  const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
  const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
  const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
  // Some monthly contracts are stored under two expiry dates: the date first listed and the date NSE later moved it to
  // (e.g. Bank Nifty Dec 2024 as 26 Dec and 24 Dec). The real one is the latest date in the month on which that expiry
  // still traded on its own day; rows under a label within 3 days of it are the same contract.
  const cal = await expiryCalendar(U, new Set(dates), D);
  const monthly = cal.monthly, relabelled = monthly.filter((e) => cal.labels(e).length > 1).length;
  const cache = new Map<string, Map<string, Q>>();
  async function load(d: string, e: string) {
    const key = d + e; let v = cache.get(key);
    if (!v) {
      const all = await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: { in: cal.labels(e) } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } });
      const seen = new Map<string, (typeof all)[number]>();
      for (const x of all) { const k2 = `${x.kind}${x.strikePaise}`, o = seen.get(k2); if (!o || (x.expiry === e && o.expiry !== e)) seen.set(k2, x); }
      const rows = [...seen.values()] as Q[];
      for (const kind of ['CE', 'PE']) { const l = rows.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
      v = new Map(rows.map((x) => [`${x.kind}${x.strikePaise}`, x]));
      cache.set(key, v);
    }
    return v;
  }
  const mark = (q: Q | undefined) => (q ? (q.traded && q.closePaise > 0 ? q.closePaise : q.settlePaise) : null);
  function near(day: Map<string, Q>, kind: 'CE' | 'PE', target: number, spot: number) {
    let best: Q | null = null;
    for (const x of day.values()) if (x.kind === kind && x.traded && x.closePaise > 0 && (!best || Math.abs(x.strikePaise - target) < Math.abs(best.strikePaise - target))) best = x;
    return best && Math.abs(best.strikePaise - target) <= spot * 0.005 ? best : null;
  }

  async function build(N: number, wide: boolean) {
    const s = wide ? Math.sqrt(N) : 1, cycles: Cycle[] = [], skipped: { target: string; why: string }[] = [];
    for (let k = N; k < monthly.length;) {
      const e = monthly[k], d = dates[idx.get(monthly[k - N])! + 1];
      const fail = (why: string) => { skipped.push({ target: e, why }); k += 1; };
      if (!d || d >= e) { fail('No trading day'); continue; }
      const m = M.get(d)!, out = M.get(e)!;
      if (!m.spotPaise || !m.lotSize || !out.spotPaise) { fail('No index close'); continue; }
      const day = await load(d, e), spot = m.spotPaise;
      const atm = near(day, 'CE', spot, spot)?.strikePaise ?? null;
      if (atm == null) { fail('No traded options for this expiry on the entry day'); continue; }
      const pick = (kind: 'CE' | 'PE', K: number) => near(day, kind, K, spot);
      const itmPut = pick('PE', atm + spot * D2 * s), otmPut = pick('PE', atm - spot * D2 * s);
      const sc = pick('CE', atm + spot * D1 * s), sp = pick('PE', atm - spot * D1 * s), lc = pick('CE', atm + spot * D2 * s), lp = pick('PE', atm - spot * D2 * s);
      if (!itmPut || !otmPut || !sc || !sp || !lc || !lp) { fail('A needed strike had no trade'); continue; }
      if (!(sc.strikePaise < lc.strikePaise && sp.strikePaise > lp.strikePaise)) { fail('Wings not beyond the sold strikes'); continue; }
      const fut = day.get('FUT0');
      let synthetic = false, p1: Omit<Leg, 'fill'>[];
      if (fut && fut.closePaise > 0) p1 = [{ part: 1, k: 'FUT', K: 0, q: 1, px: fut.closePaise }, { part: 1, k: 'PE', K: itmPut.strikePaise, q: 1, px: itmPut.closePaise }];
      else {
        const call = day.get(`CE${itmPut.strikePaise}`);
        if (!call || !call.traded || !(call.closePaise > 0)) { fail('No future and no traded call at the in-the-money strike'); continue; }
        synthetic = true; p1 = [{ part: 1, k: 'CE', K: itmPut.strikePaise, q: 1, px: call.closePaise }];
      }
      p1.push({ part: 1, k: 'PE', K: otmPut.strikePaise, q: 1, px: otmPut.closePaise });
      const p2: Omit<Leg, 'fill'>[] = [
        { part: 2, k: 'CE', K: sc.strikePaise, q: -1, px: sc.closePaise }, { part: 2, k: 'PE', K: sp.strikePaise, q: -1, px: sp.closePaise },
        { part: 2, k: 'CE', K: lc.strikePaise, q: 1, px: lc.closePaise }, { part: 2, k: 'PE', K: lp.strikePaise, q: 1, px: lp.closePaise },
      ];
      const legs = [...p1, ...p2].map((l) => ({ ...l, fill: l.q > 0 ? l.px + SLIP : Math.max(5, l.px - SLIP) }));
      const last = legs.map((l) => l.px), days: Cycle['days'] = [];
      for (let j = idx.get(d)! + 1; j < idx.get(e)!; j++) {
        const t = dates[j], td = await load(t, e);
        const sp = M.get(t)?.spotPaise ?? 0;
        legs.forEach((l, i) => { const v = l.k === 'FUT' ? mark(td.get('FUT0')) : boundedMark(td.values(), l.k, l.K, sp); if (v != null && v > 0) last[i] = v; });
        days.push({ date: t, marks: [...last] });
      }
      const settle = legs.map((l) => (l.k === 'FUT' ? out.spotPaise! : Math.max(0, l.k === 'CE' ? out.spotPaise! - l.K : l.K - out.spotPaise!)));
      cycles.push({ entry: d, expiry: e, spotIn: spot / 100, spotOut: out.spotPaise / 100, scale: todayN / (spot * m.lotSize), lot: m.lotSize, synthetic, legs, days, settle });
      k += N;
    }
    return { cycles, skipped };
  }

  // Net result of one part of a cycle, in today's rupees, with the exit rule applied to the daily closes.
  function play(c: Cycle, part: 1 | 2, rule: 'target' | 'book' | 'hold') {
    const ix = c.legs.map((l, i) => (l.part === part ? i : -1)).filter((i) => i >= 0), lot = c.lot;
    const sideIn = (l: Leg): 'BUY' | 'SELL' => (l.q > 0 ? 'BUY' : 'SELL'), sideOut = (l: Leg): 'BUY' | 'SELL' => (l.q > 0 ? 'SELL' : 'BUY');
    const chg = (l: Leg, side: 'BUY' | 'SELL', p: number, date: string) => (l.k === 'FUT' ? computeFuturesCharges({ side, qty: lot, pricePaise: p, date }) : computeOptionCharges({ side, qty: Math.abs(l.q) * lot, premiumPaise: p, date })).total;
    let charges = ix.reduce((t, i) => t + chg(c.legs[i], sideIn(c.legs[i]), c.legs[i].fill, c.entry), 0);
    const credit = ix.reduce((t, i) => t - c.legs[i].q * lot * c.legs[i].fill, 0) * c.scale / 100;
    const mtm = (marks: number[]) => ix.reduce((t, i) => t + c.legs[i].q * lot * (marks[i] - c.legs[i].fill), 0) * c.scale / 100;
    let worst = 0, exit: { date: string; marks: number[] } | null = null;
    for (const day of c.days) {
      const v = mtm(day.marks); worst = Math.min(worst, v);
      if (rule === 'target' && Math.abs(v) >= TARGET) { exit = day; break; }
      if (rule === 'book' && credit > 0 && v >= credit * 0.5) { exit = day; break; }
    }
    let gross = 0;
    for (const i of ix) {
      const l = c.legs[i];
      if (exit) { const p = l.q > 0 ? Math.max(5, exit.marks[i] - SLIP) : exit.marks[i] + SLIP; gross += l.q * lot * (p - l.fill); charges += chg(l, sideOut(l), p, exit.date); }
      else { gross += l.q * lot * (c.settle[i] - l.fill); if (l.k !== 'FUT') charges += expirySettlementCharges({ side: sideIn(l), qty: Math.abs(l.q) * lot, intrinsicPaise: c.settle[i], date: c.expiry }); }
    }
    return { net: R(((gross - charges) * c.scale) / 100), exit: exit?.date ?? c.expiry, early: !!exit, worst: R(Math.min(worst, ((gross - charges) * c.scale) / 100)), credit: R(credit) };
  }

  const stat = (xs: number[], years: number) => {
    const w = xs.filter((x) => x > 0), l = xs.filter((x) => x <= 0), sum = xs.reduce((a, b) => a + b, 0);
    return { n: xs.length, won: xs.length ? R((w.length / xs.length) * 100) : 0, total: R(sum), perYear: R(sum / years), avgWin: w.length ? R(w.reduce((a, b) => a + b, 0) / w.length) : 0, avgLoss: l.length ? R(l.reduce((a, b) => a + b, 0) / l.length) : 0, worst: xs.length ? Math.min(...xs) : 0, best: xs.length ? Math.max(...xs) : 0 };
  };
  const tests = [];
  for (const N of FRAMES) for (const wide of N > 1 ? [false, true] : [false]) {
    const { cycles, skipped } = await build(N, wide);
    if (!cycles.length) { const why: Record<string, number> = {}; for (const s of skipped) why[s.why] = (why[s.why] ?? 0) + 1; console.log(U, `${N}m`, wide ? 'wide' : '', 'no trades', JSON.stringify(why)); continue; }
    const years = (Date.parse(cycles.at(-1)!.expiry) - Date.parse(cycles[0].entry)) / (365.25 * 86400_000);
    for (const r1 of ['target', 'hold'] as const) for (const r2 of ['hold', 'book'] as const) {
      const rows = cycles.map((c) => {
        const a = play(c, 1, r1), b = play(c, 2, r2);
        return { entry: c.entry, expiry: c.expiry, spotIn: c.spotIn, spotOut: c.spotOut, move: Math.round((c.spotOut / c.spotIn - 1) * 1000) / 10, synthetic: c.synthetic, p1: a, p2: b, net: a.net + b.net,
          legs: c.legs.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${l.k === 'FUT' ? 'FUT' : `${l.K / 100} ${l.k}`} @${(l.px / 100).toFixed(2)}`) };
      });
      const byYear: Record<string, { p1: number; p2: number; net: number; n: number }> = {};
      for (const r of rows) { const y = (byYear[r.expiry.slice(0, 4)] ??= { p1: 0, p2: 0, net: 0, n: 0 }); y.p1 += r.p1.net; y.p2 += r.p2.net; y.net += r.net; y.n++; }
      const t = {
        index: U, months: N, wide, part1: r1, part2: r2, years: Math.round(years * 10) / 10, skipped: skipped.length, synthetic: rows.filter((r) => r.synthetic).length,
        p1: stat(rows.map((r) => r.p1.net), years), p2: stat(rows.map((r) => r.p2.net), years), both: stat(rows.map((r) => r.net), years),
        doubleWin: rows.filter((r) => r.p1.net > 0 && r.p2.net > 0).length, doubleLoss: rows.filter((r) => r.p1.net <= 0 && r.p2.net <= 0).length,
        losingYears: Object.values(byYear).filter((y) => y.net < 0).length, yearCount: Object.keys(byYear).length,
        since2023: stat(rows.filter((r) => r.entry >= '2023-01-01').map((r) => r.net), (Date.parse(D) - Date.parse('2023-01-01')) / (365.25 * 86400_000)),
        byYear, rows, skips: skipped,
      };
      tests.push(t);
      const f = (s: ReturnType<typeof stat>) => `n ${s.n} won ${s.won}% total ${s.total} /yr ${s.perYear} worst ${s.worst}`;
      console.log(`${U} ${N}m${wide ? ' wide' : ''} P1 ${r1} P2 ${r2} | P1 ${f(t.p1)} | P2 ${f(t.p2)} | BOTH ${f(t.both)} | 2win ${t.doubleWin} 2loss ${t.doubleLoss} | losing yrs ${t.losingYears}/${t.yearCount} | since23 ${t.since2023.total} | skip ${t.skipped} syn ${t.synthetic}`);
    }
  }
  // Today's margin for the as-written version, from NSE's SPAN file on the latest day.
  const margins: Record<string, number | null> = {};
  try {
    const span = (await spanOn(D, U))?.data?.[U];
    const ahead = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry);
    const lastIn = new Map<string, string>(); for (const e of ahead) lastIn.set(e.slice(0, 7), e);
    const months = [...lastIn.values()];
    for (const N of [1, 2, 3]) {
      const e = months[N - 1], day = await load(D, e), spot = today.spotPaise!, atm = near(day, 'CE', spot, spot)?.strikePaise;
      if (!span || !e || atm == null) { margins[`${N}`] = null; continue; }
      const k = (kind: 'CE' | 'PE', K: number) => near(day, kind, K, spot)?.strikePaise;
      const legs = [
        { kind: 'FUT', strike: 0, qty: 1, p: day.get('FUT0')?.closePaise }, { kind: 'PE', strike: k('PE', atm + spot * D2), qty: 1 }, { kind: 'PE', strike: k('PE', atm - spot * D2), qty: 1 },
        { kind: 'CE', strike: k('CE', atm + spot * D1), qty: -1 }, { kind: 'PE', strike: k('PE', atm - spot * D1), qty: -1 }, { kind: 'CE', strike: k('CE', atm + spot * D2), qty: 1 }, { kind: 'PE', strike: k('PE', atm - spot * D2), qty: 1 },
      ];
      if (legs.some((l) => l.strike == null)) { margins[`${N}`] = null; continue; }
      const v = positionMargin(span, legs.map((l) => ({ kind: l.kind, expiry: e, strike: l.strike! / 100, qty: l.qty * today.lotSize!, pricePaise: l.kind === 'FUT' ? l.p : day.get(`${l.kind}${l.strike}`)?.closePaise })) as never, today.spotPaise!, D);
      margins[`${N}`] = v.missing.length ? null : R(v.marginPaise / 100);
    }
  } catch (err) { console.log('margin skipped', String(err)); }
  console.log(U, 'margin today (both parts, 1 lot)', JSON.stringify(margins), 'months stored under two expiry dates', relabelled);
  result[U] = { from: dates[0], to: D, lot: today.lotSize, spot: today.spotPaise! / 100, margins, relabelled, tests };
  cache.clear();
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-combo.json'), JSON.stringify({ ranAt: new Date().toISOString(), target: TARGET, slipPaise: SLIP, result }));
console.log('written');
await prisma.$disconnect();
