// Calibration log for the intraday seller engine (spec v14 item 26, phase 4). Every run is logged (live: every 5 minutes
// in market hours; replay: the recorded days), and after the close each day is settled from stored data:
// - NIFTY's 15:30 close (ACTUAL_1530_CLOSE), and whether the issued direction and the E4 range held;
// - for each suggested sell, the real premium path from the option recorder: sold at the BID of the run's last finished
//   minute, bought back at the ASK of the 14:59 minute (the owner's window closes at 15:00), or earlier at the ASK of the
//   minute after a 15-minute close past the invalidation level ("with invalidation exit"); the worst ASK on the way;
//   whether NIFTY reached the strike by 15:00 and by 15:29. Charges are NSE option charges at the run's date.
// A setup counts once a day per side + strike (the first run that suggested it), so 5-minute repeats don't inflate counts.
// Files: apps/feed/.data/seller-log/YYYY-MM-DD.json. Paper only: fills at bid / ask are kinder than a real queue.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intraday } from '@mtv/options';
import { computeTradeCharges, brokerById } from '@mtv/paper';
import { MinuteStore, dateOfIst } from '../intraday/store';
import { OptionStore, type OptionMinute } from '../intraday/options';

const DIR = path.resolve(import.meta.dirname, '../../.data/seller-log');
const minutes = new MinuteStore();
const options = new OptionStore();
const IST = 19800;
const minuteOf = (t: number) => Math.floor(((t + IST) % 86400) / 60);
const hm = (t: number) => new Date((t + IST) * 1000).toISOString().slice(11, 16);
const EXIT_MIN = 15 * 60; // the window closes at 15:00: buy back at the 14:59 minute's close
const EXIT_SLACK = 5; // an ask within the last 5 minutes before 15:00 is accepted (a quiet strike may not quote every minute)
/** The owner's entry window: setups suggested before 09:30 or at/after 15:00 are logged but not counted as trades. */
const ENTRY_FROM = 9 * 60 + 30, ENTRY_TO = 15 * 60;

export type LogEntry = {
  at: number; time: string; source: 'live' | 'replay';
  candles: number; pressure: number | null; capacity: number | null; confidence: number | null;
  e4: number | null; e4Boundary: [number, number] | null;
  direction: intraday.View['direction']; mode: intraday.View['mode']; sellerView: intraday.View['sellerView'];
  spot: number | null; dayHigh: number | null; dayLow: number | null;
  setup: null | { side: 'CALL SELL' | 'PUT SELL'; strike: number; expiry: string; premium: number; lotSize: number | null; breachOdds: number | null; invalidation: number };
  line: string;
};
export type SetupOutcome = {
  key: string; firstAt: string; runs: number; side: 'CALL SELL' | 'PUT SELL'; strike: number; expiry: string; lotSize: number | null; breachOdds: number | null;
  /** Sold at this bid (null: no bid recorded at that minute). */
  entryBid: number | null; exitAsk: number | null; exitAt: string | null; worstAsk: number | null;
  invalidatedAt: string | null; exitAskInvalidation: number | null;
  touched1500: boolean; touched1529: boolean;
  /** ₹ per lot after charges; null when a price is missing. */
  pnlHold: number | null; pnlWithInvalidation: number | null; charges: number | null;
  notes: string[];
};
export type DayLog = {
  date: string; entries: LogEntry[];
  settled: null | {
    at: string; close1530: number | null; setups: SetupOutcome[];
    /** Per run: did the issued direction hold at the close; did NIFTY stay inside the E4 range until 15:30. */
    runs: { time: string; directionHeld: boolean | null; e4Held: boolean | null }[];
    /** Runs that suggested a sell outside 09:30–15:00 (logged, not counted). */
    outsideWindow: number;
  };
};

const file = (date: string) => path.join(DIR, `${date}.json`);
export async function readDay(date: string): Promise<DayLog | null> {
  return readFile(file(date), 'utf8').then((t) => JSON.parse(t) as DayLog, () => null);
}
async function writeDay(d: DayLog) { await mkdir(DIR, { recursive: true }); await writeFile(file(d.date), JSON.stringify(d)); }

/** Adds one run to its day's log (a later run at the same minute replaces it). */
export async function logRun(view: intraday.View, at: number, source: LogEntry['source']) {
  const date = dateOfIst(at), a = view.audit, s = view.setup;
  const entry: LogEntry = {
    at, time: hm(at), source, candles: view.header.candles, pressure: a.pressure, capacity: a.capacity.score, confidence: a.confidence,
    e4: a.e4.value, e4Boundary: a.e4.boundary, direction: view.direction, mode: view.mode, sellerView: view.sellerView,
    spot: a.spot, dayHigh: a.dayHigh, dayLow: a.dayLow,
    setup: s ? { side: s.side, strike: s.strike, expiry: s.expiry, premium: s.premium, lotSize: s.lotSize, breachOdds: s.breachOdds, invalidation: s.invalidation.level } : null,
    line: view.log,
  };
  const d = (await readDay(date)) ?? { date, entries: [], settled: null };
  d.entries = [...d.entries.filter((e) => e.time !== entry.time), entry].sort((x, y) => x.at - y.at);
  d.settled = null; // a new run after settling (replays) needs settling again
  await writeDay(d);
  return entry;
}

const optCharges = (side: 'BUY' | 'SELL', qty: number, price: number, date: string) =>
  computeTradeCharges({ segment: 'OPT', side, qty, pricePaise: Math.round(price * 100), date, broker: brokerById('zerodha') }).total / 100;

/** Settles a finished day from the stored NIFTY minutes and option minutes. Returns null if the day has no close yet. */
export async function settleDay(date: string): Promise<DayLog | null> {
  const d = await readDay(date);
  if (!d || !d.entries.length) return d;
  const from = Math.floor(Date.parse(`${date}T00:00:00+05:30`) / 1000);
  const nifty = (await minutes.read('NIFTY', from)).filter((b) => dateOfIst(b.time) === date).sort((a, b) => a.time - b.time);
  const last = nifty.at(-1);
  if (!last || minuteOf(last.time) < 15 * 60 + 25) return d; // the session isn't complete in the store yet
  const close1530 = last.close;
  const opt = await options.read('NIFTY', date);

  const runs = d.entries.map((e) => {
    const after = nifty.filter((b) => b.time + 60 > e.at);
    const directionHeld = e.spot == null || (e.direction !== 'UP' && e.direction !== 'DOWN') ? null : e.direction === 'UP' ? close1530 > e.spot : close1530 < e.spot;
    const e4Held = !e.e4Boundary || !after.length ? null : after.every((b) => b.high <= e.e4Boundary![1] && b.low >= e.e4Boundary![0]);
    return { time: e.time, directionHeld, e4Held };
  });

  const byKey = new Map<string, { first: LogEntry; runs: number }>();
  const outside = d.entries.filter((e) => e.setup && (minuteOf(e.at) < ENTRY_FROM || minuteOf(e.at) >= ENTRY_TO)).length;
  for (const e of d.entries) if (e.setup && minuteOf(e.at) >= ENTRY_FROM && minuteOf(e.at) < ENTRY_TO) {
    const k = `${e.setup.side}|${e.setup.strike}|${e.setup.expiry}`;
    const g = byKey.get(k);
    if (g) g.runs++; else byKey.set(k, { first: e, runs: 1 });
  }
  const setups: SetupOutcome[] = [];
  for (const [key, { first: e, runs: n }] of byKey) {
    const s = e.setup!, isCall = s.side === 'CALL SELL', right = isCall ? 'CE' : 'PE';
    const path_ = opt.filter((r) => r.expiry === s.expiry && r.strike === s.strike && r.right === right).sort((a, b) => a.time - b.time);
    const notes: string[] = [];
    const entryRow = path_.filter((r) => r.time + 60 <= e.at).at(-1);
    const entryBid = entryRow?.bid || null;
    if (!entryRow) notes.push('no recorded minute for this option before the run');
    else if (!entryRow.bid) notes.push('no bid at the entry minute');
    const held = path_.filter((r) => r.time + 60 > e.at && minuteOf(r.time) < EXIT_MIN);
    // The buy-back must be priced near 15:00: if the recording stopped earlier, the trade is left unpriced, never
    // closed at whatever the last recorded minute happened to be.
    const lastAsk: OptionMinute | undefined = held.filter((r) => r.ask > 0).at(-1);
    const exitRow = lastAsk && minuteOf(lastAsk.time) >= EXIT_MIN - EXIT_SLACK ? lastAsk : undefined;
    if (lastAsk && !exitRow) notes.push(`recording of this option stopped at ${hm(lastAsk.time + 60)}, so the 15:00 buy-back is unknown`);
    if (!lastAsk) notes.push('no ask recorded between the run and 15:00');
    const asks = held.map((r) => r.ask).filter((x) => x > 0);
    // Invalidation: a finished 15-minute NIFTY candle (closing at :29/:44/:59/:14) closes past the level.
    const inv = nifty.find((b) => b.time + 60 > e.at && minuteOf(b.time) < EXIT_MIN && (minuteOf(b.time) - 9 * 60 - 15) % 15 === 14 && (isCall ? b.close > s.invalidation : b.close < s.invalidation));
    let exitInv: OptionMinute | undefined;
    if (inv) exitInv = path_.find((r) => r.time > inv.time && r.ask > 0);
    const reach = (upto: number) => nifty.some((b) => b.time + 60 > e.at && minuteOf(b.time) < upto && (isCall ? b.high >= s.strike : b.low <= s.strike));
    const lot = s.lotSize;
    if (lot == null) notes.push('lot size unknown');
    const pnl = (sell: number | null, buy: number | null) => sell == null || buy == null || lot == null ? null
      : Math.round((sell - buy) * lot - optCharges('SELL', lot, sell, date) - optCharges('BUY', lot, buy, date));
    const exitAsk = exitRow?.ask ?? null, exitAskInv = inv ? exitInv?.ask ?? null : exitAsk;
    setups.push({
      key, firstAt: e.time, runs: n, side: s.side, strike: s.strike, expiry: s.expiry, lotSize: lot, breachOdds: s.breachOdds,
      entryBid, exitAsk, exitAt: exitRow ? hm(exitRow.time + 60) : null, worstAsk: asks.length ? Math.max(...asks) : null,
      invalidatedAt: inv ? hm(inv.time + 60) : null, exitAskInvalidation: exitAskInv,
      touched1500: reach(EXIT_MIN), touched1529: reach(15 * 60 + 30),
      pnlHold: pnl(entryBid, exitAsk), pnlWithInvalidation: pnl(entryBid, exitAskInv),
      charges: entryBid != null && exitAsk != null && lot != null ? Math.round(optCharges('SELL', lot, entryBid, date) + optCharges('BUY', lot, exitAsk, date)) : null,
      notes,
    });
  }
  d.settled = { at: new Date().toISOString(), close1530, setups, runs, outsideWindow: outside };
  await writeDay(d);
  return d;
}

export async function logDays(): Promise<string[]> {
  return (await readdir(DIR).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
}

/** Settles every past day that has runs but no settlement (on startup and after the close). */
export async function settlePending(today: string) {
  for (const date of await logDays()) {
    if (date > today) continue;
    const d = await readDay(date);
    if (d && d.entries.length && !d.settled) await settleDay(date);
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Predicted odds against what happened, in buckets, so the engine's numbers can be checked. */
function buckets(pairs: { p: number; hit: boolean }[], edges: number[]) {
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1], xs = pairs.filter((x) => x.p >= lo && x.p < hi);
    return { range: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: xs.length, predicted: mean(xs.map((x) => x.p)), actual: xs.length ? xs.filter((x) => x.hit).length / xs.length : null };
  });
}

/** Everything settled so far: totals, per day, every setup, and predicted-vs-actual checks. */
export async function calibrationSummary() {
  const days: DayLog[] = [];
  for (const date of await logDays()) { const d = await readDay(date); if (d) days.push(d); }
  const settled = days.filter((d) => d.settled);
  const setups = settled.flatMap((d) => d.settled!.setups.map((s) => ({ date: d.date, ...s })));
  const priced = setups.filter((s) => s.pnlHold != null);
  const runs = settled.flatMap((d) => d.settled!.runs.map((r, i) => ({ ...r, entry: d.entries[i] })));
  const dir = runs.filter((r) => r.directionHeld != null);
  const e4 = runs.filter((r) => r.e4Held != null && r.entry?.e4 != null).map((r) => ({ p: r.entry!.e4!, hit: r.e4Held! }));
  const breach = setups.filter((s) => s.breachOdds != null).map((s) => ({ p: s.breachOdds!, hit: s.touched1529 }));
  return {
    days: days.map((d) => ({
      date: d.date, runs: d.entries.length, live: d.entries.filter((e) => e.source === 'live').length, settled: !!d.settled, close1530: d.settled?.close1530 ?? null,
      setups: d.settled?.setups.length ?? 0, none: d.entries.filter((e) => !e.setup).length,
      pnlHold: d.settled ? d.settled.setups.reduce((a, s) => a + (s.pnlHold ?? 0), 0) : null,
    })),
    totals: {
      days: settled.length, runs: runs.length, setups: setups.length, priced: priced.length,
      won: priced.filter((s) => s.pnlHold! > 0).length,
      pnlHold: priced.reduce((a, s) => a + s.pnlHold!, 0),
      pnlWithInvalidation: priced.reduce((a, s) => a + (s.pnlWithInvalidation ?? s.pnlHold!), 0),
      worst: priced.length ? Math.min(...priced.map((s) => s.pnlHold!)) : null,
      strikeReached: setups.filter((s) => s.touched1500).length,
      directionIssued: dir.length, directionHeld: dir.filter((r) => r.directionHeld).length,
    },
    breach: buckets(breach, [0, 0.1, 0.2, 0.3, 1.01]),
    e4: buckets(e4, [0, 0.2, 0.4, 0.6, 0.8, 1.01]),
    setups,
    note: 'Paper fills: sold at the bid, bought back at the ask, NSE charges included; a real order can fill worse. A handful of days proves nothing: read the counts first.',
  };
}

export async function dayDetail(date: string) { return readDay(date); }
