// SUNPHARMA, June 2026: the monthly RSI / Bollinger as they stood each day (the June candle still forming).
import { prisma } from '@mtv/db';
import * as I from '@mtv/indicators';
import { resample } from '@mtv/rules';
import { dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';
await loadEod(() => {});
const sym = process.argv[2] ?? 'SUNPHARMA', month = process.argv[3] ?? '2026-06';
const d = dailyHistory(sym)!.candles;
for (const day of d.filter((b) => dateOfIst(b.time).startsWith(month))) {
  const upto = d.filter((b) => b.time <= day.time), m = resample(upto, 'M'), cl = m.map((b) => b.close);
  const r = I.rsi(cl, 14), u = I.bollinger(cl, 20, Number(process.argv[4] ?? 2)).upper, i = m.length - 1;
  const rsiX = r[i - 1]! <= 60 && r[i]! > 60, bbX = cl[i - 1] <= u[i - 1]! && cl[i] > u[i]!;
  console.log(`${dateOfIst(day.time)} close ${day.close}  month-so-far RSI ${r[i]!.toFixed(2)} (May ${r[i - 1]!.toFixed(2)})  band ${u[i]!.toFixed(2)} (May close ${cl[i - 1]} vs ${u[i - 1]!.toFixed(2)})  ${rsiX && bbX ? 'SIGNAL' : ''}`);
}
await prisma.$disconnect(); process.exit(0);
