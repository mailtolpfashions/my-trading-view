import type { Candle, DataQuality, Timeframe } from '@mtv/shared';

const IST = 5.5 * 3600;
const OPEN = (9 * 60 + 15) * 60; // 09:15 IST
const SESSION = 375 * 60; // 09:15–15:30

const dayStart = (t: number) => {
  const local = t + IST;
  return local - (local % 86400) + OPEN - IST; // 09:15 IST of that day, in UTC seconds
};

/**
 * Audits candles against the NSE session grid and removes bars that cannot be trusted.
 * - invalid: high/low don't contain open/close, or prices <= 0
 * - misaligned: intraday bar not on the 09:15-anchored grid for `tf`, or a duplicate timestamp
 * - suspect: frozen bars (flat and equal to the previous close), kept but flagged
 * - missing: grid slots with no bar, on days the source returned data for (holidays are absent, not missing).
 *   On the latest day, only gaps before the last bar count, since the session may still be in progress.
 * Nothing is ever filled in.
 */
export function auditCandles(input: Candle[], tf: Timeframe): { candles: Candle[]; quality: DataQuality } {
  const invalid: number[] = [], misaligned: number[] = [], missing: number[] = [];
  const intraday = tf !== 'D' && tf !== 'W';
  const span = intraday ? Number(tf) * 60 : 0;
  const seen = new Set<number>();
  const candles: Candle[] = [];

  for (const c of input) {
    const prices = [c.open, c.high, c.low, c.close];
    if (prices.some((p) => !Number.isFinite(p) || p <= 0) || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.volume < 0) {
      invalid.push(c.time);
      continue;
    }
    if (seen.has(c.time) || (candles.length && c.time < candles[candles.length - 1].time)) {
      misaligned.push(c.time);
      continue;
    }
    if (intraday) {
      const off = c.time - dayStart(c.time);
      if (off < 0 || off >= SESSION || off % span !== 0) {
        misaligned.push(c.time);
        continue;
      }
    }
    seen.add(c.time);
    candles.push(c);
  }

  const suspect: number[] = [];
  if (intraday) {
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      if (c.open === c.high && c.high === c.low && c.low === c.close && c.close === candles[i - 1].close) suspect.push(c.time);
    }
  }

  if (intraday && candles.length) {
    const days = [...new Set(candles.map((c) => dayStart(c.time)))];
    const lastTime = candles[candles.length - 1].time;
    days.forEach((open, i) => {
      const end = i === days.length - 1 ? lastTime : open + SESSION;
      for (let t = open; t < end; t += span) if (!seen.has(t)) missing.push(t);
    });
  }

  const ok = !missing.length && !invalid.length && !misaligned.length && !suspect.length;
  return { candles, quality: { ok, missing, invalid, misaligned, suspect } };
}
