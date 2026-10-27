// Turns backtest trades into signal records and summary statistics. Every number is computed from the same engine
// as the backtester, on NSE's official (adjusted) daily data, net of all charges.

import type { BacktestTrade } from '@mtv/backtest';
import type { Candle } from '@mtv/shared';

export type SignalTrade = {
  symbol: string;
  /** Session whose close produced the entry signal. */
  signalDate: string;
  entryDate: string;
  entryPrice: number; // rupees, adjusted
  /** Null while the position is still open. */
  exitDate: string | null;
  /** Exit price, or the latest close while open. */
  exitPrice: number;
  exitReason: BacktestTrade['exitReason'] | 'open';
  /** Net of all charges, as % of the amount invested. */
  returnPct: number;
  sessions: number;
  /** True when the signal was published before the entry session opened (counts toward the live record). */
  live: boolean;
};

const IST = 5.5 * 3600;
export const istDate = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);

/** Converts engine trades for one stock; `isLive` decides, per trade, whether it was published in time. */
export function toSignalTrades(symbol: string, candles: Candle[], trades: BacktestTrade[], isLive: (signalDate: string, entryTime: number) => boolean): SignalTrade[] {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  return trades.map((t) => {
    const i = index.get(t.entryTime)!;
    const signalDate = istDate(candles[Math.max(0, i - 1)].time);
    const open = t.exitReason === 'end-of-data';
    return {
      symbol, signalDate,
      entryDate: istDate(t.entryTime), entryPrice: t.entryPricePaise / 100,
      exitDate: open ? null : istDate(t.exitTime), exitPrice: t.exitPricePaise / 100,
      exitReason: open ? 'open' : t.exitReason,
      returnPct: (t.netPaise / (t.entryPricePaise * t.qty)) * 100,
      sessions: t.bars,
      live: isLive(signalDate, t.entryTime),
    };
  });
}

export type SignalStats = {
  signals: number;
  closed: number;
  open: number;
  wins: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  bestPct: number | null;
  worstPct: number | null;
  maxConsecutiveLosses: number;
  avgSessions: number | null;
  from: string | null;
  to: string | null;
};

/** Statistics over closed trades (open ones are counted, not scored). Losing streaks run in exit-date order. */
export function signalStats(trades: SignalTrade[]): SignalStats {
  const closed = trades.filter((t) => t.exitDate).sort((a, b) => (a.exitDate! < b.exitDate! ? -1 : a.exitDate! > b.exitDate! ? 1 : 0));
  const r = closed.map((t) => t.returnPct);
  const wins = r.filter((x) => x > 0), losses = r.filter((x) => x <= 0);
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const sorted = [...r].sort((a, b) => a - b);
  const median = !sorted.length ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  let streak = 0, maxStreak = 0;
  for (const x of r) { streak = x <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const lossSum = -losses.reduce((s, x) => s + x, 0);
  const dates = trades.map((t) => t.signalDate).sort();
  return {
    signals: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    wins: wins.length,
    winRatePct: r.length ? (wins.length / r.length) * 100 : null,
    avgReturnPct: mean(r),
    medianReturnPct: median,
    avgWinPct: mean(wins),
    avgLossPct: mean(losses),
    profitFactor: lossSum > 0 ? wins.reduce((s, x) => s + x, 0) / lossSum : null,
    bestPct: r.length ? Math.max(...r) : null,
    worstPct: r.length ? Math.min(...r) : null,
    maxConsecutiveLosses: maxStreak,
    avgSessions: mean(closed.map((t) => t.sessions)),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}
