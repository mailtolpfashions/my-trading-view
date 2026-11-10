// The owner's routine: run the scans once at 9:30, take the list, check each stock at 3:00 pm.
//   5-minute scan: the candle that closes at 9:30 (9:25-9:30) must match, as a scan run at 9:30 shows it;
//   daily scans: the daily candle as it stood at 9:30 (today's open/high/low so far, price at 9:30 as the close), put on
//     the daily history's split/bonus-adjusted basis;
//   (the 1-hour scan cannot run at 9:30: its first candle closes at 10:15).
//   For each stock: price at 9:30 (the 9:30 minute's open), price at 3:00 (the 14:59 minute's close), the change in
//   the trade's direction, and the best and worst move between. Real traded prices from our Kite minute bars.
// Run: DAYS=5 npx dotenv -e ../../.env -- node --max-old-space-size=4096 --import tsx scripts/research/scan-at-930.ts
import { readdir } from 'node:fs/promises';
import { prisma } from '@mtv/db';
import { Evaluator, parseFormula, resample, type Tf } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, loadEod, rawDays } from '../../src/eod/store';
import { fnoUnderlyings } from '../../src/fno/analytics';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

const DAYS = Number(process.env.DAYS ?? 5);
const HA = '(OPEN + HIGH + LOW + CLOSE) / 4';
const SCANS: { name: string; tf: Tf; side: 1 | -1; fno: boolean; formula: string }[] = [
  { name: 'Triple Supertrend BUY (5 min)', tf: '5m', side: 1, fno: true, formula: 'CROSSOVER(CLOSE, SUPERTREND(7, 3)) AND CROSSOVER(CLOSE, SUPERTREND(14, 2)) AND CROSSOVER(CLOSE, SUPERTREND(21, 1))' },
  { name: 'Ichimoku blind BUY (daily)', tf: 'D', side: 1, fno: false, formula: 'CROSSOVER(CLOSE, MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))) AND CROSSUNDER(SUPERTREND(7, 3), CLOSE)' },
  { name: 'HA Supertrend SELL (daily)', tf: 'D', side: -1, fno: true, formula: `CROSSUNDER(${HA}, SUPERTREND(7, 3)) AND CROSSUNDER(${HA}, SUPERTREND(14, 2)) AND CROSSUNDER(${HA}, SUPERTREND(21, 1))` },
];
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const nodes = SCANS.map((s) => { const p = parseFormula(s.formula); if (!p.ok) throw new Error(p.error); return p.node; });

await loadEod(() => {});
const fno = new Set((await fnoUnderlyings()).underlyings.filter((u) => !u.isIndex).map((u) => u.symbol));
const store = new MinuteStore();
const syms = (await readdir(store.dir)).filter((x) => !/^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/.test(x));
const nifty = await store.read("NIFTY", Math.floor(Date.now() / 1000) - (DAYS * 1.6 + 10) * 86400);
const dates = [...new Set(nifty.map((b) => dateOfIst(b.time)))].filter((d) => nifty.some((b) => dateOfIst(b.time) === d && ist(b.time) >= 899)).slice(-DAYS);
type Row = { date: string; scan: number; sym: string; p930: number; p300: number; best: number; worst: number };
const rows: Row[] = [];
const from = Math.floor(Date.parse(`${dates[0]}T00:00:00Z`) / 1000) - 120 * 86400;

for (const s of syms) {
  const all = (await store.read(s, from)).filter((b) => { const m = ist(b.time); return m >= 555 && m <= 929; });
  if (!all.length) continue;
  const five = resample(all, '5m');
  const fiveSer = fno.has(s) ? new Evaluator((tf) => (tf === '5m' ? five : null)).series(nodes[0], '5m') : null;
  const hist = dailyHistory(s)?.candles;
  const histDates = hist?.map((c) => dateOfIst(c.time)) ?? [];
  const raw = rawDays(s);
  const byDay = new Map<string, Candle[]>();
  for (const b of all) { const d = dateOfIst(b.time); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(b); }
  const fiveAt = new Map(five.map((b, j) => [`${dateOfIst(b.time)}|${ist(b.time)}`, j]));
  for (const date of dates) {
    const today = byDay.get(date) ?? [];
    if (today.length < 300 || ist(today[0].time) !== 555) continue;
    const at930 = today.find((b) => ist(b.time) === 570), at259 = today.find((b) => ist(b.time) === 899);
    if (!at930 || !at259) continue;
    const window = today.filter((b) => { const m = ist(b.time); return m >= 570 && m < 900; });
    const add = (k: number) => {
      const side = SCANS[k].side;
      const hi = Math.max(...window.map((b) => b.high)), lo = Math.min(...window.map((b) => b.low));
      rows.push({ date, scan: k, sym: s, p930: at930.open, p300: at259.close, best: side === 1 ? hi - at930.open : at930.open - lo, worst: side === 1 ? at930.open - lo : hi - at930.open });
    };
    // 5-minute scan: the 9:25 candle (closes at 9:30)
    if (fiveSer) { const j = fiveAt.get(`${date}|565`); if (j != null && fiveSer[j] === 1) add(0); }
    // daily scans on the candle as it stood at 9:30
    if (hist && hist.length > 120) {
      let n = histDates.findIndex((d) => d >= date);
      if (n < 0) n = hist.length;
      const before = hist.slice(Math.max(0, n - 300), n); // 300 sessions: enough for Ichimoku (52 + 26) and Supertrend to settle
      const upto = today.filter((b) => ist(b.time) < 570);
      // Daily history is split/bonus adjusted to today's basis; the minute prices are as traded. Put the 9:30 candle on
      // the history's basis (that day's adjusted close / traded close), or a later split would fake a crossover.
      const r = raw.get(date), adjDay = hist[n];
      if (!r?.close || !adjDay || histDates[n] !== date) continue;
      const k = adjDay.close / r.close;
      const partial: Candle = { time: today[0].time, open: upto[0].open * k, high: Math.max(...upto.map((b) => b.high)) * k, low: Math.min(...upto.map((b) => b.low)) * k, close: upto.at(-1)!.close * k, volume: upto.reduce((a, b) => a + b.volume, 0) / k };
      const c = [...before, partial];
      for (const k of [1, 2]) {
        if (SCANS[k].fno && !fno.has(s)) continue;
        if (new Evaluator(() => c).series(nodes[k], 'D')[c.length - 1] === 1) add(k);
      }
    }
  }
}

const f = (x: number) => x.toFixed(2);
const sg = (x: number) => `${x >= 0 ? '+' : '−'}${f(Math.abs(x))}`;
console.log(`Scans run once at 9:30, checked at 3:00 pm. Days: ${dates.join(', ')}\n`);
SCANS.forEach((scan, k) => {
  const list = rows.filter((r) => r.scan === k).sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
  console.log(`### ${scan.name}: ${list.length} stocks in ${dates.length} days`);
  if (!list.length) { console.log(''); return; }
  if (dates.length > 10) {
    const months = [...new Set(list.map((r) => r.date.slice(0, 7)))];
    for (const mo of months) { const xs = list.filter((r) => r.date.startsWith(mo)).map((r) => (scan.side * (r.p300 - r.p930) / r.p930) * 100); console.log(`  ${mo}: ${xs.length} trades, in profit ${xs.filter((x) => x > 0).length}, average ${sg(xs.reduce((a, b) => a + b, 0) / xs.length)}%`); }
    const big = [...list].sort((a, b) => Math.abs(b.p300 - b.p930) / b.p930 - Math.abs(a.p300 - a.p930) / a.p930).slice(0, 4);
    console.log('  biggest: ' + big.map((r) => `${r.date} ${r.sym} ${f(r.p930)}→${f(r.p300)}`).join(' | '));
    const pcts = list.map((r) => (scan.side * (r.p300 - r.p930) / r.p930) * 100), pts = list.map((r) => scan.side * (r.p300 - r.p930));
    console.log(`→ in profit at 3:00: ${pcts.filter((x) => x > 0).length} of ${list.length} (${((pcts.filter((x) => x > 0).length / list.length) * 100).toFixed(1)}%); average ${sg(pcts.reduce((a, b) => a + b, 0) / list.length)}% (${sg(pts.reduce((a, b) => a + b, 0) / list.length)} pts) per trade
`);
    return;
  }
  console.log('| Day | Stock | ' + (scan.side === 1 ? 'Buy' : 'Sell') + ' at 9:30 ₹ | Price at 3:00 ₹ | Profit/loss pts | % | Best pts | Worst pts |');
  console.log('|---|---|---|---|---|---|---|---|');
  let up = 0, sumPct = 0;
  for (const r of list) {
    const pl = scan.side * (r.p300 - r.p930), pct = (pl / r.p930) * 100;
    if (pl > 0) up++;
    sumPct += pct;
    console.log(`| ${r.date.slice(5)} | ${r.sym} | ${f(r.p930)} | ${f(r.p300)} | **${sg(pl)}** | ${sg(pct)}% | +${f(r.best)} | −${f(r.worst)} |`);
  }
  console.log(`→ in profit at 3:00: ${up} of ${list.length}; average ${sg(sumPct / list.length)}% per trade\n`);
});
await prisma.$disconnect();
