// Check of pattern-evidence.ts's outliers: are Dragonfly doji / Marubozu results driven by price-band (circuit)
// days, where the stock is locked at its limit and cannot be traded at the close? A day counts as "at a band" when
// the close is the day's high (or low) and the move from the previous close is within 0.1% of a 2/5/10/20% band.
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=3072 --import tsx scripts/research/pattern-check.ts
import { prisma } from '@mtv/db';
import { findPatterns } from '@mtv/rules';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';

const H = 5, NAMES = ['DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'BULLISH_MARUBOZU', 'BEARISH_MARUBOZU', 'SHOOTING_STAR', 'DARK_CLOUD_COVER'];
const BANDS = [0.02, 0.05, 0.1, 0.2];
await loadEod(() => {});
const crowd = new Map<string, [number, number]>();
type E = { sym: string; date: string; ret: number; move: number; band: boolean; big: boolean };
const evs = new Map<string, E[]>(NAMES.map((n) => [n, []]));
for (const s of allEquityShareSymbols()) {
  const hist = dailyHistory(s);
  if (!hist || hist.candles.length < 60) continue;
  const c = hist.candles, dates = c.map((k) => dateOfIst(k.time));
  const liquid = c.map((k) => k.close >= 5 && k.volume >= 1_000_000);
  for (let i = 0; i + H < c.length; i++) if (liquid[i]) { const m = crowd.get(dates[i]) ?? [0, 0]; m[0] += c[i + H].close / c[i].close - 1; m[1]++; crowd.set(dates[i], m); }
  for (const h of findPatterns(c, NAMES)) {
    const i = h.index;
    if (i < 20 || i + H >= c.length || !liquid[i]) continue;
    const move = c[i].close / c[i - 1].close - 1;
    const atEdge = c[i].close === c[i].high || c[i].close === c[i].low;
    const band = atEdge && BANDS.some((b) => Math.abs(Math.abs(move) - b) < 0.001);
    evs.get(h.name)!.push({ sym: s, date: dates[i], ret: c[i + H].close / c[i].close - 1, move, band, big: Math.abs(move) >= 0.045 });
  }
}
const ex = (e: E) => { const m = crowd.get(e.date)!; return e.ret - m[0] / m[1]; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
for (const n of NAMES) {
  const all = evs.get(n)!;
  const band = all.filter((e) => e.band), rest = all.filter((e) => !e.band), small = rest.filter((e) => !e.big);
  console.log(`\n${n}: ${all.length} signals`);
  console.log(`  at a price band   ${String(band.length).padStart(6)}  mean excess ${pc(mean(band.map(ex)))}  median ${pc(med(band.map(ex)))}`);
  console.log(`  not at a band     ${String(rest.length).padStart(6)}  mean excess ${pc(mean(rest.map(ex)))}  median ${pc(med(rest.map(ex)))}`);
  console.log(`  ...and day move < 4.5% ${String(small.length).padStart(6)}  mean excess ${pc(mean(small.map(ex)))}  median ${pc(med(small.map(ex)))}`);
  const s = [...all].sort((a, b) => a.date.localeCompare(b.date));
  console.log('  first:', s.slice(0, 2).map((e) => `${e.sym} ${e.date} day ${pc(e.move)} next5 ${pc(e.ret)}${e.band ? ' BAND' : ''}`).join(' | '));
  console.log('  last: ', s.slice(-2).map((e) => `${e.sym} ${e.date} day ${pc(e.move)} next5 ${pc(e.ret)}${e.band ? ' BAND' : ''}`).join(' | '));
}
await prisma.$disconnect();
