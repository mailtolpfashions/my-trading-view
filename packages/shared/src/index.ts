// Types shared by the feed service and the web app.

import type { PaperSnapshot } from '@mtv/paper';

/** Chart interval: minutes as a string, or D / W for daily and weekly bars. */
export type Timeframe = '1' | '5' | '15' | '30' | '60' | 'D' | 'W';
export const TIMEFRAMES: Timeframe[] = ['1', '5', '15', '30', '60', 'D', 'W'];

/** One OHLCV bar. `time` is the bar's open time in UTC epoch seconds. */
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type Exchange = 'NSE' | 'BSE' | 'NFO' | 'BFO';
export type InstrumentKind = 'INDEX' | 'EQUITY' | 'FUTURE' | 'OPTION';

export type Instrument = {
  /** Our symbol, e.g. NIFTY, RELIANCE. Unique per exchange. */
  symbol: string;
  name: string;
  exchange: Exchange;
  kind: InstrumentKind;
};

export type Quote = {
  symbol: string;
  ltp: number;
  prevClose: number;
  change: number;
  changePct: number;
  /** UTC epoch seconds of the price. */
  time: number;
};

export type DataStatus = {
  provider: 'free' | 'kite';
  /** True when prices are delayed (free sources); the UI shows a badge. */
  delayed: boolean;
};

export type MarketSession = 'pre-open' | 'open' | 'closed';

/**
 * Result of auditing a candle series against the NSE session grid (09:15–15:30 IST).
 * Gaps are reported, never filled: inventing bars would make indicator values wrong.
 */
export type DataQuality = {
  ok: boolean;
  /** Open times (UTC seconds) of intraday bars the source did not provide. */
  missing: number[];
  /** Bars whose high/low do not contain open/close, or with non-positive prices. Dropped from the series. */
  invalid: number[];
  /** Bars not aligned to the timeframe grid, or duplicated. Dropped from the series. */
  misaligned: number[];
  /**
   * Frozen intraday bars (O=H=L=C equal to the previous close). Kept, because the true values are unknown,
   * but flagged: the free source freezes prices around 15:15–15:20 IST, while the real market keeps trading.
   */
  suspect: number[];
  /**
   * Daily charts only: comparison with NSE's official end-of-day files. Where an official record exists it
   * replaces the free source's bar, and every replaced bar is listed so the user can see what changed.
   */
  official?: {
    verified: number;
    corrected: { time: number; fields: string[] }[];
    /** Bars kept as-is because they differ from NSE's record by a uniform split/bonus ratio (prices are adjusted). */
    adjusted: number[];
    latest: string | null;
  };
};

// ---- WebSocket protocol (browser <-> feed) ----
export type ClientMessage = { type: 'subscribe'; symbols: string[] } | { type: 'unsubscribe'; symbols: string[] };
export type ServerMessage =
  | { type: 'quotes'; quotes: Quote[] }
  | { type: 'status'; status: DataStatus; session: MarketSession }
  | { type: 'paper'; snapshot: PaperSnapshot };

/** Error code returned when a feature needs a connected broker (e.g. option chain on free data). */
export const NEEDS_BROKER = 'needs_broker';

const IST_OFFSET = 5.5 * 3600;

/** NSE cash-market session for a UTC epoch-seconds instant (weekends closed; exchange holidays not yet included). */
export function marketSession(nowSec: number): MarketSession {
  const ist = new Date((nowSec + IST_OFFSET) * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return 'closed';
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) return 'pre-open';
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) return 'open';
  return 'closed';
}
