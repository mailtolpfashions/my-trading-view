import { prisma } from '@mtv/db';

const DAY = 86400_000;

/**
 * The real expiry dates of an underlying's contracts, for research scripts.
 *
 * NSE files store each contract under the expiry date it was listed with. Two cases make that date wrong:
 *  - a holiday on the expiry day: the contract stops a day or two early, but keeps its label
 *    (NIFTY April 2014 is stored as 24 Apr, an election holiday; it last traded on 23 Apr);
 *  - an expiry day NSE moved later on (Bank Nifty Dec 2024 is stored both as 26 Dec and, after the move, as 24 Dec).
 * A label that traded on its own day, or is still running, is real. Another label belongs to the label within 7 days that
 * took over from it (started trading within 4 days after it stopped); failing that, a label on a non-trading day is real on
 * its last row if that is up to 4 days earlier; failing that, it keeps its own date.
 *
 * `monthly` is the last real expiry of each calendar month up to `lastDay`. The month of `lastDay` is left out while a later
 * expiry in that month is still listed, because its monthly contract has not expired yet.
 */
export async function expiryCalendar(underlying: string, tradingDays: Set<string>, lastDay: string) {
  const rows = await prisma.$queryRaw<{ expiry: string; first: string; last: string; own: bigint }[]>`
    SELECT expiry, MIN(date) AS first, MAX(date) AS last, COUNT(*) FILTER (WHERE date = expiry) AS own
    FROM "FnoEod" WHERE underlying = ${underlying} AND kind IN ('CE', 'PE') GROUP BY expiry`;
  const labels = rows.filter((r) => r.expiry.length === 10);
  const realOf = new Map<string, string>(); // label → real expiry date
  const genuine = new Set<string>(); // dates a contract really expired on (or will: still running)
  // Real on its own date: it traded on its expiry day, or it is still running.
  for (const r of labels) if (Number(r.own) > 0 || r.expiry > lastDay) { realOf.set(r.expiry, r.expiry); genuine.add(r.expiry); }
  // Relabelled by NSE: another label within 7 days starts trading within 4 days after this one stops. Chains are followed
  // (Bank Nifty Sep 2025: 24 Sep → 25 Sep → 30 Sep). NIFTY Dec 2025: 24 Dec stops 31 Jul 2025, 30 Dec starts 1 Aug.
  const next = new Map<string, string>();
  for (const r of labels) {
    if (realOf.has(r.expiry)) continue;
    const t = labels.filter((x) => x !== r && Math.abs(Date.parse(x.expiry) - Date.parse(r.expiry)) <= 7 * DAY && x.first > r.last && (Date.parse(x.first) - Date.parse(r.last)) / DAY <= 4)
      .sort((a, b) => Date.parse(a.first) - Date.parse(b.first))[0];
    if (t) next.set(r.expiry, t.expiry);
  }
  const holiday = (r: (typeof labels)[number]) => !tradingDays.has(r.expiry) && r.last < r.expiry && (Date.parse(r.expiry) - Date.parse(r.last)) / DAY <= 4;
  const byLabel = new Map(labels.map((r) => [r.expiry, r]));
  for (const r of labels) {
    if (realOf.has(r.expiry)) continue;
    let at = r.expiry; const seen = new Set<string>();
    while (next.has(at) && !seen.has(at)) { seen.add(at); at = next.get(at)!; }
    if (at !== r.expiry && (genuine.has(at) || realOf.has(at))) { realOf.set(r.expiry, realOf.get(at) ?? at); continue; }
    const end = byLabel.get(at)!;
    // The expiry day was a holiday and the contract stopped earlier (NIFTY Apr 2014: 24 Apr, last traded 23 Apr).
    if (holiday(end)) { realOf.set(r.expiry, end.last); genuine.add(end.last); continue; }
    realOf.set(r.expiry, r.expiry); // unexplained: kept apart, and not counted as an expiry
  }
  const real = [...genuine].sort();
  const labelsOf = new Map<string, string[]>();
  for (const [l, r] of realOf) labelsOf.set(r, [...(labelsOf.get(r) ?? []), l]);
  const done = real.filter((e) => e <= lastDay && tradingDays.has(e));
  const lastOf = new Map<string, string>(); for (const e of done) lastOf.set(e.slice(0, 7), e);
  const month = lastDay.slice(0, 7);
  if (labels.some((r) => r.expiry.startsWith(month) && r.expiry > lastDay)) lastOf.delete(month);
  return {
    /** Every real expiry date that has passed, sorted. */
    expired: done,
    /** The monthly expiry of each month that has passed, sorted. */
    monthly: [...lastOf.values()].sort(),
    /** All stored labels of a real expiry date (itself included), for loading its rows. */
    labels: (e: string) => labelsOf.get(e) ?? [e],
    /** The real expiry date of a stored label. */
    realOf: (label: string) => realOf.get(label) ?? label,
  };
}
