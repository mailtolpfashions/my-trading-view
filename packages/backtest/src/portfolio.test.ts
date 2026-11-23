import { describe, expect, it } from 'vitest';
import { computeCharges, istToday } from '@mtv/paper';
import type { Candle } from '@mtv/shared';
import { resample } from '@mtv/rules';
import { runPortfolio, type EquityStrategy, type Instrument, type MarketFilter } from './portfolio';

const IST = 5.5 * 3600;
/** Weekday bars from Mon 1 Jan 2024, stamped 09:15 IST: [open, high, low, close]. */
function bars(rows: [number, number, number, number][], volume = 1e6): Candle[] {
  const out: Candle[] = [];
  for (let t = Date.UTC(2024, 0, 1) / 1000; out.length < rows.length; t += 86400) {
    const d = new Date(t * 1000).getUTCDay();
    if (d === 0 || d === 6) continue;
    const [open, high, low, close] = rows[out.length];
    out.push({ time: t + 9 * 3600 + 15 * 60 - IST, open, high, low, close, volume });
  }
  return out;
}
const flat = (n: number, px = 90): [number, number, number, number][] => Array.from({ length: n }, () => [px, px, px, px]);

const base: EquityStrategy = {
  tf: 'D', side: 'LONG', entry: 'CLOSE > 100', exit: 'CLOSE < 100', order: { type: 'market' },
  stop: { kind: 'none' }, target: { kind: 'none' }, trail: { kind: 'none' }, sizing: { mode: 'qty', qty: 10 },
  maxOpen: 5, pyramid: 1, cooldownBars: 0, maxEntriesPerBar: 10, rank: 'CLOSE', minAvgValueCr: 0,
  capitalRupees: 100000, reinvest: false, slippagePct: 0, broker: 'zerodha', charges: false,
  from: '2024-01-01', to: '2024-12-31', riskFreePct: 0,
};
const run = (ins: Instrument[], s: Partial<EquityStrategy> = {}) => runPortfolio(ins, { ...base, ...s }, null);
const one = (rows: [number, number, number, number][]) => [{ symbol: 'AAA', daily: bars(rows) }];

describe('weekly / monthly trades are dated by real trading days', () => {
  it('a month that starts on a Saturday is entered on its first trading day, at that day\'s open', () => {
    // Jan–May 2024 = 110 weekdays at 90, May's last close 101 (the monthly signal); June opens Mon 3 Jun at 105.
    const rows = flat(110);
    rows[109] = [90, 101, 90, 101];
    const r = run(one([...rows, ...Array.from({ length: 10 }, () => [105, 106, 104, 105] as [number, number, number, number])]), { tf: 'M' });
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(istToday(t.entryTime * 1000)).toBe('2024-06-03');
    expect(t.entryPricePaise).toBe(10500);
    expect(istToday(t.exitTime * 1000)).toBe('2024-06-14'); // open at the end: the last trading day held, not 1 Jun
  });
});

describe('weekly buy that fills mid-week', () => {
  it('is not stopped by a low made earlier that week, before the fill', () => {
    // Week 1 closes 101 (signal), high 101 = the buy-stop trigger. Week 2: Monday dips to 80 without reaching 101,
    // Tuesday trades up through 101 (fill). The 5% stop (95.95) must not be hit by Monday's 80.
    const w1: [number, number, number, number][] = [...flat(4), [90, 101, 90, 101]];
    const w2: [number, number, number, number][] = [[95, 96, 80, 95], [100, 102, 99, 101], ...flat(3, 101)];
    const r = run(one([...w1, ...w2, ...flat(5, 101)]), { tf: 'W', exit: '', order: { type: 'stop', offsetPct: 0 }, stop: { kind: 'pct', value: 5 } });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].exitReason).not.toBe('stop');
    expect(istToday(r.trades[0].entryTime * 1000)).toBe('2024-01-09');
  });
  it('is stopped when the low after the fill reaches the stop, dated on or after the entry', () => {
    const w1: [number, number, number, number][] = [...flat(4), [90, 101, 90, 101]];
    const w2: [number, number, number, number][] = [[95, 96, 80, 95], [100, 102, 99, 101], [101, 101, 94, 95], ...flat(2, 95)];
    const r = run(one([...w1, ...w2, ...flat(5, 95)]), { tf: 'W', exit: '', order: { type: 'stop', offsetPct: 0 }, stop: { kind: 'pct', value: 5 } });
    expect(r.trades[0].exitReason).toBe('stop');
    expect(istToday(r.trades[0].exitTime * 1000)).toBe('2024-01-10');
    expect(r.trades[0].exitTime).toBeGreaterThanOrEqual(r.trades[0].entryTime);
  });
});

describe('stop at the low of the last 3 candles', () => {
  // Entry at 102 (day 2's open). Lows after entry: 101, 105, 108, 110 → on day 6 the last 3 completed lows are 105, 108,
  // 110: the stop is 105. Day 6 trades down to 104, so the trade stops out at 105 that day.
  const rows: [number, number, number, number][] = [[95, 96, 94, 101], [102, 104, 101, 103], [106, 107, 105, 106], [109, 110, 108, 109], [111, 112, 110, 111], [111, 111, 104, 106], ...flat(2, 106)];
  it('LOWEST(LOW, 3) uses the 3 latest completed candles', () => {
    const r = run(one(rows), { exit: '', stop: { kind: 'formula', formula: 'LOWEST(LOW, 3)' } });
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 10200, exitPricePaise: 10500, exitReason: 'stop' });
  });
  it('the older LOWEST(LOW, n)[1] form skips the latest candle (lows 101, 105, 108 → stop 101: not hit on day 6)', () => {
    const r = run(one(rows), { exit: '', stop: { kind: 'formula', formula: 'LOWEST(LOW, 3)[1]' } });
    expect(r.trades[0].exitReason).not.toBe('stop');
  });
});

describe('target at a formula level', () => {
  // Entry at 102 (day 2's open). The target is the previous close's HIGHEST(HIGH, 2) level, used from the bar after entry:
  // after day 2 it is 104 (highs 96, 104); day 3 reaches 105 → out at 104. A gap above the level fills at the open.
  it('sells where the bar first reaches the previous close\'s level', () => {
    const r = run(one([[95, 96, 94, 101], [102, 104, 101, 103], [103, 105, 102, 104], ...flat(2, 104)]), { exit: '', target: { kind: 'formula', formula: 'HIGHEST(HIGH, 2)' } });
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 10200, exitPricePaise: 10400, exitReason: 'target' });
  });
  it('a gap above the level fills at the open', () => {
    const r = run(one([[95, 96, 94, 101], [102, 104, 101, 103], [106, 107, 105, 106], ...flat(2, 106)]), { exit: '', target: { kind: 'formula', formula: 'HIGHEST(HIGH, 2)' } });
    expect(r.trades[0]).toMatchObject({ exitPricePaise: 10600, exitReason: 'target' });
  });
});

describe('stop at the signal candle\'s low', () => {
  it('is fixed at entry and does not move up with later lows', () => {
    // Signal on day 1 (close 101, low 94). Buy day 2 at 102. Lows then rise to 101, 105, 108: a moving stop would follow
    // them, this one stays at 94. Day 6 drops to 93 → stopped at 94.
    const rows: [number, number, number, number][] = [[90, 91, 89, 90], [95, 101, 94, 101], [102, 104, 101, 103], [106, 107, 105, 106], [109, 110, 108, 109], [100, 101, 93, 95], ...flat(2, 95)];
    const r = run(one(rows), { entry: 'CROSSOVER(CLOSE, 100)', exit: '', stop: { kind: 'signal-low' } });
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 10200, exitPricePaise: 9400, exitReason: 'stop' });
  });
});

describe('cash', () => {
  it('skips a signal when the cash left buys less than half the planned size (no 1-share leftovers)', () => {
    // Capital ₹1,000; 8 shares planned at ₹102 (₹816) for each of two stocks: ₹184 is left, 1 share for the second → skipped.
    const rows: [number, number, number, number][] = [[95, 96, 94, 95], [95, 96, 94, 101], [102, 104, 101, 103], [103, 104, 102, 103]];
    const r = run([{ symbol: 'AAA', daily: bars(rows) }, { symbol: 'BBB', daily: bars(rows) }], { sizing: { mode: 'qty', qty: 8 }, capitalRupees: 1000, entry: 'CROSSOVER(CLOSE, 100)', exit: '' });
    expect(r.trades.map((t) => [t.symbol, t.qty])).toEqual([['AAA', 8]]);
    expect(r.metrics.skippedCash).toBe(1);
  });
});

describe('fills', () => {
  it('enters at the next open after a signal and exits at the next open after the exit signal', () => {
    const r = run(one([[95, 96, 94, 99], [99, 102, 98, 101], [102, 104, 101, 103], [103, 103, 98, 99], [98, 99, 96, 97]]));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 10200, exitPricePaise: 9800, exitReason: 'signal', grossPaise: -4000, qty: 10, bars: 3 });
    expect(r.metrics.finalEquityPaise).toBe(10_000_000 - 4000);
  });

  it('assumes the stop came first when a bar touches both stop and target', () => {
    const r = run(one([[99, 101, 99, 101], [100, 120, 80, 100], ...flat(3)]), { exit: '', stop: { kind: 'pct', value: 5 }, target: { kind: 'pct', value: 10 } });
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 10000, exitPricePaise: 9500, exitReason: 'stop' });
  });

  it('fills a gap through the stop at the open, not at the stop', () => {
    const r = run(one([[99, 101, 99, 101], [100, 101, 99, 100], [90, 91, 85, 88], ...flat(2)]), { exit: '', stop: { kind: 'pct', value: 5 } });
    expect(r.trades[0]).toMatchObject({ exitPricePaise: 9000, exitReason: 'stop' });
  });

  it('a limit order fills only if the bar trades down to it, and lapses otherwise', () => {
    // Only the first bar signals (close above 100.8); the limit is 1% under its 101 close = 99.99.
    const miss = run(one([[99, 101, 99, 101], [101.5, 103, 100.5, 100.7], ...flat(3)]), { entry: 'CLOSE > 100.8', order: { type: 'limit', offsetPct: 1 } });
    expect(miss.trades).toHaveLength(0);
    expect(miss.metrics.unfilled).toBeGreaterThanOrEqual(1);
    const hit = run(one([[99, 101, 99, 101], [101.5, 103, 99, 100.7], ...flat(3)]), { entry: 'CLOSE > 100.8', order: { type: 'limit', offsetPct: 1 } });
    expect(hit.trades[0].entryPricePaise).toBe(9999); // 101 × 0.99 = 99.99
  });

  it('a stop order fills at the trigger, or at the open when it gaps above', () => {
    const r = run(one([[99, 101, 99, 101], [101, 103, 100, 102], ...flat(3)]), { order: { type: 'stop', offsetPct: 1 } });
    expect(r.trades[0].entryPricePaise).toBe(10201); // signal high 101 × 1.01
    const gap = run(one([[99, 101, 99, 101], [105, 106, 104, 105], ...flat(3)]), { order: { type: 'stop', offsetPct: 1 } });
    expect(gap.trades[0].entryPricePaise).toBe(10500);
  });

  it('a trailing stop moves at the close and is used from the next bar', () => {
    const rows: [number, number, number, number][] = [[99, 101, 99, 101], [100, 105, 99, 104], [110, 120, 113, 118], [117, 118, 113, 115], ...flat(2)];
    const r = run(one(rows), { exit: '', trail: { kind: 'pct', value: 5 } });
    // After bar 2 the best high is 120, so the trail is 114 from bar 3; bar 2's own low of 113 does not count.
    expect(r.trades[0]).toMatchObject({ exitReason: 'trail', exitPricePaise: 11400, bars: 3 });
  });

  it('applies slippage against the trader on both sides', () => {
    const r = run(one([[95, 96, 94, 99], [99, 102, 98, 101], [100, 104, 99, 103], [103, 103, 98, 99], [100, 101, 99, 100]]), { slippagePct: 1 });
    expect(r.trades[0]).toMatchObject({ entryPricePaise: 10100, exitPricePaise: 9900 });
  });
});

describe('sizing, slots and charges', () => {
  it('risk-based sizing: risk % of capital ÷ distance to the stop, from the signal close', () => {
    const r = run(one([[99, 101, 99, 100.5], [100, 101, 99, 100], ...flat(3)]), { entry: 'CLOSE > 100.25', sizing: { mode: 'risk', pct: 1 }, stop: { kind: 'pct', value: 5 } });
    // 1% of ₹1,00,000 = ₹1,000; the stop is 5% below the ₹100.50 close (₹5.03 a share) → 198 shares.
    expect(r.trades[0].qty).toBe(Math.floor(100000 / (10050 - Math.floor(10050 * 0.95))));
  });

  it('takes the highest-ranked signals when there are more than free slots', () => {
    const ins = [110, 130, 120].map((px, k) => ({ symbol: `S${k}`, daily: bars([[px, px, px, px], [px, px, px, px], ...flat(3)]) }));
    const r = run(ins, { entry: 'CLOSE > 100', exit: '', maxOpen: 2 });
    expect(r.trades.map((t) => t.symbol).sort()).toEqual(['S1', 'S2']);
    expect(r.metrics.skippedSlots).toBeGreaterThanOrEqual(1);
  });

  it('waits the cool-down after an exit before re-entering the same stock', () => {
    const rows: [number, number, number, number][] = [[101, 101, 101, 101], [101, 101, 99, 99], [99, 101, 99, 101], [101, 101, 101, 101], [101, 101, 101, 101], [101, 101, 101, 101]];
    expect(run(one(rows), { cooldownBars: 0 }).trades).toHaveLength(2);
    expect(run(one(rows), { cooldownBars: 3 }).trades).toHaveLength(1);
  });

  it('pays the exact itemised delivery charges on both legs', () => {
    const r = run(one([[95, 96, 94, 99], [99, 102, 98, 101], [102, 104, 101, 103], [103, 103, 98, 99], [98, 99, 96, 97]]), { charges: true, sizing: { mode: 'qty', qty: 100 } });
    const t = r.trades[0];
    const buy = computeCharges({ side: 'BUY', product: 'CNC', qty: 100, pricePaise: 10200, date: istToday(t.entryTime * 1000) }).total;
    const sell = computeCharges({ side: 'SELL', product: 'CNC', qty: 100, pricePaise: 9800, firstDeliverySellToday: true, date: istToday(t.exitTime * 1000) }).total;
    expect(t.chargesPaise).toBe(buy + sell);
    expect(r.metrics.finalEquityPaise).toBe(10_000_000 + t.grossPaise - buy - sell);
  });

  it('refuses short strategies and risk sizing without a stop, with a reason', () => {
    expect(() => run(one(flat(5)), { side: 'SHORT' as 'LONG' })).toThrow(/cash market/);
    expect(() => run(one(flat(5)), { sizing: { mode: 'risk', pct: 1 } })).toThrow(/needs a stop/);
  });
});

describe('honesty over a real-looking portfolio', () => {
  // Five stocks of random walks over three years.
  const walk = (seed: number): Candle[] => {
    let x = seed, p = 100;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    return bars(Array.from({ length: 780 }, () => {
      const o = p * (1 + (rnd() - 0.5) * 0.02), c = o * (1 + (rnd() - 0.5) * 0.05);
      p = c;
      return [o, Math.max(o, c) * (1 + rnd() * 0.01), Math.min(o, c) * (1 - rnd() * 0.01), c] as [number, number, number, number];
    }));
  };
  const ins = [3, 7, 11, 19, 23].map((k) => ({ symbol: `W${k}`, daily: walk(k) }));
  const s: Partial<EquityStrategy> = {
    entry: 'CROSSOVER(EMA(CLOSE, 5), EMA(CLOSE, 20)) AND [W] (CLOSE > EMA(CLOSE, 10))', exit: 'CROSSUNDER(EMA(CLOSE, 5), EMA(CLOSE, 20))',
    stop: { kind: 'atr', mult: 2, length: 14 }, trail: { kind: 'pct', value: 8 }, target: { kind: 'rr', value: 3 },
    sizing: { mode: 'percent', pct: 25 }, maxOpen: 3, reinvest: true, charges: true, slippagePct: 0.1, from: '2024-03-01', to: '2026-12-31',
  };

  it('trades closed before a day are identical whether or not later data exists', () => {
    const full = run(ins, s);
    expect(full.trades.length).toBeGreaterThan(10);
    for (const cutAt of [300, 450, 600]) {
      const cutTime = ins[0].daily[cutAt].time;
      const cut = run(ins.map((i) => ({ ...i, daily: i.daily.filter((b) => b.time <= cutTime) })), s);
      const done = (r: typeof full) => r.trades.filter((t) => !t.open && t.exitTime < cutTime && t.exitReason !== 'data-ended');
      expect(done(cut)).toEqual(done(full));
    }
  });

  it('metrics agree with the equity curve and the trades', () => {
    const r = run(ins, s);
    const m = r.metrics;
    expect(m.trades).toBe(r.trades.length);
    expect(m.wins + m.losses).toBe(m.trades);
    // Every rupee of P&L is accounted for: final equity = start + sum of trade nets (all positions closed at the end).
    expect(m.finalEquityPaise).toBe(m.initialCapitalPaise + r.trades.reduce((a, t) => a + t.netPaise, 0));
    // Max drawdown recomputed from the curve.
    let peak = m.initialCapitalPaise, dd = 0;
    for (const e of r.equity) { peak = Math.max(peak, e.equityPaise); dd = Math.max(dd, peak - e.equityPaise); }
    expect(m.maxDrawdownPaise).toBe(dd);
    expect(r.years.reduce((a, y) => a + y.trades, 0)).toBe(m.trades);
    expect(Math.max(...r.equity.map((e) => e.open))).toBeLessThanOrEqual(3);
  });
});

describe('index as the instrument', () => {
  const rows: [number, number, number, number][] = [[95, 96, 94, 99], [99, 102, 98, 101], [102, 104, 101, 103], [103, 103, 98, 99], [98, 99, 96, 97]];
  const idx: Instrument[] = [{ symbol: 'NIFTY', daily: bars(rows, 0), kind: 'index' }];
  it('trades although index files carry no volume (no traded-value check)', () => {
    expect(run(idx, { minAvgValueCr: 5 }).trades).toHaveLength(1);
    expect(run([{ ...idx[0], kind: 'equity' }], { minAvgValueCr: 5 }).trades).toHaveLength(0);
  });
  it('is charged at index futures rates, not stock delivery rates', () => {
    const fut = run(idx, { charges: true }).trades[0];
    const eq = run([{ ...idx[0], kind: 'equity' }], { charges: true }).trades[0];
    expect(fut.chargesPaise).toBeGreaterThan(0);
    expect(fut.chargesPaise).toBeLessThan(eq.chargesPaise); // delivery STT (0.1% each side) is far above futures STT
    expect(fut.grossPaise).toBe(eq.grossPaise);
  });
});

describe('intraday', () => {
  // 5-minute bars from 09:15 IST; `px(day, k)` gives [open, high, low, close] for bar k (0 = 09:15, 74 = 15:25).
  function day5m(dayIndex: number, px: (k: number) => [number, number, number, number], bars = 75): Candle[] {
    const day0 = Date.UTC(2024, 0, 1 + dayIndex) / 1000 - IST;
    return Array.from({ length: bars }, (_, k) => {
      const [open, high, low, close] = px(k);
      return { time: day0 + 9 * 3600 + 15 * 60 + k * 300, open, high, low, close, volume: 1000 };
    });
  }
  const daily = (b: Candle[]) => resample(b, 'D');
  const ins = (b: Candle[]): Instrument[] => [{ symbol: 'AAA', daily: daily(b), intraday: new Map([['5m', b]]) }];
  const flatPx = (v: number) => (): [number, number, number, number] => [v, v, v, v];
  const intra: Partial<EquityStrategy> = { tf: '5m', exit: '', from: '2024-01-01', to: '2024-01-31' };

  it('squares off at the open of the 15:15 bar and never holds overnight', () => {
    // A signal at the 09:25 close (bar 2) fills at the 09:30 open (bar 3); nothing else signals.
    const d1 = day5m(0, (k) => (k === 2 ? [99, 101, 99, 101] : k === 3 ? [100, 100, 100, 100] : k === 72 ? [104, 104, 104, 104] : [99, 99, 99, 99]));
    const d2 = day5m(1, flatPx(99));
    const r = run(ins([...d1, ...d2]), intra);
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.exitReason).toBe('square-off');
    expect(t.entryPricePaise).toBe(10000);
    expect(t.exitPricePaise).toBe(10400); // 15:15 is bar 72
    expect(new Date((t.exitTime + IST) * 1000).toISOString().slice(11, 16)).toBe('15:15');
  });

  it('does not carry a signal on the day\'s last bar to the next morning', () => {
    const d1 = day5m(0, (k) => (k === 74 ? [99, 101, 99, 101] : [99, 99, 99, 99]));
    const d2 = day5m(1, flatPx(99));
    const r = run(ins([...d1, ...d2]), intra);
    expect(r.trades).toHaveLength(0);
    expect(r.metrics.lateEntry).toBe(1);
  });

  it('takes no entry whose fill would come at or after the last-entry time', () => {
    // bar 68 = 14:55; its close is 15:00, so the fill would be at 15:00 itself
    const d1 = day5m(0, (k) => (k === 68 ? [99, 101, 99, 101] : [99, 99, 99, 99]));
    expect(run(ins(d1), intra).trades).toHaveLength(0);
    expect(run(ins(d1), { ...intra, intraday: { lastEntry: '15:05', squareOff: '15:20' } }).trades).toHaveLength(1);
  });

  it('squares off at the last bar of a short day, at its close', () => {
    const d1 = day5m(0, (k) => (k === 2 ? [99, 101, 99, 101] : k === 20 ? [99, 99, 99, 103] : [99, 99, 99, 99]), 21); // data ends 10:55
    const d2 = day5m(1, flatPx(99));
    const t = run(ins([...d1, ...d2]), intra).trades[0];
    expect(t.exitReason).toBe('square-off');
    expect(t.exitPricePaise).toBe(10300);
  });

  it('charges stocks as intraday (MIS)', () => {
    const d1 = day5m(0, (k) => (k === 2 ? [99, 101, 99, 101] : k === 3 ? [100, 100, 100, 100] : k === 72 ? [104, 104, 104, 104] : [99, 99, 99, 99]));
    const t = run(ins(d1), { ...intra, charges: true }).trades[0];
    const day = istToday(t.entryTime * 1000);
    const mis = computeCharges({ side: 'BUY', product: 'MIS', qty: 10, pricePaise: 10000, date: day }).total
      + computeCharges({ side: 'SELL', product: 'MIS', qty: 10, pricePaise: 10400, date: day }).total;
    expect(t.chargesPaise).toBe(mis);
  });

  it('takes no entry that would fill before the start time', () => {
    // bar 0 (09:15) signals; its order would fill at 09:20
    const d1 = day5m(0, (k) => (k === 0 ? [99, 101, 99, 101] : [99, 99, 99, 99]));
    expect(run(ins(d1), intra).trades).toHaveLength(1);
    const late = run(ins(d1), { ...intra, intraday: { firstEntry: '09:25', lastEntry: '15:00', squareOff: '15:15' } });
    expect(late.trades).toHaveLength(0);
    expect(late.metrics.earlyEntry).toBe(1);
  });

  it('refuses bad session times', () => {
    expect(() => run(ins(day5m(0, flatPx(99))), { ...intra, intraday: { lastEntry: '15:20', squareOff: '15:15' } })).toThrow(/before the square-off/);
  });
});

describe('market filter (a rule on another chart, e.g. NIFTY)', () => {
  // The stock closes at 101 every day (entry rule true), opens at 101+day so each fill shows which day it happened.
  const stock = () => [{ symbol: 'AAA', daily: bars(Array.from({ length: 12 }, (_, d) => [101 + d, 102 + d, 100, 101] as [number, number, number, number])) }];
  const mkt = (closes: number[]) => bars(closes.map((c) => [c, c, c, c] as [number, number, number, number]));
  const on: MarketFilter = { symbol: 'NIFTY', rule: 'CLOSE > 60', whenOff: 'keep' };
  const go = (closes: number[], m: Partial<MarketFilter> = {}, s: Partial<EquityStrategy> = {}) =>
    runPortfolio(stock(), { ...base, exit: '', ...s, market: { ...on, ...m } }, null, mkt(closes));

  it('no buys while the rule is off; the first buy follows the first close where it is on', () => {
    const r = go([50, 50, 50, 70, 70, 70, 70, 70, 70, 70, 70, 70]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entryPricePaise).toBe(10500); // signal at day 3's close (market on that close), fill day 4's open
    expect(r.metrics.marketOff).toBe(3);
  });
  it('reads the market at the same close as the stock, never a later one', () => {
    const a = go([50, 50, 50, 50, 70, 70, 70, 70, 70, 70, 70, 70]);
    expect(a.trades[0].entryPricePaise).toBe(10600); // on from day 4's close → fill day 5
    // Changing the market after day 4 changes nothing up to then.
    const b = go([50, 50, 50, 50, 70, 10, 10, 10, 10, 10, 10, 10]);
    expect(b.trades[0].entryPricePaise).toBe(10600);
  });
  it('sell-all exits every holding at the next open with reason "market"; keep holds on', () => {
    const closes = [70, 70, 70, 50, 50, 50, 50, 50, 50, 50, 50, 50];
    const sold = go(closes, { whenOff: 'sell-all' });
    expect(sold.trades[0]).toMatchObject({ entryPricePaise: 10200, exitPricePaise: 10500, exitReason: 'market' });
    const kept = go(closes, { whenOff: 'keep' });
    expect(kept.trades).toHaveLength(1);
    expect(kept.trades[0].exitReason).toBe('end-of-test');
  });
  it('size scale multiplies the quantity, clamped to 0..1', () => {
    const closes = Array.from({ length: 12 }, () => 70);
    expect(go(closes, { rule: '', sizeScale: '0.5' }).trades[0].qty).toBe(5);
    expect(go(closes, { rule: '', sizeScale: '3' }).trades[0].qty).toBe(10);
    expect(go(closes, { rule: '', sizeScale: '0' }).trades).toHaveLength(0);
  });
  it('is refused on weekly / monthly strategies and without market bars', () => {
    expect(() => runPortfolio(stock(), { ...base, tf: 'W', market: on }, null, mkt([70]))).toThrow(/daily and intraday/);
    expect(() => runPortfolio(stock(), { ...base, market: on }, null, null)).toThrow(/No daily history for NIFTY/);
  });
});

describe('market filter on an intraday strategy', () => {
  // Day 0 and day 1 of 5-minute bars; a signal at day 1's 09:25 close fills at 09:30.
  const day5m = (dayIndex: number, sig: boolean): Candle[] => Array.from({ length: 75 }, (_, k) => {
    const v = sig && k === 2 ? 101 : 99;
    return { time: Date.UTC(2024, 0, 1 + dayIndex) / 1000 - IST + 9 * 3600 + 15 * 60 + k * 300, open: 99, high: v, low: 99, close: v, volume: 1000 };
  });
  const b = [...day5m(0, false), ...day5m(1, true)];
  const ins: Instrument[] = [{ symbol: 'AAA', daily: resample(b, 'D'), intraday: new Map([['5m', b]]) }];
  const mkt = (c0: number, c1: number) => bars([[c0, c0, c0, c0], [c1, c1, c1, c1]]);
  const go = (c0: number, c1: number) => runPortfolio(ins, { ...base, tf: '5m', exit: '', from: '2024-01-01', to: '2024-01-31', market: { symbol: 'NIFTY', rule: 'CLOSE > 60', whenOff: 'keep' } }, null, mkt(c0, c1));
  it('uses the market\'s previous day, since today\'s daily bar is not finished', () => {
    expect(go(70, 50).trades).toHaveLength(1); // yesterday on, today's (unknown at 09:25) off
    expect(go(50, 70).trades).toHaveLength(0); // yesterday off
  });
});
