// Compares lightweight-charts-indicators (installed in a scratch folder, path as argv[2]) with our verified
// indicators on real NSE daily history. Run: npx tsx scripts/compare-lci.ts <scratch node_modules folder>
import { createRequire } from 'node:module';
import path from 'node:path';
import { atr, bollinger, ema, macd, rsi, sma, supertrend } from '@mtv/indicators';
import { dailyHistory, loadEod } from '../src/eod/store';

const req = createRequire(path.join(process.argv[2], 'x.js'));
const L = req('lightweight-charts-indicators');

await loadEod(() => {});
type Row = { name: string; theirs: (number | null)[]; ours: (number | null)[] };
const plot = (r: { plots: Record<string, { value: number }[]> }, key: string) => r.plots[key].map((p) => (Number.isFinite(p.value) ? p.value : null));

for (const symbol of ['RELIANCE', 'NIFTY']) {
  const c = dailyHistory(symbol)!.candles;
  const bars = c.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  const closes = c.map((b) => b.close);
  const first = (name: string, inputs: object = {}) => L[name].calculate(bars, inputs);
  const keys = (name: string) => Object.keys(first(name).plots).join(',');
  const rows: Row[] = [];
  const m = macd(closes, 12, 26, 9), bb = bollinger(closes, 20, 2), st = supertrend(c, 10, 3);
  rows.push({ name: 'SMA 20', theirs: plot(first('SMA', { len: 20, length: 20 }), 'plot0'), ours: sma(closes, 20) });
  rows.push({ name: 'EMA 9', theirs: plot(first('EMA', { len: 9, length: 9 }), 'plot0'), ours: ema(closes, 9) });
  rows.push({ name: 'RSI 14', theirs: plot(first('RSI', { length: 14 }), 'plot0'), ours: rsi(closes, 14) });
  const mr = first('MACD');
  rows.push({ name: 'MACD line', theirs: plot(mr, Object.keys(mr.plots)[1] ?? 'plot1'), ours: m.macd });
  const br = first('BollingerBands');
  rows.push({ name: 'BB upper', theirs: plot(br, Object.keys(br.plots)[1]), ours: bb.upper });
  rows.push({ name: 'ATR 14', theirs: plot(first('ATR', { length: 14 }), 'plot0'), ours: atr(c, 14) });
  const sr = first('Supertrend');
  const stTheirs = Object.keys(sr.plots).map((k) => plot(sr, k)).reduce((acc, s) => acc.map((v, i) => v ?? s[i]));
  rows.push({ name: 'Supertrend 10,3', theirs: stTheirs, ours: st.value });
  console.log(`\n${symbol} daily, ${c.length} bars. Plot keys: MACD[${keys('MACD')}] BB[${keys('BollingerBands')}] ST[${keys('Supertrend')}]`);
  for (const r of rows) {
    let n = 0, worst = 0, worstAt = -1;
    for (let i = 60; i < c.length; i++) { // skip warm-up, where seeding conventions legitimately differ
      const a = r.theirs[i], b = r.ours[i];
      if (a == null || b == null) continue;
      n++;
      const d = Math.abs(a - b);
      if (d > worst) { worst = d; worstAt = i; }
    }
    console.log(`  ${r.name.padEnd(16)} compared ${n}, max difference ${worst.toFixed(4)}${worstAt >= 0 ? ` (theirs ${r.theirs[worstAt]?.toFixed(2)} ours ${r.ours[worstAt]?.toFixed(2)})` : ''}`);
  }
}
process.exit(0);
