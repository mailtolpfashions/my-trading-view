// Checks a vendor's 1-minute NIFTY option files (one folder per expiry YYYYMMDD, files <strike><CE|PE>_<expiry>.csv
// with timestamp,open,high,low,close,volume,oi,strike,option_type, plus nifty_spot.csv) against NSE's daily option
// file (FnoEod) and the NIFTY index (IndexEod), then replays the expiry-day ATM straddle on each expiry day in the
// 9:30 → 15:00 window (no stop and 50% leg stop) beside the 9:15-open → close version the daily study used.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/vendor-check.ts <folder>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';

const root = process.argv[2];
if (!root) throw new Error('usage: vendor-check.ts <folder>');
type Bar = { date: string; hm: number; o: number; h: number; l: number; c: number; v: number };
const parse = (t: string): Bar[] => t.trim().split('\n').slice(1).map((l) => {
  const [ts, o, h, lo, c, v] = l.split(',');
  return { date: ts.slice(0, 10), hm: Number(ts.slice(11, 13)) * 100 + Number(ts.slice(14, 16)), o: +o, h: +h, l: +lo, c: +c, v: +v };
});
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

let days = 0, hlOk = 0, oOk = 0, cOk = 0, noNse = 0;
const bad: string[] = [];
const replay: string[] = [];
for (const folder of (await readdir(root)).sort()) {
  const expiry = `${folder.slice(0, 4)}-${folder.slice(4, 6)}-${folder.slice(6, 8)}`;
  const files = (await readdir(path.join(root, folder))).filter((f) => /^\d+(CE|PE)_/.test(f));
  const bars = new Map<string, Bar[]>();
  for (const f of files) bars.set(f.split('_')[0], parse(await readFile(path.join(root, folder, f), 'utf8')));
  // 1. daily OHLC from minutes vs NSE's daily row, every contract-day
  const nse = await prisma.fnoEod.findMany({ where: { underlying: 'NIFTY', expiry, kind: { in: ['CE', 'PE'] }, traded: true } });
  const nseMap = new Map(nse.map((r) => [`${r.date}|${r.strikePaise / 100}${r.kind}`, r]));
  for (const [key, b] of bars) {
    const byDay = new Map<string, Bar[]>();
    for (const x of b) (byDay.get(x.date) ?? byDay.set(x.date, []).get(x.date)!).push(x);
    for (const [d, m] of byDay) {
      const r = nseMap.get(`${d}|${key}`);
      if (!r) { noNse++; continue; }
      days++;
      const h = Math.max(...m.map((x) => x.h)), l = Math.min(...m.map((x) => x.l));
      const tol = Math.max(0.1, r.highPaise / 100 * 0.002);
      const okHL = near(h, r.highPaise / 100, tol) && near(l, r.lowPaise / 100, tol);
      if (okHL) hlOk++; else if (bad.length < 12) bad.push(`${d} ${key}: vendor H ${h} L ${l} vs NSE H ${r.highPaise / 100} L ${r.lowPaise / 100}`);
      if (near(m[0].o, r.openPaise / 100, tol)) oOk++;
      if (near(m[m.length - 1].c, r.closePaise / 100, Math.max(tol, 1))) cOk++;
    }
  }
  // 2. expiry-day straddle: ATM by the spot at 9:30
  const spot = parse(await readFile(path.join(root, folder, 'nifty_spot.csv'), 'utf8')).filter((x) => x.date === expiry);
  const s930 = spot.find((x) => x.hm === 930), s1500 = spot.find((x) => x.hm === 1500);
  if (!s930) { replay.push(`${expiry}: no spot at 9:30`); continue; }
  const strikes = [...new Set([...bars.keys()].map((k) => Number(k.slice(0, -2))))];
  const atm = strikes.reduce((a, k) => (Math.abs(k - s930.o) < Math.abs(a - s930.o) ? k : a), strikes[0]);
  const legs = (['CE', 'PE'] as const).map((k) => (bars.get(`${atm}${k}`) ?? []).filter((x) => x.date === expiry));
  if (legs.some((l) => !l.find((x) => x.hm === 930) || !l.find((x) => x.hm === 1500))) { replay.push(`${expiry}: ATM ${atm} legs missing a 9:30 or 15:00 minute`); continue; }
  let noStop = 0, stop50 = 0, openClose = 0;
  const parts: string[] = [];
  for (const [i, l] of legs.entries()) {
    const entry = l.find((x) => x.hm === 930)!.o, exit = l.find((x) => x.hm === 1500)!.o;
    const between = l.filter((x) => x.hm >= 930 && x.hm < 1500);
    const stopPx = entry * 1.5, hit = between.some((x) => x.h >= stopPx);
    noStop += entry - exit; stop50 += entry - (hit ? stopPx : exit);
    openClose += l[0].o - l[l.length - 1].c;
    parts.push(`${i ? 'PE' : 'CE'} ${entry.toFixed(1)}→${exit.toFixed(1)}${hit ? ' (stop)' : ''}`);
  }
  replay.push(`${expiry} ${new Date(`${expiry}T12:00:00Z`).toUTCString().slice(0, 3)}: NIFTY 9:30 ${s930.o} → 15:00 ${s1500?.o ?? '?'}, ATM ${atm}: ${parts.join(', ')} | 9:30→15:00 no stop ${noStop.toFixed(1)} pts, 50% stop ${stop50.toFixed(1)} | open→close ${openClose.toFixed(1)}`);
}
await prisma.$disconnect();
console.log(`Contract-days compared with NSE: ${days} (vendor days NSE has no traded row for: ${noNse})`);
console.log(`  high/low match: ${(100 * hlOk / days).toFixed(1)}%   open match: ${(100 * oOk / days).toFixed(1)}%   close within ₹1: ${(100 * cOk / days).toFixed(1)}%`);
if (bad.length) console.log('  examples off:\n   ' + bad.join('\n   '));
console.log('\nExpiry-day ATM straddle, points per unit (before costs):');
for (const r of replay) console.log('  ' + r);
