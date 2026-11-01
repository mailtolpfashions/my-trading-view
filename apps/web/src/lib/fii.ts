// FII footprints: participant positions (NSE), FII derivatives statistics (NSE) and FPI flows (NSDL), day by day.
// Tables show counts, starts, ends and extremes with dates, never averages.

import { FEED_URL, feedFetch } from './feed';

export const PARTICIPANTS = ['FII', 'DII', 'Pro', 'Client'] as const;
export type Participant = (typeof PARTICIPANTS)[number];
export type Positions = { futLong: number; futShort: number; callLong: number; callShort: number; putLong: number; putShort: number };
export type FiiStat = { buyContracts: number; buyCr: number; sellContracts: number; sellCr: number; oiContracts: number; oiCr: number };
export type FiiDay = {
  date: string;
  positions: Partial<Record<Participant, Positions>>;
  stats: Record<string, FiiStat>;
  fpiEquityNetCr: number | null;
  fpiTotalNetCr: number | null;
  nifty: { close: number; changePct: number | null } | null;
};
export type FiiResponse = { sources: Record<string, string>; rows: FiiDay[] };

export async function fetchFii(): Promise<FiiResponse> {
  const res = await feedFetch(`${FEED_URL}/api/research/fii`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'FII data unavailable');
  return body as FiiResponse;
}

/** Index-futures net (long − short), long share %, and option nets, for one participant on one day. */
export function derive(p: Positions | undefined) {
  if (!p) return null;
  const total = p.futLong + p.futShort;
  return { futNet: p.futLong - p.futShort, longPct: total ? (p.futLong / total) * 100 : null, callNet: p.callLong - p.callShort, putNet: p.putLong - p.putShort };
}

export type DayRow = {
  date: string;
  nifty: FiiDay['nifty'];
  /** Next trading day's NIFTY change %, for the "what happened next" view. */
  niftyNextPct: number | null;
  fii: ReturnType<typeof derive>;
  fiiFutNetChange: number | null;
  others: Record<Exclude<Participant, 'FII'>, ReturnType<typeof derive>>;
  fiiIndexFutNetCr: number | null;
  fiiIndexOptOi: number | null;
  fpiEquityNetCr: number | null;
};

export function dayRows(days: FiiDay[]): DayRow[] {
  const out: DayRow[] = [];
  let prevNet: number | null = null;
  days.forEach((d, i) => {
    const fii = derive(d.positions.FII);
    const fut = d.stats['INDEX FUTURES'];
    const next = days.slice(i + 1).find((x) => x.nifty);
    out.push({
      date: d.date,
      nifty: d.nifty,
      niftyNextPct: next?.nifty?.changePct ?? null,
      fii,
      fiiFutNetChange: fii && prevNet != null ? fii.futNet - prevNet : null,
      others: { DII: derive(d.positions.DII), Pro: derive(d.positions.Pro), Client: derive(d.positions.Client) },
      fiiIndexFutNetCr: fut ? Math.round((fut.buyCr - fut.sellCr) * 100) / 100 : null,
      fiiIndexOptOi: d.stats['INDEX OPTIONS']?.oiContracts ?? null,
      fpiEquityNetCr: d.fpiEquityNetCr,
    });
    if (fii) prevNet = fii.futNet;
  });
  return out;
}

export type PeriodRow = {
  period: string;
  days: number;
  fiiNetStart: number | null; fiiNetEnd: number | null;
  longPctLow: { date: string; pct: number } | null; longPctHigh: { date: string; pct: number } | null;
  /** Sum over the period's days (₹ crore), not an average. */
  fiiIndexFutNetCrTotal: number | null;
  fpiEquityNetCrTotal: number | null;
  niftyStart: number | null; niftyEnd: number | null;
};

/** Per year or month: FII index-futures net at the first and last day, long-share extremes with dates, and totals. */
export function periodRows(rows: DayRow[], by: 'year' | 'month'): PeriodRow[] {
  const groups = new Map<string, DayRow[]>();
  for (const r of rows) { const k = by === 'year' ? r.date.slice(0, 4) : r.date.slice(0, 7); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const sum = (xs: (number | null)[]) => (xs.some((x) => x != null) ? Math.round(xs.reduce<number>((s, x) => s + (x ?? 0), 0) * 100) / 100 : null);
  return [...groups].map(([period, list]) => {
    const withFii = list.filter((r) => r.fii);
    const byPct = withFii.filter((r) => r.fii!.longPct != null).sort((a, b) => a.fii!.longPct! - b.fii!.longPct!);
    const withNifty = list.filter((r) => r.nifty);
    return {
      period, days: list.length,
      fiiNetStart: withFii[0]?.fii!.futNet ?? null, fiiNetEnd: withFii.at(-1)?.fii!.futNet ?? null,
      longPctLow: byPct[0] ? { date: byPct[0].date, pct: byPct[0].fii!.longPct! } : null,
      longPctHigh: byPct.at(-1) ? { date: byPct.at(-1)!.date, pct: byPct.at(-1)!.fii!.longPct! } : null,
      fiiIndexFutNetCrTotal: sum(list.map((r) => r.fiiIndexFutNetCr)),
      fpiEquityNetCrTotal: sum(list.map((r) => r.fpiEquityNetCr)),
      niftyStart: withNifty[0]?.nifty!.close ?? null, niftyEnd: withNifty.at(-1)?.nifty!.close ?? null,
    };
  }).sort((a, b) => (a.period < b.period ? -1 : 1));
}

export type NextDayRow = { year: string; addedLongs: { up: number; down: number }; cutLongs: { up: number; down: number }; unchanged: number };

/**
 * Per year: on days FIIs raised their index-futures net position, how often NIFTY rose or fell the NEXT trading day;
 * and the same for days they cut it. Plain counts, so a year where it held and a year where it didn't both show.
 */
export function nextDayRows(rows: DayRow[]): NextDayRow[] {
  const out = new Map<string, NextDayRow>();
  for (const r of rows) {
    if (r.fiiFutNetChange == null || r.niftyNextPct == null) continue;
    const y = r.date.slice(0, 4);
    const row = out.get(y) ?? out.set(y, { year: y, addedLongs: { up: 0, down: 0 }, cutLongs: { up: 0, down: 0 }, unchanged: 0 }).get(y)!;
    if (r.fiiFutNetChange === 0) { row.unchanged++; continue; }
    const bucket = r.fiiFutNetChange > 0 ? row.addedLongs : row.cutLongs;
    if (r.niftyNextPct > 0) bucket.up++; else if (r.niftyNextPct < 0) bucket.down++;
  }
  return [...out.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
}
