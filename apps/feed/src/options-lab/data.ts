// Data for the option strategy lab (packages/backtest/src/lab.ts), read the way the selling studies read it: real expiry
// dates (expiryCalendar), every stored label of an expiry merged, impossible closes set aside (staleFlags). Built once per
// underlying and trading day; option chains are loaded one expiry and date range at a time and kept for later runs.

import { prisma } from '@mtv/db';
import { staleFlags } from '@mtv/options';
import type { LabData, LabQuote } from '@mtv/backtest';
import { expiryCalendar } from '../selling/expiries';
import { ivHistory } from '../selling/books';

type Row = LabQuote & { date: string; expiry: string };
const built = new Map<string, Promise<LabData>>();
const chainCache = new Map<string, Map<string, LabQuote[]>>();
const futCache = new Map<string, Map<string, number>>();
const MAX_CACHED = 600;
const remember = <T>(m: Map<string, T>, k: string, v: T) => { if (m.size >= MAX_CACHED) m.delete(m.keys().next().value!); m.set(k, v); };

export async function labData(underlying: 'NIFTY' | 'BANKNIFTY'): Promise<LabData> {
  const last = await prisma.fnoDayMeta.findFirst({ where: { underlying }, orderBy: { date: 'desc' }, select: { date: true } });
  if (!last) throw new Error(`No F&O history for ${underlying}`);
  const key = `${underlying}|${last.date}`;
  let p = built.get(key);
  if (!p) {
    p = build(underlying, last.date);
    built.clear(); chainCache.clear(); futCache.clear(); // a new day: start fresh
    built.set(key, p);
    p.catch(() => built.delete(key));
  }
  return p;
}

async function build(u: string, lastDay: string): Promise<LabData> {
  const days = await prisma.fnoDayMeta.findMany({ where: { underlying: u }, select: { date: true, spotPaise: true, lotSize: true }, orderBy: { date: 'asc' } });
  const cal = await expiryCalendar(u, new Set(days.map((d) => d.date)), lastDay);
  // Still listed on the latest day: a trade on them can already have finished (an exit with days left).
  const ahead = (await prisma.fnoEod.findMany({ where: { underlying: u, date: lastDay, kind: { in: ['CE', 'PE'] } }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } }))
    .map((r) => r.expiry).filter((e) => e > lastDay);
  const lastOf = new Map<string, string>(cal.monthly.map((e) => [e.slice(0, 7), e]));
  for (const e of ahead) lastOf.set(e.slice(0, 7), e);
  // The monthly expiry is the one with a futures contract. "The month's last expiry" can be a weekly moved forward for
  // a holiday (NIFTY 30 Apr 2025 for 1 May; Bank Nifty 31 Jan and 30 Apr 2024). Months with no future (far contracts
  // listed years ahead) keep their last expiry.
  const futures = new Set((await prisma.fnoEod.findMany({ where: { underlying: u, kind: 'FUT' }, distinct: ['expiry'], select: { expiry: true } })).map((r) => cal.realOf(r.expiry)));
  const all = [...new Set([...cal.expired, ...ahead])];
  for (const m of lastOf.keys()) {
    const withFuture = all.filter((e) => e.startsWith(m) && futures.has(e)).sort().at(-1);
    if (withFuture) lastOf.set(m, withFuture);
  }
  const monthly = [...lastOf.values()].sort();
  const expiries = [...new Set([...cal.expired, ...ahead])].sort();
  const iv = await ivHistory(u);

  return {
    days, monthly, expiries, iv,
    async chains(expiry, from, to) {
      const k = `${expiry}|${from}|${to}`;
      const hit = chainCache.get(k);
      if (hit) return hit;
      const rows = (await prisma.fnoEod.findMany({
        where: { underlying: u, kind: { in: ['CE', 'PE'] }, expiry: { in: cal.labels(expiry) }, date: { gte: from, lte: to } },
        select: { date: true, expiry: true, kind: true, strikePaise: true, closePaise: true, settlePaise: true, traded: true },
      })) as Row[];
      // One row per date, type and strike: a traded row first, then the expiry's own label (as the studies merge them).
      const best = new Map<string, Row>();
      for (const x of rows) {
        const id = `${x.date}|${x.kind}${x.strikePaise}`, o = best.get(id);
        if (!o || (x.traded && !o.traded) || (x.expiry === expiry && o.expiry !== expiry && x.traded === o.traded)) best.set(id, x);
      }
      const byDate = new Map<string, LabQuote[]>();
      for (const x of best.values()) {
        const q: LabQuote = { kind: x.kind, strikePaise: x.strikePaise, closePaise: x.closePaise, settlePaise: x.settlePaise, traded: x.traded };
        const l = byDate.get(x.date); if (l) l.push(q); else byDate.set(x.date, [q]);
      }
      for (const list of byDate.values()) for (const kind of ['CE', 'PE'] as const) {
        const l = list.filter((x) => x.kind === kind && x.traded && x.closePaise > 0).sort((a, b) => a.strikePaise - b.strikePaise);
        staleFlags(l.map((x) => x.closePaise), kind === 'PE').forEach((s, i) => { if (s) l[i].traded = false; });
      }
      remember(chainCache, k, byDate);
      return byDate;
    },
    async futures(expiry, from, to) {
      const k = `${expiry}|${from}|${to}`;
      const hit = futCache.get(k);
      if (hit) return hit;
      const rows = await prisma.fnoEod.findMany({ where: { underlying: u, kind: 'FUT', expiry: { in: cal.labels(expiry) }, date: { gte: from, lte: to } }, select: { date: true, closePaise: true, traded: true, expiry: true } });
      const out = new Map<string, number>();
      for (const r of rows.sort((a, b) => Number(a.expiry === expiry) - Number(b.expiry === expiry))) if (r.closePaise > 0) out.set(r.date, r.closePaise);
      remember(futCache, k, out);
      return out;
    },
  };
}
