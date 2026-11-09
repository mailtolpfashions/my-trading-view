// Strategy search (the user, 2026-11-09): build multi-leg shapes from bought and sold calls and puts (spreads, ratios,
// seagulls, lizards, condors, flies, risk reversals), on later expiries only (2nd month, 3rd month, January → December),
// and keep only the ones that pass the user's rules. Rules fixed before running:
//   strikes   offsets from the index at entry: −30 … +30% in 5% steps; nearest traded strike within 1% of the index
//             (2.5% for the yearly frame); a shape whose legs collapse onto the same strike is skipped that month
//   frames    2m: entry the first trading day after a monthly expiry, the monthly two months out (~60 days)
//             3m: same, three months out (~90 days); yearly: last Monday of January → that December's expiry
//   exits     at expiry, or at the first close with 21 days or fewer left
//   sizes     1 lot per unit of a leg (a "2" leg is 2 lots), at today's index level and lot size
//   stops     portfolio stop at 10%, 15%, 20% of ₹5 lakh, checked at daily closes, exit at that close
//   choose    on entries 2011–2020 only; then report 2021 onward once. Pass: ≥70% won, total won ≥1.5× total lost,
//             profit in 2011–15 and 2016–20, worst loss after the stop ≥ −₹1 lakh, margin ≤ ₹3 lakh, and at least half
//             of its neighbouring shapes (one strike 5% away) also profitable
// Every month's entry is computed on its own; one-position-at-a-time profit is averaged over the possible start months
// and the worst start month is kept. Untraded days are priced with boundedMark. Charges and ₹1 slippage per leg.
// Writes .data/research/selling-search.json. Heavy: run when live recording is off or after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=8192 -- npx tsx scripts/selling-search.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { ivAboveMedian, ivRank, positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { ivHistory } from '../src/selling/books';
import { expiryCalendar } from '../src/selling/expiries';

const U = 'NIFTY', SLIP = 100, R = Math.round, DAY = 86400_000, CAPITAL = 500000, STOPS = [0.1, 0.15, 0.2];
type K = 'CE' | 'PE';
type LegSpec = { k: K; o: number; q: number };
type Shape = { id: string; family: string; params: number[]; legs: LegSpec[] };

// ---- shapes -----------------------------------------------------------------------------------------------------------
const shapes: Shape[] = [];
const add = (family: string, params: number[], legs: LegSpec[]) => shapes.push({ id: `${family}:${params.join(',')}`, family, params, legs });
const P = (o: number, q: number): LegSpec => ({ k: 'PE', o, q }), C = (o: number, q: number): LegSpec => ({ k: 'CE', o, q });
for (const a of [-15, -10, -5, 0]) for (const w of [5, 10, 15]) add('Bull put spread', [a, a - w], [P(a, -1), P(a - w, 1)]);
for (const a of [-5, 0, 5]) for (const w of [5, 10, 15]) add('Bull call spread', [a, a + w], [C(a, 1), C(a + w, -1)]);
for (const a of [-5, 0, 5]) for (const w of [5, 10, 15]) for (const c of [-20, -15, -10, -5]) {
  add('Seagull', [a, a + w, c], [C(a, 1), C(a + w, -1), P(c, -1)]);
  for (const d of [c - 5, c - 10]) add('Seagull + put', [a, a + w, c, d], [C(a, 1), C(a + w, -1), P(c, -1), P(d, 1)]);
}
for (const a of [-5, 0, 5]) for (const b of [a + 5, a + 10, a + 15, a + 20]) for (const c of [-20, -15, -10]) {
  add('Call ratio + put', [a, b, c], [C(a, 1), C(b, -2), P(c, -1)]);
  for (const d of [c - 5, c - 10]) add('Call ratio + put spread', [a, b, c, d], [C(a, 1), C(b, -2), P(c, -1), P(d, 1)]);
}
for (const c of [-15, -10, -5]) for (const a of [0, 5, 10]) add('Risk reversal', [c, a], [P(c, -1), C(a, 1)]);
for (const c of [-15, -10, -5]) for (const a of [5, 10, 15]) for (const w of [5, 10]) add('Jade lizard', [c, a, a + w], [P(c, -1), C(a, -1), C(a + w, 1)]);
for (const c of [-15, -10, -5]) for (const wd of [5, 10]) for (const a of [5, 10, 15]) for (const wc of [5, 10]) add('Bullish condor', [c, c - wd, a, a + wc], [P(c, -1), P(c - wd, 1), C(a, -1), C(a + wc, 1)]);
for (const a of [-5, 0, 5]) for (const w of [5, 10]) for (const x of [5, 10]) add('Broken-wing call fly', [a, a + w, a + 2 * w + x], [C(a, 1), C(a + w, -2), C(a + 2 * w + x, 1)]);
for (const c of [-10, -5, 0]) for (const a of [0, 5, 10]) if (a >= c) {
  add('Short strangle', [c, a], [P(c, -1), C(a, -1)]);
  for (const d of [-20, -25]) add('Short strangle + crash put', [c, a, d], [P(c, -1), C(a, -1), P(d, 1)]);
}

// ---- market data ------------------------------------------------------------------------------------------------------
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, D = today.date, todayN = today.spotPaise! * today.lotSize!;
const cal = await expiryCalendar(U, new Set(dates), D);
const monthly = cal.monthly;
const history = await ivHistory(U);

type Row = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean; expiry: string };
type Book = { traded: Map<string, number>; mark: Map<string, number>; strikes: Record<K, number[]> };
const books = new Map<string, Book>();
// One day of one expiry: traded closes (stale ones removed) for choosing strikes, and a bounded mark for every strike
// (traded close, else NSE settlement kept between intrinsic value and the cheapest traded richer option).
async function book(d: string, e: string): Promise<Book> {
  const key = d + e; let b = books.get(key);
  if (b) return b;
  const all = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: { in: cal.labels(e) }, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true, expiry: true } })) as Row[];
  const by = new Map<string, Row>();
  for (const x of all) { const k2 = `${x.kind}${x.strikePaise}`, o = by.get(k2); if (!o || (x.traded && !o.traded) || (x.expiry === e && o.expiry !== e && x.traded === o.traded)) by.set(k2, x); }
  const spot = M.get(d)?.spotPaise ?? 0, traded = new Map<string, number>(), mark = new Map<string, number>(), strikes: Record<K, number[]> = { CE: [], PE: [] };
  for (const kind of ['CE', 'PE'] as const) {
    const rows = [...by.values()].filter((x) => x.kind === kind).sort((a, c) => a.strikePaise - c.strikePaise);
    const live = rows.filter((x) => x.traded && x.closePaise > 0);
    staleFlags(live.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) live[i].traded = false; });
    const ok = rows.map((x) => (x.traded && x.closePaise > 0 ? x.closePaise : Infinity));
    // cap for a call: cheapest traded call with a lower strike; for a put: with a higher strike
    const cap = new Array<number>(rows.length).fill(Infinity);
    if (kind === 'CE') { let m = Infinity; for (let i = 0; i < rows.length; i++) { cap[i] = m; m = Math.min(m, ok[i]); } }
    else { let m = Infinity; for (let i = rows.length - 1; i >= 0; i--) { cap[i] = m; m = Math.min(m, ok[i]); } }
    rows.forEach((x, i) => {
      const k2 = `${kind}${x.strikePaise}`;
      if (ok[i] < Infinity) { traded.set(k2, x.closePaise); mark.set(k2, x.closePaise); strikes[kind].push(x.strikePaise); return; }
      if (x.settlePaise > 0) mark.set(k2, Math.max(Math.max(0, kind === 'CE' ? spot - x.strikePaise : x.strikePaise - spot), Math.min(x.settlePaise, cap[i])));
    });
  }
  b = { traded, mark, strikes }; books.set(key, b);
  return b;
}
const nearestTraded = (b: Book, k: K, target: number, tol: number) => {
  let best: number | null = null;
  for (const s of b.strikes[k]) if (best == null || Math.abs(s - target) < Math.abs(best - target)) best = s;
  return best != null && Math.abs(best - target) <= tol ? best : null;
};

// ---- entries ----------------------------------------------------------------------------------------------------------
type Entry = { frame: string; phase: number; entry: string; expiry: string; exit21: string; spot: number; lot: number; hi: boolean | null; rank: number | null };
const entries: Entry[] = [];
function lastMondayOfJan(y: number) { for (let d = 31; d >= 25; d--) { const t = new Date(Date.UTC(y, 0, d)); if (t.getUTCDay() === 1) return t.toISOString().slice(0, 10); } return `${y}-01-25`; }
const exit21 = (d: string, e: string) => dates.find((t) => t > d && (Date.parse(e) - Date.parse(t)) / DAY <= 21) ?? e;
for (const [frame, n] of [['2m', 2], ['3m', 3]] as const) {
  for (let k = 1; k + n - 1 < monthly.length; k++) {
    const d = dates[idx.get(monthly[k - 1])! + 1], e = monthly[k + n - 1], m = d ? M.get(d) : null;
    if (!d || !m?.spotPaise || !m.lotSize || !M.get(e)?.spotPaise) continue;
    entries.push({ frame, phase: k % n, entry: d, expiry: e, exit21: exit21(d, e), spot: m.spotPaise, lot: m.lotSize, hi: ivAboveMedian(history, d), rank: ivRank(history, d) });
  }
}
for (const e of monthly.filter((x) => x.slice(5, 7) === '12')) {
  const d = dates.find((x) => x >= lastMondayOfJan(Number(e.slice(0, 4)))), m = d ? M.get(d) : null;
  if (!d || !m?.spotPaise || !m.lotSize) continue;
  entries.push({ frame: 'yearly', phase: 0, entry: d, expiry: e, exit21: exit21(d, e), spot: m.spotPaise, lot: m.lotSize, hi: ivAboveMedian(history, d), rank: ivRank(history, d) });
}
console.log('shapes', shapes.length, 'entries', entries.length, JSON.stringify(Object.fromEntries(['2m', '3m', 'yearly'].map((f) => [f, entries.filter((x) => x.frame === f).length]))));

// ---- simulate ---------------------------------------------------------------------------------------------------------
type Trade = { s: string; f: string; x: string; ph: number; en: string; ex: string; hi: boolean | null; rk: number | null; net: number; mtm: number; st: number[] };
const trades: Trade[] = [];
const charge = (side: 'BUY' | 'SELL', qty: number, p: number, date: string) => computeOptionCharges({ side, qty, premiumPaise: p, date }).total;
let done = 0;
for (const en of entries) {
  const tol = en.frame === 'yearly' ? 0.025 : 0.01, b0 = await book(en.entry, en.expiry);
  const scale = todayN / (en.spot * en.lot), money = (p: number) => (p * scale) / 100;
  const pathDays = dates.slice(idx.get(en.entry)! + 1, idx.get(en.expiry)! + 1);
  const dayBooks: Book[] = []; for (const t of pathDays) dayBooks.push(await book(t, en.expiry));
  const outSpot = M.get(en.expiry)!.spotPaise!;
  for (const sh of shapes) {
    const Ks = sh.legs.map((l) => nearestTraded(b0, l.k, en.spot * (1 + l.o / 100), en.spot * tol));
    if (Ks.some((x) => x == null)) continue;
    const used = new Set(sh.legs.map((l, i) => `${l.k}${Ks[i]}`)); if (used.size !== sh.legs.length) continue;
    const legs = sh.legs.map((l, i) => { const k2 = `${l.k}${Ks[i]}`, px = b0.traded.get(k2)!; return { ...l, K: Ks[i]!, key: k2, qty: Math.abs(l.q) * en.lot, fill: l.q > 0 ? px + SLIP : Math.max(5, px - SLIP) }; });
    const entryCash = legs.reduce((a, l) => a + (l.q > 0 ? -1 : 1) * l.qty * l.fill, 0);
    const entryCh = legs.reduce((a, l) => a + charge(l.q > 0 ? 'BUY' : 'SELL', l.qty, l.fill, en.entry), 0);
    const closeOut = (bk: Book, date: string) => legs.reduce((a, l) => { const m = bk.mark.get(l.key) ?? l.fill, p = l.q > 0 ? Math.max(5, m - SLIP) : m + SLIP; return { cash: a.cash + (l.q > 0 ? 1 : -1) * l.qty * p, ch: a.ch + charge(l.q > 0 ? 'SELL' : 'BUY', l.qty, p, date) }; }, { cash: 0, ch: 0 });
    for (const exitKind of ['expiry', '21'] as const) {
      const lastDay = exitKind === 'expiry' ? en.expiry : en.exit21;
      let worst = 0, stopNet: (number | null)[] = STOPS.map(() => null), finalNet = 0;
      for (let j = 0; j < pathDays.length; j++) {
        const t = pathDays[j], bk = dayBooks[j];
        if (t === en.expiry && exitKind === 'expiry') break; // settled below
        const live = legs.reduce((a, l) => a + (l.q > 0 ? 1 : -1) * l.qty * (bk.mark.get(l.key) ?? l.fill), 0);
        const v = money(entryCash + live - entryCh); if (v < worst) worst = v;
        STOPS.forEach((s, i) => { if (stopNet[i] == null && v <= -s * CAPITAL) { const c = closeOut(bk, t); stopNet[i] = money(entryCash + c.cash - entryCh - c.ch); } });
        if (t === lastDay) { const c = closeOut(bk, t); finalNet = money(entryCash + c.cash - entryCh - c.ch); break; }
      }
      if (exitKind === 'expiry') {
        let cash = entryCash, ch = entryCh;
        for (const l of legs) { const iv = Math.max(0, l.k === 'CE' ? outSpot - l.K : l.K - outSpot); cash += (l.q > 0 ? 1 : -1) * l.qty * iv; ch += expirySettlementCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: l.qty, intrinsicPaise: iv, date: en.expiry }); }
        finalNet = money(cash - ch);
      }
      worst = Math.min(worst, finalNet);
      trades.push({ s: sh.id, f: en.frame, x: exitKind, ph: en.phase, en: en.entry, ex: lastDay, hi: en.hi, rk: en.rank, net: R(finalNet), mtm: R(worst), st: stopNet.map((x) => R(x ?? finalNet)) });
    }
  }
  if (++done % 25 === 0) console.log(`entries ${done}/${entries.length}, trades ${trades.length}`);
  // Free days no later entry needs: earlier expiries, and earlier days of this one (entries run in date order per frame).
  for (const k of [...books.keys()]) { const e = k.slice(10), d = k.slice(0, 10); if (e < en.expiry || (e === en.expiry && d < en.entry)) books.delete(k); }
}

// ---- summarise --------------------------------------------------------------------------------------------------------
const YEARS = { train: (Date.parse('2021-01-01') - Date.parse('2011-01-01')) / (365.25 * DAY), test: (Date.parse(D) - Date.parse('2021-01-01')) / (365.25 * DAY) };
const PHASES: Record<string, number> = { '2m': 2, '3m': 3, yearly: 1 };
type Sum = { n: number; won: number; total: number; perYear: number; minPhaseYear: number; pf: number; worst: number; worstMtm: number; h1: number; h2: number };
function summarise(ts: Trade[], stop: number, part: 'train' | 'test', frame: string): Sum {
  const net = (t: Trade) => (stop < 0 ? t.net : t.st[stop]);
  const ns = ts.map(net), w = ns.filter((x) => x > 0), l = ns.filter((x) => x <= 0), sw = w.reduce((a, b) => a + b, 0), sl = -l.reduce((a, b) => a + b, 0);
  const phases = Array.from({ length: PHASES[frame] }, (_, p) => ts.filter((t) => t.ph === p).reduce((a, t) => a + net(t), 0) / YEARS[part]);
  return {
    n: ts.length, won: ts.length ? R((w.length / ts.length) * 100) : 0, total: R(sw - sl), perYear: R(phases.reduce((a, b) => a + b, 0) / phases.length), minPhaseYear: R(Math.min(...phases)),
    pf: sl ? Math.round((sw / sl) * 100) / 100 : sw ? 99 : 0, worst: ns.length ? Math.min(...ns) : 0,
    worstMtm: ts.length ? Math.min(...ts.map((t) => (stop < 0 ? t.mtm : Math.max(t.mtm, Math.min(t.st[stop], -STOPS[stop] * CAPITAL))))) : 0,
    h1: R(ts.filter((t) => t.en < '2016').reduce((a, t) => a + net(t), 0)), h2: R(ts.filter((t) => t.en >= '2016' && t.en < '2021').reduce((a, t) => a + net(t), 0)),
  };
}
const byKey = new Map<string, Trade[]>();
for (const t of trades) { const k = `${t.s}|${t.f}|${t.x}`; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(t); }
// Today's margin for each shape and frame.
const span = (await spanOn(D, U))?.data?.[U];
const ahead = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })).map((r) => r.expiry).filter((e) => e > D);
const lastIn = new Map<string, string>(); for (const e of ahead) lastIn.set(e.slice(0, 7), e);
const mons = [...lastIn.values()].sort();
const frameExpiry: Record<string, string | undefined> = { '2m': mons[1], '3m': mons[2], yearly: mons.find((e) => e.slice(5, 7) === '12' && (Date.parse(e) - Date.parse(D)) / DAY > 300) };
const margin = new Map<string, number | null>();
for (const [frame, e] of Object.entries(frameExpiry)) {
  if (!span || !e) continue;
  const b = await book(D, e), spot = today.spotPaise!, tol = frame === 'yearly' ? 0.025 : 0.01;
  for (const sh of shapes) {
    const Ks = sh.legs.map((l) => nearestTraded(b, l.k, spot * (1 + l.o / 100), spot * tol));
    if (Ks.some((x) => x == null)) { margin.set(`${sh.id}|${frame}`, null); continue; }
    const v = positionMargin(span, sh.legs.map((l, i) => ({ kind: l.k, expiry: e, strike: Ks[i]! / 100, qty: l.q * today.lotSize!, pricePaise: b.traded.get(`${l.k}${Ks[i]}`) })) as never, spot, D);
    margin.set(`${sh.id}|${frame}`, v.missing.length ? null : R(v.marginPaise / 100));
  }
}
type SRow = { id: string; family: string; params: number[]; legs: LegSpec[]; frame: string; exit: string; iv: 'all' | 'high'; stop: number | null; margin: number | null; train: Sum; test: Sum };
const rows: SRow[] = [];
for (const [key, ts] of byKey) {
  const [sid, frame, exit] = key.split('|'), sh = shapes.find((s) => s.id === sid)!;
  for (const iv of ['all', 'high'] as const) for (let stop = -1; stop < STOPS.length; stop++) {
    const pick = ts.filter((t) => iv === 'all' || t.hi === true);
    const train = summarise(pick.filter((t) => t.en < '2021'), stop, 'train', frame), test = summarise(pick.filter((t) => t.en >= '2021'), stop, 'test', frame);
    rows.push({ id: sid, family: sh.family, params: sh.params, legs: sh.legs, frame, exit, iv, stop: stop < 0 ? null : STOPS[stop], margin: margin.get(`${sid}|${frame}`) ?? null, train, test });
  }
}
// Pass on 2011–2020 only.
const minTrades: Record<string, number> = { '2m': 30, '3m': 20, yearly: 7 };
const passes = (r: (typeof rows)[number]) => r.train.n >= minTrades[r.frame] && r.train.won >= 70 && r.train.pf >= 1.5 && r.train.h1 > 0 && r.train.h2 > 0 && r.train.worstMtm >= -100000 && r.margin != null && r.margin <= 300000;
const sameSetting = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.family === b.family && a.frame === b.frame && a.exit === b.exit && a.iv === b.iv && a.stop === b.stop;
const neighbours = (r: (typeof rows)[number]) => rows.filter((x) => sameSetting(x, r) && x.id !== r.id && x.params.length === r.params.length && x.params.filter((p, i) => p !== r.params[i]).length === 1 && x.params.every((p, i) => Math.abs(p - r.params[i]) <= 5));
const passed = rows.filter(passes).map((r) => { const nb = neighbours(r); const okNb = nb.filter((x) => x.train.total > 0).length; return { ...r, neighbours: nb.length, neighboursProfitable: okNb, robust: nb.length > 0 && okNb / nb.length >= 0.5 }; }).filter((r) => r.robust);
passed.sort((a, b) => b.train.perYear / Math.max(1, b.margin ?? 1) - a.train.perYear / Math.max(1, a.margin ?? 1));
console.log(`\nrows ${rows.length}, passed on 2011–2020 (robust) ${passed.length}`);
for (const r of passed.slice(0, 40)) console.log(`${r.family} [${r.params.join(',')}] ${r.frame} exit ${r.exit} iv ${r.iv} stop ${r.stop ?? '-'} | margin ${r.margin} | TRAIN n ${r.train.n} won ${r.train.won}% /yr ${r.train.perYear} (worst start ${r.train.minPhaseYear}) pf ${r.train.pf} worstMTM ${r.train.worstMtm} | TEST n ${r.test.n} won ${r.test.won}% /yr ${r.test.perYear} total ${r.test.total} worst ${r.test.worst}`);
const keep = new Set(passed.slice(0, 80).map((r) => `${r.id}|${r.frame}|${r.exit}`));
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-search.json'), JSON.stringify({ ranAt: new Date().toISOString(), capital: CAPITAL, stops: STOPS, lot: today.lotSize, spot: today.spotPaise! / 100, shapes: shapes.length, entries: entries.length, rows, passed: passed.map((r) => ({ id: r.id, frame: r.frame, exit: r.exit, iv: r.iv, stop: r.stop, neighbours: r.neighbours, neighboursProfitable: r.neighboursProfitable })), trades: trades.filter((t) => keep.has(`${t.s}|${t.f}|${t.x}`)) }));
console.log('written');
await prisma.$disconnect();
