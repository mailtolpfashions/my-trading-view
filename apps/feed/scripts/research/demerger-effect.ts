// Effect of the demerger adjustment: raw ex-day prices, the factor applied, and the SIEMENS monthly signal it restores.
import { prisma } from '@mtv/db';
import * as I from '@mtv/indicators';
import { resample } from '@mtv/rules';
import { dailyHistory, loadEod, rawDays } from '../../src/eod/store';
import { dateOfIst } from '../../src/intraday/store';
await loadEod(() => {});
for (const s of ['SIEMENS', 'TMPV', 'VEDL', 'HINDUNILVR', 'ITC', 'STLTECH', 'HEGAM']) {
  const h = dailyHistory(s);
  if (!h) { console.log(s, 'no history'); continue; }
  const d = h.adjustments.filter((a) => a.basis === 'ex-day price');
  const rd = rawDays(s), raw = [...rd].map(([date, v]) => ({ date, ...v })).sort((x, y) => x.date.localeCompare(y.date));
  for (const a of d) {
    const i = raw.findIndex((r) => r.date === a.date);
    console.log(`${s.padEnd(10)} ex ${a.date}: prev close ${raw[i - 1]?.close} → ex-day open ${raw[i]?.open}; factor ${a.factor.toFixed(4)} (${a.purpose})`);
  }
  console.log(`${''.padEnd(10)} still flagged: ${h.unhandled.filter((u) => /DEMERG|SPIN/i.test(u.purpose)).map((u) => u.exDate + ' ' + u.reason).join('; ') || 'none'} | breaks after 2024: ${h.breaks.filter((b) => b.date >= '2024').map((b) => b.date + ' ' + b.reason).join('; ') || 'none'}`);
}
const m = resample(dailyHistory('SIEMENS')!.candles, 'M'), cl = m.map((b) => b.close), r = I.rsi(cl, 14), b2 = I.bollinger(cl, 20, 2);
for (let i = m.length - 6; i < m.length; i++) console.log(`SIEMENS ${dateOfIst(m[i].time).slice(0, 7)} close ${cl[i]} RSI ${r[i]?.toFixed(2)} BBup(20,2) ${b2.upper[i]?.toFixed(2)}`);
await prisma.$disconnect(); process.exit(0);
