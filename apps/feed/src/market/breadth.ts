// Market breadth of an index from its members' corporate-action adjusted daily closes (NSE end-of-day files).
// Membership is NSE's current constituent list; applied to past days it ignores later changes to the index
// (survivorship), which the page states.

export type DayClose = { date: string; close: number };
export type BreadthDay = { date: string; advances: number; declines: number; unchanged: number; notTraded: number; cumulative: number };
export type BreadthSnapshot = {
  date: string; members: number; traded: number;
  aboveSma20: number; aboveSma50: number; aboveSma200: number; withSma200: number;
  /** Close above / below every close of the previous 252 sessions. */
  newHighs: number; newLows: number; with52w: number;
};

/**
 * Advances, declines and unchanged per trading day over `dates`, from each member's closes. A member counts on a
 * day only if it has a close that day and on its previous trading day; otherwise it is "not traded".
 */
export function breadthByDay(members: Map<string, DayClose[]>, dates: string[]): BreadthDay[] {
  const change = new Map<string, Map<string, number>>(); // symbol -> date -> close − previous close
  for (const [sym, closes] of members) {
    const m = new Map<string, number>();
    for (let i = 1; i < closes.length; i++) m.set(closes[i].date, closes[i].close - closes[i - 1].close);
    change.set(sym, m);
  }
  let cumulative = 0;
  return dates.map((date) => {
    let advances = 0, declines = 0, unchanged = 0, notTraded = 0;
    for (const m of change.values()) {
      const c = m.get(date);
      if (c == null) notTraded++;
      else if (c > 1e-9) advances++;
      else if (c < -1e-9) declines++;
      else unchanged++;
    }
    cumulative += advances - declines;
    return { date, advances, declines, unchanged, notTraded, cumulative };
  });
}

const sma = (v: number[], n: number) => (v.length >= n ? v.slice(-n).reduce((a, b) => a + b, 0) / n : null);

/** Moving-average and 52-week counts on `date` (members without a close that day are not counted). */
export function breadthSnapshot(members: Map<string, DayClose[]>, date: string): BreadthSnapshot {
  const s: BreadthSnapshot = { date, members: members.size, traded: 0, aboveSma20: 0, aboveSma50: 0, aboveSma200: 0, withSma200: 0, newHighs: 0, newLows: 0, with52w: 0 };
  for (const closes of members.values()) {
    let i = closes.length - 1;
    while (i >= 0 && closes[i].date > date) i--;
    if (i < 0 || closes[i].date !== date) continue;
    s.traded++;
    const upto = closes.slice(0, i + 1).map((c) => c.close);
    const last = upto[upto.length - 1];
    const a20 = sma(upto, 20), a50 = sma(upto, 50), a200 = sma(upto, 200);
    if (a20 != null && last > a20) s.aboveSma20++;
    if (a50 != null && last > a50) s.aboveSma50++;
    if (a200 != null) { s.withSma200++; if (last > a200) s.aboveSma200++; }
    if (upto.length > 252) {
      s.with52w++;
      const prior = upto.slice(-253, -1);
      if (last > Math.max(...prior)) s.newHighs++;
      if (last < Math.min(...prior)) s.newLows++;
    }
  }
  return s;
}
