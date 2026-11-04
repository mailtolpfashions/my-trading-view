// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { writeFileSync } from 'node:fs';
import { prisma } from '@mtv/db';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { deltaOf, parityForward, yearsBetween } from '@mtv/options';

const U = 'NIFTY', SLIP = 100;
const meta = await prisma.fnoDayMeta.findMany({ where: { underlying: U }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
const dates = meta.map((m) => m.date), idx = new Map(dates.map((d, i) => [d, i])), M = new Map(meta.map((m) => [m.date, m]));
const today = meta.at(-1)!, todayN = today.spotPaise! * 65;
const exps = (await prisma.fnoEod.findMany({ where: { underlying: U, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => r.expiry).filter((e) => idx.has(e)).sort();
const last = new Map<string, string>(); for (const e of exps) last.set(e.slice(0, 7), e);
const monthly = [...last.values()];
console.log('history', dates[0], 'to', dates.at(-1), dates.length, 'days;', monthly.length, 'monthly expiries');
const DAY = 86400_000, dte = (d: string, e: string) => Math.round((Date.parse(e) - Date.parse(d)) / DAY);
type Q = { kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
const cache = new Map<string, Q[]>();
const load = async (d: string, e: string) => {
  const k = d + e; let r = cache.get(k);
  if (!r) { r = (await prisma.fnoEod.findMany({ where: { underlying: U, date: d, expiry: e, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true } })) as Q[]; cache.set(k, r); }
  return r;
};
const toQ = (r: Q) => ({ strikePaise: r.strikePaise, pricePaise: r.traded ? r.closePaise : r.settlePaise, traded: r.traded });
const intr = (k: string, K: number, S: number) => Math.max(0, k === 'CE' ? S - K : K - S);

// ---- Time value curve: ATM straddle by calendar days to expiry, per era, as % of its value at 45 days ----
const derived = await prisma.fnoDerivedDay.findMany({ where: { underlying: U, expiry: { in: monthly }, straddleTraded: true, daysToExpiry: { gte: 0, lte: 70 } }, select: { date: true, expiry: true, daysToExpiry: true, straddlePaise: true, spotPaise: true } });
const eras = [['2016-2019', '2016', '2019'], ['2020-2022', '2020', '2022'], ['2023-2026', '2023', '2026']] as const;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const curves: Record<string, { dte: number; pctOfSpot: number | null; n: number }[]> = {};
for (const [name, a, b] of eras) {
  const rows = derived.filter((r) => r.date.slice(0, 4) >= a && r.date.slice(0, 4) <= b && r.spotPaise && r.straddlePaise);
  const out: { dte: number; pctOfSpot: number | null; n: number }[] = [];
  for (let t = 0; t <= 70; t++) { const v = rows.filter((r) => r.daysToExpiry === t).map((r) => (r.straddlePaise! / r.spotPaise!) * 100); out.push({ dte: t, pctOfSpot: median(v), n: v.length }); }
  curves[name] = out;
}

// ---- Enter X days out, exit Y days out, one trade per monthly expiry ----
const ENTRIES = [60, 45, 30, 21, 14, 7], EXITS = [21, 14, 7, 0];
const pickDate = (e: string, x: number) => { const t = new Date(Date.parse(e) - x * DAY).toISOString().slice(0, 10); return dates.find((d) => d >= t) ?? null; };
type Shape = { name: string; delta: number; wing: number | null };
const shapes: Shape[] = [{ name: 'Naked 0.16 delta', delta: 0.16, wing: null }, { name: 'Far 0.10 delta, hedged 2%', delta: 0.10, wing: 2 }];
const results: any[] = [];
for (const sh of shapes) for (const X of ENTRIES) for (const Y of EXITS) {
  if (Y >= X) continue;
  const out: { y: string; net: number; days: number }[] = []; let skip = 0, stale = 0;
  for (const e of monthly) {
    const d = pickDate(e, X), x = Y === 0 ? e : pickDate(e, Y);
    if (!d || !x || d >= x || dte(d, e) > X + 5) { skip++; continue; }
    const m = M.get(d)!, end = M.get(x)!;
    if (!m.spotPaise || !m.lotSize || !end.spotPaise) { skip++; continue; }
    const rows = await load(d, e), T = yearsBetween(d, e);
    const calls = rows.filter((r) => r.kind === 'CE').map(toQ), puts = rows.filter((r) => r.kind === 'PE').map(toQ);
    const F = parityForward(calls, puts, m.spotPaise, T) ?? m.spotPaise;
    const legs: { k: string; K: number; q: number; px: number }[] = []; let ok = true;
    for (const [k, s] of [['CE', 1], ['PE', -1]] as const) {
      const c = rows.filter((r) => r.kind === k && r.traded && r.closePaise > 0);
      let best: Q | null = null, gap = 9;
      for (const r of c) { if (s * (r.strikePaise - F) <= 0) continue; const dl = deltaOf(k, r.closePaise, F, r.strikePaise, T); if (dl == null) continue; const g = Math.abs(Math.abs(dl) - sh.delta); if (g < gap) { gap = g; best = r; } }
      if (!best || gap > 0.05) { ok = false; break; }
      legs.push({ k, K: best.strikePaise, q: -1, px: best.closePaise });
      if (sh.wing != null) {
        const tgt = best.strikePaise + s * m.spotPaise * (sh.wing / 100);
        const w = [...c].sort((a, b) => Math.abs(a.strikePaise - tgt) - Math.abs(b.strikePaise - tgt))[0];
        if (!w || Math.abs(w.strikePaise - tgt) > m.spotPaise * 0.01) { ok = false; break; }
        if (w.closePaise >= best.closePaise) { stale++; ok = false; break; } // a further strike cannot cost more: a stale price
        legs.push({ k, K: w.strikePaise, q: 1, px: w.closePaise });
      }
    }
    if (!ok) { skip++; continue; }
    const lot = m.lotSize, scale = todayN / (m.spotPaise * lot), exitRows = Y === 0 ? [] : await load(x, e);
    let cash = 0, ch = 0;
    for (const l of legs) {
      const side = l.q < 0 ? 'SELL' : 'BUY', p = l.q < 0 ? Math.max(5, l.px - SLIP) : l.px + SLIP;
      cash += (l.q < 0 ? 1 : -1) * lot * p; ch += computeOptionCharges({ side, qty: lot, premiumPaise: p, date: d }).total;
      if (Y === 0) { const ii = intr(l.k, l.K, end.spotPaise); cash += (l.q > 0 ? 1 : -1) * lot * ii; if (l.q > 0) ch += exerciseStt(lot, ii, e); }
      else {
        const r = exitRows.find((z) => z.kind === l.k && z.strikePaise === l.K);
        const mk = r ? (r.traded ? r.closePaise : r.settlePaise) : l.px;
        const px = l.q < 0 ? mk + SLIP : Math.max(5, mk - SLIP);
        cash += (l.q < 0 ? -1 : 1) * lot * px; ch += computeOptionCharges({ side: l.q < 0 ? 'BUY' : 'SELL', qty: lot, premiumPaise: px, date: x }).total;
      }
    }
    out.push({ y: x.slice(0, 4), net: (cash - ch) * scale / 100, days: dte(d, x) });
  }
  if (!out.length) continue;
  const net = out.reduce((s, o) => s + o.net, 0), days = out.reduce((s, o) => s + o.days, 0);
  const yrs: Record<string, number> = {}; for (const o of out) yrs[o.y] = (yrs[o.y] ?? 0) + o.net;
  const recent = out.filter((o) => o.y >= '2023').reduce((s, o) => s + o.net, 0);
  const wins = out.filter((o) => o.net > 0);
  results.push({ shape: sh.name, enter: X, exit: Y, n: out.length, skip, stale, wonPct: Math.round(wins.length / out.length * 100), netTotal: Math.round(net), perTrade: Math.round(net / out.length), perDay: Math.round(net / days), worst: Math.round(Math.min(...out.map((o) => o.net))), losingYears: Object.values(yrs).filter((v) => v < 0).length, years: Object.keys(yrs).length, since2023: Math.round(recent) });
}
writeFileSync(process.argv[2], JSON.stringify({ from: dates[0], to: dates.at(-1), curves, results }));
for (const r of results) console.log(`${r.shape.padEnd(26)} in ${String(r.enter).padStart(2)} out ${String(r.exit).padStart(2)} | n ${r.n} skip ${r.skip} stale ${r.stale} | won ${r.wonPct}% | per trade ${r.perTrade} | per day ${r.perDay} | worst ${r.worst} | lose yrs ${r.losingYears}/${r.years} | net ${r.netTotal} | since 2023 ${r.since2023}`);
for (const [n, c] of Object.entries(curves)) console.log(n, [60, 45, 30, 21, 14, 7, 3, 1].map((t) => `${t}d ${c[t]?.pctOfSpot?.toFixed(2)}% (n${c[t]?.n})`).join(' | '));
await prisma.$disconnect(); process.exit(0);
