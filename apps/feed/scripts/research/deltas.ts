// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
// The delta version of the user's balancing rule: sell equal-delta options; when position delta passes the trigger, exit the
// winner, sell a new option at the same delta, and buy the option costing about the extra credit on the other side.
// Based on the premium version. Sell a strangle at about 0.41% of the index each side. When one short has
// fallen by the trigger and the other is above its sold price: exit the winner, sell a new one near the original premium
// target, and buy an option on the losing side costing about the extra credit. Repeats, with no cap in the video.
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { deltaOf, ivAboveMedian, parityForward, staleFlags, yearsBetween } from '@mtv/options';

const U = 'NIFTY', SLIP = 100, DAY = 86400_000, TARGET = 100 / 24500;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65, YEARS = dates.length / 248;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
const monthly = [...last.values()];
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
/** The traded out-of-the-money strike nearest a premium. */
const byPremium = (r: Q[], k: 'CE' | 'PE', target: number, spot: number) => r.filter((x) => x.kind === k && x.traded && x.closePaise > 0 && (k === 'CE' ? x.strikePaise > spot : x.strikePaise < spot)).sort((a, b) => Math.abs(a.closePaise - target) - Math.abs(b.closePaise - target))[0];
const priceOf = (r: Q[], k: string, K: number, fb: number) => { const x = r.find((z) => z.kind === k && z.strikePaise === K); return x ? (x.traded ? x.closePaise : x.settlePaise) : fb; };
type Leg = { k: 'CE' | 'PE'; K: number; q: number; sold: number; last: number };
type V = { entry: 'series' | '45d'; exit: 21 | 0; sellDelta: number; trigger: number | null; stop: number | null; cross: boolean; late: boolean; high: boolean };
const vars: V[] = [];
for (const entry of ['series', '45d'] as const) for (const exit of [21, 0] as const) for (const stop of [15000, 25000, null]) for (const high of [false, true]) for (const sellDelta of [0.1, 0.16, 0.25]) {
  vars.push({ entry, exit, sellDelta, trigger: null, stop, cross: false, late: false, high });
  for (const trigger of [0.1, 0.15, 0.2]) for (const cross of [false, true]) for (const late of [false, true]) vars.push({ entry, exit, sellDelta, trigger, stop, cross, late, high });
}
const fwd = new Map<string, number>(), dl = new Map<string, number | null>();
function deltaAt(r: Q[], t: string, e: string, spot: number, k: 'CE' | 'PE', K: number) {
  const key = t + e + k + K;
  if (dl.has(key)) return dl.get(key)!;
  const T = yearsBetween(t, e), fk = t + e;
  if (!fwd.has(fk)) {
    const q = (kind: string) => r.filter((x) => x.kind === kind).map((x) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded }));
    fwd.set(fk, parityForward(q('CE'), q('PE'), spot, T) ?? spot);
  }
  const x = r.find((z) => z.kind === k && z.strikePaise === K);
  const d = x?.traded && x.closePaise > 0 && T > 0 ? deltaOf(k, x.closePaise, fwd.get(fk)!, K, T) : null;
  dl.set(key, d);
  return d;
}
/** The traded out-of-the-money strike nearest a delta. */
function byDelta(r: Q[], t: string, e: string, spot: number, k: 'CE' | 'PE', target: number) {
  let best: Q | null = null, gap = 0.05;
  for (const x of r) {
    if (x.kind !== k || !x.traded || !(x.closePaise > 0) || (k === 'CE' ? x.strikePaise <= spot : x.strikePaise >= spot)) continue;
    const d = deltaAt(r, t, e, spot, k, x.strikePaise);
    if (d != null && Math.abs(Math.abs(d) - target) < gap) { gap = Math.abs(Math.abs(d) - target); best = x; }
  }
  return best;
}
const R = Math.round, sum = (a: number[]) => a.reduce((x, y) => x + y, 0), out2: { net: number; line: string; base: boolean }[] = [];
for (const v of vars) {
  const out: { y: string; net: number }[] = []; let skip = 0, off = 0, adj = 0, stops = 0, refused = 0;
  for (let n = 0; n < monthly.length; n++) {
    const e = monthly[n], iE = idx.get(e)!;
    const d = v.entry === '45d' ? pickDate(e, 45) : n > 0 ? dates[idx.get(monthly[n - 1])! + 1] : null;
    const x = v.exit === 21 ? pickDate(e, 21) : e;
    if (!d || !x || d >= x || (v.entry === '45d' && (Date.parse(e) - Date.parse(d)) / DAY > 50)) { skip++; continue; }
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    if (v.high && ivAboveMedian(history, d) !== true) { off++; continue; }
    const rows = await load(d, e), lot = m.lotSize, scale = todayN / (m.spotPaise * lot);
    const c = byDelta(rows, d, e, m.spotPaise, 'CE', v.sellDelta), p = byDelta(rows, d, e, m.spotPaise, 'PE', v.sellDelta);
    if (!c || !p) { skip++; continue; }
    let cash = 0, ch = 0;
    const legs: Leg[] = [];
    const open = (k: Leg['k'], K: number, q: number, px: number, date: string) => { const side = q > 0 ? 'BUY' : 'SELL', f = q > 0 ? px + SLIP : Math.max(5, px - SLIP); cash += (q > 0 ? -1 : 1) * lot * f; ch += computeOptionCharges({ side, qty: lot, premiumPaise: f, date }).total; legs.push({ k, K, q, sold: px, last: px }); };
    const close = (l: Leg, date: string) => { const side = l.q > 0 ? 'SELL' : 'BUY', f = l.q > 0 ? Math.max(5, l.last - SLIP) : l.last + SLIP; cash += (l.q > 0 ? 1 : -1) * lot * f; ch += computeOptionCharges({ side, qty: lot, premiumPaise: f, date }).total; legs.splice(legs.indexOf(l), 1); };
    open('CE', c.strikePaise, -1, c.closePaise, d); open('PE', p.strikePaise, -1, p.closePaise, d);
    const adjust = (win: Leg, r: Q[], t: string, spot: number) => {
      const lose = legs.find((l) => l.q < 0 && l.k !== win.k)!, s = byDelta(r, t, e, spot, win.k, v.sellDelta);
      const closer = s && (win.k === 'CE' ? s.strikePaise < win.K : s.strikePaise > win.K);
      if (!s || !closer) { refused++; return; }
      if (!v.cross && (win.k === 'CE' ? s.strikePaise <= lose.K : s.strikePaise >= lose.K)) { refused++; return; }
      const extra = s.closePaise - win.last; if (extra <= 0) { refused++; return; }
      const h = byPremium(r, lose.k, extra, spot); if (!h) { refused++; return; }
      close(win, t); open(win.k, s.strikePaise, -1, s.closePaise, t); open(lose.k, h.strikePaise, 1, h.closePaise, t); adj++;
    };
    let pendingExit = false, pendingLeg: Leg['k'] | null = null, done = false;
    for (let j = idx.get(d)! + 1; j <= idx.get(x)!; j++) {
      const t = dates[j], r = await load(t, e), spot = M.get(t)!.spotPaise ?? m.spotPaise;
      for (const l of legs) l.last = priceOf(r, l.k, l.K, l.last);
      if (t === e) break; // expiry settles below
      if (t === x || pendingExit) { for (const l of [...legs]) close(l, t); done = true; break; }
      if (pendingLeg) { const w = legs.find((l) => l.q < 0 && l.k === pendingLeg); pendingLeg = null; if (w) adjust(w, r, t, spot); }
      const pnl = (cash + legs.reduce((s, l) => s + (l.q > 0 ? 1 : -1) * lot * l.last, 0) - ch) * scale / 100;
      if (v.stop != null && pnl <= -v.stop) { stops++; if (v.late) pendingExit = true; else { for (const l of [...legs]) close(l, t); done = true; break; } continue; }
      if (v.trigger == null) continue;
      const a = legs.find((l) => l.q < 0 && l.k === 'CE')!, b = legs.find((l) => l.q < 0 && l.k === 'PE')!;
      let net = 0, known = true;
      for (const l of legs) { const q = deltaAt(r, t, e, spot, l.k, l.K); if (q == null) { known = false; break; } net += (l.q > 0 ? 1 : -1) * q; }
      // Delta above zero means the market fell: move the call down. Below zero means it rose: move the put up.
      const win = known && Math.abs(net) >= v.trigger ? (net > 0 ? a : b) : null;
      if (win) { if (v.late) pendingLeg = win.k; else adjust(win, r, t, spot); }
    }
    if (!done) {
      const ST = M.get(e)!.spotPaise; if (!ST) { skip++; continue; }
      for (const l of legs) { const I = Math.max(0, l.k === 'CE' ? ST - l.K : l.K - ST); cash += (l.q > 0 ? 1 : -1) * lot * I; if (l.q > 0) ch += exerciseStt(lot, I, e); }
    }
    out.push({ y: e.slice(0, 4), net: ((cash - ch) * scale) / 100 });
  }
  if (!out.length) continue;
  const n = out.map((o) => o.net), w = n.filter((a) => a > 0), l = n.filter((a) => a <= 0), yrs: Record<string, number> = {};
  for (const o of out) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  const totalNet = sum(n), tag = `d${v.sellDelta} ${v.entry.padEnd(6)} exit ${v.exit === 21 ? '21d ' : 'exp '} ${v.trigger == null ? 'NO-ADJ ' : `adj d${v.trigger}`} ${v.cross ? 'cross ' : 'nocross'} ${v.stop == null ? 'nostop' : `stop ${v.stop / 1000}k`} ${v.late ? 'late' : 'same'} ${v.high ? 'highIV' : 'all'}`;
  out2.push({ net: totalNet, base: v.trigger == null, line: `${tag.padEnd(58)} | n ${String(out.length).padStart(3)} skip ${skip} | won ${R(w.length / out.length * 100)}% | win ${R(sum(w) / (w.length || 1))} loss ${R(-sum(l) / (l.length || 1))} | worst ${R(Math.min(...n))} | /yr ${R(totalNet / YEARS)} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | since23 ${R(sum(out.filter((o) => o.y >= '2023').map((o) => o.net)))} | adj ${adj} refused ${refused} stops ${stops}` });
}
out2.sort((a, b) => b.net - a.net);
console.log('Years', YEARS.toFixed(1), 'sets', out2.length, 'profitable', out2.filter((o) => o.net > 0).length);
for (const o of out2) console.log(o.line);
await prisma.$disconnect(); process.exit(0);
