// Option chain views over NSE's official end-of-day data.

import { prisma } from '@mtv/db';
import { black76, impliedVol, yearsToExpiry } from '@mtv/options';
import type { FnoUnderlying } from './bhavcopy';
import { nearestStrike, strikeStep } from './metrics';

export const RISK_FREE = 0.065; // annual; only affects model estimates (IV, Greeks), never P&L

export type ChainSide = {
  closePaise: number; settlePaise: number; oi: number; volume: number; traded: boolean;
  iv: number | null; delta: number | null; theta: number | null; vega: number | null; gamma: number | null;
  /** Change in open interest from the previous trading day (same contract); null if it was not listed then. */
  oiChange?: number | null;
  /** Previous trading day's close of the same contract, or null. */
  prevClosePaise?: number | null;
};
export type ChainRow = { strikePaise: number; CE: ChainSide | null; PE: ChainSide | null };
export type Chain = {
  underlying: FnoUnderlying;
  date: string;
  expiry: string;
  expiries: string[];
  lotSize: number | null;
  isIndex: boolean;
  spotPaise: number | null;
  /** Previous trading day held for this underlying (the base for OI change), or null. */
  prevDate: string | null;
  /** Strike interval near the money, derived from the strikes listed. */
  strikeStepPaise: number | null;
  /** Market-implied forward from put-call parity at the ATM strike (both legs traded), or null. */
  forwardPaise: number | null;
  /** Futures listed that day, nearest expiry first: NSE's close (carried forward when untraded) and settlement price. */
  futures: { expiry: string; closePaise: number; settlePaise: number; traded: boolean }[];
  atmStrikePaise: number | null;
  rows: ChainRow[];
};

export async function latestFnoDate(underlying: FnoUnderlying, onOrBefore?: string): Promise<string | null> {
  const m = await prisma.fnoDayMeta.findFirst({ where: { underlying, ...(onOrBefore ? { date: { lte: onOrBefore } } : {}) }, orderBy: { date: 'desc' }, select: { date: true } });
  return m?.date ?? null;
}

export async function expiriesOn(underlying: FnoUnderlying, date: string): Promise<string[]> {
  const rows = await prisma.fnoEod.findMany({ where: { underlying, date, kind: { in: ['CE', 'PE'] } }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } });
  return rows.map((r) => r.expiry);
}

/** Put-call parity forward at the traded strike nearest spot: F = K + (C − P)·e^(rT). */
export function impliedForward(rows: ChainRow[], spotPaise: number, T: number, r = RISK_FREE): number | null {
  const both = rows.filter((x) => x.CE?.traded && x.PE?.traded).sort((a, b) => Math.abs(a.strikePaise - spotPaise) - Math.abs(b.strikePaise - spotPaise));
  const atm = both[0];
  if (!atm) return null;
  return atm.strikePaise + (atm.CE!.closePaise - atm.PE!.closePaise) * Math.exp(r * T);
}

/**
 * Fills IV and Greeks on traded legs from the market-implied forward; returns that forward (paise) or null.
 * Shared by the end-of-day and live chains so both are computed identically.
 */
export function applyGreeks(rows: ChainRow[], spotPaise: number | null, T: number): number | null {
  const F = spotPaise != null && T > 0 ? impliedForward(rows, spotPaise, T) : null;
  if (F == null) return null;
  for (const row of rows) for (const right of ['CE', 'PE'] as const) {
    const side = row[right];
    if (!side?.traded) continue; // IV/Greeks only from real traded premiums
    const iv = impliedVol(right, side.closePaise / 100, F / 100, row.strikePaise / 100, T, RISK_FREE);
    if (iv == null) continue;
    const g = black76(right, F / 100, row.strikePaise / 100, T, RISK_FREE, iv);
    Object.assign(side, { iv, delta: g.delta, theta: g.theta, vega: g.vega, gamma: g.gamma });
  }
  return F;
}

export async function getChain(underlying: FnoUnderlying, date: string, expiry?: string): Promise<Chain | null> {
  const expiries = await expiriesOn(underlying, date);
  const exp = expiry && expiries.includes(expiry) ? expiry : expiries[0];
  if (!exp) return null;
  const meta = await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date, underlying } } });
  // While NSE moves to a new lot size, expiries differ: use this expiry's own lot when it is known.
  const expiryLot = (await prisma.fnoDerivedDay.findUnique({ where: { date_underlying_expiry: { date, underlying, expiry: exp } }, select: { lotSize: true } }))?.lotSize ?? null;
  const contracts = await prisma.fnoEod.findMany({ where: { underlying, date, expiry: exp, kind: { in: ['CE', 'PE'] } }, orderBy: { strikePaise: 'asc' } });
  const prevDate = (await prisma.fnoDayMeta.findFirst({ where: { underlying, date: { lt: date } }, orderBy: { date: 'desc' }, select: { date: true } }))?.date ?? null;
  const prev = prevDate ? await prisma.fnoEod.findMany({ where: { underlying, date: prevDate, expiry: exp, kind: { in: ['CE', 'PE'] } }, select: { kind: true, strikePaise: true, oi: true, closePaise: true } }) : [];
  const before = new Map(prev.map((p) => [`${p.kind}${p.strikePaise}`, p]));

  const byStrike = new Map<number, ChainRow>();
  for (const c of contracts) {
    const row = byStrike.get(c.strikePaise) ?? { strikePaise: c.strikePaise, CE: null, PE: null };
    const b = before.get(`${c.kind}${c.strikePaise}`);
    row[c.kind as 'CE' | 'PE'] = {
      closePaise: c.closePaise, settlePaise: c.settlePaise, oi: Number(c.oi), volume: Number(c.volume), traded: c.traded, iv: null, delta: null, theta: null, vega: null, gamma: null,
      oiChange: b ? Number(c.oi) - Number(b.oi) : null, prevClosePaise: b ? b.closePaise : null,
    };
    byStrike.set(c.strikePaise, row);
  }
  const rows = [...byStrike.values()];
  const spot = meta?.spotPaise ?? null;
  // Futures listed that day (one per monthly expiry), for buying or selling a future in the strategy builder.
  const futures = (await prisma.fnoEod.findMany({ where: { underlying, date, kind: 'FUT', expiry: { gte: date } }, select: { expiry: true, closePaise: true, settlePaise: true, traded: true }, orderBy: { expiry: 'asc' } }))
    .map((f) => ({ expiry: f.expiry, closePaise: f.closePaise, settlePaise: f.settlePaise, traded: f.traded }));
  // Model estimates are "as of" the close of `date` (15:30 IST).
  const asOf = Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600;
  const F = applyGreeks(rows, spot, yearsToExpiry(asOf, exp));
  const strikes = rows.map((r) => r.strikePaise);
  const atm = spot != null ? nearestStrike(strikes, spot) : null;
  return {
    underlying, date, expiry: exp, expiries, lotSize: expiryLot ?? meta?.lotSize ?? null, isIndex: meta?.isIndex ?? true, spotPaise: spot, prevDate,
    strikeStepPaise: spot != null ? strikeStep(strikes, spot) : null, forwardPaise: F == null ? null : Math.round(F), atmStrikePaise: atm, rows, futures,
  };
}
