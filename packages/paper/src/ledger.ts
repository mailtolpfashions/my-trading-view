// Positions, cash and P&L are always derived from the trade ledger, never stored as running totals,
// so they cannot drift. Lots are matched first-in-first-out, which keeps realised P&L in exact integer paise.

import type { Paise } from './money';
import type { Product, Side } from './charges';

export type Trade = {
  id: string;
  orderId: string;
  symbol: string;
  product: Product;
  side: Side;
  qty: number;
  pricePaise: Paise;
  chargesPaise: Paise;
  /** UTC epoch seconds. */
  time: number;
  /** IST trading date, YYYY-MM-DD. */
  tradeDate: string;
};

type Lot = { qty: number; pricePaise: Paise }; // qty > 0 long, < 0 short

export type Position = {
  symbol: string;
  product: Product;
  /** Net quantity: positive long, negative short, 0 closed. */
  qty: number;
  /** Signed cost of the open lots: Σ lot.qty × lot.price. */
  openCostPaise: Paise;
  realisedPaise: Paise;
  buyQty: number;
  sellQty: number;
  buyValuePaise: Paise;
  sellValuePaise: Paise;
  chargesPaise: Paise;
  lastTradeDate: string;
};

export type Ledger = { cashPaise: Paise; chargesPaise: Paise; realisedPaise: Paise; positions: Position[] };

const key = (symbol: string, product: Product) => `${symbol}|${product}`;

export function buildLedger(trades: Trade[], startingCashPaise: Paise): Ledger {
  const sorted = [...trades].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const lots = new Map<string, Lot[]>();
  const pos = new Map<string, Position>();
  let cash = startingCashPaise, charges = 0, realised = 0;

  for (const t of sorted) {
    if (!Number.isSafeInteger(t.qty) || t.qty <= 0 || !Number.isSafeInteger(t.pricePaise) || t.pricePaise <= 0) {
      throw new Error(`Corrupt trade ${t.id}: qty and price must be positive integers`);
    }
    const k = key(t.symbol, t.product);
    const p = pos.get(k) ?? { symbol: t.symbol, product: t.product, qty: 0, openCostPaise: 0, realisedPaise: 0, buyQty: 0, sellQty: 0, buyValuePaise: 0, sellValuePaise: 0, chargesPaise: 0, lastTradeDate: t.tradeDate };
    const book = lots.get(k) ?? [];
    const value = t.qty * t.pricePaise;
    const dir = t.side === 'BUY' ? 1 : -1;

    // Close opposite lots first-in-first-out, then open a new lot with whatever remains.
    let remaining = t.qty;
    while (remaining > 0 && book.length && Math.sign(book[0].qty) === -dir) {
      const lot = book[0];
      const m = Math.min(remaining, Math.abs(lot.qty));
      const pnl = lot.qty > 0 ? (t.pricePaise - lot.pricePaise) * m : (lot.pricePaise - t.pricePaise) * m;
      p.realisedPaise += pnl;
      realised += pnl;
      lot.qty += dir * m;
      remaining -= m;
      if (lot.qty === 0) book.shift();
    }
    if (remaining > 0) book.push({ qty: dir * remaining, pricePaise: t.pricePaise });

    if (t.side === 'BUY') { cash -= value; p.buyQty += t.qty; p.buyValuePaise += value; }
    else { cash += value; p.sellQty += t.qty; p.sellValuePaise += value; }
    cash -= t.chargesPaise;
    charges += t.chargesPaise;
    p.chargesPaise += t.chargesPaise;
    p.qty = book.reduce((s, l) => s + l.qty, 0);
    p.openCostPaise = book.reduce((s, l) => s + l.qty * l.pricePaise, 0);
    p.lastTradeDate = t.tradeDate;
    lots.set(k, book);
    pos.set(k, p);
  }
  return { cashPaise: cash, chargesPaise: charges, realisedPaise: realised, positions: [...pos.values()] };
}

/** Average price of the open quantity, in (possibly fractional) paise. Display only; P&L uses exact lot costs. */
export const avgPricePaise = (p: Position) => (p.qty === 0 ? 0 : p.openCostPaise / p.qty);

/** Unrealised P&L of the open lots at `ltp`: qty × ltp − open cost. Exact integer paise. */
export const unrealisedPaise = (p: Position, ltpPaise: Paise) => p.qty * ltpPaise - p.openCostPaise;

/**
 * Funds with no leverage (1× margin): a long ties up its full value (already paid from cash), and an intraday short
 * blocks margin equal to its value. equity = cash + Σ qty × ltp; available = equity − Σ |qty| × ltp − blocked orders.
 */
export function funds(ledger: Ledger, ltp: (symbol: string) => Paise | undefined, blockedForOrdersPaise: Paise) {
  let marketValue = 0, used = 0, unrealised = 0;
  for (const p of ledger.positions) {
    if (p.qty === 0) continue;
    const price = ltp(p.symbol) ?? Math.round(avgPricePaise(p)); // no quote yet: value at cost
    marketValue += p.qty * price;
    used += Math.abs(p.qty) * price;
    unrealised += unrealisedPaise(p, price);
  }
  const equity = ledger.cashPaise + marketValue;
  return { equityPaise: equity, usedPaise: used, blockedPaise: blockedForOrdersPaise, availablePaise: equity - used - blockedForOrdersPaise, unrealisedPaise: unrealised };
}
