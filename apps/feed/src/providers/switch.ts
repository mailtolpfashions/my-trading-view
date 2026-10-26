import type { Candle, DataStatus, Quote, Timeframe } from '@mtv/shared';
import type { FreeProvider } from './free';
import type { KiteProvider } from './kite/provider';
import type { MarketDataProvider } from './types';

/** Uses Kite whenever it is selected and logged in; otherwise the free delayed source. Decided per request. */
export class SwitchProvider implements MarketDataProvider {
  constructor(private free: FreeProvider, private kite: KiteProvider, private wantKite: boolean) {}

  private get active(): MarketDataProvider {
    return this.wantKite && this.kite.ready ? this.kite : this.free;
  }
  get status(): DataStatus {
    return this.active.status;
  }
  candles(symbol: string, tf: Timeframe, deep?: boolean): Promise<Candle[]> {
    return this.active.candles(symbol, tf, deep);
  }
  quotes(symbols: string[]): Promise<Quote[]> {
    return this.active.quotes(symbols);
  }
}
