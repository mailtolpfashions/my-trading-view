// Small pure checks behind the paper rule: is IV high today, which day is the entry day, and which closing prices are stale.

export const DAY_MS = 86400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** A date moved forward past a weekend. Holidays are not known here, so a future date is an estimate. */
export function nextWeekday(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 6 ? addDays(date, 2) : day === 0 ? addDays(date, 1) : date;
}

/** True when `date` is the first trading day at or inside `days` calendar days of the expiry. */
export function isFirstDayWithin(date: string, previousTradingDay: string | null, expiry: string, days: number): boolean {
  return daysBetween(date, expiry) <= days && daysBetween(date, expiry) > 0 && (previousTradingDay == null || daysBetween(previousTradingDay, expiry) > days);
}

export type IvPoint = { date: string; iv: number };

/**
 * Is the day's IV above the median of the previous `window` days? Only earlier days count. Null with under 60 days behind
 * it, or no IV on or after that date. `history` must be sorted by date.
 */
export function ivAboveMedian(history: IvPoint[], date: string, window = 250): boolean | null {
  const i = history.findIndex((p) => p.date >= date);
  if (i < 60) return null;
  const past = history.slice(Math.max(0, i - window), i).map((p) => p.iv).sort((a, b) => a - b);
  return history[i].iv > past[Math.floor(past.length / 2)];
}

/** Share of the previous `window` days with lower IV, from 0 to 1. Only earlier days count. Null with under 60 days behind it. */
export function ivRank(history: IvPoint[], date: string, window = 250): number | null {
  const i = history.findIndex((p) => p.date >= date);
  if (i < 60) return null;
  const past = history.slice(Math.max(0, i - window), i), iv = history[i].iv;
  return past.filter((p) => p.iv < iv).length / past.length;
}

/**
 * A price for an option on one day, for marking a position. A traded close is used as it is. With no trade, NSE's
 * settlement price is used but kept between the option's intrinsic value and the cheapest traded option of the same type
 * that must be worth more (a lower-strike call, a higher-strike put): for far contracts with no trade the settlement price
 * can be far off. 17 Apr 2020, Dec 2020 expiry: the 14000 CE had a settlement price of ₹911.60 while the 12000 CE traded at
 * ₹118. Returns null when there is no price at all.
 */
export function boundedMark(
  rows: Iterable<{ kind: string; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean }>,
  kind: 'CE' | 'PE', strikePaise: number, spotPaise: number,
): number | null {
  let own: { closePaise: number; settlePaise: number; traded: boolean } | null = null, cap = Infinity;
  for (const x of rows) {
    if (x.kind !== kind) continue;
    if (x.strikePaise === strikePaise) { own = x; continue; }
    if (x.traded && x.closePaise > 0 && (kind === 'CE' ? x.strikePaise < strikePaise : x.strikePaise > strikePaise)) cap = Math.min(cap, x.closePaise);
  }
  if (own?.traded && own.closePaise > 0) return own.closePaise;
  if (!own || !(own.settlePaise > 0)) return null;
  const intrinsic = Math.max(0, kind === 'CE' ? spotPaise - strikePaise : strikePaise - spotPaise);
  return Math.max(intrinsic, Math.min(own.settlePaise, cap));
}

/**
 * Finds closing prices that cannot all be live together. For one expiry and option type, sorted by strike, prices must only
 * rise (puts) or only fall (calls). The longest run that obeys this is kept and the rest are flagged: NSE's close can be the
 * day's last trade from hours earlier. 12 Mar 2020: the 9450 PE closed at ₹104 while the 9400 PE closed at ₹360.
 * A small tolerance allows for tick rounding. Prices are flagged, never repaired.
 */
export function staleFlags(pricesByStrike: number[], rising: boolean, tolerancePaise = 5): boolean[] {
  const n = pricesByStrike.length;
  const best = new Array<number>(n).fill(1), from = new Array<number>(n).fill(-1);
  let end = n ? 0 : -1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const ok = rising ? pricesByStrike[i] >= pricesByStrike[j] - tolerancePaise : pricesByStrike[i] <= pricesByStrike[j] + tolerancePaise;
      if (ok && best[j] + 1 > best[i]) { best[i] = best[j] + 1; from[i] = j; }
    }
    if (best[i] > best[end]) end = i;
  }
  const keep = new Set<number>();
  for (let i = end; i >= 0; i = from[i]) keep.add(i);
  return pricesByStrike.map((_, i) => !keep.has(i));
}
