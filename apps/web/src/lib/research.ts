// NIFTY research tables, built from day rows (no averages: counts, buckets and the extreme days with their dates,
// so every number can be traced to the days behind it).

import { FEED_URL, feedFetch } from './feed';

export type NiftyDay = {
  date: string; weekday: string; prevClose: number | null; open: number; high: number; low: number; close: number;
  gapPts: number | null; gapPct: number | null; changePts: number | null; changePct: number | null; rangePct: number | null;
  vixClose: number | null; expiryDay: boolean | null; events: string[];
};
export type MarketEvent = { id: string; name: string; from: string; to: string; source: string };
export type NiftyDaysResponse = { source: string; from: string | null; to: string | null; events: MarketEvent[]; rows: NiftyDay[] };

export async function fetchNiftyDays(): Promise<NiftyDaysResponse> {
  const res = await feedFetch(`${FEED_URL}/api/research/nifty-days`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Research data unavailable');
  return body as NiftyDaysResponse;
}

/** Size buckets for a % move, by absolute value. */
export const MOVE_BUCKETS = [
  { id: 'lt05', label: '< 0.5%', test: (x: number) => Math.abs(x) < 0.5 },
  { id: '05to1', label: '0.5–1%', test: (x: number) => Math.abs(x) >= 0.5 && Math.abs(x) < 1 },
  { id: '1to2', label: '1–2%', test: (x: number) => Math.abs(x) >= 1 && Math.abs(x) < 2 },
  { id: 'ge2', label: '≥ 2%', test: (x: number) => Math.abs(x) >= 2 },
] as const;
export const GAP_FLAT = 0.1; // |gap| under 0.1% counts as flat

export type PeriodRow = {
  period: string;
  days: number;
  up: number; down: number; flat: number;
  gapUp: number; gapDown: number; gapFlat: number; bigGaps: number;
  moves: Record<(typeof MOVE_BUCKETS)[number]['id'], number>;
  bestDay: { date: string; pct: number } | null;
  worstDay: { date: string; pct: number } | null;
  vixLow: { date: string; value: number } | null;
  vixHigh: { date: string; value: number } | null;
  expiryDays: number;
  eventDays: number;
};

/** One row per period (year 'YYYY' or month 'YYYY-MM'): counts and the extreme days, never averages. */
export function periodTable(rows: NiftyDay[], by: 'year' | 'month'): PeriodRow[] {
  const groups = new Map<string, NiftyDay[]>();
  for (const r of rows) {
    if (r.changePct == null) continue; // first day: no previous close
    const k = by === 'year' ? r.date.slice(0, 4) : r.date.slice(0, 7);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups].map(([period, list]) => {
    const moves = Object.fromEntries(MOVE_BUCKETS.map((b) => [b.id, list.filter((r) => b.test(r.changePct!)).length])) as PeriodRow['moves'];
    const byChange = [...list].sort((a, b) => b.changePct! - a.changePct!);
    const withVix = list.filter((r) => r.vixClose != null).sort((a, b) => a.vixClose! - b.vixClose!);
    return {
      period,
      days: list.length,
      up: list.filter((r) => r.changePct! > 0).length,
      down: list.filter((r) => r.changePct! < 0).length,
      flat: list.filter((r) => r.changePct === 0).length,
      gapUp: list.filter((r) => r.gapPct! >= GAP_FLAT).length,
      gapDown: list.filter((r) => r.gapPct! <= -GAP_FLAT).length,
      gapFlat: list.filter((r) => Math.abs(r.gapPct!) < GAP_FLAT).length,
      bigGaps: list.filter((r) => Math.abs(r.gapPct!) >= 1).length,
      moves,
      bestDay: byChange[0] ? { date: byChange[0].date, pct: byChange[0].changePct! } : null,
      worstDay: byChange.at(-1) ? { date: byChange.at(-1)!.date, pct: byChange.at(-1)!.changePct! } : null,
      vixLow: withVix[0] ? { date: withVix[0].date, value: withVix[0].vixClose! } : null,
      vixHigh: withVix.at(-1) ? { date: withVix.at(-1)!.date, value: withVix.at(-1)!.vixClose! } : null,
      expiryDays: list.filter((r) => r.expiryDay).length,
      eventDays: list.filter((r) => r.events.length).length,
    };
  }).sort((a, b) => (a.period < b.period ? -1 : 1));
}

export type PatternRow = {
  year: string;
  /** After an up close: how the next day opened (up / down / flat), and the same after a down close. */
  afterUp: { gapUp: number; gapDown: number; gapFlat: number };
  afterDown: { gapUp: number; gapDown: number; gapFlat: number };
  /** Gap-up days that closed above / below their open, and the same for gap-down days. */
  gapUpClose: { aboveOpen: number; belowOpen: number };
  gapDownClose: { aboveOpen: number; belowOpen: number };
};

/** Simple day-to-day patterns, counted separately for every year so a change over time shows. */
export function patternTable(rows: NiftyDay[]): PatternRow[] {
  const out = new Map<string, PatternRow>();
  const blank = (year: string): PatternRow => ({ year, afterUp: { gapUp: 0, gapDown: 0, gapFlat: 0 }, afterDown: { gapUp: 0, gapDown: 0, gapFlat: 0 }, gapUpClose: { aboveOpen: 0, belowOpen: 0 }, gapDownClose: { aboveOpen: 0, belowOpen: 0 } });
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], r = rows[i];
    if (r.gapPct == null) continue;
    const row = out.get(r.date.slice(0, 4)) ?? out.set(r.date.slice(0, 4), blank(r.date.slice(0, 4))).get(r.date.slice(0, 4))!;
    const gapKind = r.gapPct >= GAP_FLAT ? 'gapUp' : r.gapPct <= -GAP_FLAT ? 'gapDown' : 'gapFlat';
    if (prev.changePct != null && prev.changePct > 0) row.afterUp[gapKind]++;
    else if (prev.changePct != null && prev.changePct < 0) row.afterDown[gapKind]++;
    if (gapKind === 'gapUp') row.gapUpClose[r.close >= r.open ? 'aboveOpen' : 'belowOpen']++;
    if (gapKind === 'gapDown') row.gapDownClose[r.close >= r.open ? 'aboveOpen' : 'belowOpen']++;
  }
  return [...out.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
}

/** Rows kept after the user's filters: a year range, and event periods to leave out. */
export function filterRows(rows: NiftyDay[], f: { fromYear?: string; toYear?: string; excludeEvents: string[] }): NiftyDay[] {
  return rows.filter((r) => (!f.fromYear || r.date.slice(0, 4) >= f.fromYear) && (!f.toYear || r.date.slice(0, 4) <= f.toYear) && !r.events.some((e) => f.excludeEvents.includes(e)));
}
