// Which demerger factor makes SIEMENS's Aug 2026 monthly signal fire (RSI crosses 60 AND close crosses BB upper 20,2)?
import { prisma } from '@mtv/db';
import * as I from '@mtv/indicators';
import { resample } from '@mtv/rules';
import { dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';
await loadEod(() => {});
const h = dailyHistory('SIEMENS')!, ex = h.adjustments.find((a) => a.basis === 'ex-day price')!;
for (const f of [0.44, 0.46, 0.48, 0.4971, 0.50, 0.52, 0.54, 0.56]) {
  const c = h.candles.map((b) => dateOfIst(b.time) < ex.date ? { ...b, open: b.open * f / ex.factor, high: b.high * f / ex.factor, low: b.low * f / ex.factor, close: b.close * f / ex.factor } : b);
  const m = resample(c, 'M'), cl = m.map((b) => b.close), r = I.rsi(cl, 14), u = I.bollinger(cl, 20, 2).upper;
  const i = m.findIndex((b) => dateOfIst(b.time).startsWith('2026-08'));
  const rsiX = r[i - 1]! <= 60 && r[i]! > 60, bbX = cl[i - 1] <= u[i - 1]! && cl[i] > u[i]!;
  console.log(`factor ${f}: Jul RSI ${r[i - 1]!.toFixed(2)} Aug RSI ${r[i]!.toFixed(2)} | Aug close ${cl[i]} vs band ${u[i]!.toFixed(2)} | signal ${rsiX && bbX ? 'YES' : 'no'}`);
}
await prisma.$disconnect(); process.exit(0);
