// The user's yearly shape (from the platform's strategy builder, NIFTY Dec 2025 as of 1 Jan 2025, spot 23,742.90):
//   buy 1 × 23000 CE, sell 2 × 25000 CE, sell 1 × 21000 PE  →  a 1×2 call ratio spread plus a short put, net credit.
// Tested every year: enter at the close of the last Monday of January on that year's December expiry, strikes at the same
// distance from the index as in the screenshot. Four exits, fixed before running:
//   hold   – hold to the December expiry
//   vix30  – exit at the first close with India VIX at 30 or more (the user's earlier slide rule)
//   stop50 – exit at the first close with a loss of ₹50,000 or more (today's rupees)
//   half   – exit at the first close with half the position's maximum profit
// Far contracts often have no trade on a given day. A leg with no trade within 2.5% of its target (December strikes are 500 to 1,000 points apart) on the entry day is priced
// at NSE's settlement price and the year is flagged; daily marks use the traded close, else the settlement price.
// Some December contracts are stored under the first-listed date and the date NSE moved them to; rows are merged.
// Money is at today's index level and lot size, after charges and ₹1 slippage per leg.
// Writes .data/research/selling-yearly.json. Run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/selling-yearly.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, positionMargin } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { expiryCalendar } from '../src/selling/expiries';

const U = 'NIFTY', SLIP = 100, R = Math.round, S0 = 23742.9;
const SHAPE = [{ k: 'CE' as const, at: 23000 / S0, q: 1 }, { k: 'CE' as const, at: 25000 / S0, q: -2 }, { k: 'PE' as const, at: 21000 / S0, q: -1 }];
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; expiry: string };
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
const vix = new Map((await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true } })).map((r) => [r.date, r.closePaise / 100]));
const cal = await expiryCalendar(U, new Set(dates), D);
const allExp = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => e.length === 10).sort();

function lastMondayOfJan(y: number) {
  for (let d = 31; d >= 25; d--) { const t = new Date(Date.UTC(y, 0, d)); if (t.getUTCDay() === 1) return t.toISOString().slice(0, 10); }
  return `${y}-01-25`;
}
const years = [], margins: Record<string, number | null> = {};
for (let y = 2011; y <= Number(D.slice(0, 4)); y++) {
  const mon = lastMondayOfJan(y), d = dates.find((x) => x >= mon)!;
  const dec = allExp.filter((e) => e.startsWith(`${y}-12-`));
  // The December monthly on its real date (holiday-moved and relabelled contracts handled); still running → its listed labels.
  const realDec = cal.monthly.find((e) => e.startsWith(`${y}-12-`)), open = !realDec;
  const settleOn = open ? null : realDec!;
  const want = open ? dec.filter((e) => e > D) : cal.labels(realDec!);
  const load = async (t: string) => {
    const rows = (await prisma.fnoEod.findMany({ where: { underlying: U, date: t, expiry: { in: want } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Q[];
    const by = new Map<string, Q>();
    for (const x of rows) { const k = `${x.kind}${x.strikePaise}`, o = by.get(k); if (!o || (x.traded && !o.traded) || (x.expiry === realDec && o.expiry !== realDec && x.traded === o.traded)) by.set(k, x); }
    return by;
  };
  const m = M.get(d)!, spot = m.spotPaise!, lot = m.lotSize!, day = await load(d);
  const legs: { k: 'CE' | 'PE'; K: number; q: number; px: number; fill: number; model: boolean }[] = [];
  let why: string | null = null;
  for (const s of SHAPE) {
    const target = spot * s.at, rows = [...day.values()].filter((x) => x.kind === s.k);
    const tradedNear = rows.filter((x) => x.traded && x.closePaise > 0 && Math.abs(x.strikePaise - target) <= spot * 0.025).sort((a, b) => Math.abs(a.strikePaise - target) - Math.abs(b.strikePaise - target))[0];
    const any = rows.filter((x) => x.settlePaise > 0).sort((a, b) => Math.abs(a.strikePaise - target) - Math.abs(b.strikePaise - target))[0];
    const pick = tradedNear ?? (any && Math.abs(any.strikePaise - target) <= spot * 0.025 ? any : null);
    if (!pick) { why = `No ${s.k} near ${R(target / 100)}`; break; }
    const px = tradedNear ? pick.closePaise : boundedMark(rows, s.k, pick.strikePaise, spot) ?? pick.settlePaise;
    legs.push({ k: s.k, K: pick.strikePaise, q: s.q, px, fill: s.q > 0 ? px + SLIP : Math.max(5, px - SLIP), model: !tradedNear });
  }
  if (why) { years.push({ year: y, entry: d, skipped: why }); continue; }
  const scale = todayN / (spot * lot), money = (p: number) => (p * scale) / 100;
  const entryCharges = legs.reduce((t, l) => t + computeOptionCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: Math.abs(l.q) * lot, premiumPaise: l.fill, date: d }).total, 0);
  // Maximum profit at expiry: the best payoff over strikes, before charges.
  const payoffAt = (S: number) => legs.reduce((t, l) => t + l.q * lot * (Math.max(0, l.k === 'CE' ? S - l.K : l.K - S) - l.fill), 0);
  const maxProfit = money(Math.max(...legs.map((l) => payoffAt(l.K))));
  const credit = money(legs.reduce((t, l) => t - l.q * lot * l.fill, 0));
  const last = legs.map((l) => l.px), marks: { date: string; m: number[]; vix: number | null; mtm: number; spot: number }[] = [];
  const end = settleOn ? idx.get(settleOn)! : dates.length - 1;
  for (let j = idx.get(d)! + 1; j <= end; j++) {
    const t = dates[j], td = await load(t);
    const sp = M.get(t)?.spotPaise ?? 0;
    legs.forEach((l, i) => { const v = boundedMark(td.values(), l.k, l.K, sp); if (v != null && v > 0) last[i] = v; });
    const mtm = money(legs.reduce((a, l, i) => a + l.q * lot * (last[i] - l.fill), 0) - entryCharges);
    marks.push({ date: t, m: [...last], vix: vix.get(t) ?? null, mtm, spot: (M.get(t)?.spotPaise ?? 0) / 100 });
  }
  const outSpot = settleOn ? M.get(settleOn)!.spotPaise! : null;
  const result = (rule: 'hold' | 'vix30' | 'stop50' | 'half') => {
    let ex = -1;
    for (let j = 0; j < marks.length - (settleOn ? 1 : 0); j++) {
      const k = marks[j];
      if (rule === 'vix30' && k.vix != null && k.vix >= 30) { ex = j; break; }
      if (rule === 'stop50' && k.mtm <= -50000) { ex = j; break; }
      if (rule === 'half' && k.mtm >= maxProfit / 2) { ex = j; break; }
    }
    let gross = 0, ch = entryCharges, status: string;
    if (ex >= 0 || !settleOn) {
      const k = ex >= 0 ? marks[ex] : marks.at(-1)!;
      legs.forEach((l, i) => { const p = l.q > 0 ? Math.max(5, k.m[i] - SLIP) : k.m[i] + SLIP; gross += l.q * lot * (p - l.fill); ch += computeOptionCharges({ side: l.q > 0 ? 'SELL' : 'BUY', qty: Math.abs(l.q) * lot, premiumPaise: p, date: k.date }).total; });
      status = ex >= 0 ? `exit ${k.date}` : `still open, marked ${k.date}`;
    } else {
      legs.forEach((l) => { const iv = Math.max(0, l.k === 'CE' ? outSpot! - l.K : l.K - outSpot!); gross += l.q * lot * (iv - l.fill); ch += expirySettlementCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: Math.abs(l.q) * lot, intrinsicPaise: iv, date: settleOn }); });
      status = `expiry ${settleOn}`;
    }
    const upto = ex >= 0 ? marks.slice(0, ex + 1) : marks, w = upto.reduce((a, k) => (k.mtm < a.mtm ? k : a), { mtm: 0, date: d } as { mtm: number; date: string });
    return { net: R(money(gross - ch)), status, worstMtm: R(w.mtm), worstOn: w.date };
  };
  const row = {
    year: y, entry: d, expiry: settleOn ?? want.at(-1), spotIn: spot / 100, spotOut: outSpot ? outSpot / 100 : null, move: outSpot ? Math.round((outSpot / spot - 1) * 1000) / 10 : null,
    modelPriced: legs.filter((l) => l.model).length, credit: R(credit), maxProfit: R(maxProfit), maxVix: Math.max(...marks.map((k) => k.vix ?? 0)),
    legs: legs.map((l) => `${l.q > 0 ? 'Buy' : 'Sell'} ${Math.abs(l.q)}× ${l.K / 100} ${l.k} @${(l.px / 100).toFixed(2)}${l.model ? ' (NSE settlement, no trade)' : ''}`),
    hold: result('hold'), vix30: result('vix30'), stop50: result('stop50'), half: result('half'),
  };
  years.push(row);
  console.log(`${y} ${d} spot ${row.spotIn} → ${row.spotOut ?? 'open'} (${row.move ?? '-'}%) | ${row.legs.join(', ')} | credit ${row.credit} maxP ${row.maxProfit} maxVix ${row.maxVix}`);
  for (const r of ['hold', 'vix30', 'stop50', 'half'] as const) console.log(`    ${r}: ${row[r].net} (${row[r].status}) worst MTM ${row[r].worstMtm} on ${row[r].worstOn}`);
}
const done = years.filter((r): r is Extract<typeof r, { hold: unknown }> => 'hold' in r && r.spotOut != null);
for (const rule of ['hold', 'vix30', 'stop50', 'half'] as const) {
  const xs = done.map((r) => r[rule].net), clean = done.filter((r) => !r.modelPriced).map((r) => r[rule].net), s = (a: number[]) => a.reduce((x, y) => x + y, 0);
  console.log(`${rule}: years ${xs.length} won ${xs.filter((x) => x > 0).length} total ${s(xs)} avg ${R(s(xs) / xs.length)} worst ${Math.min(...xs)} best ${Math.max(...xs)} | traded-price years only: ${clean.length} won ${clean.filter((x) => x > 0).length} total ${s(clean)}`);
}
// Today's margin for the same shape on the latest listed December, from NSE's SPAN file.
try {
  const span = (await spanOn(D, U))?.data?.[U], e = allExp.filter((x) => x.slice(5, 7) === '12' && x > D).at(-1) && allExp.find((x) => x.startsWith(`${Number(D.slice(0, 4)) + 1}-12-`));
  if (span && e) {
    const rows = await prisma.fnoEod.findMany({ where: { underlying: U, date: D, expiry: e }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true } });
    const spot = today.spotPaise!, legs = SHAPE.map((s) => { const r = rows.filter((x) => x.kind === s.k).sort((a, b) => Math.abs(a.strikePaise - spot * s.at) - Math.abs(b.strikePaise - spot * s.at))[0]; return { kind: s.k, expiry: e, strike: r.strikePaise / 100, qty: s.q * today.lotSize!, pricePaise: r.closePaise || r.settlePaise }; });
    const v = positionMargin(span, legs as never, spot, D);
    margins[e] = v.missing.length ? null : R(v.marginPaise / 100);
    console.log('margin today for', e, legs.map((l) => `${l.qty > 0 ? 'B' : 'S'}${Math.abs(l.qty / today.lotSize!)} ${l.strike}${l.kind}`).join(' '), '₹', margins[e]);
  }
} catch (err) { console.log('margin skipped', String(err)); }
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-yearly.json'), JSON.stringify({ ranAt: new Date().toISOString(), shape: SHAPE, lot: today.lotSize, spot: today.spotPaise! / 100, margins, years }));
console.log('written');
await prisma.$disconnect();
