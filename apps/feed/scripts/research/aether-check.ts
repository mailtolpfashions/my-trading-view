// Check the AETHER monthly signal behind the backtest entry of 1 Feb 2026 (user screenshot).
import { prisma } from '@mtv/db';
import * as I from '@mtv/indicators';
import { resample } from '@mtv/rules';
import { dailyHistory, loadEod } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';
await loadEod(() => {});
const d = dailyHistory(process.argv[2] ?? 'AETHER')!.candles;
console.log('daily bars around 1 Feb 2026:', d.filter((b) => { const x = dateOfIst(b.time); return x >= '2026-01-28' && x <= '2026-02-04'; }).map((b) => `${dateOfIst(b.time)} O${b.open} C${b.close}`).join(' | '));
const m = resample(d, 'M'), cl = m.map((b) => b.close), r = I.rsi(cl, 14), b2 = I.bollinger(cl, 20, 2), b1 = I.bollinger(cl, 20, 1);
const f = (x: number | null) => (x == null ? '-' : x.toFixed(2));
for (let i = Math.max(0, m.length - 14); i < m.length; i++) {
  const x = dateOfIst(m[i].time);
  const rsiX = r[i - 1] != null && r[i] != null && r[i - 1]! <= 60 && r[i]! > 60;
  const bbX = (b: { upper: (number | null)[] }, k = 0) => b.upper[i - k] != null && b.upper[i - 1 - k] != null && cl[i - 1] <= b.upper[i - 1 - k]! && cl[i] > b.upper[i - k]!;
  console.log(`${x.slice(0, 7)} O${m[i].open} C${cl[i]}  RSI ${f(r[i])}${rsiX ? ' ↑60' : ''}  BBup(20,2) ${f(b2.upper[i])}${bbX(b2) ? ' CROSS' : ''}  BBup(20,1) ${f(b1.upper[i])}${bbX(b1) ? ' CROSS' : ''}  BBup(20,2) 20 months ago ${f(b2.upper[i - 20] ?? null)}${i >= 21 && cl[i - 1] <= (b2.upper[i - 21] ?? Infinity) && cl[i] > (b2.upper[i - 20] ?? Infinity) ? ' CROSS' : ''}`);
}
await prisma.$disconnect(); process.exit(0);
