// Checks stored one-minute history (apps/feed/.data/1m) against NSE's official daily bars as published (not adjusted):
// each day rebuilt from its minutes should have the same high, low and volume. Open and close can differ slightly:
// NSE's official close is a weighted average of the last 30 minutes, not the last trade.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/check-minutes.ts [SYMBOL ...]

import { prisma } from '@mtv/db';
import { adjustToEod } from '../src/intraday/adjust';
import { MinuteStore, dateOfIst } from '../src/intraday/store';

const store = new MinuteStore();
const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'SBIN', 'KOTAKBANK', 'ITC', 'LT', 'AXISBANK', 'MARUTI'];
const pct = (a: number, b: number) => (b ? Math.abs(a / b - 1) * 100 : 0);

for (const symbol of symbols) {
  // Re-based onto NSE's published prices (adj = 1): the same rule the service uses, which should then match NSE.
  const raw = await prisma.equityEod.findMany({ where: { symbol }, select: { date: true, openPaise: true } });
  const minutes = adjustToEod(await store.read(symbol, 0), new Map(raw.map((r) => [r.date, { rawOpen: r.openPaise / 100, adj: 1 }])));
  const days = new Map<string, { o: number; h: number; l: number; c: number; v: number; n: number }>();
  for (const m of minutes) {
    const d = dateOfIst(m.time), x = days.get(d);
    if (!x) days.set(d, { o: m.open, h: m.high, l: m.low, c: m.close, v: m.volume, n: 1 });
    else { x.h = Math.max(x.h, m.high); x.l = Math.min(x.l, m.low); x.c = m.close; x.v += m.volume; x.n++; }
  }
  const eod = await prisma.equityEod.findMany({ where: { symbol, date: { in: [...days.keys()] } } });
  let n = 0, hl = 0, vol = 0, op = 0, cl = 0;
  const odd: string[] = [];
  const gaps: number[] = [];
  for (const e of eod) {
    const m = days.get(e.date)!;
    n++;
    const H = e.highPaise / 100, L = e.lowPaise / 100, O = e.openPaise / 100, C = e.closePaise / 100, V = Number(e.volume);
    const hlOk = pct(m.h, H) < 0.01 && pct(m.l, L) < 0.01;
    if (hlOk) hl++; else if (odd.length < 2) odd.push(`${e.date}: minutes H ${m.h} L ${m.l}, NSE H ${H} L ${L}`);
    if (pct(m.v, V) < 1) vol++;
    if (pct(m.o, O) < 0.05) op++;
    if (pct(m.c, C) < 0.05) cl++;
    gaps.push(pct(m.c, C));
  }
  gaps.sort((a, b) => a - b);
  const all = [...days.keys()].sort();
  const full = [...days.values()].filter((d) => d.n >= 370).length;
  console.log(`${symbol.padEnd(10)} ${all.length} days (${all[0]} → ${all.at(-1)}), ${full} full sessions | vs NSE: high/low exact ${hl}/${n}, volume ±1% ${vol}/${n}, open ±0.05% ${op}/${n}, close ±0.05% ${cl}/${n}, median close gap ${(gaps[gaps.length >> 1] ?? 0).toFixed(3)}%`);
  for (const o of odd) console.log(`           ${o}`);
}

// KOTAKBANK split 1:5 (ex-date 14 Jan 2026): are Kite's minutes before it raw (₹2,000s) or already adjusted (₹400s)?
const k = (await store.read('KOTAKBANK', Date.parse('2026-01-12T00:00:00+05:30') / 1000)).filter((m) => ['2026-01-13', '2026-01-14'].includes(dateOfIst(m.time)));
const last13 = k.filter((m) => dateOfIst(m.time) === '2026-01-13').at(-1), first14 = k.find((m) => dateOfIst(m.time) === '2026-01-14');
const raw13 = await prisma.equityEod.findFirst({ where: { symbol: 'KOTAKBANK', date: '2026-01-13' } });
console.log(`KOTAKBANK split: stored 13 Jan last minute ${last13?.close}, 14 Jan first minute ${first14?.open}; NSE published close on 13 Jan ${raw13 ? raw13.closePaise / 100 : '–'}`);
await prisma.$disconnect();
