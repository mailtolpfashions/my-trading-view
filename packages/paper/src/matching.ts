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
