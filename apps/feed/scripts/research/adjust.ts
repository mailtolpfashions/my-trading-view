// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
// The YouTube adjustment, as confirmed by the user. Sell a strangle at about 0.41% of the index each side. When one short has
// fallen by the trigger and the other is above its sold price: exit the winner, sell a new one near the original premium
// target, and buy an option on the losing side costing about the extra credit. Repeats, with no cap in the video.
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { ivAboveMedian, staleFlags } from '@mtv/options';

const U = 'NIFTY', SLIP = 100, DAY = 86400_000, TARGET = 100 / 24500;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65, YEARS = dates.length / 248;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
// listed today: expiries still ahead whose trade can already have finished
for (const r of await prisma.fnoEod.findMany({ where: { underlying: U, date: today.date, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } })) if (r.expiry > today.date) last.set(r.expiry.slice(0, 7), r.expiry);
const monthly = [...last.values()].sort();
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
type V = { entry: 'series' | '45d'; exit: 21 | 0; balance?: number; trigger: number | null; stop: number | null; cross: boolean; late: boolean; high: boolean };
const vars: V[] = [];
for (const entry of ['series', '45d'] as const) for (const exit of [21, 0] as const) for (const stop of [15000, 25000, null]) for (const high of [false, true]) {
  vars.push({ entry, exit, trigger: null, stop, cross: false, late: false, high });
  for (const trigger of [0.3, 0.5]) for (const cross of [false, true]) for (const late of [false, true]) vars.push({ entry, exit, trigger, stop, cross, late, high });
  // The user's version: rebalance when the smaller side falls to this share of the two sides' total value.
  for (const balance of [0.4, 0.35, 0.3]) for (const cross of [false, true]) for (const late of [false, true]) vars.push({ entry, exit, trigger: 0, balance, stop, cross, late, high });
}
const R = Math.round, sum = (a: number[]) => a.reduce((x, y) => x + y, 0), out2: { net: number; line: string; base: boolean }[] = [];
for (const v of vars) {
  const out: { y: string; net: number }[] = []; let skip = 0, off = 0, adj = 0, stops = 0, refused = 0;
  for (let n = 0; n < monthly.length; n++) {
    const e = monthly[n], iE = idx.get(e)!;
    const d = v.entry === '45d' ? pickDate(e, 45) : n > 0 ? dates[idx.get(monthly[n - 1])! + 1] : null;
    const x = v.exit === 21 ? pickDate(e, 21) : e;
    if (x && !idx.has(x)) continue; // not finished yet
    if (!d || !x || d >= x || (v.entry === '45d' && (Date.parse(e) - Date.parse(d)) / DAY > 50)) { skip++; continue; }
    const m = M.get(d)!; if (!m.spotPaise || !m.lotSize) { skip++; continue; }
    if (v.high && ivAboveMedian(history, d) !== true) { off++; continue; }
    const rows = await load(d, e), target = m.spotPaise * TARGET, lot = m.lotSize, scale = todayN / (m.spotPaise * lot);
    const c = byPremium(rows, 'CE', target, m.spotPaise), p = byPremium(rows, 'PE', target, m.spotPaise);
    if (!c || !p) { skip++; continue; }
    let cash = 0, ch = 0;
    const legs: Leg[] = [];
    const open = (k: Leg['k'], K: number, q: number, px: number, date: string) => { const side = q > 0 ? 'BUY' : 'SELL', f = q > 0 ? px + SLIP : Math.max(5, px - SLIP); cash += (q > 0 ? -1 : 1) * lot * f; ch += computeOptionCharges({ side, qty: lot, premiumPaise: f, date }).total; legs.push({ k, K, q, sold: px, last: px }); };
    const close = (l: Leg, date: string) => { const side = l.q > 0 ? 'SELL' : 'BUY', f = l.q > 0 ? Math.max(5, l.last - SLIP) : l.last + SLIP; cash += (l.q > 0 ? 1 : -1) * lot * f; ch += computeOptionCharges({ side, qty: lot, premiumPaise: f, date }).total; legs.splice(legs.indexOf(l), 1); };
    open('CE', c.strikePaise, -1, c.closePaise, d); open('PE', p.strikePaise, -1, p.closePaise, d);
    const adjust = (win: Leg, r: Q[], t: string, spot: number) => {
      const lose = legs.find((l) => l.q < 0 && l.k !== win.k)!, s = byPremium(r, win.k, target, spot);
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
      const side = (k: Leg['k']) => legs.filter((l) => l.k === k).reduce((t, l) => t + (l.q < 0 ? 1 : -1) * l.last, 0);
      const ceSide = side('CE'), peSide = side('PE'), total = ceSide + peSide;
      const win = v.balance != null
        ? (total > 0 && Math.min(ceSide, peSide) / total <= v.balance ? (ceSide < peSide ? a : b) : null)
        : a.last <= a.sold * (1 - v.trigger) && b.last > b.sold ? a : b.last <= b.sold * (1 - v.trigger) && a.last > a.sold ? b : null;
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
  const net = sum(n), tag = `${v.entry.padEnd(6)} exit ${v.exit === 21 ? '21d ' : 'exp '} ${v.trigger == null ? 'NO-ADJ ' : v.balance != null ? `adj bal${v.balance * 100}` : `adj ${v.trigger * 100}%`} ${v.cross ? 'cross ' : 'nocross'} ${v.stop == null ? 'nostop' : `stop ${v.stop / 1000}k`} ${v.late ? 'late' : 'same'} ${v.high ? 'highIV' : 'all'}`;
  out2.push({ net, base: v.trigger == null, line: `${tag.padEnd(58)} | n ${String(out.length).padStart(3)} skip ${skip} | won ${R(w.length / out.length * 100)}% | win ${R(sum(w) / (w.length || 1))} loss ${R(-sum(l) / (l.length || 1))} | worst ${R(Math.min(...n))} | /yr ${R(net / YEARS)} | lose yrs ${Object.values(yrs).filter((y) => y < 0).length}/${Object.keys(yrs).length} | since23 ${R(sum(out.filter((o) => o.y >= '2023').map((o) => o.net)))} | adj ${adj} refused ${refused} stops ${stops}` });
}
out2.sort((a, b) => b.net - a.net);
console.log('Years', YEARS.toFixed(1), 'sets', out2.length, 'profitable', out2.filter((o) => o.net > 0).length);
for (const o of out2) console.log(o.line);
await prisma.$disconnect(); process.exit(0);
