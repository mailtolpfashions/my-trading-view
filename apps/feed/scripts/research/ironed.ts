// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
// The "Ironed Collar" as described in the user's note, on BANKNIFTY monthly expiries, daily closes.
import { prisma } from '@mtv/db';
import { computeFuturesCharges, computeOptionCharges, exerciseStt } from '@mtv/paper';
import { positionMargin, staleFlags } from '@mtv/options';
import { spanOn } from '../../src/fno/span';
import { MARKET_EVENTS } from '../../src/research/nifty-days';

const U = 'BANKNIFTY', SLIP = 100, STEP = 100_00;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * today.lotSize!, YEARS = dates.length / 248;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
const monthly = [...last.values()];
const vix = new Map((await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true } })).map((r) => [r.date, r.closePaise / 100]));
const pcrRows = await prisma.fnoDerivedDay.findMany({ where: { underlying: U }, select: { date: true, expiry: true, ceOi: true, peOi: true } });
const pcr = new Map(pcrRows.map((r) => [`${r.date}|${r.expiry}`, Number(r.ceOi) ? Number(r.peOi) / Number(r.ceOi) : 0]));
const events = MARKET_EVENTS.filter((e) => e.id.startsWith('budget') || e.id.startsWith('election')).map((e) => e.from);
console.log(U, dates[0], 'to', dates.at(-1), YEARS.toFixed(1), 'years, monthly expiries', monthly.length, 'vix days', vix.size, 'lot', today.lotSize, 'spot', today.spotPaise! / 100);

type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const cache = new Map<string, Q[]>();
async function load(d: string, e: string) {
  const k = d + e; let r = cache.get(k);
  if (!r) {
    r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[];
    for (const kind of ['CE', 'PE']) { const l = r.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise); staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; }); }
    cache.set(k, r);
  }
  return r;
}
type Leg = { k: 'FUT' | 'CE' | 'PE'; K: number; q: number; px: number; last: number };
const px = (r: Q[], k: string, K: number) => { const x = r.find((z) => z.kind === k && z.strikePaise === K); return x ? (x.traded ? x.closePaise : x.settlePaise) : null; };
const tradedAt = (r: Q[], k: string, K: number) => { const x = r.find((z) => z.kind === k && z.strikePaise === K && z.traded && z.closePaise > 0); return x ? x.closePaise : null; };
const intr = (k: string, K: number, S: number) => (k === 'FUT' ? S : Math.max(0, k === 'CE' ? S - K : K - S));
type V = { ceSteps: number; before: number; manage: 'hold' | 'book50' | 'adj-roll' | 'adj-hedge'; filter: boolean; late: boolean };
const vars: V[] = [];
for (const ceSteps of [2, 4]) for (const before of [20, 10, 5]) for (const manage of ['hold', 'book50', 'adj-roll', 'adj-hedge'] as const) for (const filter of [false, true]) for (const late of [false, true]) { if (manage === 'hold' && late) continue; vars.push({ ceSteps, before, manage, filter, late }); }
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0), R = Math.round;
const results: { line: string; net: number }[] = [];
for (const v of vars) {
  const out: { y: string; net: number }[] = []; let skip = 0, filtered = 0, adjustments = 0, forced = 0, booked = 0;
  for (const e of monthly) {
    const iE = idx.get(e)!, iD = iE - v.before; if (iD < 1) continue;
    const d = dates[iD], m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    if (v.filter) {
      const vx = vix.get(d), p = pcr.get(`${d}|${e}`);
      const ev = events.some((x) => x > d && x <= dates[Math.min(iD + 5, iE)]);
      if (vx == null || vx < 13 || vx > 18 || p == null || p < 0.85 || p > 1.25 || ev) { filtered++; continue; }
    }
    const rows = await load(d, e), atm = Math.round(m.spotPaise / STEP) * STEP, K1 = atm + v.ceSteps * STEP, K2 = atm - STEP;
    const fut = tradedAt(rows, 'FUT', 0), c = tradedAt(rows, 'CE', K1), p = tradedAt(rows, 'PE', K2);
    if (fut == null || c == null || p == null) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot);
    let cash = 0, ch = 0;
    const legs: Leg[] = [];
    const fillPx = (side: 'BUY' | 'SELL', q: number) => (side === 'BUY' ? q + SLIP : Math.max(5, q - SLIP));
    const charge = (k: string, side: 'BUY' | 'SELL', p0: number, date: string) => (k === 'FUT' ? computeFuturesCharges({ side, qty: lot, pricePaise: p0, date }).total : computeOptionCharges({ side, qty: lot, premiumPaise: p0, date }).total);
    const open = (k: Leg['k'], K: number, q: number, price: number, date: string) => { const side = q > 0 ? 'BUY' : 'SELL', f = fillPx(side, price); cash += (q > 0 ? -1 : 1) * lot * f; ch += charge(k, side, f, date); legs.push({ k, K, q, px: f, last: price }); };
    const close = (l: Leg, date: string) => { const side = l.q > 0 ? 'SELL' : 'BUY', f = fillPx(side, l.last); cash += (l.q > 0 ? 1 : -1) * lot * f; ch += charge(l.k, side, f, date); legs.splice(legs.indexOf(l), 1); };
    open('CE', K1, 1, c, d); open('FUT', 0, -1, fut, d); open('PE', K2, -1, p, d);
    const maxProfit = lot * (fillPx('SELL', fut) - K2 - fillPx('BUY', c) + fillPx('SELL', p));
    if (maxProfit <= 0 && v.manage !== 'hold') { /* the note's 50% target has no meaning here: hold to expiry */ }
    let adj = 0, pending: null | 'exit' | 'up' | 'down' = null;
    const act = async (what: 'exit' | 'up' | 'down', t: string, r: Q[], spot: number) => {
      if (what === 'exit') { for (const l of [...legs]) close(l, t); return; }
      adj++; adjustments++;
      const newK = Math.round(spot / STEP) * STEP - STEP;
      if (what === 'up') {
        const pe = legs.find((l) => l.k === 'PE' && l.q < 0), price = tradedAt(r, 'PE', newK);
        if (pe && price != null && newK > pe.K) { close(pe, t); open('PE', newK, -1, price, t); }
      } else {
        const ce = legs.find((l) => l.k === 'CE' && l.q > 0); if (ce) close(ce, t);
        if (v.manage === 'adj-roll') {
          const pe = legs.find((l) => l.k === 'PE' && l.q < 0), price = tradedAt(r, 'PE', newK);
          if (pe && price != null && newK < pe.K) { close(pe, t); open('PE', newK, -1, price, t); }
        } else {
          const K = (legs.find((l) => l.k === 'PE' && l.q < 0)?.K ?? atm) - 300_00, price = tradedAt(r, 'PE', K);
          if (price != null && !legs.some((l) => l.k === 'PE' && l.q > 0)) open('PE', K, 1, price, t);
        }
      }
    };
    for (let j = iD + 1; j < iE && legs.length; j++) {
      const t = dates[j], spot = M.get(t)!.spotPaise, r = await load(t, e);
      for (const l of legs) { const q = px(r, l.k, l.k === 'FUT' ? 0 : l.K); if (q != null) l.last = q; }
      if (!spot) continue;
      if (pending) { await act(pending, t, r, spot); pending = null; if (!legs.length) break; }
      if (v.manage === 'hold') continue;
      const pnl = cash + legs.reduce((s, l) => s + (l.q > 0 ? 1 : -1) * lot * l.last, 0);
      let what: null | 'exit' | 'up' | 'down' = null;
      if (maxProfit > 0 && pnl >= maxProfit / 2) { what = 'exit'; booked++; }
      else if (v.manage !== 'book50') {
        const ce = legs.find((l) => l.k === 'CE' && l.q > 0), pe = legs.find((l) => l.k === 'PE' && l.q < 0);
        const up = ce && spot >= ce.K - STEP, down = pe && spot <= pe.K;
        if (up || down) { if (adj >= 2) { what = 'exit'; forced++; } else what = up ? 'up' : 'down'; }
      }
      if (what) { if (v.late) pending = what; else { await act(what, t, r, spot); if (!legs.length) break; } }
    }
    const ST = M.get(e)!.spotPaise;
    if (!ST) { skip++; continue; }
    for (const l of legs) {
      const I = intr(l.k, l.K, ST);
      cash += (l.q > 0 ? 1 : -1) * lot * I;
      if (l.k === 'FUT') ch += computeFuturesCharges({ side: l.q > 0 ? 'SELL' : 'BUY', qty: lot, pricePaise: ST, date: e }).total;
      else if (l.q > 0) ch += exerciseStt(lot, I, e);
    }
    out.push({ y: e.slice(0, 4), net: ((cash - ch) * scale) / 100 });
  }
  if (!out.length) continue;
  const nets = out.map((o) => o.net), w = nets.filter((n) => n > 0), l = nets.filter((n) => n <= 0), yrs: Record<string, number> = {};
  for (const o of out) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  const net = sum(nets);
  results.push({ net, line: `CE+${v.ceSteps * 100} ${String(v.before).padStart(2)}d ${v.manage.padEnd(9)} ${v.filter ? 'filter' : 'all   '} ${v.late ? 'late' : 'same'} | n ${String(out.length).padStart(3)} skip ${skip} off ${filtered} | won ${R(w.length / out.length * 100)}% | win ${R(sum(w) / (w.length || 1))} loss ${R(-sum(l) / (l.length || 1))} | worst ${R(Math.min(...nets))} | /yr ${R(net / YEARS)} | net ${R(net)} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | since23 ${R(sum(out.filter((o) => o.y >= '2023').map((o) => o.net)))} | adj ${adjustments} booked ${booked} forced ${forced}` });
}
for (const r of results.sort((a, b) => b.net - a.net)) console.log(r.line);
console.log('profitable sets', results.filter((r) => r.net > 0).length, 'of', results.length);
const D = today.date, fr = (await prisma.fnoEod.findMany({ where: { underlying: U, date: D, kind: 'FUT' }, select: { expiry: true, closePaise: true }, orderBy: { expiry: 'asc' } }))[0];
const rows = await load(D, fr.expiry), atm = Math.round(today.spotPaise! / STEP) * STEP, span = (await spanOn(D, U))?.data?.[U], L = today.lotSize!;
for (const s of [2, 4]) {
  const K1 = atm + s * STEP, K2 = atm - STEP, c = px(rows, 'CE', K1)!, p = px(rows, 'PE', K2)!, F = fr.closePaise;
  const up = (F - K1 - c + p) * L / 100, dn = (F - K2 - c + p) * L / 100;
  const margin = span ? positionMargin(span, [{ kind: 'CE', expiry: fr.expiry, strike: K1 / 100, qty: L, pricePaise: c }, { kind: 'FUT', expiry: fr.expiry, strike: 0, qty: -L, pricePaise: F }, { kind: 'PE', expiry: fr.expiry, strike: K2 / 100, qty: -L, pricePaise: p }] as any, today.spotPaise!, D).marginPaise / 100 : 0;
  console.log(`Today ${fr.expiry} F ${F / 100} CE ${K1 / 100} @${c / 100} PE ${K2 / 100} @${p / 100} | below PE ${R(dn / 100)} above CE ${R(up / 100)} | margin ${R(margin)}`);
}
await prisma.$disconnect(); process.exit(0);
