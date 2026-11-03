// Builds coarser bars from finer ones: weeks and months from days (stamped Monday / the 1st at 09:15 IST, as the
// feed's EOD timeframes are), and intraday bars aligned to the 09:15 IST session open (3m, 15m, 1h, 2h, 4h …).

import type { Candle } from '@mtv/shared';
import { TF_MINUTES, isIntraday, type Tf } from './ast';

const IST = 5.5 * 3600;
const DAY = 86400;
const OPEN = 9 * 3600 + 15 * 60;

/** Start time (UTC seconds) of the `tf` bar that a bar opening at `time` belongs to. */
export function bucketStart(time: number, tf: Tf): number {
  const local = time + IST;
  const midnight = local - (local % DAY);
  if (isIntraday(tf)) {
    const span = TF_MINUTES[tf]! * 60, open = midnight + OPEN;
    return open + Math.floor((local - open) / span) * span - IST;
  }
  if (tf === 'D') return midnight + OPEN - IST;
  if (tf === 'W') return midnight - (((Math.floor(local / DAY) + 4) % 7 + 6) % 7) * DAY + OPEN - IST; // 1 Jan 1970: Thursday
  const d = new Date(local * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 + OPEN - IST;
}

/** Start of the bucket after the one starting at `start` (the next month for M; the arithmetic ones need no calendar). */
function nextMonth(start: number): number {
  const d = new Date((start + IST) * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 + OPEN - IST;
}

/** Aggregates bars into `tf` buckets (open of the first, high/low extremes, close of the last, summed volume). */
export function resample(bars: Candle[], tf: Tf): Candle[] {
  const out: Candle[] = [];
  // For months, the calendar is consulted only when a bar falls past the current month.
  let monthStart = -Infinity, monthEnd = -Infinity;
  for (const b of bars) {
    let t: number;
    if (tf === 'M') {
      if (b.time < monthStart || b.time >= monthEnd) { monthStart = bucketStart(b.time, 'M'); monthEnd = nextMonth(monthStart); }
      t = monthStart;
    } else t = bucketStart(b.time, tf);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
  }
  return out;
}
