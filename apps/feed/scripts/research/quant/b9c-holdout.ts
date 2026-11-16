// B9c. One-time final check of B9b's "NIFTY above its 100-day average" momentum family on 2024-01 → latest close, which
// no momentum test had touched. Runs the 24 base settings × keep / sell-all plus the unfiltered control, once.
// Pass mark, fixed before the run: the filter family's median CAGR beats NIFTY's AND its median max drawdown is under
// 25% AND the unfiltered control's median drawdown is higher (the filter has to be what helps).
// Run (apps/feed): HOLDOUT_UNLOCK=1 npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/quant/b9c-holdout.ts
import { prisma } from '@mtv/db';
import { runPortfolio, curveMetrics, familySummary, guardHoldout, PERIODS, type EquityStrategy, type Instrument, type CurvePoint, type MarketFilter } from '@mtv/backtest';
import { loadEod, allEquityShareSymbols, dailyHistory } from '../../../src/eod/store';
import { register, saveDetail, COSTS } from './registry';

const FROM = PERIODS.holdout.from;
const CAPITAL = 1_000_000;
const IST = 5.5 * 3600, dateOf = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);

await loadEod(() => {});
const nifty = dailyHistory('NIFTY')!.candles;
const TO = guardHoldout(dateOf(nifty.at(-1)!.time));
const instruments: Instrument[] = [];
for (const s of allEquityShareSymbols()) {
  const h = dailyHistory(s);
  if (!h || h.candles.length < 300 || !h.candles.some((c) => c.close * c.volume >= 5e7)) continue;
  instruments.push({ symbol: s, daily: h.candles, breaks: h.breaks.map((b) => b.date), kind: 'equity' });
}
console.log(`${instruments.length} stocks, ${FROM} → ${TO}`);

const FILTERS: Record<string, MarketFilter | null> = {
  none: null,
  'sma100-keep': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 100)', whenOff: 'keep' },
  'sma100-sell': { symbol: 'NIFTY', rule: 'CLOSE > SMA(CLOSE, 100)', whenOff: 'sell-all' },
};
type P = { lookback: number; maxOpen: number; stopPct: number; skipMonth: 0 | 1; filter: string };
const GRID = { lookback: [63, 126, 252], maxOpen: [10, 20], stopPct: [0, 15], skipMonth: [0, 1] as const, filter: Object.keys(FILTERS) };
const key = (p: P) => `lb${p.lookback} open${p.maxOpen} stop${p.stopPct} skip${p.skipMonth} ${p.filter}`;
function strategy(p: P): EquityStrategy {
  const mom = p.skipMonth ? `(CLOSE[21] / CLOSE[${p.lookback + 21}] - 1) * 100` : `ROC(CLOSE, ${p.lookback})`;
  const f = FILTERS[p.filter];
  return {
    tf: 'D', side: 'LONG', entry: `${mom} > 0 AND CLOSE > SMA(CLOSE, 200) AND CLOSE > 20`,
    order: { type: 'market' }, stop: p.stopPct ? { kind: 'pct', value: p.stopPct } : { kind: 'none' }, target: { kind: 'none' }, trail: { kind: 'none' },
    maxBars: 21, sizing: { mode: 'percent', pct: Math.round(100 / p.maxOpen) }, maxOpen: p.maxOpen, pyramid: 1, cooldownBars: 0, maxEntriesPerBar: p.maxOpen,
    rank: mom, minAvgValueCr: 10, capitalRupees: CAPITAL, reinvest: true, slippagePct: 0.03, broker: 'zerodha', charges: true, from: FROM, to: TO, riskFreePct: 6.5,
    ...(f ? { market: f } : {}),
  };
}

const brief = (c: ReturnType<typeof curveMetrics>) => ({ cagrPct: c.cagrPct, maxDdPct: c.drawdown.maxDdPct, sharpe: c.sharpe, worstMonthPct: c.worstMonthPct, annual: c.annual.map((y) => ({ year: y.year, returnPct: y.returnPct })) });
const rows: { id: string; p: P; m: ReturnType<typeof brief>; trades: number }[] = [];
const curves: { p: P; curve: CurvePoint[] }[] = [];
for (const filter of GRID.filter) for (const lookback of GRID.lookback) for (const maxOpen of GRID.maxOpen) for (const stopPct of GRID.stopPct) for (const skipMonth of GRID.skipMonth) {
  const p: P = { lookback, maxOpen, stopPct, skipMonth, filter };
  const r = runPortfolio(instruments, strategy(p), nifty, nifty);
  const curve = r.equity.map((e) => ({ date: dateOf(e.time), equity: e.equityPaise / 100 }));
  const m = brief(curveMetrics(curve));
  rows.push({ id: key(p), p, m, trades: r.trades.length });
  curves.push({ p, curve });
  console.log(`${key(p).padEnd(40)} ${r.trades.length} trades, CAGR ${m.cagrPct}%, DD ${m.maxDdPct}%`);
}
const niftyCurve: CurvePoint[] = nifty.filter((c) => dateOf(c.time) >= FROM && dateOf(c.time) <= TO).map((c) => ({ date: dateOf(c.time), equity: c.close }));
const bench = brief(curveMetrics(niftyCurve));
const fam = Object.fromEntries(GRID.filter.map((f) => { const r = rows.filter((x) => x.p.filter === f); return [f, { cagr: familySummary(r.map((x) => x.m.cagrPct)), dd: familySummary(r.map((x) => x.m.maxDdPct)) }]; }));
const filtered = rows.filter((x) => x.p.filter !== 'none');
const famAll = { cagr: familySummary(filtered.map((x) => x.m.cagrPct)), dd: familySummary(filtered.map((x) => x.m.maxDdPct)) };
console.log(`\nNIFTY: CAGR ${bench.cagrPct}% DD ${bench.maxDdPct}%`);
for (const [f, v] of Object.entries(fam)) console.log(`  ${f.padEnd(12)} median CAGR ${v.cagr.median}% (${v.cagr.p25}–${v.cagr.p75}), median DD ${v.dd.median}% (${v.dd.p25}–${v.dd.p75})`);
const pass = famAll.cagr.median > bench.cagrPct && famAll.dd.median < 25 && fam.none.dd.median > famAll.dd.median;
console.log(`Filter family (48): median CAGR ${famAll.cagr.median}%, median DD ${famAll.dd.median}% → ${pass ? 'PASS' : 'FAIL'}`);
const id = await register({
  name: 'B9c momentum + NIFTY 100-day filter, one-time final check 2024→', family: 'B9-final',
  hypothesis: 'The NIFTY-above-100-day filter that cut 2019–2023 drawdowns (B9b) also does so on unseen 2024–2026 data.',
  script: 'scripts/research/quant/b9c-holdout.ts',
  params: { filters: FILTERS, grid: GRID, capital: CAPITAL, passMark: 'filter family median CAGR > NIFTY, median DD < 25%, and below the unfiltered control' },
  period: { from: FROM, to: TO, role: 'holdout' }, costs: COSTS.stocksLiquid,
  metrics: { nifty: bench, settings: rows, family: fam, filterFamily: famAll },
  validation: { holdoutTouched: true, runs: 'once, no tuning', pickedFrom: 'E-20261116-001 (seen on 2019–2023, so this is the only fair test)' },
  caveats: ['Under 3 years of data; one market phase.', 'Slippage 0.03% a side assumed.'],
  verdict: pass ? 'lead' : 'fail', notes: `Filter family median CAGR ${famAll.cagr.median}% / DD ${famAll.dd.median}% vs NIFTY ${bench.cagrPct}% / ${bench.maxDdPct}%; unfiltered median DD ${fam.none.dd.median}%.`,
});
saveDetail(id, 'curves', curves);
console.log(`Registered ${id}`);
await prisma.$disconnect();
