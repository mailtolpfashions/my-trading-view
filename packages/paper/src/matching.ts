// When a simulated order fills, and at what price, given the last traded price (LTP).
// Model: a new marketable order executes immediately at the LTP; a resting limit order executes at its own limit
// price when the market reaches it (as on the exchange, where resting orders trade at their price).
// The free data source has no bid/ask, so fills use the LTP: real fills can differ by the spread.

import type { Paise } from './money';
import type { Side } from './charges';

export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SLM';

export type MatchOrder = {
  side: Side;
  type: OrderType;
  pricePaise?: Paise; // LIMIT and SL
  triggerPaise?: Paise; // SL and SLM
  triggered: boolean;
};

export type MatchResult = { action: 'fill'; pricePaise: Paise } | { action: 'trigger' } | { action: 'wait' };

const crossed = (side: Side, ltp: Paise, level: Paise) => (side === 'BUY' ? ltp <= level : ltp >= level);
const triggerHit = (side: Side, ltp: Paise, trigger: Paise) => (side === 'BUY' ? ltp >= trigger : ltp <= trigger);

/** `isNew` is true for the order's first evaluation (on placement, or the moment a stop triggers). */
export function evaluate(o: MatchOrder, ltp: Paise, isNew: boolean): MatchResult {
  if (o.type === 'MARKET') return { action: 'fill', pricePaise: ltp };

  if ((o.type === 'SL' || o.type === 'SLM') && !o.triggered) {
    return triggerHit(o.side, ltp, o.triggerPaise!) ? { action: 'trigger' } : { action: 'wait' };
  }
  if (o.type === 'SLM') return { action: 'fill', pricePaise: ltp };

  const limit = o.pricePaise!;
  if (!crossed(o.side, ltp, limit)) return { action: 'wait' };
  return { action: 'fill', pricePaise: isNew ? ltp : limit };
}

export type NewOrder = { side: Side; type: OrderType; qty: number; pricePaise?: Paise; triggerPaise?: Paise };

/** Returns a rejection reason, or null when the order is valid against the current LTP. */
export function validateOrder(o: NewOrder, ltp: Paise): string | null {
  if (!Number.isSafeInteger(o.qty) || o.qty <= 0) return 'Quantity must be a whole number above zero';
  if (o.type === 'LIMIT' || o.type === 'SL') {
    if (!o.pricePaise || o.pricePaise <= 0) return 'Enter a limit price';
  }
  if (o.type === 'SL' || o.type === 'SLM') {
    if (!o.triggerPaise || o.triggerPaise <= 0) return 'Enter a trigger price';
    if (o.side === 'BUY' && o.triggerPaise <= ltp) return 'Buy stop-loss trigger must be above the last traded price';
    if (o.side === 'SELL' && o.triggerPaise >= ltp) return 'Sell stop-loss trigger must be below the last traded price';
    if (o.type === 'SL' && o.side === 'BUY' && o.pricePaise! < o.triggerPaise) return 'Buy stop-loss limit price must be at or above the trigger';
    if (o.type === 'SL' && o.side === 'SELL' && o.pricePaise! > o.triggerPaise) return 'Sell stop-loss limit price must be at or below the trigger';
  }
  return null;
}

/** The live market for one instrument: last traded price and the best bid and ask (0 = that side is empty). */
export type BookQuote = { ltpPaise: Paise; bidPaise: Paise; askPaise: Paise };

/** Price a marketable order takes now: a buy pays the ask, a sell gets the bid; the LTP when that side is empty. */
export function takePrice(side: Side, q: BookQuote): { pricePaise: Paise; fromBook: boolean } {
  const book = side === 'BUY' ? q.askPaise : q.bidPaise;
  return book > 0 ? { pricePaise: book, fromBook: true } : { pricePaise: q.ltpPaise, fromBook: false };
}

/**
 * Like `evaluate`, on the live order book (Trade lab). A market order (or a stop-market once triggered) takes the ask or
 * bid. A limit order that is marketable when placed fills at the better of its limit and the book; a resting limit
 * fills at its own price once the book or a trade reaches it. Stops trigger on the last traded price.
 */
export function evaluateBook(o: MatchOrder, q: BookQuote, isNew: boolean): MatchResult & { fromBook?: boolean } {
  if (o.type === 'MARKET') { const t = takePrice(o.side, q); return { action: 'fill', pricePaise: t.pricePaise, fromBook: t.fromBook }; }
  if ((o.type === 'SL' || o.type === 'SLM') && !o.triggered) {
    return triggerHit(o.side, q.ltpPaise, o.triggerPaise!) ? { action: 'trigger' } : { action: 'wait' };
  }
  if (o.type === 'SLM') { const t = takePrice(o.side, q); return { action: 'fill', pricePaise: t.pricePaise, fromBook: t.fromBook }; }
  const limit = o.pricePaise!;
  const book = o.side === 'BUY' ? q.askPaise : q.bidPaise;
  if (isNew && book > 0) {
    // Marketable now: trades against the book at the book's price, never worse than the limit.
    if (o.side === 'BUY' ? book <= limit : book >= limit) return { action: 'fill', pricePaise: book, fromBook: true };
    return { action: 'wait' };
  }
  // Resting: the book or a trade has come to the limit.
  const reached = (book > 0 && (o.side === 'BUY' ? book <= limit : book >= limit)) || crossed(o.side, q.ltpPaise, limit);
  return reached ? { action: 'fill', pricePaise: limit, fromBook: book > 0 } : { action: 'wait' };
}
