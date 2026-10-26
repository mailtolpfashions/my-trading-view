import type { Candle, DataStatus, Quote, Timeframe } from '@mtv/shared';

/** Everything the app needs from a market-data source. Free (delayed) and Kite (live) implement it. */
export interface MarketDataProvider {
  /** Current source; may change while running (e.g. Kite login, or its session expiring at 6 AM). */
  readonly status: DataStatus;
  /** `deep` asks for the longest history the source offers (for backtests). */
  candles(symbol: string, tf: Timeframe, deep?: boolean): Promise<Candle[]>;
  quotes(symbols: string[]): Promise<Quote[]>;
}

/** Raised when the upstream source has no data for a symbol. */
export class NotFoundError extends Error {}
