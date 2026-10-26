import { describe, expect, it } from 'vitest';
import { computeCharges } from '@mtv/paper';
import type { Candle } from '@mtv/shared';
import { BacktestError, evalCondition, runBacktest, type Condition, type Strategy } from './index';

const ist = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m) / 1000 - 5.5 * 3600;
/** 5-minute bars from 09:15 IST on 26 Oct; each entry is [open, high, low, close]. */
const bars = (ohlc: number[][], day = 26, startMin = 0): Candle[] =>
  ohlc.map(([o, h, l, c], i) => ({ time: ist(day, 9, 15) + (startMin + i) * 300, open: o, high: h, low: l, close: c, volume: 1000 }));
const flat = (p: number) => [p, p, p, p];

const closeAbove = (v: number): Condition => ({ left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'number', value: v } });
const closeBelow = (v: number): Condition => ({ left: { kind: 'price', field: 'close' }, op: 'crossesBelow', right: { kind: 'number', value: v } });
const strat = (over: Partial<Strategy> = {}): Strategy => ({
  name: 'test', direction: 'LONG', product: 'MIS', entry: { match: 'all', conditions: [closeAbove(100)] },
  sizing: { mode: 'qty', qty: 10 }, initialCapitalPaise: 1_00_000_00, ...over,
});
const ch = (side: 'BUY' | 'SELL', qty: number, pricePaise: number, product: 'MIS' | 'CNC' = 'MIS') =>
  computeCharges({ side, product, qty, pricePaise, firstDeliverySellToday: product === 'CNC' && side === 'SELL' }).total;

describe('conditions', () => {
  const s = (xs: number[]) => xs;
  it('crosses follow TradingView: above now, at-or-below on the previous bar', () => {
    const c = closeAbove(100);
    expect(evalCondition(c, s([99, 101]), s([100, 100]), 1)).toBe(true);
    expect(evalCondition(c, s([100, 101]), s([100, 100]), 1)).toBe(true); // touching counts as "below or equal"
    expect(evalCondition(c, s([101, 102]), s([100, 100]), 1)).toBe(false); // already above
    expect(evalCondition(c, [null, 101], s([100, 100]), 1)).toBe(false); // warm-up
  });
});

describe('execution model', () => {
  it('has no look-ahead: a signal at a bar close fills at the NEXT bar open', () => {
    // bar1 closes at 101 (cross above 100) -> entry at bar2 open 102
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], [102, 103, 101, 102], flat(102)]), '5', strat());
    expect(r.trades[0]).toMatchObject({ entryTime: ist(26, 9, 25), entryPricePaise: 102_00, exitReason: 'end-of-data' });
  });

  it('exits on a signal at the next bar open', () => {
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], flat(103), [103, 103, 95, 96], [97, 98, 96, 97]]), '5',
      strat({ exit: { match: 'all', conditions: [closeBelow(100)] } }));
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 103_00, exitPricePaise: 97_00, exitReason: 'signal', exitTime: ist(26, 9, 35) });
  });

  it('stop and target: fills at the level; if one bar touches both, the stop is assumed first', () => {
    const base = [flat(99), [99, 101, 99, 101]];
    const s = strat({ stopLossPct: 2, targetPct: 3 }); // entry 100 -> stop 98, target 103
    const target = runBacktest(bars([...base, [100, 100.5, 99.5, 100], [100, 103.5, 99, 103]]), '5', s);
    expect(target.trades[0]).toMatchObject({ exitPricePaise: 103_00, exitReason: 'target' });
    const both = runBacktest(bars([...base, [100, 100.5, 99.5, 100], [100, 104, 97, 101]]), '5', s);
    expect(both.trades[0]).toMatchObject({ exitPricePaise: 98_00, exitReason: 'stop' });
  });

  it('a gap through the stop fills at the open, not at the stop price', () => {
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], [100, 100.5, 99.5, 100], [95, 96, 94, 95]]), '5', strat({ stopLossPct: 2 }));
    expect(r.trades[0]).toMatchObject({ exitPricePaise: 95_00, exitReason: 'stop' });
  });

  it('rounds stop and target against the trader', () => {
    // long entry 100.00: 0.33% stop = 99.67 exactly; 0.335% stop = 99.665 -> rounds DOWN to 99.66
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], [100, 100, 99, 99.5]]), '5', strat({ stopLossPct: 0.335 }));
    expect(r.trades[0]).toMatchObject({ exitPricePaise: 99_66, exitReason: 'stop' });
  });

  it('short positions profit when price falls', () => {
    const r = runBacktest(bars([flat(101), [101, 101, 99, 99], [98, 98, 97, 97], flat(96)]), '5',
      strat({ direction: 'SHORT', entry: { match: 'all', conditions: [closeBelow(100)] } }));
    const t = r.trades[0];
    expect(t).toMatchObject({ side: 'SHORT', entryPricePaise: 98_00, exitPricePaise: 96_00, grossPaise: 20_00 });
    expect(t.netPaise).toBe(20_00 - ch('SELL', 10, 98_00) - ch('BUY', 10, 96_00));
  });
});

describe('intraday (MIS) session rules', () => {
  it('squares off at the close of the last bar starting before 15:20 IST and never holds overnight', () => {
    // 75 bars: index 0 = 09:15 … 72 = 15:15, 73 = 15:20, 74 = 15:25
    const day = Array.from({ length: 75 }, (_, i) => (i === 1 ? [99, 101, 99, 101] : flat(i === 0 ? 99 : 102)));
    day[72] = [102, 102, 102, 104]; // the 15:15 bar closes at 104 (the price at 15:20)
    const r = runBacktest(bars(day), '5', strat());
    expect(r.trades[0]).toMatchObject({ exitTime: ist(26, 15, 15), exitPricePaise: 104_00, exitReason: 'square-off' });
  });

  it('labels an exit because the data ran out mid-session as end-of-data, not square-off', () => {
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], flat(102)]), '5', strat());
    expect(r.trades[0].exitReason).toBe('end-of-data');
  });

  it('takes no new entries at or after 15:15 IST', () => {
    const day = Array.from({ length: 75 }, () => flat(99));
    day[71] = [99, 101, 99, 101]; // signal at the 15:10 bar close -> would enter at 15:15: not allowed
    expect(runBacktest(bars(day), '5', strat()).trades).toHaveLength(0);
  });

  it('does not carry a signal from one day into the next morning', () => {
    const d1 = bars([...Array.from({ length: 74 }, () => flat(99)), [99, 101, 99, 101]], 26);
    const d2 = bars([flat(102), flat(102)], 27);
    expect(runBacktest([...d1, ...d2], '5', strat()).trades).toHaveLength(0);
  });
});

describe('money', () => {
  it('net P&L = gross − itemised charges on both legs, exact to the paisa', () => {
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], [100.05, 100.05, 100.05, 100.05], [105.35, 105.35, 105.35, 105.35]]), '5', strat());
    const t = r.trades[0];
    expect(t.grossPaise).toBe((105_35 - 100_05) * 10);
    expect(t.chargesPaise).toBe(ch('BUY', 10, 100_05) + ch('SELL', 10, 105_35));
    expect(r.metrics.finalEquityPaise).toBe(1_00_000_00 + t.netPaise);
  });

  it('capital sizing buys whole shares only', () => {
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], flat(333.33), flat(333.33)]), '5',
      strat({ sizing: { mode: 'capital', pct: 10 }, initialCapitalPaise: 10_000_00 }));
    expect(r.trades[0].qty).toBe(3); // ₹1,000 / ₹333.33 = 3.0000…3 -> 3
  });

  it('measures max drawdown from the equity peak', () => {
    // long 10 from 100; closes 100, 110 (peak +100), 90 (−200 from peak), 95
    const r = runBacktest(bars([flat(99), [99, 101, 99, 101], flat(100), flat(110), flat(90), flat(95)]), '5', strat({ product: 'CNC' }), );
    expect(r.metrics.maxDrawdownPaise).toBe(200_00); // 10 shares × (110 − 90); no charges fall between those bars
  });
});

describe('validation', () => {
  it('rejects strategies that cannot be traded', () => {
    const c = bars([flat(99), flat(101)]);
    expect(() => runBacktest(c, '5', strat({ product: 'CNC', direction: 'SHORT' }))).toThrow(BacktestError);
    expect(() => runBacktest(c, 'D', strat({ product: 'MIS' }))).toThrow(/intraday timeframe/);
    expect(() => runBacktest(c, '5', strat({ entry: { match: 'all', conditions: [] } }))).toThrow(/entry condition/);
    expect(() => runBacktest(c, '5', strat({ sizing: { mode: 'qty', qty: 0 } }))).toThrow(/Quantity/);
  });
});
