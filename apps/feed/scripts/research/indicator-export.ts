// Accuracy check, part 1: NIFTY 50 daily candles (IndexEod) and RELIANCE daily (with volume), run through every
// indicator in @mtv/indicators at TradingView default settings. Writes .data/research/indicator-export.json, which
// scripts/research/indicator-ref.py recomputes independently from the published formulas and compares.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/indicator-export.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import * as I from '@mtv/indicators';
import type { Candle } from '@mtv/shared';
import { dailyHistory, loadEod } from '../../src/eod/store';

const rows = await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, orderBy: { date: 'asc' } });
const nifty: Candle[] = rows.map((r) => ({ time: Date.parse(`${r.date}T00:00:00Z`) / 1000, open: r.openPaise / 100, high: r.highPaise / 100, low: r.lowPaise / 100, close: r.closePaise / 100, volume: 0 }));
await loadEod(() => {});
const rel = dailyHistory('RELIANCE')?.candles ?? [];

function all(c: Candle[]) {
  const cl = c.map((b) => b.close);
  const st = I.supertrend(c, 10, 3), dm = I.dmi(c, 14, 14), ar = I.aroon(c, 14), ich = I.ichimoku(c), bb = I.bollinger(cl, 20, 2), m = I.macd(cl), sto = I.stochastic(c, 14, 1, 3), srsi = I.stochRsi(cl);
  return {
    sma20: I.sma(cl, 20), ema20: I.ema(cl, 20), wma20: I.wma(cl, 20), rsi14: I.rsi(cl, 14),
    macd: m.macd, macdSignal: m.signal, bbUpper: bb.upper, bbLower: bb.lower, bbWidth: I.bbWidth(cl), percentB: I.percentB(cl),
    atr14: I.atr(c, 14), stValue: st.value, stDir: st.direction,
    stochK: sto.k, stochD: sto.d, stochRsiK: srsi.k, stochRsiD: srsi.d, willR: I.williamsR(c, 14),
    cci20: I.cci(c.map((b) => (b.high + b.low + b.close) / 3), 20), roc9: I.roc(cl, 9), tsi: I.tsi(cl),
    diPlus: dm.plus, diMinus: dm.minus, adx: dm.adx, aroonUp: ar.up, aroonDown: ar.down, psar: I.psar(c),
    ichConv: ich.conversion, ichBase: ich.base, chop: I.choppiness(c, 14), hv10: I.historicalVolatility(cl, 10),
    mfi14: c[0]?.volume ? I.mfi(c, 14) : null, obv: c[0]?.volume ? I.obv(c) : null,
  };
}
const out = { nifty: { candles: nifty, ind: all(nifty) }, reliance: { candles: rel, ind: all(rel) } };
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/indicator-export.json'), JSON.stringify(out));
console.log('NIFTY', nifty.length, nifty[0] && rows[0].date, '→', rows.at(-1)?.date, '| RELIANCE', rel.length);
await prisma.$disconnect();
process.exit(0);
