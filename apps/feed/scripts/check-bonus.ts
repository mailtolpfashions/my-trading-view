// One-off check against real NSE files: RELIANCE 1:1 bonus, ex-date 28 Oct 2024.
// Run: npx tsx scripts/check-bonus.ts
import { adjustedCandles, findAdjustments, type RawBar } from '../src/eod/adjust';
import { fetchEodDay } from '../src/eod/store';

const bars: RawBar[] = [];
const actions = [];
for (const d of ['2024-10-25', '2024-10-28']) {
  const got = await fetchEodDay(d);
  const r = got.day.rows.find((x) => x.symbol === 'RELIANCE')!;
  console.log(d, { open: r.open, close: r.close, rows: got.day.rows.length, rejected: got.day.rejected.length, actions: got.actions.length });
  bars.push({ date: d, symbol: 'RELIANCE', openPaise: Math.round(r.open * 100), highPaise: Math.round(r.high * 100), lowPaise: Math.round(r.low * 100), closePaise: Math.round(r.close * 100), prevClosePaise: Math.round(r.prevClose * 100), volume: r.volume });
  actions.push(...got.actions.filter((a) => a.symbol === 'RELIANCE'));
}
console.log('RELIANCE actions', actions);
const { adjustments, unhandled } = findAdjustments(bars, actions);
console.log('adjustments', adjustments, 'unhandled', unhandled);
console.log('adjusted closes', adjustedCandles(bars, adjustments).map((c) => c.close));
process.exit(0);
