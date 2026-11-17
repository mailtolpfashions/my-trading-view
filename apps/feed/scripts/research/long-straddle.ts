// "Long-term short straddle" from a YouTube video: sell the NIFTY call and put on a far expiry (December), at a strike
// ABOVE the index (he picked ~+7% to +12%) because NIFTY rose in ~80% of years; held to expiry. Run through the option
// lab engine (packages/backtest/src/lab.ts). Entry: last Monday of January or of July, December expiry. Far strikes
// often do not trade, so 'settlement' (NSE's capped settlement price) is allowed and counted; 'skip' is shown too.
// Margin: NSE SPAN for today's position. Money at today's index and lot.
// Run after market hours: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/long-straddle.ts
import { prisma } from '@mtv/db';
import { positionMargin } from '@mtv/options';
import { previewLab, runLab, type LabStrategy } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';
import { spanToday } from '../../src/fno/span';

const data = await labData('NIFTY');
const span = await spanToday();
const legs = (strike: LabStrategy['legs'][number]['strike']): LabStrategy['legs'] => [
  { side: 'SELL', kind: 'CE', lots: 1, strike, expiry: 0 }, { side: 'SELL', kind: 'PE', lots: 1, strike, expiry: 0 },
];
const strikes: [string, LabStrategy['legs'][number]['strike']][] = [
  ['ATM (forward)', { by: 'forward' }], ['+5%', { by: 'pct', pct: 5 }], ['+7%', { by: 'pct', pct: 7 }], ['+10%', { by: 'pct', pct: 10 }], ['+12%', { by: 'pct', pct: 12 }],
];
const L = (n: number) => `₹${(n / 100000).toFixed(2)}L`;
for (const month of [1, 7]) for (const missing of ['settlement', 'skip'] as const) {
  console.log(`\n===== ${month === 1 ? 'January → December' : 'July → December'}, missing strikes: ${missing}`);
  for (const [name, st] of strikes) {
    const s: LabStrategy = { name, underlying: 'NIFTY', schedule: { every: 'year', month, day: 'last-monday', expiryMonth: 12 }, legs: legs(st), iv: 'any', exit: {}, missing, slippage: 1, money: 'today' };
    const r = await runLab(s, data);
    const m = r.summary;
    let margin = '';
    const p = await previewLab(s, data);
    if (span && typeof p !== 'string') {
      const mm = positionMargin(span.data.NIFTY, p.legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strike: l.strike, qty: -l.lots * p.lot, pricePaise: Math.round(l.price * 100) })), Math.round(p.spot * 100), span.tradeDate);
      if (!mm.missing.length) margin = ` margin today ${L(mm.marginPaise / 100)}`;
    }
    const yrs = r.trades.map((t) => `${t.entry.slice(0, 4)} ${t.net >= 0 ? '+' : ''}${Math.round(t.net / 1000)}k${t.model ? '*' : ''}`).join(' ');
    console.log(`${name.padEnd(14)} n ${m.trades} won ${m.won} total ${L(m.total)} /yr ${L(m.perYear)} worst ${L(m.worst ?? 0)} worstOpen ${L(m.worstMtm ?? 0)} settlementPriced ${m.modelPriced}${margin}`);
    console.log(`   ${yrs}`);
    if (r.skipped.length) console.log(`   skipped: ${r.skipped.map((x) => `${x.date} ${x.reason}`).join('; ')}`);
  }
}
await prisma.$disconnect();
