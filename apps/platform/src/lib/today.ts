// The Today page: the day's mode and limits, and the brief (apps/feed/src/today/brief.ts) plus the dashboard's
// breadth and flows.

import { feed } from './feed';

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
  needsYou: { alertsToday: number; latest: { name: string; symbols: string[]; at: string }[] };
  vix: { close: number; changePct: number; percentile: number; yearLow: number; yearHigh: number } | null;
  sectors: { name: string; close: number; d1: number; w1: number; m1: number }[];
  expiries: { underlying: string; expiry: string; calendarDays: number }[];
};

export type Dashboard = {
  asOf: string;
  nifty50: { breadth: { advances: number; declines: number; unchanged: number }; gainers: { symbol: string; changePct: number }[]; losers: { symbol: string; changePct: number }[] } | null;
  nifty500: { breadth: { advances: number; declines: number; unchanged: number } } | null;
  fii: { latest: FiiPos; previous: FiiPos | null } | null;
  fpi: { reportDate: string; netCr: number } | null;
};
type FiiPos = { date: string; futLong: number; futShort: number; callLong: number; callShort: number; putLong: number; putShort: number };

export const todayApi = {
  brief: () => feed<Brief>('today'),
  dashboard: () => feed<Dashboard>('dashboard'),
  settings: () => feed<DaySettings>('user/settings'),
  saveSettings: (s: Partial<DaySettings>) => feed<DaySettings>('user/settings', s),
};
