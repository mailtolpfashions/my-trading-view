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

// ---------------------------------------------------------------- the weekly premium paper trade (research lead)

export type PremiumRule = { id: string; name: string; enabled: boolean; underlying: 'NIFTY'; weekday: number; time: string; delta: number; lots: number; iv: 'high' | 'any'; updatedAt: string };
export type PremiumLeg = { symbol: string; label?: string; kind: 'CE' | 'PE'; strikePaise: number; delta: number; bidPaise: number; askPaise: number; ltpPaise: number; orderId: string | null; fillPaise: number | null; closePaise: number | null; slipPaise: number | null; settlePaise: number | null };
export type PremiumEntry = { date: string; expiry: string; at: number; ivHigh: boolean | null; ivAsOf: string | null; spotPaise: number; forwardPaise: number; legs: PremiumLeg[]; netPaise: number | null; done: boolean };
export type PremiumEvent = { at: number; action: 'placed' | 'skipped' | 'error' | 'checked'; text: string };
export type PremiumReport = {
  rule: PremiumRule; entries: PremiumEntry[]; events: PremiumEvent[];
  slippage: { legs: number; avgPaise: number | null; worstPaise: number | null; medianPaise: number | null };
  totals: { weeks: number; traded: number; skippedIv: number; realisedPaise: number; chargesPaise: number };
};
export const premiumApi = {
  report: () => feed<PremiumReport>('tradelab/premium'),
  save: (r: Partial<PremiumRule>) => feed<PremiumRule>('tradelab/premium', r),
};

// ---------------------------------------------------------------- the 9:20 straddle forward paper test

export type S920Rule = { id: string; name: string; enabled: boolean; underlying: 'NIFTY'; entry: string; exit: string; stopPct: number; lots: number; updatedAt: string };
export type S920Leg = { symbol: string; label: string; kind: 'CE' | 'PE'; strikePaise: number; bidPaise: number; askPaise: number; fillPaise: number | null; stopPaise: number | null; exitPaise: number | null; how: 'stop' | 'time' | 'open' | null };
export type S920Shadow = { rangeHighPaise: number; rangeLowPaise: number; state: string; shifts: number; legs: { symbol: string; label: string; kind: 'CE' | 'PE'; sellPaise: number; buyPaise: number | null }[]; events: { at: number; text: string }[]; chargesPaise: number; netPaise: number | null };
export type S920Day = { date: string; expiry: string; dte: number; at: number; spotPaise: number; legs: S920Leg[]; closedAt: number | null; clean: boolean; note: string | null; netPaise: number | null; chargesPaise: number; shadow?: S920Shadow | null };
export type S920Report = {
  rule: S920Rule; days: S920Day[]; events: PremiumEvent[] | { at: number; action: string; text: string }[];
  byDte: { dte: number; days: number; won: number; netPaise: number; worstPaise: number }[];
  totals: { days: number; clean: number; won: number; netPaise: number; chargesPaise: number; stopsHit: number; bothStopped: number };
  shadow: { days: number; won: number; netPaise: number; shifts: number; byDte: { dte: number; days: number; won: number; netPaise: number; worstPaise: number }[] };
};
export const s920Api = {
  report: () => feed<S920Report>('tradelab/straddle920'),
  save: (r: Partial<S920Rule>) => feed<S920Rule>('tradelab/straddle920', r),
};

// ---------------------------------------------------------------- the option pivot buy forward paper test

export type PivotRule = { id: string; name: string; enabled: boolean; lots: number; targetPts: number; stopPts: number; maxTrades: number; entryFrom: string; entryTo: string; exit: string; updatedAt: string };
export type PivotLevel = { name: string; paise: number };
export type PivotTradeRow = {
  version: 'fixed' | 'ladder'; level: string; entryAt: number; entryPaise: number; exitAt: number | null; exitPaise: number | null;
  why: 'target' | 'stop' | 'trail' | 'time' | null; reached: string | null; date: string; leg: string; kind: 'CE' | 'PE'; qty: number;
  grossPaise: number | null; chargesPaise: number; netPaise: number | null; clean: boolean;
};
type PivotTotal = { trades: number; won: number; netPaise: number; chargesPaise: number; byKind: Record<'CE' | 'PE', { trades: number; won: number; netPaise: number }> };
export type PivotReport = {
  rule: PivotRule; events: { at: number; action: string; text: string }[]; cleanDays: number;
  days: { date: string; expiry: string; strikePaise: number; clean: boolean; note: string | null; closedAt: number | null; legs: { label: string; kind: 'CE' | 'PE'; prev: { date: string; highPaise: number; lowPaise: number; closePaise: number }; levels: PivotLevel[]; lastPaise: number | null }[] }[];
  trades: PivotTradeRow[];
  totals: Record<'fixed' | 'ladder', PivotTotal>;
};
export const pivotApi = {
  report: () => feed<PivotReport>('tradelab/pivotbuy'),
  save: (r: Partial<PivotRule>) => feed<PivotRule>('tradelab/pivotbuy', r),
};

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
