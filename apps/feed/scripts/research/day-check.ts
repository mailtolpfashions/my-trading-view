// One trading day, run like a trader would: the four Chartink scans from 9:30 on (nothing before 9:30, the opening
// is too volatile), the list of stocks each gave, and what each stock did after the signal, minute by minute.
//   5-minute / 1-hour scans: a signal when a candle closing at or after 9:30 matches; entry at that candle's close
//     time (the next minute's open); first signal per stock.
//   daily scans: run at 9:30 on the daily candle as it stood then (today's open, high and low so far, price at 9:30
//     as the close: what Chartink's live daily scan shows); entry at the 9:30 open.
//   then to 15:15: did it reach the target (10 / 20 / 30 points in the trade's direction) before a stop of the same
//   size, and the best and worst move. Real traded prices (our Kite minute bars). Costs not included.
// Run: DATE=2026-11-09 npx dotenv -e ../../.env -- node --max-old-space-size=4096 --import tsx scripts/research/day-check.ts
import { readdir } from 'node:fs/promises';
import { prisma } from '@mtv/db';
import { Evaluator, parseFormula, resample, type Tf } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, loadEod } from '../../src/eod/store';
import { fnoUnderlyings } from '../../src/fno/analytics';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

const DATE = process.env.DATE ?? '2026-11-09';
const HA = '(OPEN + HIGH + LOW + CLOSE) / 4';
const SCANS: { name: string; tf: Tf; side: 1 | -1; fno: boolean; formula: string }[] = [
  { name: 'Triple Supertrend BUY (5 min)', tf: '5m', side: 1, fno: true, formula: 'CROSSOVER(CLOSE, SUPERTREND(7, 3)) AND CROSSOVER(CLOSE, SUPERTREND(14, 2)) AND CROSSOVER(CLOSE, SUPERTREND(21, 1))' },
  { name: 'HA Supertrend SELL (1 hour)', tf: '1h', side: -1, fno: true, formula: `CROSSUNDER(${HA}, SUPERTREND(7, 3)) AND CROSSUNDER(${HA}, SUPERTREND(14, 2)) AND CROSSUNDER(${HA}, SUPERTREND(21, 1))` },
  { name: 'HA Supertrend SELL (daily, at 9:30)', tf: 'D', side: -1, fno: true, formula: `CROSSUNDER(${HA}, SUPERTREND(7, 3)) AND CROSSUNDER(${HA}, SUPERTREND(14, 2)) AND CROSSUNDER(${HA}, SUPERTREND(21, 1))` },
  { name: 'Ichimoku blind BUY (daily, at 9:30)', tf: 'D', side: 1, fno: false, formula: 'CROSSOVER(CLOSE, MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))) AND CROSSUNDER(SUPERTREND(7, 3), CLOSE)' },
];
const STEP: Record<string, number> = { '5m': 5, '1h': 60 };
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

await loadEod(() => {});
const fno = new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol));
const store = new MinuteStore();
const syms = (await readdir(store.dir)).filter((x) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(x));
const nodes = SCANS.map((s) => { const p = parseFormula(s.formula); if (!p.ok) throw new Error(p.error); return p.node; });
type Hit = { sym: string; at: number; entry: number; after: Candle[] };
const hits: Hit[][] = SCANS.map(() => []);
const from = Math.floor(Date.parse(`${DATE}T00:00:00Z`) / 1000) - 200 * 86400;

for (const s of syms) {
  const all = (await store.read(s, from)).filter((b) => { const m = ist(b.time); return m >= 555 && m <= 929; });
  const today = all.filter((b) => dateOfIst(b.time) === DATE);
  if (today.length < 300 || ist(today[0].time) !== 555) continue;
  const minuteAt = (m: number) => today.findIndex((b) => ist(b.time) === m);
  const take = (k: number, i: number) => {
    if (i < 0 || hits[k].some((h) => h.sym === s)) return;
    hits[k].push({ sym: s, at: ist(today[i].time), entry: today[i].open, after: today.slice(i).filter((b) => ist(b.time) <= 914) });
  };
  SCANS.forEach((scan, k) => {
    if (scan.fno && !fno.has(s)) return;
    if (scan.tf === 'D') {
      const hist = dailyHistory(s)?.candles.filter((c) => dateOfIst(c.time) < DATE);
      if (!hist || hist.length < 120) return;
      const upto = today.filter((b) => ist(b.time) < 570); // 9:15 to 9:29
      const partial: Candle = { time: today[0].time, open: upto[0].open, high: Math.max(...upto.map((b) => b.high)), low: Math.min(...upto.map((b) => b.low)), close: upto.at(-1)!.close, volume: upto.reduce((a, b) => a + b.volume, 0) };
      const c = [...hist, partial];
      const ser = new Evaluator(() => c).series(nodes[k], 'D');
      if (ser[c.length - 1] === 1) take(k, minuteAt(570));
      return;
    }
    const bars = resample(all, scan.tf);
    const ser = new Evaluator((tf) => (tf === scan.tf ? bars : null)).series(nodes[k], scan.tf);
    for (let j = 0; j < bars.length; j++) {
      if (ser[j] !== 1 || dateOfIst(bars[j].time) !== DATE) continue;
      const closeAt = ist(bars[j].time) + STEP[scan.tf];
      if (closeAt < 570 || closeAt > 900) continue; // signals from 9:30 to 15:00
      take(k, minuteAt(closeAt));
      break;
    }
  });
}

console.log(`Day: ${DATE} (signals from 9:30, exit by 15:15; points = rupees; target and stop the same size)\n`);
SCANS.forEach((scan, k) => {
  const list = hits[k].sort((a, b) => a.at - b.at);
  console.log(`${scan.name}: ${list.length} stock${list.length === 1 ? '' : 's'}`);
  let got = { 10: 0, 20: 0, 30: 0 };
  for (const h of list) {
    const move = (b: Candle, which: 'best' | 'worst') => (scan.side === 1) === (which === 'best') ? b.high - h.entry : h.entry - b.low;
    const best = Math.max(...h.after.map((b) => (scan.side === 1 ? b.high - h.entry : h.entry - b.low)));
    const worst = Math.max(...h.after.map((b) => (scan.side === 1 ? h.entry - b.low : b.high - h.entry)));
    const first = (T: number) => {
      for (const b of h.after) {
        const t = move(b, 'best') >= T, st = (scan.side === 1 ? h.entry - b.low : b.high - h.entry) >= T;
        if (t && st) return '?';
        if (st) return '✗';
        if (t) return '✓';
      }
      return '–';
    };
    const r = { 10: first(10), 20: first(20), 30: first(30) };
    for (const T of [10, 20, 30] as const) if (r[T] === '✓') got[T]++;
    const end = scan.side * (h.after.at(-1)!.close - h.entry);
    console.log(`  ${hhmm(h.at)} ${h.sym.padEnd(12)} ${scan.side === 1 ? 'buy' : 'sell'} ₹${h.entry.toFixed(2).padStart(9)}  best +₹${best.toFixed(2).padStart(6)} (${((best / h.entry) * 100).toFixed(2)}%)  worst −₹${worst.toFixed(2).padStart(6)}  15:15 ${end >= 0 ? '+' : '−'}₹${Math.abs(end).toFixed(2).padStart(6)}   10pt ${r[10]}  20pt ${r[20]}  30pt ${r[30]}`);
  }
  if (list.length) console.log(`  target first: 10 pts ${got[10]}/${list.length}, 20 pts ${got[20]}/${list.length}, 30 pts ${got[30]}/${list.length}`);
  console.log('');
});
console.log('✓ target first  ✗ stop first  – neither by 15:15  ? same minute (unclear)');
await prisma.$disconnect();
