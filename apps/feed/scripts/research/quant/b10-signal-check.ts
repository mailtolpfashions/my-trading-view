// B10 diagnostic: the raw 52-week-high breakout signal on liquid stocks (≥ ₹10 crore 20-day average turnover, close > 20),
// 2011-09 → 2023-12, against the crowd of all liquid stock-days on the same dates. Mean AND median forward returns
// (5, 20, 60 sessions), win rate, and the same per year, so a mean carried by a few huge winners is visible.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/quant/b10-signal-check.ts
import { prisma } from '@mtv/db';
import { Evaluator, parseFormula, resample, type Tf } from '@mtv/rules';
import { guardHoldout, PERIODS } from '@mtv/backtest';
import { loadEod, allEquityShareSymbols, dailyHistory } from '../../../src/eod/store';
import { dateOfIst } from '../../../src/intraday/store';
import { register } from './registry';

const TO = guardHoldout(PERIODS.validation.to), FROM = '2011-09-01';
await loadEod(() => {});
const node = (f: string) => { const p = parseFormula(f); if (!p.ok) throw new Error(p.error); return p.node; };
const SIGNAL = node('CLOSE > HIGHEST(HIGH, 252)[1]'), LIQ = node('AVG_TURNOVER(20) >= 100000000 AND CLOSE > 20');
const H = [5, 20, 60] as const;
type Ev = { date: string; symbol: string; ret: Record<number, number | null> };
const events: Ev[] = [];
const crowd = new Map<string, Record<number, [number, number]>>(); // date → h → [sum, n]
const crowdMed = new Map<string, Record<number, number[]>>();
let stocks = 0;
for (const s of allEquityShareSymbols()) {
  const h = dailyHistory(s);
  if (!h || h.candles.length < 300) continue;
  const c = h.candles;
  const ev = new Evaluator((tf: Tf) => (tf === 'D' ? c : tf === 'W' ? resample(c, 'W') : tf === 'M' ? resample(c, 'M') : null));
  let sig: (number | null)[], liq: (number | null)[];
  try { sig = ev.series(SIGNAL, 'D'); liq = ev.series(LIQ, 'D'); } catch { continue; }
  stocks++;
  const breaks = new Set(h.breaks.map((b) => b.date));
  const dates = c.map((k) => dateOfIst(k.time));
  for (let i = 252; i < c.length; i++) {
    if (dates[i] < FROM || dates[i] > TO || liq[i] !== 1) continue;
    const r: Record<number, number | null> = {};
    for (const hh of H) {
      let broken = false;
      for (let k = i + 1; k <= Math.min(i + hh, c.length - 1); k++) if (breaks.has(dates[k])) { broken = true; break; }
      r[hh] = i + hh < c.length && !broken ? c[i + hh].close / c[i].close - 1 : null;
      if (r[hh] != null) {
        const cr = crowd.get(dates[i]) ?? { 5: [0, 0], 20: [0, 0], 60: [0, 0] }; cr[hh][0] += r[hh]!; cr[hh][1]++; crowd.set(dates[i], cr);
        const cm = crowdMed.get(dates[i]) ?? { 5: [], 20: [], 60: [] }; cm[hh].push(r[hh]!); crowdMed.set(dates[i], cm);
      }
    }
    if (sig[i] === 1) events.push({ date: dates[i], symbol: s, ret: r });
  }
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pc = (x: number) => `${(x * 100).toFixed(2)}%`;
const summarise = (evs: Ev[]) => Object.fromEntries(H.map((hh) => {
  const xs = evs.map((e) => e.ret[hh]).filter((x): x is number => x != null);
  const ex = evs.filter((e) => e.ret[hh] != null).map((e) => { const cr = crowd.get(e.date)![hh]; return e.ret[hh]! - cr[0] / cr[1]; });
  const exMed = evs.filter((e) => e.ret[hh] != null).map((e) => e.ret[hh]! - med(crowdMed.get(e.date)![hh]));
  return [hh, { n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, median: med(xs), winPct: xs.filter((x) => x > 0).length / xs.length, excessMean: ex.reduce((a, b) => a + b, 0) / ex.length, excessMedian: med(exMed), excessWinPct: ex.filter((x) => x > 0).length / ex.length }];
}));
const all = summarise(events);
console.log(`${stocks} stocks, ${events.length} liquid breakout events ${FROM}→${TO}`);
for (const hh of H) { const a = all[hh]; console.log(`H=${hh}: mean ${pc(a.mean)} median ${pc(a.median)} win ${pc(a.winPct)} | excess over crowd: mean ${pc(a.excessMean)} median ${pc(a.excessMedian)} beats crowd ${pc(a.excessWinPct)} (n=${a.n})`); }
const byYear: Record<string, unknown> = {};
console.log('\nPer year, H=20: n, mean, median, excess mean, excess median');
for (const y of [...new Set(events.map((e) => e.date.slice(0, 4)))].sort()) {
  const s = summarise(events.filter((e) => e.date.startsWith(y)))[20];
  byYear[y] = s;
  console.log(`  ${y}  n=${String(s.n).padStart(5)}  mean ${pc(s.mean)}  median ${pc(s.median)}  excess mean ${pc(s.excessMean)}  excess median ${pc(s.excessMedian)}`);
}
const roundTripCost = 0.0035; // delivery: STT 0.1% ×2 + slippage 0.03% ×2 + exchange/stamp/DP ≈ 0.35% (estimate)
await register({
  name: 'B10 signal check: 52-week-high breakout, mean vs median, liquid stocks', family: 'B10',
  hypothesis: 'The breakout signal\'s +1% average excess per 20 sessions holds at the median, not only in the mean.', script: 'scripts/research/quant/b10-signal-check.ts',
  params: { signal: 'CLOSE > HIGHEST(HIGH,252)[1]', liquidity: 'AVG_TURNOVER(20) ≥ ₹10 cr, close > 20', horizons: H, crowd: 'all liquid stock-days on the same date', roundTripCostEstimate: roundTripCost },
  period: { from: FROM, to: TO, role: 'train+validation' }, costs: { broker: '-', slippage: 'not applied; cost estimate shown', charges: 'not applied' },
  metrics: { stocks, events: events.length, all, byYearH20: byYear }, validation: { holdoutTouched: false, breaks: 'events whose window crosses a data break are dropped' },
  caveats: ['Raw signal study, overlapping windows, no position limits.', 'Crowd = every liquid stock-day, so the comparison already removes the market\'s drift.'],
  verdict: all[20].excessMedian > roundTripCost ? 'lead' : 'info', notes: `H=20: mean excess ${pc(all[20].excessMean)}, median excess ${pc(all[20].excessMedian)}, beats crowd ${pc(all[20].excessWinPct)} of the time (n=${all[20].n}).`,
});
await prisma.$disconnect();
