// Puts intraday bars on the same split / bonus / rights-adjusted prices as the daily history, so a screen mixing
// [D] and [15m] values, or a chart switching timeframe, never compares adjusted with unadjusted prices.
// Whether a source's minutes are already adjusted is checked day by day: on a day where the adjusted close differs from
// the published one, the day's last minute close is compared with both. Nearer the published close → scale the day
// by adjusted / published (prices up, volume the other way); nearer the adjusted close → already adjusted, leave it.

import type { Candle } from '@mtv/shared';
import { dateOfIst } from './store';

export type DayCloses = Map<string, { raw: number; adj: number }>;

export function adjustToEod(bars: Candle[], closes: DayCloses): Candle[] {
  const byDate = new Map<string, Candle[]>();
  for (const b of bars) { const d = dateOfIst(b.time); byDate.set(d, [...(byDate.get(d) ?? []), b]); }
  const out: Candle[] = [];
  for (const [d, day] of byDate) {
    const c = closes.get(d);
    const f = c && c.raw > 0 ? c.adj / c.raw : 1;
    if (Math.abs(f - 1) < 1e-6) { out.push(...day); continue; }
    const last = day[day.length - 1].close;
    const isRaw = Math.abs(last / c!.raw - 1) <= Math.abs(last / c!.adj - 1);
    if (!isRaw) { out.push(...day); continue; }
    const r = (v: number) => Math.round(v * f * 100) / 100;
    for (const b of day) out.push({ time: b.time, open: r(b.open), high: r(b.high), low: r(b.low), close: r(b.close), volume: Math.round(b.volume / f) });
  }
  return out;
}
