// Narrowing a scan's list with price action: does waiting for an R1 break (and RSI momentum) help?
//   A) blind-buy list at 9:30, bought at 9:30 (the paper log's rule)
//   B) same list, bought when a 5-minute candle closes above today's R1 (classic floor pivot from yesterday's
//      high/low/close: P = (H+L+C)/3, R1 = 2P - L), between 9:30 and 3:00
//   C) B and the 5-minute RSI(14) above 60 on that candle
//   D) C on every F&O stock, without the scan (does the scan add anything?)
// Every trade closed at 3:00 pm (the 14:59 close). Yesterday's high/low/close from our minute bars (as traded, same
// basis as today). Each stock's data is read once. Costs not included (about 0.04% a trade in cash intraday).
// Run: npx dotenv -e ../../.env -- node --max-old-space-size=6144 --import tsx scripts/research/pivot-filter.ts
import { readdir } from 'node:fs/promises';
import { Evaluator, parseFormula, resample } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, loadEod, rawDays } from '../../src/eod/store';
import { fnoUnderlyings } from '../../src/fno/analytics';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';
import { BLIND_BUY } from '../../src/paperlog/blind-buy';

const START = 570, EXIT = 900;
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const parse = (f: string) => { const p = parseFormula(f); if (!p.ok) throw new Error(p.error); return p.node; };
const rsiNode = parse('RSI(CLOSE, 14)'), scanNode = parse(BLIND_BUY);
await loadEod(() => {});
const store = new MinuteStore();
const fno = new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol));
const symbols = (await readdir(store.dir)).filter((s) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(s));

type T = { date: string; sym: string; entry: number; exit: number; at: number };
const out: Record<'A' | 'B' | 'C' | 'D', T[]> = { A: [], B: [], C: [], D: [] };
let n = 0;
for (const sym of symbols) {
  if (++n % 100 === 0) console.log(`  ${n} of ${symbols.length} stocks…`);
  const all = (await store.read(sym, 0)).filter((b) => { const m = ist(b.time); return m >= 555 && m <= 929; });
  if (all.length < 5000) continue;
  const days = new Map<string, Candle[]>();
  for (const b of all) { const d = dateOfIst(b.time); (days.get(d) ?? days.set(d, []).get(d)!).push(b); }
  const order = [...days.keys()].sort();
  const five = resample(all, '5m');
  const rsi = new Evaluator((tf) => (tf === '5m' ? five : null)).series(rsiNode, '5m');
  const fiveByDay = new Map<string, number[]>();
  five.forEach((b, k) => { const d = dateOfIst(b.time); (fiveByDay.get(d) ?? fiveByDay.set(d, []).get(d)!).push(k); });
  const hist = dailyHistory(sym)?.candles;
  const histDates = hist?.map((c) => dateOfIst(c.time)) ?? [];
  const raw = rawDays(sym);

  /** First 5-minute close above R1 (and RSI > 60 if asked), 9:30-3:00; entry at that candle's close time. */
  const trigger = (date: string, i: number, needRsi: boolean): T | null => {
    const today = days.get(date)!, y = days.get(order[i - 1])!;
    const H = Math.max(...y.map((b) => b.high)), L = Math.min(...y.map((b) => b.low)), C = y.at(-1)!.close;
    const r1 = 2 * ((H + L + C) / 3) - L;
    const exitBar = today.find((b) => ist(b.time) === EXIT - 1);
    if (!exitBar) return null;
    for (const k of fiveByDay.get(date) ?? []) {
      const b = five[k], closeAt = ist(b.time) + 5;
      if (closeAt <= START || closeAt >= EXIT) continue;
      if (b.close > r1 && (!needRsi || (rsi[k] ?? 0) > 60)) {
        const e = today.find((m) => ist(m.time) === closeAt);
        return e ? { date, sym, entry: e.open, exit: exitBar.close, at: closeAt } : null;
      }
    }
    return null;
  };

  for (let i = 1; i < order.length; i++) {
    const date = order[i], today = days.get(date)!;
    if (ist(today[0].time) !== 555) continue;
    const exitBar = today.find((b) => ist(b.time) === EXIT - 1), at930 = today.find((b) => ist(b.time) === START);
    if (!exitBar || !at930) continue;
    if (fno.has(sym)) { const d = trigger(date, i, true); if (d) out.D.push(d); }
    // the blind-buy scan at 9:30 on the daily candle as it stood then (on the daily history's adjusted basis)
    if (!hist || hist.length < 120) continue;
    let k = histDates.findIndex((d) => d >= date);
    if (k < 0) k = hist.length;
    const r = raw.get(date);
    if (!r?.close || histDates[k] !== date) continue;
    const f = hist[k].close / r.close;
    const upto = today.filter((b) => ist(b.time) < START);
    const partial: Candle = { time: today[0].time, open: upto[0].open * f, high: Math.max(...upto.map((b) => b.high)) * f, low: Math.min(...upto.map((b) => b.low)) * f, close: upto.at(-1)!.close * f, volume: 0 };
    const c = [...hist.slice(Math.max(0, k - 300), k), partial];
    if (new Evaluator(() => c).series(scanNode, 'D')[c.length - 1] !== 1) continue;
    out.A.push({ date, sym, entry: at930.open, exit: exitBar.close, at: START });
    const b = trigger(date, i, false); if (b) out.B.push(b);
    const cc = trigger(date, i, true); if (cc) out.C.push(cc);
  }
}

const label = { A: 'A) blind-buy list, buy at 9:30', B: 'B) list + 5-min close above R1', C: 'C) list + R1 + RSI > 60', D: 'D) every F&O stock: R1 + RSI > 60 (no scan)' };
console.log('\n| Rule | Trades | In profit at 3:00 | Average a trade | After ~0.04% costs |');
console.log('|---|---|---|---|---|');
for (const key of ['A', 'B', 'C', 'D'] as const) {
  const r = out[key].map((t) => ((t.exit - t.entry) / t.entry) * 100);
  const cnt = r.length, avg = cnt ? r.reduce((a, b) => a + b, 0) / cnt : 0;
  const sd = cnt > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - avg) ** 2, 0) / (cnt - 1)) : 0;
  console.log(`| ${label[key]} | ${cnt} | ${cnt ? ((r.filter((x) => x > 0).length / cnt) * 100).toFixed(1) : 0}% | ${avg >= 0 ? '+' : ''}${avg.toFixed(3)}% (t ${(sd ? avg / (sd / Math.sqrt(cnt)) : 0).toFixed(1)}) | ${avg - 0.04 >= 0 ? '+' : ''}${(avg - 0.04).toFixed(3)}% |`);
}
const hours = new Map<number, number>();
for (const t of out.D) hours.set(Math.floor(t.at / 60), (hours.get(Math.floor(t.at / 60)) ?? 0) + 1);
console.log('\nD entries by hour: ' + [...hours].sort((a, b) => a[0] - b[0]).map(([h, c]) => `${h}:00 ${c}`).join(', '));
process.exit(0);
