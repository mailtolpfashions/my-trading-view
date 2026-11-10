// Trade lab: paper trading on live Kite prices (the engine is in apps/feed/src/tradelab). Money is paise from the feed.
import { feed } from './feed';

export type Side = 'BUY' | 'SELL';
export type Product = 'MIS' | 'CNC' | 'NRML';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SLM';

export type LabOrder = {
  id: string; symbol: string; exchange: 'NSE' | 'NFO'; side: Side; product: Product; type: OrderType; qty: number; lotSize: number | null;
  pricePaise: number | null; triggerPaise: number | null; stopPaise: number | null; targetPaise: number | null; parentId: string | null;
  status: 'OPEN' | 'TRIGGER_PENDING' | 'COMPLETE' | 'CANCELLED' | 'REJECTED'; triggered: boolean; avgFillPaise: number | null;
  rejectReason: string | null; tag: string | null; source: string; reason: string | null; tradeDate: string; createdAt: number;
};
export type LabTrade = { id: string; orderId: string; symbol: string; side: Side; product: Product; qty: number; pricePaise: number; chargesPaise: number; time: number; tradeDate: string };
export type LabPosition = {
  symbol: string; label: string; kind: 'EQ' | 'FUT' | 'CE' | 'PE' | null; product: Product; qty: number; lot: number; avgPaise: number | null;
  ltpPaise: number | null; bidPaise: number | null; askPaise: number | null; unrealisedPaise: number; realisedPaise: number; chargesPaise: number;
};
export type LabSnapshot = {
  asOf: number; live: boolean;
  settings: { firstEntry: string; squareOff: string; broker: string };
  funds: { startingCashPaise: number; equityPaise: number; realisedPaise: number; unrealisedPaise: number; chargesPaise: number; usedPaise: number; marginMethod: string; availablePaise: number };
  positions: LabPosition[]; orders: LabOrder[]; trades: LabTrade[];
  days: { date: string; realisedPaise: number; chargesPaise: number; trades: number; netPaise: number }[];
};
export type LabQuote = { symbol: string; label: string; exchange: 'NSE' | 'NFO'; kind: 'EQ' | 'FUT' | 'CE' | 'PE'; underlying: string; expiry: string | null; lot: number; ltpPaise: number | null; bidPaise: number | null; askPaise: number | null };
export type ContractRow = { symbol: string; label: string; lot: number; ltpPaise: number | null; bidPaise: number | null; askPaise: number | null };
export type Contracts = {
  underlying: string; spotPaise: number | null; expiry: string; expiries: string[];
  futures: (ContractRow & { expiry: string })[];
  strikes: { strike: number; CE: ContractRow | null; PE: ContractRow | null }[];
};
export type PlaceOrder = { symbol: string; side: Side; product: Product; type: OrderType; qty: number; price?: string; trigger?: string; stop?: string; target?: string; reason?: string };

export const labApi = {
  snapshot: () => feed<LabSnapshot>('tradelab'),
  quote: (symbol: string) => feed<LabQuote>(`tradelab/quote?symbol=${encodeURIComponent(symbol)}`),
  contracts: (underlying: string, expiry?: string, width = 12) => feed<Contracts>(`tradelab/contracts?underlying=${encodeURIComponent(underlying)}${expiry ? `&expiry=${expiry}` : ''}&width=${width}`),
  place: (o: PlaceOrder) => feed<LabOrder>('tradelab/order', o),
  cancel: (id: string) => feed<{ ok: boolean }>('tradelab/cancel', { id }),
  exit: (symbol: string, product: Product) => feed<LabOrder | null>('tradelab/exit', { symbol, product }),
  reset: (cash: string) => feed<{ ok: boolean }>('tradelab/reset', { cash }),
};

export const inr = (paise: number | null | undefined, digits = 2) =>
  paise == null ? '—' : `${paise < 0 ? '−' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const signedInr = (paise: number) => `${paise > 0 ? '+' : ''}${inr(paise)}`;
/** What the ticket opens with: a stock or contract symbol, or an underlying to pick F&O from. */
export type TicketStart = { symbol?: string; underlying?: string; side?: Side; /** Opened from a basket: "Add to basket" adds to this one. */ basketId?: string };

// ---------------------------------------------------------------- automatic rules

export type AutoRule = {
  id: string; name: string; enabled: boolean;
  scan: { name: string; formula: string; tf: string };
  universe: import('./screener').UniverseSpec;
  direction: 'BULLISH' | 'BEARISH';
  instrument: 'STOCK' | 'FUTURE' | 'OPTION';
  optionStrikes: number;
  product: Product;
  size: number;
  stopPct: number | null; targetPct: number | null;
  maxTradesPerDay: number; maxOpen: number;
  createdAt: string; updatedAt: string;
};
export type RuleResult = { trades: number; tradesToday: number; open: number; realisedPaise: number; unrealisedPaise: number; chargesPaise: number; netPaise: number };
export type AutoEvent = { at: number; ruleId: string; ruleName: string; symbol: string | null; action: 'placed' | 'skipped' | 'error' | 'checked'; text: string };

export const autoApi = {
  rules: () => feed<{ rules: AutoRule[]; results: Record<string, RuleResult> }>('tradelab/rules'),
  save: (r: Partial<AutoRule>) => feed<AutoRule>('tradelab/rules', r),
  remove: (id: string) => feed<{ ok: boolean }>('tradelab/rules/delete', { id }),
  log: () => feed<{ events: AutoEvent[] }>('tradelab/log'),
};

// ---------------------------------------------------------------- baskets and margin

export type BasketItem = { id: string; symbol: string; label: string; side: Side; product: Product; type: OrderType; qty: number; pricePaise: number | null; triggerPaise: number | null };
export type Basket = { id: string; name: string; items: BasketItem[]; updatedAt: string };
export type MarginPreview = { neededPaise: number; totalAfterPaise: number; availablePaise: number; method: string };

export const basketApi = {
  list: () => feed<{ baskets: Basket[] }>('tradelab/baskets'),
  save: (b: Partial<Basket>) => feed<Basket>('tradelab/baskets', b),
  remove: (id: string) => feed<{ ok: boolean }>('tradelab/baskets/delete', { id }),
  execute: (id: string) => feed<{ basket: string; results: { id: string; label: string; ok: boolean; text: string }[] }>('tradelab/baskets/execute', { id }),
  margin: (orders: { symbol: string; side: Side; product: Product; qty: number; price?: string }[]) => feed<MarginPreview>('tradelab/margin', { orders }),
};
