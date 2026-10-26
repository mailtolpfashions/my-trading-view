// Invariants that must hold for any strategy on real market data (NIFTY 5m, Sep–Oct 2026 fixture).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { runBacktest, type Strategy } from './index';

const candles: Candle[] = JSON.parse(readFileSync(new URL('../../indicators/fixtures/nifty-5m-2026-10-26.json', import.meta.url), 'utf8')).candles;
const IST = 5.5 * 3600;
const minuteOfDay = (t: number) => Math.floor(((t + IST) % 86400) / 60);
const day = (t: number) => Math.floor((t + IST) / 86400);

const strategies: Strategy[] = [
  {
    name: 'EMA 9/21 cross, intraday long', direction: 'LONG', product: 'MIS', initialCapitalPaise: 10_00_000_00, sizing: { mode: 'qty', qty: 50 },
    entry: { match: 'all', conditions: [{ left: { kind: 'indicator', name: 'EMA', params: [9] }, op: 'crossesAbove', right: { kind: 'indicator', name: 'EMA', params: [21] } }] },
    exit: { match: 'all', conditions: [{ left: { kind: 'indicator', name: 'EMA', params: [9] }, op: 'crossesBelow', right: { kind: 'indicator', name: 'EMA', params: [21] } }] },
    stopLossPct: 0.3, targetPct: 0.6,
  },
  {
    name: 'RSI 30/70, intraday short', direction: 'SHORT', product: 'MIS', initialCapitalPaise: 10_00_000_00, sizing: { mode: 'capital', pct: 50 },
    entry: { match: 'all', conditions: [{ left: { kind: 'indicator', name: 'RSI', params: [14] }, op: 'crossesBelow', right: { kind: 'number', value: 70 } }] },
    exit: { match: 'any', conditions: [{ left: { kind: 'indicator', name: 'RSI', params: [14] }, op: '<', right: { kind: 'number', value: 30 } }] },
  },
  {
    name: 'Supertrend positional long', direction: 'LONG', product: 'CNC', initialCapitalPaise: 10_00_000_00, sizing: { mode: 'qty', qty: 10 },
    entry: { match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'indicator', name: 'SUPERTREND', params: [10, 3] } }] },
    exit: { match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: 'crossesBelow', right: { kind: 'indicator', name: 'SUPERTREND', params: [10, 3] } }] },
  },
];

describe.each(strategies)('$name', (s) => {
  const r = runBacktest(candles, '5', s);
  const byTime = new Map(candles.map((c, i) => [c.time, i]));

  it('produces trades on real data', () => expect(r.trades.length).toBeGreaterThan(0));

  it('final equity = starting capital + Σ net trade P&L, to the paisa', () => {
    expect(r.metrics.finalEquityPaise).toBe(s.initialCapitalPaise + r.trades.reduce((a, t) => a + t.netPaise, 0));
  });

  it('every entry is at a bar OPEN (never the signal bar close)', () => {
    for (const t of r.trades) expect(t.entryPricePaise).toBe(Math.round(candles[byTime.get(t.entryTime)!].open * 100));
  });

  it('every fill price lies within its bar\'s high–low range', () => {
    for (const t of r.trades) {
      for (const [time, price] of [[t.entryTime, t.entryPricePaise], [t.exitTime, t.exitPricePaise]]) {
        const c = candles[byTime.get(time)!];
        expect(price).toBeGreaterThanOrEqual(Math.round(c.low * 100) - 1); // stop/target levels round against the trader by < 1 paisa
        expect(price).toBeLessThanOrEqual(Math.round(c.high * 100) + 1);
      }
    }
  });

  it('trades never overlap, and intraday trades never cross midnight or 15:20', () => {
    for (let i = 1; i < r.trades.length; i++) expect(r.trades[i].entryTime).toBeGreaterThanOrEqual(r.trades[i - 1].exitTime);
    if (s.product === 'MIS') for (const t of r.trades) {
      expect(day(t.entryTime)).toBe(day(t.exitTime));
      expect(minuteOfDay(t.entryTime)).toBeLessThan(15 * 60 + 15);
      expect(minuteOfDay(t.exitTime)).toBeLessThan(15 * 60 + 20);
    }
  });

  it('net = gross − charges on every trade, and charges are never zero', () => {
    for (const t of r.trades) {
      expect(t.netPaise).toBe(t.grossPaise - t.chargesPaise);
      expect(t.chargesPaise).toBeGreaterThan(0);
    }
  });
});
