// What the option-selling rule engine sees: a position and one moment of the market. Plain data, so the same rules run
// on a past day in a backtest and on live prices in the advisor. All money is integer paise.

export type Kind = 'CE' | 'PE';
export type Side = 'BUY' | 'SELL';

/** `short` legs earn the premium; `wing` legs are the protection bought further out. */
export type SellLeg = { expiry: string; strikePaise: number; kind: Kind; side: Side; qty: number; entryPaise: number; role: 'short' | 'wing' };
export type LegRef = Pick<SellLeg, 'expiry' | 'strikePaise' | 'kind'>;
export type ChainQuote = { strikePaise: number; pricePaise: number; traded: boolean };

export interface MarketSnapshot {
  date: string;
  spotPaise: number;
  /** Listed expiries after today, oldest first. */
  expiries: string[];
  /** Expiries that close a month; rolling a monthly position goes to the next one of these. */
  isMonthly(expiry: string): boolean;
  chain(expiry: string, kind: Kind): ChainQuote[];
  quote(leg: LegRef): ChainQuote | null;
  /** Black-76 delta from the contract's own premium (signed: puts negative). Null without a real traded premium. */
  delta(leg: LegRef): number | null;
}

export type SellPosition = {
  legs: SellLeg[];
  /** Net premium received at entry, premium × quantity, in paise. The yardstick for profit and loss limits. */
  creditPaise: number;
  /** Gross profit already booked from legs that have been closed. */
  realisedPaise: number;
  adjustments: number;
};

export const legKey = (l: LegRef) => `${l.expiry}|${l.strikePaise}|${l.kind}`;

/** Gross profit so far: booked, plus open legs at today's prices. */
export function positionPnl(p: SellPosition, price: (l: SellLeg) => number): number {
  return p.legs.reduce((sum, l) => sum + (l.side === 'SELL' ? 1 : -1) * l.qty * (l.entryPaise - price(l)), p.realisedPaise);
}

export const shorts = (p: SellPosition) => p.legs.filter((l) => l.role === 'short');
export const wingFor = (p: SellPosition, s: SellLeg) => p.legs.find((l) => l.role === 'wing' && l.kind === s.kind && l.expiry === s.expiry);
