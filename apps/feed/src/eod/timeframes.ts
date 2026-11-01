// End-of-day timeframes and "last close" quotes, built only from NSE's official daily bars (the EOD store). The
// product shows no live or delayed prices: every price is a dated NSE close.

import type { Candle, EodTimeframe, Quote } from '@mtv/shared';
import { dailyHistory } from './store';

const IST = 5.5 * 3600;
const DAY = 86400;
const at0915 = (localMidnight: number) => localMidnight + 9 * 3600 + 15 * 60 - IST;

/** Weekly bars from daily bars, weeks starting Monday (stamped Monday 09:15 IST, even if Monday was a holiday). */
export function weeklyFromDaily(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const d of days) {
    const local = d.time + IST;
    const dow = new Date(local * 1000).getUTCDay();
    const monday = at0915(local - (local % DAY) - ((dow + 6) % 7) * DAY);
    const w = out.at(-1);
    if (w && w.time === monday) { w.high = Math.max(w.high, d.high); w.low = Math.min(w.low, d.low); w.close = d.close; w.volume += d.volume; }
    else out.push({ ...d, time: monday });
  }
  return out;
}

/** Monthly bars from daily bars, stamped the 1st of the month 09:15 IST. */
export function monthlyFromDaily(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const d of days) {
    const local = new Date((d.time + IST) * 1000);
    const first = at0915(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) / 1000);
    const m = out.at(-1);
    if (m && m.time === first) { m.high = Math.max(m.high, d.high); m.low = Math.min(m.low, d.low); m.close = d.close; m.volume += d.volume; }
    else out.push({ ...d, time: first });
  }
  return out;
}

/** Adjusted NSE end-of-day candles for a symbol at D, W or M; null when we hold no history for it. */
export function eodCandles(symbol: string, tf: EodTimeframe): Candle[] | null {
  const h = dailyHistory(symbol);
  if (!h) return null;
  return tf === 'D' ? h.candles : tf === 'W' ? weeklyFromDaily(h.candles) : monthlyFromDaily(h.candles);
}

/** Candles at D, W or M plus the history's data-break dates, from one history build. */
export function eodSeries(symbol: string, tf: EodTimeframe): { candles: Candle[]; breaks: { date: string; reason: string }[] } | null {
  const h = dailyHistory(symbol);
  if (!h) return null;
  return { candles: tf === 'D' ? h.candles : tf === 'W' ? weeklyFromDaily(h.candles) : monthlyFromDaily(h.candles), breaks: h.breaks };
}

/** Last official close and the change from the close before it; `time` is that trading day (09:15 IST stamp). */
export function lastCloseQuote(symbol: string): Quote | null {
  const c = dailyHistory(symbol)?.candles;
  if (!c?.length) return null;
  const last = c[c.length - 1], prev = c.length > 1 ? c[c.length - 2].close : last.open;
  return { symbol, ltp: last.close, prevClose: prev, change: Math.round((last.close - prev) * 100) / 100, changePct: prev ? ((last.close - prev) / prev) * 100 : 0, time: last.time };
}
