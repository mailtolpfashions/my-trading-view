// Records NIFTY and BANKNIFTY option minutes from the live feed, to build an intraday option history that Kite's
// historical API cannot give for expired contracts. Recorded: the current and next expiry, the 10 strikes each side of
// the index (CE and PE). When the index moves, newly needed strikes are added for the rest of the day (never dropped).
// Each minute keeps the traded OHLC, volume, open interest and the best bid and ask at the minute's close, so later
// backtests can use real spreads instead of a guessed slippage.
// Files: apps/feed/.data/opt1m/UNDERLYING/YYYY-MM-DD.bin, rows of 13 int32s (see ROW below).

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OptionContract } from '../providers/kite/provider';
import type { Tick } from '../providers/kite/ticker';
import { minuteStart } from './builder';
import { dateOfIst } from './store';

export type OptionMinute = {
  time: number; expiry: string; strike: number; right: 'CE' | 'PE';
  open: number; high: number; low: number; close: number; volume: number; oi: number;
  /** Best bid and ask at the minute's close, ₹ (0 when that side was empty). */
  bid: number; ask: number;
};

const ROW = 13 * 4;
const toInt = (rupees: number) => Math.round(rupees * 100);

function encode(rows: OptionMinute[]): Buffer {
  const b = Buffer.alloc(rows.length * ROW);
  rows.forEach((r, i) => {
    const vals = [r.time, Number(r.expiry.replace(/-/g, '')), toInt(r.strike), r.right === 'CE' ? 0 : 1, toInt(r.open), toInt(r.high), toInt(r.low), toInt(r.close), Math.min(2 ** 31 - 1, r.volume), Math.min(2 ** 31 - 1, r.oi), toInt(r.bid), toInt(r.ask), 0];
    vals.forEach((v, k) => b.writeInt32LE(v, i * ROW + k * 4));
  });
  return b;
}

function decode(buf: Buffer): OptionMinute[] {
  const out: OptionMinute[] = [];
  for (let o = 0; o + ROW <= buf.length; o += ROW) {
    const v = (k: number) => buf.readInt32LE(o + k * 4);
    const e = String(v(1));
    out.push({ time: v(0), expiry: `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`, strike: v(2) / 100, right: v(3) ? 'PE' : 'CE', open: v(4) / 100, high: v(5) / 100, low: v(6) / 100, close: v(7) / 100, volume: v(8), oi: v(9), bid: v(10) / 100, ask: v(11) / 100 });
  }
  return out;
}

export class OptionStore {
  constructor(readonly dir = path.resolve(import.meta.dirname, '../../.data/opt1m')) {}
  async append(underlying: string, rows: OptionMinute[]) {
    if (!rows.length) return;
    const f = path.join(this.dir, underlying, `${dateOfIst(rows[0].time)}.bin`);
    await mkdir(path.dirname(f), { recursive: true });
    await appendFile(f, encode(rows));
  }
  async read(underlying: string, date: string): Promise<OptionMinute[]> {
    return readFile(path.join(this.dir, underlying, `${date}.bin`)).then(decode, () => []);
  }
}

/** The contracts to record: the nearest two expiries, `width` strikes each side of the strike nearest `spot`. */
export function pickContracts(all: OptionContract[], spot: number, today: string, width = 10): OptionContract[] {
  const expiries = [...new Set(all.filter((c) => c.expiry >= today).map((c) => c.expiry))].sort().slice(0, 2);
  const out: OptionContract[] = [];
  for (const e of expiries) {
    const strikes = [...new Set(all.filter((c) => c.expiry === e).map((c) => c.strike))].sort((a, b) => a - b);
    if (!strikes.length) continue;
    let atm = 0;
    strikes.forEach((s, i) => { if (Math.abs(s - spot) < Math.abs(strikes[atm] - spot)) atm = i; });
    const keep = new Set(strikes.slice(Math.max(0, atm - width), atm + width + 1));
    out.push(...all.filter((c) => c.expiry === e && keep.has(c.strike)));
  }
  return out;
}

type Bar = OptionMinute & { baseVol: number; lastCum: number; keep: boolean };

/** Minute bars per option contract from full-mode ticks (same rules as the stock builder, plus OI and bid / ask). */
export class OptionRecorder {
  private contracts = new Map<number, { underlying: string; c: OptionContract }>();
  private bars = new Map<number, Bar>();
  rowsToday = 0;

  constructor(private onRows: (underlying: string, rows: OptionMinute[]) => void) {}

  /** Starts recording these contracts (already recorded ones are left as they are). Returns the new tokens. */
  add(underlying: string, list: OptionContract[]): number[] {
    const fresh = list.filter((c) => !this.contracts.has(c.token));
    for (const c of fresh) this.contracts.set(c.token, { underlying, c });
    return fresh.map((c) => c.token);
  }

  get size() { return this.contracts.size; }

  tick(t: Tick, now: number) {
    const meta = this.contracts.get(t.token);
    if (!meta || !(t.ltpPaise > 0)) return;
    const time = t.time || now;
    const start = minuteStart(time);
    if (start == null) return;
    const ltp = t.ltpPaise / 100, cum = t.volume ?? 0;
    let b = this.bars.get(t.token);
    if (b && start < b.time) return;
    if (b && start > b.time) { this.finish(t.token, b); b = undefined; }
    if (!b) {
      const prev = this.bars.get(t.token);
      const known = prev && dateOfIst(prev.time) === dateOfIst(start); // the day's running volume before this bar is known
      const atOpen = (start + 5.5 * 3600) % 86400 === 9 * 3600 + 15 * 60;
      b = {
        time: start, expiry: meta.c.expiry, strike: meta.c.strike, right: meta.c.right, open: ltp, high: ltp, low: ltp, close: ltp,
        volume: 0, oi: t.oi ?? 0, bid: (t.bidPaise ?? 0) / 100, ask: (t.askPaise ?? 0) / 100,
        baseVol: known ? prev!.lastCum : atOpen ? 0 : cum, lastCum: known ? prev!.lastCum : cum, keep: !!known || atOpen,
      };
      this.bars.set(t.token, b);
    }
    b.high = Math.max(b.high, ltp);
    b.low = Math.min(b.low, ltp);
    b.close = ltp;
    if (cum >= b.lastCum) b.lastCum = cum;
    b.volume = Math.max(0, b.lastCum - b.baseVol);
    if (t.oi) b.oi = t.oi;
    if (t.bidPaise != null) b.bid = t.bidPaise / 100;
    if (t.askPaise != null) b.ask = t.askPaise / 100;
  }

  private finish(token: number, b: Bar) {
    if (!b.keep) return;
    b.keep = false;
    const { baseVol: _b, lastCum: _l, keep: _k, ...row } = b;
    this.rowsToday++;
    this.onRows(this.contracts.get(token)!.underlying, [row]);
  }

  /** Closes bars whose minute ended `graceSec` ago (contracts with no trade since). */
  flush(now: number, graceSec = 3) {
    for (const [token, b] of this.bars) if (b.keep && b.time + 60 + graceSec <= now) this.finish(token, b);
  }
}
