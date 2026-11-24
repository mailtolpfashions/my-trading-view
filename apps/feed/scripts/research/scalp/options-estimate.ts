// Scalping study, step 5: each spot trade from setups.ts priced on the 1-in-the-money NIFTY weekly option, as a
// BUYER (long signal → buy the 1-ITM call; short → buy the 1-ITM put) and as a SELLER (long signal → sell the 1-ITM
// put; short → sell the 1-ITM call), side by side, net of Zerodha charges and 0.5 pt slippage per fill.
// ESTIMATE, not fills: Black-76 with that day's closing ATM IV (FnoDerivedDay) held fixed through the trade; forward =
// spot × that expiry's forward/spot ratio of the day. Strike: forward rounded to 100 = ATM; 1-ITM call = ATM − 100,
// put = ATM + 100. Expiry: nearest weekly; on expiry day the next one (both sides); on the day before, the next one for
// the buyer (as the series says). Lot = that expiry's lot size.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/options-estimate.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { black76 } from '@mtv/options';
import { computeOptionCharges } from '@mtv/paper';

type T = { setup: string; date: string; dir: 1 | -1; entryTime: number; exitTime: number; entry: number; exit: number; pts: number; rangeVsAvg: number | null };
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
const input = process.argv[2] ?? 'setups-trades.json', stem = input === 'setups-trades.json' ? 'options-estimate' : input.replace('-trades.json', '-options');
const trades = JSON.parse(await readFile(path.join(dir, input), 'utf8')) as T[];
const SLIP = 0.5, R = 0.065, YEAR = 365 * 86400;

const rows = await prisma.fnoDerivedDay.findMany({
  where: { underlying: 'NIFTY', date: { gte: '2023-01-01' } },
  select: { date: true, expiry: true, daysToExpiry: true, lotSize: true, spotPaise: true, forwardPaise: true, atmIv: true },
});
await prisma.$disconnect();
const byDate = new Map<string, typeof rows>();
for (const r of rows) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
for (const l of byDate.values()) l.sort((a, b) => a.expiry.localeCompare(b.expiry));
console.log(`FnoDerivedDay NIFTY rows: ${rows.length}, days ${byDate.size}`);

const expirySec = (e: string) => Date.parse(`${e}T15:30:00+05:30`) / 1000;
type Leg = { premiumIn: number; premiumOut: number; lot: number; iv: number; strike: number; right: 'CE' | 'PE'; expiry: string; dte: number };
function leg(t: T, side: 'buyer' | 'seller'): Leg | string {
  const list = (byDate.get(t.date) ?? []).filter((r) => r.expiry >= t.date && r.atmIv && r.spotPaise && r.forwardPaise);
  if (!list.length) return 'no IV row';
  let k = 0;
  if (list[0].daysToExpiry === 0) k = 1;
  else if (list[0].daysToExpiry === 1 && side === 'buyer') k = 1;
  const r = list[k];
  if (!r) return 'no next expiry';
  const ratio = r.forwardPaise! / r.spotPaise!, iv = r.atmIv! > 3 ? r.atmIv! / 100 : r.atmIv!;
  const F0 = t.entry * ratio, atm = Math.round(F0 / 100) * 100;
  // buyer goes with the signal; seller sells the opposite side's 1-ITM option
  const right: 'CE' | 'PE' = (side === 'buyer') === (t.dir === 1) ? 'CE' : 'PE';
  const strike = right === 'CE' ? atm - 100 : atm + 100;
  const px = (spot: number, at: number) => black76(right, spot * ratio, strike, Math.max(60, expirySec(r.expiry) - at) / YEAR, R, iv).price;
  return { premiumIn: px(t.entry, t.entryTime), premiumOut: px(t.exit, t.exitTime), lot: r.lotSize ?? 75, iv, strike, right, expiry: r.expiry, dte: r.daysToExpiry };
}
const fee = (side: 'BUY' | 'SELL', qty: number, px: number, date: string) => computeOptionCharges({ side, qty, premiumPaise: Math.round(px * 100), date }).total / 100;

type Out = { setup: string; date: string; dir: number; spotPts: number; buyer: number | null; seller: number | null; buyerRs: number | null; sellerRs: number | null; buyerGross: number | null; sellerGross: number | null; lot: number | null };
const out: Out[] = [];
const missing = new Map<string, number>();
for (const t of trades) {
  const o: Out = { setup: t.setup, date: t.date, dir: t.dir, spotPts: t.pts, buyer: null, seller: null, buyerRs: null, sellerRs: null, buyerGross: null, sellerGross: null, lot: null };
  for (const side of ['buyer', 'seller'] as const) {
    const l = leg(t, side);
    if (typeof l === 'string') { missing.set(l, (missing.get(l) ?? 0) + 1); continue; }
    const inFill = side === 'buyer' ? l.premiumIn + SLIP : Math.max(0.05, l.premiumIn - SLIP);
    const outFill = side === 'buyer' ? Math.max(0.05, l.premiumOut - SLIP) : l.premiumOut + SLIP;
    const gross = side === 'buyer' ? l.premiumOut - l.premiumIn : l.premiumIn - l.premiumOut;
    const pts = side === 'buyer' ? outFill - inFill : inFill - outFill;
    const charges = fee(side === 'buyer' ? 'BUY' : 'SELL', l.lot, inFill, t.date) + fee(side === 'buyer' ? 'SELL' : 'BUY', l.lot, outFill, t.date);
    const rs = pts * l.lot - charges;
    o.lot = l.lot;
    if (side === 'buyer') { o.buyer = rs / l.lot; o.buyerRs = rs; o.buyerGross = gross; } else { o.seller = rs / l.lot; o.sellerRs = rs; o.sellerGross = gross; }
  }
  out.push(o);
}
if (missing.size) console.log('not priced:', Object.fromEntries(missing));

const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const lines: string[] = [];
const log = (s = '') => { lines.push(s); console.log(s); };
log('Per trade, option premium points (net = after 0.5 pt slippage per fill and Zerodha charges). ESTIMATE (Black-76, day IV).');
log('setup                                     n    spot  | buyer gross  net  win  2023-25  2026 | seller gross  net  win  2023-25  2026 | ₹/lot total buyer / seller, by year');
const years = ['2023', '2024', '2025', '2026'];
for (const name of [...new Set(out.map((o) => o.setup))]) {
  const o = out.filter((x) => x.setup === name && x.buyer != null && x.seller != null);
  const dev = o.filter((x) => x.date < '2026'), hold = o.filter((x) => x.date >= '2026');
  const side = (k: 'buyer' | 'seller', g: 'buyerGross' | 'sellerGross') =>
    `${f(avg(o.map((x) => x[g]!))).padStart(6)} ${f(avg(o.map((x) => x[k]!))).padStart(5)} ${f(100 * o.filter((x) => x[k]! > 0).length / o.length, 0).padStart(3)}% ${f(avg(dev.map((x) => x[k]!))).padStart(6)} ${f(avg(hold.map((x) => x[k]!))).padStart(6)}`;
  log(`${name.padEnd(40)} ${String(o.length).padStart(4)} ${f(avg(o.map((x) => x.spotPts))).padStart(6)}  | ${side('buyer', 'buyerGross')} | ${side('seller', 'sellerGross')} | ${years.map((y) => { const z = o.filter((x) => x.date.startsWith(y)); return `${y.slice(2)}: ${f(sum(z.map((x) => x.buyerRs!)) / 1000, 0)}k/${f(sum(z.map((x) => x.sellerRs!)) / 1000, 0)}k`; }).join(' ')}`);
}
await writeFile(path.join(dir, `${stem}.json`), JSON.stringify(out));
await writeFile(path.join(dir, `${stem}.txt`), lines.join('\n'));
