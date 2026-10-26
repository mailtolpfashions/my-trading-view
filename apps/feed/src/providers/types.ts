import type { Candle, DataStatus, Quote, Timeframe } from '@mtv/shared';

/** Everything the app needs from a market-data source. Free (delayed) and Kite (live) implement it. */
export interface MarketDataProvider {
  readonly status: DataStatus;
  /** `deep` asks for the longest history the source offers (for backtests). */
  candles(symbol: string, tf: Timeframe, deep?: boolean): Promise<Candle[]>;
  quotes(symbols: string[]): Promise<Quote[]>;
}

/** Raised when the upstream source has no data for a symbol. */
export class NotFoundError extends Error {}
