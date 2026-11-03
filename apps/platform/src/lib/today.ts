// The Today page: the day's mode and limits, and the brief (apps/feed/src/today/brief.ts) plus the dashboard's
// breadth and flows.

import type { Tf } from '@mtv/rules';
import type { Timeframe } from '@mtv/shared';
import { feed, useFeed } from './feed';

export type DaySettings = { mode: 'intraday' | 'swing' | 'positional'; capitalRupees: number; riskPerTradePct: number; maxDailyLossRupees: number; maxTradesPerDay: number };

export type IndexLevels = {
  symbol: string; session: string; open: number; high: number; low: number; close: number; changePct: number | null;
  pivots: Record<'P' | 'R1' | 'R2' | 'R3' | 'S1' | 'S2' | 'S3', number>;
  cpr: { top: number; bottom: number; widthPct: number; narrowerThan: number; of: number };
  ranges: Record<'week' | 'month' | 'year', { high: number; low: number }>;
  trend: { ema20: number | null; ema50: number | null; ema200: number | null; rsi14: number | null; supertrendUp: boolean };
  live: { ltp: number; changePct: number; open: number; gapPct: number; high: number; low: number; openingRange: { high: number; low: number } | null; lastBar: number; facts: string[] } | null;
};

export type Brief = {
  today: string; live: boolean; greeting: string; name: string | null; indices: IndexLevels[];
  market: { state: 'pre' | 'open' | 'closed'; minutes: number | null; text: string };
  options: { underlying: string; date: string; expiry: string; daysToExpiry: number; spot: number | null; pcr: number | null; maxPain: number | null; atmIv: number | null; ivRank: number | null; ivPercentile: number | null; straddle: number | null; impliedMovePct: number | null; callWall: number | null; putWall: number | null }[] | null;
  volumeSpikes: { symbol: string; rvol: number; changePct: number; close: number; basis: 'today so far' | 'last session' }[];
  /** The volume scan runs in the background; true until a fresh result is ready. */
  volumeUpdating: boolean;
  needsYou: { alertsToday: number; latest: { name: string; symbols: string[]; at: string }[] };
  vix: { close: number; changePct: number; percentile: number; yearLow: number; yearHigh: number } | null;
  sectors: { name: string; close: number; d1: number; w1: number; m1: number }[];
  expiries: { underlying: string; expiry: string; calendarDays: number }[];
};

export type IndexCard = { symbol: string; date: string; open: number; high: number; low: number; close: number; prevClose: number | null; change: number | null; changePct: number | null };
export type StockMove = { symbol: string; close?: number; changePct: number };
export type Breadth = { advances: number; declines: number; unchanged: number; members?: number; notTraded?: string[] };
export type FiiPositions = { date: string; futLong: number; futShort: number; callLong: number; callShort: number; putLong: number; putShort: number };

export type Dashboard = {
  asOf: string;
  indices?: IndexCard[];
  nifty50: { breadth: Breadth; gainers: StockMove[]; losers: StockMove[] } | null;
  nifty500: { breadth: Breadth } | null;
  fii: { latest: FiiPositions; previous: FiiPositions | null } | null;
  fpi: { reportDate: string; netCr: number } | null;
};

export type TradingMode = DaySettings['mode'];
export const MODE_LABEL: Record<TradingMode, string> = { intraday: 'Intraday', swing: 'Swing', positional: 'Positional' };
/** Where each mode starts: the screener's timeframe for a new screen and the chart's timeframe. */
export const MODE_TF: Record<TradingMode, { screen: Tf; chart: Timeframe; screenWords: string; chartWords: string }> = {
  intraday: { screen: '5m', chart: '5', screenWords: '5-minute', chartWords: '5-minute' },
  swing: { screen: 'D', chart: 'D', screenWords: 'daily', chartWords: 'daily' },
  positional: { screen: 'D', chart: 'W', screenWords: 'daily', chartWords: 'weekly' },
};

/** The mode picked on the Today page (the last one this browser saw at once, then the saved one). */
export function useTradingMode(): TradingMode | null {
  return useFeed<DaySettings>('user/settings').data?.mode ?? null;
}

/**
 * True the first time `where` sees `mode` since the mode last changed, so a page applies the mode's defaults once and
 * the owner's own choices on that page hold until the next change of mode.
 */
export function modeIsNew(where: string, mode: TradingMode): boolean {
  try {
    const key = `platform.mode.${where}`;
    if (localStorage.getItem(key) === mode) return false;
    localStorage.setItem(key, mode);
    return true;
  } catch { return false; }
}

export const todayApi = {
  brief: () => feed<Brief>('today'),
  dashboard: () => feed<Dashboard>('dashboard'),
  settings: () => feed<DaySettings>('user/settings'),
  saveSettings: (s: Partial<DaySettings>) => feed<DaySettings>('user/settings', s),
};
