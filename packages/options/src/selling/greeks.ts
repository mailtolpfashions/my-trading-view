// Forward and delta for the rule engine. Same method as the option chain: the put-call parity forward at the traded
// strike nearest the index, then Black-76 from each contract's own premium. Estimates for triggers, never for P&L.

import { black76, impliedVol } from '../pricing';
import type { ChainQuote, Kind } from './state';

export const SELLING_RISK_FREE = 0.065; // same rate as the option chain (apps/feed/src/fno/chain.ts)

/** Years from a day's close to an expiry's close, calendar days. */
export const yearsBetween = (date: string, expiry: string) => Math.max(0, (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / (365 * 86400_000));

/** Put-call parity forward in paise, or null when no strike traded on both sides. */
export function parityForward(calls: ChainQuote[], puts: ChainQuote[], spotPaise: number, T: number, r = SELLING_RISK_FREE): number | null {
  const put = new Map(puts.filter((p) => p.traded).map((p) => [p.strikePaise, p]));
  const both = calls.filter((c) => c.traded && put.has(c.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - spotPaise) - Math.abs(b.strikePaise - spotPaise));
  const c = both[0];
  return c ? c.strikePaise + (c.pricePaise - put.get(c.strikePaise)!.pricePaise) * Math.exp(r * T) : null;
}

export function ivOf(kind: Kind, pricePaise: number, forwardPaise: number, strikePaise: number, T: number): number | null {
  return impliedVol(kind, pricePaise / 100, forwardPaise / 100, strikePaise / 100, T, SELLING_RISK_FREE);
}

/** Signed delta from a real premium, or null when no volatility fits that premium. */
export function deltaOf(kind: Kind, pricePaise: number, forwardPaise: number, strikePaise: number, T: number): number | null {
  const iv = ivOf(kind, pricePaise, forwardPaise, strikePaise, T);
  return iv == null ? null : black76(kind, forwardPaise / 100, strikePaise / 100, T, SELLING_RISK_FREE, iv).delta;
}

export type GapShock = { gapPct: number; ivMultiple: number };

/** The gaps the study replays: a fall comes with an IV jump, a rise with little change. */
export const GAP_SHOCKS: GapShock[] = [
  { gapPct: -3, ivMultiple: 1.25 }, { gapPct: -5, ivMultiple: 1.5 }, { gapPct: -8, ivMultiple: 2 }, { gapPct: -13, ivMultiple: 2.5 },
  { gapPct: 3, ivMultiple: 1.05 }, { gapPct: 5, ivMultiple: 1.1 }, { gapPct: 8, ivMultiple: 1.2 }, { gapPct: 13, ivMultiple: 1.3 },
];

export type ShockLeg = { kind: Kind; side: 'BUY' | 'SELL'; qty: number; strikePaise: number; pricePaise: number; iv: number; T: number; forwardPaise: number };

/** Model profit (paise) if the index gapped now. A loss is negative. Time passing is ignored: a gap is instant. */
export function gapPnl(legs: ShockLeg[], s: GapShock): number {
  return Math.round(legs.reduce((sum, l) => {
    const F = (l.forwardPaise / 100) * (1 + s.gapPct / 100);
    const after = black76(l.kind, F, l.strikePaise / 100, l.T, SELLING_RISK_FREE, l.iv * s.ivMultiple).price * 100;
    return sum + (l.side === 'SELL' ? 1 : -1) * l.qty * (l.pricePaise - after);
  }, 0));
}
