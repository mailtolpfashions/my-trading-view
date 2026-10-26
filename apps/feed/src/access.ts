// Data entitlements. When the source is live (Kite / licensed vendor), Free users must only ever receive data that is
// at least 15 minutes old (the condition of the cheaper delayed licence); Live users get real-time data and are counted
// once per month for exchange per-user fees. When the source itself is delayed, everyone gets the same delayed data.

import type { Candle, Quote, Timeframe } from '@mtv/shared';

export const DELAY_SEC = 15 * 60;
const IST = 5.5 * 3600;

/** Keeps a short history of live quotes per symbol so Free users can be served the price as of 15 minutes ago. */
export class DelayBuffer {
  private hist = new Map<string, Quote[]>();

  push(q: Quote) {
    const list = this.hist.get(q.symbol) ?? [];
    if (list.length && list[list.length - 1].time > q.time) return; // out-of-order tick: ignore
    list.push(q);
    // Keep a little more than the delay window.
    const keepFrom = q.time - DELAY_SEC - 120;
    while (list.length > 1 && list[1].time <= keepFrom) list.shift();
    this.hist.set(q.symbol, list);
  }

  /** The latest quote whose exchange time is at or before `nowSec − 15 min`, or null if none is old enough yet. */
  delayed(symbol: string, nowSec: number): Quote | null {
    const cutoff = nowSec - DELAY_SEC;
    const list = this.hist.get(symbol);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].time <= cutoff) return list[i];
    return null;
  }
}

/** When a bar closes, in UTC seconds: intraday = open + tf; daily = 15:30 IST that day; weekly = Friday 15:30 IST. */
export function barEnd(c: Candle, tf: Timeframe): number {
  if (tf === 'D' || tf === 'W') {
    const local = c.time + IST;
    const day = local - (local % 86400);
    return day + (tf === 'W' ? 4 * 86400 : 0) + (15 * 60 + 30) * 60 - IST;
  }
  return c.time + Number(tf) * 60;
}

/** For Free users on a live source: only bars that closed at least 15 minutes ago (never a bar with newer prices). */
export function delayCandles(candles: Candle[], tf: Timeframe, nowSec: number): Candle[] {
  const cutoff = nowSec - DELAY_SEC;
  return candles.filter((c) => barEnd(c, tf) <= cutoff);
}

const istMonth = (sec: number) => new Date((sec + IST) * 1000).toISOString().slice(0, 7);

/** Remembers which users were already recorded this month, so the database is written once per user per month. */
export class LiveUsageRecorder {
  private seen = new Set<string>();
  constructor(private save: (userId: string, month: string) => Promise<void>, private log: (m: string) => void) {}

  record(userId: string, nowSec: number) {
    const key = `${userId}|${istMonth(nowSec)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.save(userId, istMonth(nowSec)).catch((e) => {
      this.seen.delete(key); // retry on the next live delivery
      this.log(`Live usage not recorded for ${userId}: ${(e as Error).message}`);
    });
  }
}
