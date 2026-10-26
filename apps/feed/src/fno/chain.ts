// Option chain views over NSE's official end-of-day data.

import { prisma } from '@mtv/db';
import { black76, impliedVol, yearsToExpiry } from '@mtv/options';
import type { FnoUnderlying } from './bhavcopy';

export const RISK_FREE = 0.065; // annual; only affects model estimates (IV, Greeks), never P&L
export const STRIKE_STEP: Record<FnoUnderlying, number> = { NIFTY: 50, BANKNIFTY: 100 };

export type ChainSide = { closePaise: number; settlePaise: number; oi: number; volume: number; traded: boolean; iv: number | null; delta: number | null; theta: number | null; vega: number | null; gamma: number | null };
export type ChainRow = { strikePaise: number; CE: ChainSide | null; PE: ChainSide | null };
export type Chain = {
  underlying: FnoUnderlying;
  date: string;
  expiry: string;
  expiries: string[];
  lotSize: number | null;
  spotPaise: number | null;
  /** Market-implied forward from put-call parity at the ATM strike (both legs traded), or null. */
  forwardPaise: number | null;
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

export async function getChain(underlying: FnoUnderlying, date: string, expiry?: string): Promise<Chain | null> {
  const expiries = await expiriesOn(underlying, date);
  const exp = expiry && expiries.includes(expiry) ? expiry : expiries[0];
  if (!exp) return null;
  const meta = await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date, underlying } } });
  const contracts = await prisma.fnoEod.findMany({ where: { underlying, date, expiry: exp, kind: { in: ['CE', 'PE'] } }, orderBy: { strikePaise: 'asc' } });

  const byStrike = new Map<number, ChainRow>();
  for (const c of contracts) {
    const row = byStrike.get(c.strikePaise) ?? { strikePaise: c.strikePaise, CE: null, PE: null };
    row[c.kind as 'CE' | 'PE'] = { closePaise: c.closePaise, settlePaise: c.settlePaise, oi: Number(c.oi), volume: Number(c.volume), traded: c.traded, iv: null, delta: null, theta: null, vega: null, gamma: null };
    byStrike.set(c.strikePaise, row);
  }
  const rows = [...byStrike.values()];
  const spot = meta?.spotPaise ?? null;
  // Model estimates are "as of" the close of `date` (15:30 IST).
  const asOf = Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600;
  const T = yearsToExpiry(asOf, exp);
  const F = spot != null && T > 0 ? impliedForward(rows, spot, T) : null;
  if (F != null) {
    for (const row of rows) for (const right of ['CE', 'PE'] as const) {
      const side = row[right];
      if (!side?.traded) continue; // IV/Greeks only from real traded premiums
      const iv = impliedVol(right, side.closePaise / 100, F / 100, row.strikePaise / 100, T, RISK_FREE);
      if (iv == null) continue;
      const g = black76(right, F / 100, row.strikePaise / 100, T, RISK_FREE, iv);
      Object.assign(side, { iv, delta: g.delta, theta: g.theta, vega: g.vega, gamma: g.gamma });
    }
  }
  const step = STRIKE_STEP[underlying] * 100;
  const atm = spot != null ? Math.round(spot / step) * step : null;
  return { underlying, date, expiry: exp, expiries, lotSize: meta?.lotSize ?? null, spotPaise: spot, forwardPaise: F == null ? null : Math.round(F), atmStrikePaise: atm, rows };
}
