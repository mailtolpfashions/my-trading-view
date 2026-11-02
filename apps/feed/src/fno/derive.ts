// Per-expiry chain statistics for one trading day, computed from the parsed NSE F&O file as it is saved, so the
// long-history pages (PCR, max pain, straddle, IV, gamma exposure) read one small row per day instead of every strike.

import { yearsToExpiry } from '@mtv/options';
import type { FnoDay } from './bhavcopy';
import { RISK_FREE, applyGreeks, type ChainRow } from './chain';
import { atmIv, chainTotals, gammaExposure, maxPain, nearestStrike, strikeStep } from './metrics';

export type DerivedDay = {
  date: string; underlying: string; expiry: string; daysToExpiry: number; lotSize: number | null;
  spotPaise: number | null; forwardPaise: number | null; strikeStepPaise: number | null; atmStrikePaise: number | null;
  atmIv: number | null; straddlePaise: number | null; straddleTraded: boolean; maxPainPaise: number | null;
  ceOi: bigint; peOi: bigint; ceVolume: bigint; peVolume: bigint;
  gexNet: number | null; callWallPaise: number | null; putWallPaise: number | null; gammaFlipPaise: number | null; gexIvFilled: number;
};

const toPaise = (rupees: number) => Math.round(rupees * 100);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
/** Model estimates are "as of" the close of `date` (15:30 IST). */
export const closeOf = (date: string) => Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600;

/** Groups a day's option rows into chain rows per underlying and expiry. */
export function chainsOf(day: FnoDay): Map<string, Map<string, ChainRow[]>> {
  const out = new Map<string, Map<string, Map<number, ChainRow>>>();
  for (const r of day.rows) {
    if (r.kind === 'FUT' || r.strike == null) continue;
    const byExpiry = out.get(r.underlying) ?? new Map<string, Map<number, ChainRow>>();
    out.set(r.underlying, byExpiry);
    const byStrike = byExpiry.get(r.expiry) ?? new Map<number, ChainRow>();
    byExpiry.set(r.expiry, byStrike);
    const k = toPaise(r.strike);
    const row = byStrike.get(k) ?? { strikePaise: k, CE: null, PE: null };
    row[r.kind] = { closePaise: toPaise(r.close), settlePaise: toPaise(r.settle), oi: r.oi, volume: r.volume, traded: r.traded, iv: null, delta: null, theta: null, vega: null, gamma: null };
    byStrike.set(k, row);
  }
  return new Map([...out].map(([u, byExpiry]) => [u, new Map([...byExpiry].map(([e, m]) => [e, [...m.values()].sort((a, b) => a.strikePaise - b.strikePaise)]))]));
}

/** Statistics of one expiry's chain. `rows` get IV and Greeks filled in place. */
export function deriveExpiry(date: string, underlying: string, expiry: string, rows: ChainRow[], spotPaise: number | null, lotSize: number | null = null): DerivedDay {
  const T = yearsToExpiry(closeOf(date), expiry);
  const F = applyGreeks(rows, spotPaise, T);
  const forwardPaise = F == null ? null : Math.round(F);
  const ref = forwardPaise ?? spotPaise;
  const strikes = rows.map((r) => r.strikePaise);
  const atm = ref != null ? nearestStrike(strikes, ref) : null;
  const atmRow = rows.find((r) => r.strikePaise === atm);
  const t = chainTotals(rows);
  const pain = maxPain(rows);
  const gex = forwardPaise != null ? gammaExposure(rows, forwardPaise, T, RISK_FREE) : null;
  return {
    date, underlying, expiry, daysToExpiry: daysBetween(date, expiry), lotSize,
    spotPaise, forwardPaise, strikeStepPaise: ref != null ? strikeStep(strikes, ref) : null, atmStrikePaise: atm,
    atmIv: atmIv(rows, atm),
    straddlePaise: atmRow?.CE && atmRow.PE ? atmRow.CE.closePaise + atmRow.PE.closePaise : null,
    straddleTraded: !!(atmRow?.CE?.traded && atmRow.PE?.traded),
    maxPainPaise: pain?.strikePaise ?? null,
    ceOi: BigInt(Math.round(t.ceOi)), peOi: BigInt(Math.round(t.peOi)), ceVolume: BigInt(Math.round(t.ceVolume)), peVolume: BigInt(Math.round(t.peVolume)),
    gexNet: gex?.net ?? null, callWallPaise: gex?.callWallPaise ?? null, putWallPaise: gex?.putWallPaise ?? null, gammaFlipPaise: gex?.flipPaise ?? null, gexIvFilled: gex?.ivFilled ?? 0,
  };
}

/** Statistics for every underlying and every live expiry (expiry on or after the date) in a day's file. */
export function deriveDay(day: FnoDay): DerivedDay[] {
  const out: DerivedDay[] = [];
  for (const [u, byExpiry] of chainsOf(day)) {
    const spot = day.spot[u];
    for (const [expiry, rows] of byExpiry) {
      if (expiry < day.date) continue;
      out.push(deriveExpiry(day.date, u, expiry, rows, spot != null ? toPaise(spot) : null, day.lotByExpiry?.[u]?.[expiry] ?? day.lotSize[u] ?? null));
    }
  }
  return out;
}
