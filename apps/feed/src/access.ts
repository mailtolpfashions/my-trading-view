// Data entitlements. When the source is live (Kite / licensed vendor), Free users must only ever receive data that is
// at least 15 minutes old (the condition of the cheaper delayed licence); Live users get real-time data and are counted
// once per month for exchange per-user fees. When the source itself is delayed, everyone gets the same delayed data.

import type { Candle, Quote, Timeframe } from '@mtv/shared';

export const DELAY_SEC = 15 * 60;
const IST = 5.5 * 3600;

/** Ring of (second, price) samples for one symbol: the last sample in each second is kept. */
class Ring {
  static SIZE = 1200; // ≥ 20 minutes at one sample per second
  times = new Float64Array(Ring.SIZE);
  prices = new Float64Array(Ring.SIZE);
  head = 0; // next write slot
  size = 0;
  prevClose = 0;

  last() { return this.size ? (this.head - 1 + Ring.SIZE) % Ring.SIZE : -1; }
  push(time: number, price: number) {
    const sec = Math.floor(time), l = this.last();
    if (l >= 0 && this.times[l] > sec) return; // out of order: ignore
    if (l >= 0 && this.times[l] === sec) { this.prices[l] = price; return; }
    this.times[this.head] = sec;
    this.prices[this.head] = price;
    this.head = (this.head + 1) % Ring.SIZE;
    this.size = Math.min(this.size + 1, Ring.SIZE);
  }
  /** Index of the newest sample at or before `t`, or -1 (also -1 if the oldest kept sample is already newer). */
  at(t: number) {
    for (let k = 0; k < this.size; k++) {
      const i = (this.head - 1 - k + 2 * Ring.SIZE) % Ring.SIZE;
      if (this.times[i] <= t) return i;
    }
    return -1;
  }
}

/**
 * Records every live tick (one sample per second per symbol) so Free users can be shown the market exactly as it
 * moved, 15 minutes later: a delayed broadcast, updating every second. Memory is fixed per symbol (~19 KB).
 */
export class DelayBuffer {
  private rings = new Map<string, Ring>();

  push(q: Quote) {
    let r = this.rings.get(q.symbol);
    if (!r) { r = new Ring(); this.rings.set(q.symbol, r); }
    r.prevClose = q.prevClose;
    r.push(q.time, q.ltp);
  }

  /** The price as it stood at `nowSec − 15 min`, or null if recording for this symbol started after that moment. */
  delayed(symbol: string, nowSec: number): Quote | null {
    const r = this.rings.get(symbol);
    if (!r) return null;
    const i = r.at(nowSec - DELAY_SEC);
    if (i < 0) return null;
    const ltp = r.prices[i], change = ltp - r.prevClose;
    return { symbol, ltp, prevClose: r.prevClose, change: Math.round(change * 100) / 100, changePct: r.prevClose ? (change / r.prevClose) * 100 : 0, time: r.times[i] };
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

const dayOf = (sec: number) => Math.floor((sec + IST) / 86400);

/**
 * Bars for a Free user on a live source, built only from data at least 15 minutes old: every bar that had closed
 * by then, plus the bar in progress at that moment rebuilt from finer bars that had closed by then (1-minute bars;
 * for weekly bars, the week's completed daily bars plus today's 1-minute bars). Nothing newer than the cutoff is used.
 */
export function delayCandlesWithPartial(candles: Candle[], tf: Timeframe, nowSec: number, oneMinute: Candle[], daily: Candle[] = []): Candle[] {
  const cutoff = nowSec - DELAY_SEC;
  const done = delayCandles(candles, tf, nowSec);
  const current = candles.find((c) => c.time <= cutoff && barEnd(c, tf) > cutoff);
  if (!current) return done;
  const end = barEnd(current, tf);
  const minutes = oneMinute.filter((m) => m.time >= current.time && m.time < end && m.time + 60 <= cutoff);
  let pieces = minutes;
  if (tf === 'W') {
    const days = daily.filter((d) => d.time >= current.time && d.time < end && barEnd(d, 'D') <= cutoff);
    const covered = new Set(days.map((d) => dayOf(d.time)));
    pieces = [...days, ...minutes.filter((m) => !covered.has(dayOf(m.time)))].sort((a, b) => a.time - b.time);
  }
  if (!pieces.length) return done;
  const partial: Candle = {
    time: current.time,
    open: pieces[0].open,
    high: Math.max(...pieces.map((p) => p.high)),
    low: Math.min(...pieces.map((p) => p.low)),
    close: pieces[pieces.length - 1].close,
    volume: pieces.reduce((s, p) => s + p.volume, 0),
  };
  return [...done, partial];
}

/** A quote as of 15 minutes ago, from the last 1-minute bar that had closed by then; null if there is none. */
export function delayedQuoteFromBars(live: Quote, oneMinute: Candle[], nowSec: number): Quote | null {
  const cutoff = nowSec - DELAY_SEC;
  let last: Candle | undefined;
  for (const m of oneMinute) if (m.time + 60 <= cutoff && (!last || m.time > last.time)) last = m;
  if (!last) return null;
  const change = last.close - live.prevClose;
  // Before the day's first 15 minutes have passed, the delayed price is still yesterday's last trade.
  const sameDay = dayOf(last.time) === dayOf(live.time);
  // Stamped inside that minute (its last second), so a chart files the price under the bar it came from.
  return { ...live, ltp: last.close, change: sameDay ? change : 0, changePct: sameDay && live.prevClose ? (change / live.prevClose) * 100 : 0, time: last.time + 59 };
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
