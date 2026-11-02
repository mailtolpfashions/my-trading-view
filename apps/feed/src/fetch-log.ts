// When an NSE archive answered "not published" for a date, is that final? NSE sometimes posts a day's files well
// after the usual evening time, so a miss recorded on the day itself (27 Oct 2026: checked about 19:15 IST, posted
// later) must be retried. A miss is final once it was checked at least FINAL_AFTER_DAYS after the date (a holiday or
// weekend with no session); before that the date is retried, at most every RETRY_MS.

export const FINAL_AFTER_DAYS = 2;
export const RETRY_MS = 3 * 3600_000;

export function missIsFinal(date: string, checkedAt: Date, now = Date.now()): boolean {
  const day = Date.parse(`${date}T00:00:00Z`);
  if ((checkedAt.getTime() - day) / 86400_000 >= FINAL_AFTER_DAYS) return true;
  return now - checkedAt.getTime() < RETRY_MS; // checked recently: leave it until the next retry window
}
