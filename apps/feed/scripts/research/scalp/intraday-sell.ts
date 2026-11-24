// Intraday option selling on REAL prices: NSE's daily option open/high/low/close (FnoEod), NIFTY weekly options,
// 2019-02-11 → yesterday. Sell at the day's open (9:15, the first trade), buy back at the close; a per-leg stop is
// judged from the leg's day high: the open is the first trade, so a high at or above the stop came after entry and the
// stop was hit (exit at the stop + slippage; the time of the stop is not known). This cannot show a 9:20/9:30 entry
// or a 15:00 exit (the user's window): it is the 9:15 → 15:30 version, labelled as such.
// Positions: ATM straddle (strike nearest the NIFTY open) and a strangle 100 pts either side. Stops: none, 20%, 30%,
// 50% of each leg's entry. Costs: Zerodha charges (dated) + slippage ₹1 per fill (₹3 stress; stop fills +₹2 more).
// Rupees per lot at TODAY's index level and lot (premiums scaled by today's spot ÷ that day's spot), as the quant
// report does. DTE = trading days to the expiry (0 = expiry day).
// Run (apps/feed, after market hours): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/intraday-sell.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { positionMargin } from '@mtv/options';
import { computeOptionCharges } from '@mtv/paper';
import { spanOn } from '../../../src/fno/span';

const U = 'NIFTY', FROM = '2019-02-11';
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const idx = (await prisma.indexEod.findMany({ where: { name: 'NIFTY 50', date: { gte: FROM, lt: today } }, orderBy: { date: 'asc' }, select: { date: true, openPaise: true, closePaise: true } }));
const dates = idx.map((r) => r.date), pos = new Map(dates.map((d, i) => [d, i]));
const lastMeta = await prisma.fnoDayMeta.findFirst({ where: { underlying: U }, orderBy: { date: 'desc' } });
const LOT = lastMeta!.lotSize!, SPOT_NOW = lastMeta!.spotPaise! / 100;
console.log(`days ${dates.length} (${dates[0]} → ${dates.at(-1)}), today's lot ${LOT}, spot ${SPOT_NOW} (${lastMeta!.date})`);

type Leg = { kind: 'CE' | 'PE'; strike: number; open: number; high: number; close: number };
type Day = { date: string; year: string; dte: number; spot: number; expiry: string; straddle: Leg[] | null; strangle: Leg[] | null };
const days: Day[] = [];
const skipped: Record<string, number> = {};
const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
for (const r of idx) {
  const exp = await prisma.fnoEod.findFirst({ where: { date: r.date, underlying: U, kind: 'CE', expiry: { gte: r.date } }, orderBy: { expiry: 'asc' }, select: { expiry: true } });
  if (!exp) { skip('no expiry'); continue; }
  const e = exp.expiry;
  const dte = pos.has(e) ? pos.get(e)! - pos.get(r.date)! : Math.round((Date.parse(e) - Date.parse(r.date)) / 86400_000 * 5 / 7);
  if (dte > 6) { skip('nearest expiry > 6 trading days (monthly-only period)'); continue; }
  const open = r.openPaise / 100, atm = Math.round(open / 50) * 50;
  const rows = await prisma.fnoEod.findMany({ where: { date: r.date, underlying: U, expiry: e, kind: { in: ['CE', 'PE'] }, strikePaise: { in: [atm - 100, atm, atm + 100].map((k) => k * 100) } } });
  const leg = (kind: 'CE' | 'PE', k: number): Leg | null => {
    const x = rows.find((y) => y.kind === kind && y.strikePaise === k * 100);
    if (!x || !x.traded || x.openPaise <= 0 || Number(x.volume) <= 0) return null;
    return { kind, strike: k, open: x.openPaise / 100, high: x.highPaise / 100, close: x.closePaise / 100 };
  };
  const s = [leg('CE', atm), leg('PE', atm)], g = [leg('CE', atm + 100), leg('PE', atm - 100)];
  const ok = (l: (Leg | null)[]) => (l.every(Boolean) ? (l as Leg[]) : null);
  if (!ok(s)) skip('straddle leg not traded');
  days.push({ date: r.date, year: r.date.slice(0, 4), dte, spot: open, expiry: e, straddle: ok(s), strangle: ok(g) });
}
console.log('skipped:', skipped);

type Res = { date: string; year: string; dte: number; rs: number; pts: number; stopped: number };
function run(which: 'straddle' | 'strangle', stop: number | null, slip: number): Res[] {
  const out: Res[] = [];
  for (const d of days) {
    const legs = d[which];
    if (!legs) continue;
    const scale = SPOT_NOW / d.spot;
    let rs = 0, pts = 0, stopped = 0;
    for (const l of legs) {
      const sell = Math.max(0.05, l.open - slip / scale);
      const hit = stop != null && l.high >= l.open * (1 + stop);
      const buy = hit ? l.open * (1 + stop!) + (slip + 2) / scale : l.close + slip / scale;
      stopped += hit ? 1 : 0;
      pts += sell - buy;
      const fee = computeOptionCharges({ side: 'SELL', qty: LOT, premiumPaise: Math.round(sell * scale * 100), date: d.date }).total / 100 + computeOptionCharges({ side: 'BUY', qty: LOT, premiumPaise: Math.round(buy * scale * 100), date: d.date }).total / 100;
      rs += (sell - buy) * scale * LOT - fee;
    }
    out.push({ date: d.date, year: d.year, dte: d.dte, rs, pts, stopped });
  }
  return out;
}

const lines: string[] = [];
const log = (s = '') => { lines.push(s); console.log(s); };
const f0 = (n: number) => Math.round(n).toLocaleString('en-IN');
const years = [...new Set(days.map((d) => d.year))];
function summary(name: string, r: Res[]) {
  const tot = r.reduce((a, x) => a + x.rs, 0), yrs = r.length / 250;
  let peak = 0, eq = 0, dd = 0;
  for (const x of r) { eq += x.rs; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const worst = r.reduce((a, x) => (x.rs < a.rs ? x : a), r[0]);
  const byDte = [0, 1, 2, 3, 4].map((k) => { const z = r.filter((x) => Math.min(x.dte, 4) === k); return `${k}${k === 4 ? '+' : ''}: ${f0(z.reduce((a, x) => a + x.rs, 0) / Math.max(z.length, 1))} (${Math.round(100 * z.filter((x) => x.rs > 0).length / Math.max(z.length, 1))}% n${z.length})`; });
  log(`${name.padEnd(34)} n ${r.length}  ₹/day ${f0(tot / r.length).padStart(6)}  ₹/yr ${f0(tot / yrs).padStart(9)}  win ${Math.round(100 * r.filter((x) => x.rs > 0).length / r.length)}%  worst day ${f0(worst.rs)} (${worst.date})  max DD ${f0(dd)}`);
  log(`${''.padEnd(34)} by year ${years.map((y) => `${y.slice(2)}: ${f0(r.filter((x) => x.year === y).reduce((a, x) => a + x.rs, 0) / 1000)}k`).join('  ')}`);
  log(`${''.padEnd(34)} avg ₹ by DTE ${byDte.join('  ')}`);
}
log(`NIFTY weekly options, sell at the 9:15 open, buy back at the close; real NSE daily prices. ₹ per lot (${LOT}) at today's index level, after charges.`);
const all: Record<string, Res[]> = {};
for (const which of ['straddle', 'strangle'] as const) {
  for (const slip of [1, 3]) {
    log(`\n${which.toUpperCase()} (±${which === 'straddle' ? 0 : 100} pts), slippage ₹${slip} per fill${slip === 3 ? ' (stress)' : ''}`);
    for (const stop of [null, 0.2, 0.3, 0.5]) {
      const name = `${which} ${stop == null ? 'no stop' : `${stop * 100}% leg stop`} slip ${slip}`;
      const r = run(which, stop, slip);
      all[name] = r;
      summary(stop == null ? 'no stop' : `${stop * 100}% stop on each leg`, r);
    }
  }
}

// Margin today for one lot (SPAN + exposure from NSE's latest file), for return-on-capital context.
try {
  const D = lastMeta!.date, span = (await spanOn(D, U))?.data?.[U];
  const e = (await prisma.fnoEod.findFirst({ where: { date: D, underlying: U, kind: 'CE', expiry: { gt: D } }, orderBy: { expiry: 'asc' }, select: { expiry: true } }))!.expiry;
  const atm = Math.round(SPOT_NOW / 50) * 50;
  if (span) for (const [n, legs] of [['straddle', [['CE', atm], ['PE', atm]]], ['strangle', [['CE', atm + 100], ['PE', atm - 100]]]] as const) {
    const m = positionMargin(span, legs.map(([k, s]) => ({ kind: k, expiry: e, strike: s, qty: -LOT })) as never, lastMeta!.spotPaise!, D);
    log(`\nMargin for 1 lot ${n} today (${D}, expiry ${e}): ₹${f0(m.marginPaise / 100)} (SPAN + exposure; NSE file)`);
  }
} catch (err) { log(`\nMargin: not available (${(err as Error).message})`); }

const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'intraday-sell.json'), JSON.stringify({ skipped, LOT, SPOT_NOW, runs: all }));
await writeFile(path.join(dir, 'intraday-sell.txt'), lines.join('\n'));
await prisma.$disconnect();
