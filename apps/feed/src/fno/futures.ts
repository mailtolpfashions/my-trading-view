// Index futures analytics from NSE's official F&O end-of-day data: basis to spot, cost of carry, open interest,
// build-up and rollover. Every day-on-day change compares the SAME contract with itself, never the near contract of
// one day with a different near contract the day before, so expiry and roll days don't produce false readings.

import { prisma } from '@mtv/db';
import type { FnoUnderlying } from './bhavcopy';

export type BuildUp = 'long-buildup' | 'short-buildup' | 'short-covering' | 'long-unwinding' | 'neutral';

/** The standard reading of price change against open-interest change. Either change being zero (or unknown) is neutral. */
export function classifyBuildUp(priceChange: number | null, oiChange: number | null): BuildUp {
  if (!priceChange || !oiChange) return 'neutral';
  if (priceChange > 0) return oiChange > 0 ? 'long-buildup' : 'short-covering';
  return oiChange > 0 ? 'short-buildup' : 'long-unwinding';
}

export type FutContract = { expiry: string; closePaise: number; oi: number; volume: number; traded: boolean };

export type FuturesDay = {
  date: string;
  spotPaise: number | null;
  near: (FutContract & {
    /** Change from the same contract's previous close, or null if it did not trade the day before. */
    changePaise: number | null;
    oiChange: number | null;
    basisPaise: number | null;
    premiumPct: number | null;
    /** Basis annualised over calendar days to expiry (cost of carry). */
    carryPct: number | null;
    daysToExpiry: number;
    buildUp: BuildUp;
  }) | null;
  /** Open interest across all expiries, and its change from the previous day. */
  totalOi: number;
  totalOiChange: number | null;
  /** Share of total open interest in the contracts after the near month. */
  rolloverPct: number | null;
  contracts: FutContract[];
};

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

/** Pure: builds day rows (ascending) from each day's futures contracts and spot closes. */
export function buildFuturesDays(byDate: Map<string, FutContract[]>, spot: Map<string, number | null>): FuturesDay[] {
  const dates = [...byDate.keys()].sort();
  const out: FuturesDay[] = [];
  let prev: Map<string, FutContract> | null = null;
  let prevTotal: number | null = null;
  for (const date of dates) {
    const contracts = [...(byDate.get(date) ?? [])].filter((c) => c.expiry >= date).sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
    const totalOi = contracts.reduce((s, c) => s + c.oi, 0);
    const n = contracts[0];
    const s = spot.get(date) ?? null;
    let near: FuturesDay['near'] = null;
    if (n) {
      const before = prev?.get(n.expiry);
      const changePaise = before ? n.closePaise - before.closePaise : null;
      const oiChange = before ? n.oi - before.oi : null;
      const basisPaise = s != null ? n.closePaise - s : null;
      const dte = Math.max(0, days(date, n.expiry));
      near = {
        ...n, changePaise, oiChange, basisPaise, daysToExpiry: dte,
        premiumPct: basisPaise != null && s ? (basisPaise / s) * 100 : null,
        carryPct: basisPaise != null && s && dte > 0 ? (basisPaise / s) * (365 / dte) * 100 : null,
        buildUp: classifyBuildUp(changePaise, oiChange),
      };
    }
    out.push({
      date, spotPaise: s, near, totalOi, totalOiChange: prevTotal == null ? null : totalOi - prevTotal,
      rolloverPct: totalOi > 0 && contracts.length > 1 ? (contracts.slice(1).reduce((a, c) => a + c.oi, 0) / totalOi) * 100 : null,
      contracts,
    });
    prev = new Map(contracts.map((c) => [c.expiry, c]));
    prevTotal = totalOi;
  }
  return out;
}

/** The last `limit` trading days of futures analytics for an index, from the stored NSE files. */
export async function futuresHistory(underlying: FnoUnderlying, limit = 250): Promise<FuturesDay[]> {
  const metas = await prisma.fnoDayMeta.findMany({ where: { underlying }, orderBy: { date: 'desc' }, take: limit + 1, select: { date: true, spotPaise: true } });
  if (!metas.length) return [];
  const from = metas[metas.length - 1].date;
  const rows = await prisma.fnoEod.findMany({
    where: { underlying, kind: 'FUT', date: { gte: from } },
    select: { date: true, expiry: true, closePaise: true, oi: true, volume: true, traded: true },
  });
  const byDate = new Map<string, FutContract[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push({ expiry: r.expiry, closePaise: r.closePaise, oi: Number(r.oi), volume: Number(r.volume), traded: r.traded });
    byDate.set(r.date, list);
  }
  const all = buildFuturesDays(byDate, new Map(metas.map((m) => [m.date, m.spotPaise])));
  return all.slice(-limit); // the extra first day only seeds the day-on-day changes
}

/** Each contract's open interest on the latest stored day before `date` (the base for live OI change). */
export async function previousOi(underlying: FnoUnderlying, date: string): Promise<{ date: string; oi: Map<string, number> } | null> {
  const meta = await prisma.fnoDayMeta.findFirst({ where: { underlying, date: { lt: date } }, orderBy: { date: 'desc' }, select: { date: true } });
  if (!meta) return null;
  const rows = await prisma.fnoEod.findMany({ where: { underlying, kind: 'FUT', date: meta.date }, select: { expiry: true, oi: true } });
  return { date: meta.date, oi: new Map(rows.map((r) => [r.expiry, Number(r.oi)])) };
}
