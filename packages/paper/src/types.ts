import type { Charges, Product, Side } from './charges';
import type { OrderType } from './matching';
import type { Paise } from './money';

export type OrderStatus = 'OPEN' | 'TRIGGER_PENDING' | 'COMPLETE' | 'CANCELLED' | 'REJECTED';

export type PaperOrder = {
  id: string;
  symbol: string;
  side: Side;
  product: Product;
  type: OrderType;
  qty: number;
  pricePaise: Paise | null;
  triggerPaise: Paise | null;
  status: OrderStatus;
  triggered: boolean;
  avgFillPaise: Paise | null;
  rejectReason: string | null;
  tag: string | null;
  tradeDate: string;
  /** UTC epoch seconds */
  createdAt: number;
};

export type PlaceOrderInput = {
  symbol: string;
  side: Side;
  product: Product;
  type: OrderType;
  qty: number;
  /** Rupee strings/numbers with at most two decimals; converted to paise exactly. */
  price?: number | string;
  triggerPrice?: number | string;
};

/** Everything the UI shows, in paise. Built on the server from the trade ledger. */
export type PaperSnapshot = {
  account: {
    startingCashPaise: Paise;
    cashPaise: Paise;
    equityPaise: Paise;
    availablePaise: Paise;
    usedPaise: Paise;
    blockedPaise: Paise;
    realisedPaise: Paise;
    unrealisedPaise: Paise;
    chargesPaise: Paise;
    resetAt: string;
  };
  positions: {
    symbol: string;
    product: Product;
    qty: number;
    avgPricePaise: number;
    ltpPaise: Paise | null;
    unrealisedPaise: Paise;
    realisedPaise: Paise;
    chargesPaise: Paise;
  }[];
  orders: PaperOrder[];
  trades: { id: string; orderId: string; symbol: string; side: Side; product: Product; qty: number; pricePaise: Paise; charges: Charges; time: number }[];
  chargeRatesEffectiveFrom: string;
};
