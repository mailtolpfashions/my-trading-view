import { describe, expect, it } from 'vitest';
import { blockBootstrap, familySummary, guardHoldout, placeboPercentile, plateau, walkForward } from './validate';
import { combineCurves, curveMetrics, drawdownOf, equityFromTrades, pnlCorrelation, regimeMetrics, tradeMetrics } from './metrics';
import { regimeTable } from './regimes';

const days = (n: number, start = '2020-01-01') => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10));

describe('metrics', () => {
  it('drawdown finds the deepest fall and recovery', () => {
    const d = days(6), eq = [100, 110, 99, 104, 111, 108];
    const dd = drawdownOf(d.map((date, i) => ({ date, equity: eq[i] })));
    expect(dd.maxDd).toBe(11); expect(dd.maxDdPct).toBe(10); expect(dd.peakDate).toBe(d[1]); expect(dd.troughDate).toBe(d[2]); expect(dd.recoveredDate).toBe(d[4]);
    expect(dd.deepestDays).toBe(1); expect(dd.longestUnderwaterDays).toBe(2);
  });
  it('curve metrics: a flat curve has no return, a doubling in a year is 100% CAGR', () => {
    const d = days(366, '2020-01-01');
    const flat = curveMetrics(d.map((date) => ({ date, equity: 100 })));
    expect(flat.cagrPct).toBe(0); expect(flat.sharpe).toBeNull(); // no spread in daily returns: ratio left empty
    const grow = curveMetrics(d.map((date, i) => ({ date, equity: 100 * Math.pow(2, i / 365) })));
    expect(grow.cagrPct).toBeCloseTo(100, 0); expect(grow.drawdown.maxDd).toBe(0); expect(grow.annual.length).toBe(1); expect(grow.monthly.length).toBe(12);
  });
  it('trade metrics count streaks and best-trade dependence', () => {
    const t = tradeMetrics([{ entry: '2020-01-01', exit: '2020-01-10', net: 50 }, { entry: '2020-02-01', exit: '2020-02-05', net: -10 }, { entry: '2020-03-01', exit: '2020-03-05', net: -20 }, { entry: '2021-01-01', exit: '2021-01-03', net: 5 }]);
    expect(t.trades).toBe(4); expect(t.winRatePct).toBe(50); expect(t.maxConsecutiveLosses).toBe(2); expect(t.profitFactor).toBeCloseTo(55 / 30, 2);
    expect(t.totalWithoutBest).toBe(-25); expect(t.bestTradeSharePct).toBe(200); expect(t.perYear.map((y) => y.net)).toEqual([20, 5]);
  });
  it('equity from trades marks open trades daily and books at exit', () => {
    const d = days(5);
    const eq = equityFromTrades(d, 1000, [{ entry: d[0], exit: d[3], net: 30, daily: [{ date: d[1], mtm: -10 }, { date: d[2], mtm: 20 }, { date: d[3], mtm: 30 }] }]);
    expect(eq.map((p) => p.equity)).toEqual([1000, 990, 1020, 1030, 1030]);
  });
  it('combine and correlate', () => {
    const d = days(40);
    const a = d.map((date, i) => ({ date, equity: 100 + i * (i % 3) })), b = d.map((date, i) => ({ date, equity: 200 - i * (i % 3) }));
    expect(combineCurves([a, b], 1000).at(-1)!.equity).toBe(1000);
    expect(pnlCorrelation(a, b).r).toBe(-1);
    const r = regimeMetrics(a, (date) => (date < d[20] ? 'first' : 'second'));
    expect(r.map((x) => x.net)).toEqual([a[19].equity - a[0].equity, a[39].equity - a[19].equity]);
  });
});

describe('validate', () => {
  it('locks the holdout', () => {
    expect(() => guardHoldout('2024-01-02', {})).toThrow();
    expect(guardHoldout('2023-12-31', {})).toBe('2023-12-31');
    expect(guardHoldout('2026-01-01', { HOLDOUT_UNLOCK: '1' })).toBe('2026-01-01');
  });
  it('walk-forward picks on past years only', () => {
    const mk = (id: string, nets: Record<string, number>) => ({ id, params: { id }, byYear: new Map(Object.entries(nets).map(([y, net]) => [y, { net, worst: -1, trades: 1 }])) });
    const a = mk('a', { '2015': 10, '2016': 10, '2017': -50, '2018': 0 }), b = mk('b', { '2015': 5, '2016': 5, '2017': 5, '2018': 5 });
    const wf = walkForward([a, b], ['2015', '2016', '2017', '2018'], 2, (rows) => rows.reduce((s, r) => s + r.net, 0));
    expect(wf.picks.map((p) => p.chosen)).toEqual(['a', 'b']); // 2017 chosen on 2015–16 (a), 2018 on 2016–17 (b)
    expect(wf.total).toBe(-45); expect(wf.changes).toBe(1);
  });
  it('plateau reads neighbours one step away', () => {
    const all = [10, 20, 30].flatMap((x) => [1, 2].map((y) => ({ params: { x, y }, value: x * y })));
    const p = plateau({ x: 20, y: 1 }, all, { x: [10, 20, 30], y: [1, 2] });
    expect(p.neighbours.map((n) => n.kept)).toEqual([0.5, 1.5, 2]); expect(p.minKept).toBe(0.5);
  });
  it('bootstrap is reproducible and sensible', () => {
    const pnl = Array.from({ length: 200 }, (_, i) => (i % 5 === 0 ? -40 : 15));
    const a = blockBootstrap(pnl, { draws: 300, seed: 3, ddThresholds: [40, 1000] }), b = blockBootstrap(pnl, { draws: 300, seed: 3 });
    expect(a.total.p50).toBe(b.total.p50); expect(a.total.mean).toBeGreaterThan(0); expect(a.ddAtLeast[0].share).toBe(1); expect(a.ddAtLeast[1].share).toBe(0);
  });
  it('placebo percentile and family summary', () => {
    expect(placeboPercentile(10, [1, 2, 3, 20])).toBe(0.75);
    expect(familySummary([-5, 0, 5, 10])).toMatchObject({ tried: 4, profitable: 2, best: 10, worst: -5 });
  });
});

describe('regimes', () => {
  it('labels trend without look-ahead and tags crisis days', () => {
    const d = days(400, '2019-06-01');
    const idx = d.map((date, i) => ({ date, close: 100 + i * 0.5 }));
    const t = regimeTable(idx, null, ['2020-03-26']);
    expect(t.get(d[100])!.trend).toBeNull(); // not enough history yet
    expect(t.get(d[399])!.trend).toBe('bull');
    expect(t.get('2020-03-20')!.crisis).toBe('covid');
    expect(t.get('2020-03-23')!.expiryWeek).toBe(true); expect(t.get('2020-03-10')!.expiryWeek).toBe(false);
  });
});
