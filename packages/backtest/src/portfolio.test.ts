import { describe, expect, it } from 'vitest';
import { computeCharges, istToday } from '@mtv/paper';
import type { Candle } from '@mtv/shared';
import { runPortfolio, type EquityStrategy, type Instrument } from './portfolio';

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
