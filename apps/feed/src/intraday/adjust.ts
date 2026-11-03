// Puts intraday bars on the same split / bonus / rights-adjusted prices as the daily history, so a screen mixing
// [D] and [15m] values, or a chart switching timeframe, never compares prices on different bases.
//
// Kite's historical minutes come already adjusted by Kite's own rules, which include dividends (ITC's minutes a year
// back sit about 4.6% below NSE's published prices), while the daily history adjusts only splits, bonuses and rights.
// So each day is re-based on its opening price, which matches NSE's published open on every unadjusted day:
//   Kite's scale for the day   k = first minute's open ÷ NSE's published open
//   our scale for the day      a = adjusted close ÷ published close (from the daily history)
//   minute prices × a / k,  volumes × k / a.
// A day whose first minute is not 09:15 (or that has no published bar) borrows k from the nearest day that has one,
// since Kite's scale only changes on corporate-action dates.

import type { Candle } from '@mtv/shared';
import { dateOfIst } from './store';

export type DayInfo = Map<string, { rawOpen: number; adj: number }>;

const IST = 5.5 * 3600;
const OPEN = 9 * 3600 + 15 * 60;

export function adjustToEod(bars: Candle[], days: DayInfo): Candle[] {
  const byDate = new Map<string, Candle[]>();
  for (const b of bars) { const d = dateOfIst(b.time); byDate.set(d, [...(byDate.get(d) ?? []), b]); }
  const dates = [...byDate.keys()];

  // Kite's scale where the day's first minute and the published open are both there.
  const k = new Map<string, number>();
  for (const d of dates) {
    const first = byDate.get(d)![0], info = days.get(d);
    if (!info?.rawOpen || (first.time + IST) % 86400 !== OPEN) continue;
    const r = first.open / info.rawOpen;
    k.set(d, Math.abs(r - 1) < 0.002 ? 1 : r); // tick rounding on low-priced stocks
  }
  const nearest = (i: number): number => {
    for (let s = 1; s < dates.length; s++) {
      const a = k.get(dates[i - s]), b = k.get(dates[i + s]);
      if (a != null) return a;
      if (b != null) return b;
    }
    return 1;
  };

  const out: Candle[] = [];
  dates.forEach((d, i) => {
    const day = byDate.get(d)!;
    const scale = (days.get(d)?.adj ?? 1) / (k.get(d) ?? nearest(i));
    if (Math.abs(scale - 1) < 0.0005) { out.push(...day); return; }
    const r = (v: number) => Math.round(v * scale * 100) / 100;
    for (const b of day) out.push({ time: b.time, open: r(b.open), high: r(b.high), low: r(b.low), close: r(b.close), volume: Math.round(b.volume / scale) });
  });
  return out;
}
