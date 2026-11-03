// Builds one-minute bars from live ticks (Kite full mode: last price, the day's running volume and the last trade
// time). A bar covers [hh:mm, hh:mm+1) IST inside the 09:15–15:30 session; its volume is the change in the day's
// running volume. The first bar seen for a stock after the service starts mid-session is never kept, because the
// volume traded before that tick is unknown; the historical download supplies those minutes instead.

import type { Candle } from '@mtv/shared';

const IST = 5.5 * 3600;
const OPEN = 9 * 3600 + 15 * 60, CLOSE = 15 * 3600 + 30 * 60;
const dayOf = (t: number) => Math.floor((t + IST) / 86400);

/** Start of the minute a trade at `t` belongs to, or null outside the session. */
export function minuteStart(t: number): number | null {
  const local = t + IST, sec = local % 86400;
  if (sec < OPEN || sec >= CLOSE) return null;
  return t - (t % 60);
}

type State = { bar: Candle; baseVol: number; lastCum: number; keep: boolean };

export class MinuteBuilder {
  private state = new Map<string, State>();
  private today = new Map<string, Candle[]>();
  private day = -1;

  /** `onBars`: finished bars to store. */
  constructor(private onBars: (symbol: string, bars: Candle[]) => void) {}

  private newDay(t: number) {
    if (dayOf(t) === this.day) return;
    this.day = dayOf(t);
    this.today.clear();
    // Running volume restarts each day, so a stock seen yesterday starts today's first bar from zero.
    for (const s of this.state.values()) { s.baseVol = 0; s.lastCum = 0; s.keep = true; }
  }

  /** One tick: `ltp` in rupees, `cumVolume` the day's volume so far (null for indices), `time` UTC seconds. */
  tick(symbol: string, ltp: number, cumVolume: number | null, time: number) {
    const start = minuteStart(time);
    if (start == null || !(ltp > 0)) return;
    this.newDay(time);
    const cum = cumVolume ?? 0;
    let s = this.state.get(symbol);
    if (s && dayOf(s.bar.time) !== this.day) { this.state.delete(symbol); s = undefined; }
    if (!s) {
      // First tick for this stock today. At 09:15 nothing traded before it (pre-open volume belongs to the first bar,
      // as in Kite's minute data); later, earlier volume is unknown, so this bar is only a starting point.
      const atOpen = (start + IST) % 86400 === OPEN;
      this.state.set(symbol, { bar: { time: start, open: ltp, high: ltp, low: ltp, close: ltp, volume: atOpen ? cum : 0 }, baseVol: atOpen ? 0 : cum, lastCum: cum, keep: atOpen });
      return;
    }
    if (start < s.bar.time) return; // a late tick for a finished minute
    if (start > s.bar.time) {
      this.finish(symbol, s);
      s.bar = { time: start, open: ltp, high: ltp, low: ltp, close: ltp, volume: 0 };
      s.baseVol = s.lastCum;
      s.keep = true;
    }
    const b = s.bar;
    b.high = Math.max(b.high, ltp);
    b.low = Math.min(b.low, ltp);
    b.close = ltp;
    if (cum >= s.lastCum) s.lastCum = cum;
    b.volume = Math.max(0, s.lastCum - s.baseVol);
  }

  private finish(symbol: string, s: State) {
    if (!s.keep) return;
    const done = { ...s.bar };
    const list = this.today.get(symbol) ?? [];
    if (!list.length || list[list.length - 1].time < done.time) list.push(done);
    this.today.set(symbol, list);
    this.onBars(symbol, [done]);
    s.keep = false; // never emitted twice
  }

  /** Closes every bar whose minute ended at least `graceSec` before `now` (stocks with no trade since). */
  flush(now: number, graceSec = 3) {
    for (const [symbol, s] of this.state) {
      if (s.keep && s.bar.time + 60 + graceSec <= now) this.finish(symbol, s);
    }
  }

  /** Today's finished bars, plus the bar still forming when `forming` is set. */
  todayBars(symbol: string, forming: boolean): Candle[] {
    const list = this.today.get(symbol) ?? [];
    const s = this.state.get(symbol);
    if (!forming || !s || dayOf(s.bar.time) !== this.day || (list.length && list[list.length - 1].time >= s.bar.time)) return list;
    return [...list, { ...s.bar }];
  }

  /**
   * Today's minutes from the historical API (authoritative up to its last bar); live bars after that are kept.
   * Returns true when minutes may be missing between the two: the live side started more than a minute after the
   * download's last bar (the minute the service joined is never kept), so a second download should fill the seam.
   */
  setToday(symbol: string, bars: Candle[]): boolean {
    if (!bars.length) return false;
    this.newDay(bars[bars.length - 1].time);
    const last = bars[bars.length - 1].time;
    const live = (this.today.get(symbol) ?? []).filter((b) => b.time > last);
    this.today.set(symbol, [...bars, ...live]);
    const s = this.state.get(symbol);
    const nextLive = live[0]?.time ?? (s && s.bar.time > last ? s.bar.time : null);
    return nextLive != null && nextLive - last > 60;
  }

  symbols() { return [...this.today.keys()]; }
}
