// Trade lab: paper trading of NSE stocks, futures and options on live Kite prices. Shared shapes.
import type { BookQuote, Charges, OrderStatus, OrderType, Product, Side } from '@mtv/paper';

export type Kind = 'EQ' | 'FUT' | 'CE' | 'PE';

/** Something Trade lab can trade: an NSE stock, or an NFO future or option (symbol = the exchange's trading symbol). */
export type Instrument = {
  symbol: string;
  exchange: 'NSE' | 'NFO';
  kind: Kind;
  /** The stock itself, or the F&O contract's underlying (NIFTY, RELIANCE…). */
  underlying: string;
  expiry: string | null;
  strikePaise: number;
  /** Units per lot (1 for stocks). */
  lot: number;
  token: number | null;
  /** Plain name: "RELIANCE", "NIFTY 27 Nov FUT", "NIFTY 27 Nov 24500 CE". */
  label: string;
};

/** The live book with the time it was received (UTC seconds). */
export type Quote = BookQuote & { at: number };

/** Where prices come from (live Kite in the app, a fake in tests). */
export interface Market {
  instrument(symbol: string): Instrument | null;
  quote(i: Instrument): Quote | null;
  /** Keep these instruments streaming (orders and positions). */
  watch(list: Instrument[]): void;
  /** Latest price of an underlying (index or stock), paise. */
  underlyingPrice(underlying: string): number | null;
  /** True while prices are flowing for a trading session (connected, a weekday, 09:15-15:30, ticks this session). */
  isOpen(nowSec: number): boolean;
}

/** End-of-day prices, for closing what the live session could not (app off at square-off time, expiry settlement). */
export interface Closes {
  /** NSE's official close of an instrument on a day, paise; null until that day's file is in. */
  close(i: Instrument, date: string): Promise<number | null>;
  /** Final settlement value per unit of an expired F&O contract on its expiry day, paise; null until known. */
  settlement(i: Instrument, date: string): Promise<number | null>;
}

export type LabOrder = {
  id: string;
  symbol: string;
  exchange: 'NSE' | 'NFO';
  side: Side;
  product: Product;
  type: OrderType;
  qty: number;
  lotSize: number | null;
  pricePaise: number | null;
  triggerPaise: number | null;
  stopPaise: number | null;
  targetPaise: number | null;
  parentId: string | null;
  status: OrderStatus;
  triggered: boolean;
  avgFillPaise: number | null;
  rejectReason: string | null;
  tag: string | null;
  source: string;
  reason: string | null;
  tradeDate: string;
  /** UTC seconds. */
  createdAt: number;
};

export type LabTrade = {
  id: string;
  orderId: string;
  symbol: string;
  exchange: 'NSE' | 'NFO';
  side: Side;
  product: Product;
  qty: number;
  pricePaise: number;
  chargesPaise: number;
  charges: Charges;
  /** UTC seconds. */
  time: number;
  tradeDate: string;
};

/** Storage (Postgres in the app, memory in tests). Status changes are conditional, so nothing happens twice. */
export interface Repo {
  account(): Promise<{ startingCashPaise: number; resetAt: number }>;
  reset(startingCashPaise: number): Promise<void>;
  /** Orders since the last reset: open ones, or everything. */
  orders(open?: boolean): Promise<LabOrder[]>;
  trades(): Promise<LabTrade[]>;
  createOrder(o: Omit<LabOrder, 'id' | 'createdAt'>, nowSec: number): Promise<LabOrder>;
  updateOrder(id: string, from: OrderStatus[], patch: Partial<Pick<LabOrder, 'status' | 'triggered' | 'rejectReason' | 'reason'>>): Promise<boolean>;
  /** Marks the order COMPLETE with its fill and records the trade, only if it is still in `from`. */
  fill(id: string, from: OrderStatus[], t: Omit<LabTrade, 'id'>, reason: string): Promise<boolean>;
}

/** The owner's Trade lab settings. */
export type LabSettings = {
  /** No new positions before this (IST, HH:MM): the opening is too volatile. */
  firstEntry: string;
  /** Intraday (MIS) positions are closed at this time, and no new intraday trades from it. */
  squareOff: string;
  broker: string;
};
export const DEFAULT_SETTINGS: LabSettings = { firstEntry: '09:30', squareOff: '15:00', broker: 'zerodha' };

export type PlaceInput = {
  symbol: string;
  side: Side;
  product: Product;
  type: OrderType;
  /** Units: shares, or lots × lot size for F&O. */
  qty: number;
  pricePaise?: number;
  triggerPaise?: number;
  /** Bracket: after the entry fills, a stop exit and a target exit are placed (one cancels the other). */
  stopPaise?: number;
  targetPaise?: number;
  source?: string;
  reason?: string;
};

export class LabError extends Error {}
