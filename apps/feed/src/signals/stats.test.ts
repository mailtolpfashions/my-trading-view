import { describe, expect, it } from 'vitest';
import type { BacktestTrade } from '@mtv/backtest';
import { dayTime } from '../eod/adjust';
import { signalStats, toSignalTrades, type SignalTrade } from './stats';

const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
const candles = days.map((d) => ({ time: dayTime(d), open: 100, high: 100, low: 100, close: 100, volume: 1 }));
const trade = (entryDay: number, exitDay: number, entry: number, exit: number, net: number, reason: BacktestTrade['exitReason'] = 'signal'): BacktestTrade => ({
  side: 'LONG', qty: 10, entryTime: dayTime(days[entryDay]), entryPricePaise: entry, exitTime: dayTime(days[exitDay]), exitPricePaise: exit,
  exitReason: reason, grossPaise: (exit - entry) * 10, chargesPaise: (exit - entry) * 10 - net, netPaise: net, bars: exitDay - entryDay + 1,
});

describe('signal trades', () => {
  it('dates each trade by the session that produced the signal (the bar before entry), and returns are net of charges', () => {
    const [t] = toSignalTrades('X', candles, [trade(2, 4, 100_00, 110_00, 9_000)], () => true);
    expect(t).toMatchObject({ symbol: 'X', signalDate: '2024-01-02', entryDate: '2024-01-03', exitDate: '2024-01-05', entryPrice: 100, exitPrice: 110, sessions: 3, live: true });
    expect(t.returnPct).toBeCloseTo(9, 10); // ₹90 net on ₹1,000 invested
  });
  it('a position still open is marked, not closed', () => {
    const [t] = toSignalTrades('X', candles, [trade(3, 4, 100_00, 105_00, 4_000, 'end-of-data')], () => false);
    expect(t).toMatchObject({ exitDate: null, exitReason: 'open', live: false });
  });
  it('asks whether each trade was published in time, using its signal date and entry time', () => {
    const calls: [string, number][] = [];
    toSignalTrades('X', candles, [trade(1, 2, 100_00, 101_00, 0)], (d, t) => { calls.push([d, t]); return false; });
    expect(calls).toEqual([['2024-01-01', dayTime('2024-01-02')]]);
  });
});

describe('signal statistics', () => {
  const t = (signalDate: string, exitDate: string | null, returnPct: number, sessions = 5): SignalTrade => ({
    symbol: 'X', signalDate, entryDate: signalDate, entryPrice: 100, exitDate, exitPrice: 100, exitReason: exitDate ? 'signal' : 'open', returnPct, sessions, live: false,
  });
  it('scores closed trades only and counts open ones separately', () => {
    const s = signalStats([t('2024-01-01', '2024-01-05', 10), t('2024-01-02', '2024-01-06', -5), t('2024-01-03', '2024-01-07', 4), t('2024-01-04', null, 50)]);
    expect(s).toMatchObject({ signals: 4, closed: 3, open: 1, wins: 2, bestPct: 10, worstPct: -5, medianReturnPct: 4, from: '2024-01-01', to: '2024-01-04' });
    expect(s.winRatePct).toBeCloseTo(66.667, 2);
    expect(s.avgReturnPct).toBeCloseTo(3, 10);
    expect(s.profitFactor).toBeCloseTo(14 / 5, 10);
  });
  it('losing streaks follow exit order, and a break-even trade counts as a loss', () => {
    const s = signalStats([t('2024-01-01', '2024-01-10', 0), t('2024-01-02', '2024-01-03', -1), t('2024-01-03', '2024-01-04', -2), t('2024-01-05', '2024-01-06', 3)]);
    expect(s.maxConsecutiveLosses).toBe(2); // exits 03 (-1), 04 (-2), then 06 (+3), then 10 (0)
  });
  it('is empty-safe', () => {
    expect(signalStats([])).toMatchObject({ signals: 0, winRatePct: null, avgReturnPct: null, profitFactor: null, maxConsecutiveLosses: 0 });
  });
});
