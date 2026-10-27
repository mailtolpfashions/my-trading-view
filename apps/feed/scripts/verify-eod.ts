// Cross-checks NSE-derived adjusted daily closes against an independent source (Yahoo, split/bonus-adjusted closes)
// for a set of stocks, including ones with known splits and bonuses. Reports every date where they differ.
// Run (feed stopped or running, it only reads): npx tsx scripts/verify-eod.ts [SYMBOL ...]
import { FreeProvider } from '../src/providers/free';
import { dailyHistory, loadEod } from '../src/eod/store';
import { istDate } from '../src/signals/stats';

const SYMBOLS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'RELIANCE', 'HDFCBANK', 'INFY', 'TCS', 'ICICIBANK', 'SBIN', 'ITC', 'LT', 'BAJFINANCE', 'MARUTI',
  'IRFC', 'TATAMOTORS', 'ADANIENT', 'BEL', 'HAL', 'COALINDIA', 'NESTLEIND', 'BOSCHLTD', 'MRF', 'PAGEIND',
];

await loadEod(() => {});
const yahoo = new FreeProvider();
let total = 0, bad = 0;
for (const symbol of SYMBOLS) {
  const h = dailyHistory(symbol);
  if (!h) { console.log(`${symbol}: no NSE history`); continue; }
  let y;
  try { y = await yahoo.candles(symbol, 'D', true); } catch (e) { console.log(`${symbol}: Yahoo failed (${(e as Error).message})`); continue; }
  const yByDate = new Map(y.map((c) => [istDate(c.time), c.close]));
  const diffs: string[] = [];
  let compared = 0;
  for (const c of h.candles) {
    const d = istDate(c.time), yc = yByDate.get(d);
    if (yc == null) continue;
    compared++;
    if (Math.abs(yc - c.close) / c.close > 0.002) diffs.push(`${d} NSE ${c.close} Yahoo ${yc.toFixed(2)}`);
  }
  total += compared; bad += diffs.length;
  const adj = h.adjustments.map((a) => `${a.exDate} ${a.purpose} ×${a.factor}${a.check ? ' (CHECK)' : ''}`).join('; ');
  console.log(`${symbol.padEnd(11)} ${compared} days compared, ${diffs.length} differ${adj ? ` · adjustments: ${adj}` : ''}${h.unhandled.length ? ` · unhandled: ${h.unhandled.map((u) => u.purpose).join('; ')}` : ''}`);
  for (const line of diffs.slice(0, 5)) console.log(`   ${line}`);
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`\n${total} stock-days compared, ${bad} differ by more than 0.2%`);
process.exit(0);
