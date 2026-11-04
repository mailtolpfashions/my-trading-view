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
