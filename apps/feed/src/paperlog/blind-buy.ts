// Paper log of the "blind buy" scan, run the owner's way: once at 9:30 on the daily candle as it stood then, every
// pick "bought" at the 9:30 price and "closed" at 3:00 pm. Paper only: nothing is ordered.
//   scan:   Daily Close crosses above the Ichimoku cloud top (9,26,52) AND Daily Supertrend(7,3) crosses below the
//           Close (Chartink's "blind buy" scan), on the stocks we hold minute data for (NIFTY 500 + F&O).
//   live:   the list is worked out at 9:30 (a timer in server.ts) and saved; a saved list never changes, so the
//           forward record is honest. The 3:00 result is filled from our minute bars.
//   replay: earlier days (before the log started) are worked out from the same data afterwards and marked so.
// Research behind it: scripts/research/scan-at-930.ts (a year of 9:30 runs: 126 picks, 52% in profit, +0.26% a trade).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Evaluator, parseFormula } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, rawDays } from '../eod/store';
import { MinuteStore, dateOfIst } from '../intraday/store';

export const BLIND_BUY = 'CROSSOVER(CLOSE, MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))) AND CROSSUNDER(SUPERTREND(7, 3), CLOSE)';
/** The owner's window, minutes after midnight IST: picks at 9:30, every trade closed at 3:00 pm. */
const START = 570, EXIT = 900;
const DIR = path.resolve(import.meta.dirname, '../../.data/paperlog/blind-buy');
const INDEXES = /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYBEES|NIFTY-FUT)$/;
const node = (() => { const p = parseFormula(BLIND_BUY); if (!p.ok) throw new Error(p.error); return p.node; })();
const store = new MinuteStore();
const istMin = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayStart = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) - 19800;

type Saved = { date: string; kind: 'live' | 'replay'; savedAt: string; picks: { symbol: string; p930: number }[] };
export type PaperPick = {
  symbol: string; p930: number;
  /** Price at 3:00 pm (the 14:59 minute's close); null until then. */
  p300: number | null;
  /** The latest price held for that day, and its minute (IST), for a day still running. */
  last: number | null; lastAt: string | null;
  /** Best and worst move from the 9:30 price, 9:30 to 3:00 (or so far). */
  best: number | null; worst: number | null;
};
export type PaperDay = { date: string; kind: 'live' | 'replay'; savedAt: string; picks: PaperPick[] };

/** One day's minutes of a stock, 9:15 to 15:29. */
async function minutesOn(symbol: string, date: string): Promise<Candle[]> {
  const t0 = dayStart(date);
  return (await store.read(symbol, t0)).filter((b) => b.time >= t0 && dateOfIst(b.time) === date && istMin(b.time) >= 555 && istMin(b.time) <= 929);
}

/** The scan at 9:30 on `date`: every stock whose daily candle, as it stood at 9:30, matches. */
export async function scanAt930(date: string): Promise<{ symbol: string; p930: number }[]> {
  const symbols = (await readdir(store.dir).catch(() => [] as string[])).filter((s) => !INDEXES.test(s));
  const picks: { symbol: string; p930: number }[] = [];
  for (const s of symbols) {
    const hist = dailyHistory(s)?.candles;
    if (!hist || hist.length < 120) continue;
    const today = await minutesOn(s, date);
    if (!today.length || istMin(today[0].time) !== 555) continue;
    const upto = today.filter((b) => istMin(b.time) < START);
    const at930 = today.find((b) => istMin(b.time) === START);
    if (upto.length < 10 || !at930) continue;
    // Daily history is split/bonus adjusted to today's basis, minutes are as traded: put the 9:30 candle on the
    // history's basis (that day's adjusted / traded close; the day before's when today's close is not in yet).
    const dates = hist.map((c) => dateOfIst(c.time));
    let n = dates.findIndex((d) => d >= date);
    if (n < 0) n = hist.length;
    const raw = rawDays(s);
    const basisDay = dates[n] === date ? n : n - 1;
    const r = raw.get(dates[basisDay]);
    if (!r?.close || basisDay < 0) continue;
    const k = hist[basisDay].close / r.close;
    const partial: Candle = {
      time: today[0].time, open: upto[0].open * k, high: Math.max(...upto.map((b) => b.high)) * k, low: Math.min(...upto.map((b) => b.low)) * k,
      close: upto.at(-1)!.close * k, volume: upto.reduce((a, b) => a + b.volume, 0) / k,
    };
    const c = [...hist.slice(Math.max(0, n - 300), n), partial];
    if (new Evaluator(() => c).series(node, 'D')[c.length - 1] === 1) picks.push({ symbol: s, p930: at930.open });
  }
  return picks;
}

/** How a pick did from 9:30 to 3:00 (or so far today). */
async function statusOf(symbol: string, date: string, p930: number): Promise<PaperPick> {
  const w = (await minutesOn(symbol, date)).filter((b) => { const m = istMin(b.time); return m >= START && m < EXIT; });
  if (!w.length) return { symbol, p930, p300: null, last: null, lastAt: null, best: null, worst: null };
  const lastBar = w.at(-1)!, m = istMin(lastBar.time);
  return {
    symbol, p930,
    p300: m === EXIT - 1 ? lastBar.close : null,
    last: lastBar.close, lastAt: `${String(Math.floor((m + 1) / 60)).padStart(2, '0')}:${String((m + 1) % 60).padStart(2, '0')}`,
    best: Math.max(...w.map((b) => b.high)) - p930, worst: p930 - Math.min(...w.map((b) => b.low)),
  };
}

const fileOf = (date: string) => path.join(DIR, `${date}.json`);
const readSaved = (date: string) => readFile(fileOf(date), 'utf8').then((t) => JSON.parse(t) as Saved, () => null);
async function save(s: Saved) { await mkdir(DIR, { recursive: true }); await writeFile(fileOf(s.date), JSON.stringify(s, null, 1)); }
const todayIst = () => dateOfIst(Math.floor(Date.now() / 1000));
const nowMin = () => istMin(Math.floor(Date.now() / 1000));

/**
 * Called every minute by the server: once it is past 9:30 on a trading day (our NIFTY minutes for today reach 9:30),
 * work out and save today's list, marked live. Does nothing on later calls, holidays, or after 3 pm.
 */
let running = false;
export async function takeTodayIfDue(): Promise<void> {
  const date = todayIst(), m = nowMin();
  if (running || m < START + 1 || m >= EXIT || (await readSaved(date))) return;
  const nifty = await minutesOn('NIFTY', date);
  if (!nifty.some((b) => istMin(b.time) === START)) return; // market closed today, or Kite not connected yet
  running = true;
  try { await save({ date, kind: 'live', savedAt: new Date().toISOString(), picks: await scanAt930(date) }); }
  finally { running = false; }
}

/** Trading days we hold minutes for (from NIFTY's minutes), newest last. */
async function minuteDays(): Promise<string[]> {
  const bars = await store.read('NIFTY', 0);
  const seen = new Set<string>();
  for (const b of bars) if (istMin(b.time) === EXIT - 1) seen.add(dateOfIst(b.time));
  return [...seen].sort();
}

/** Earlier days without a saved list are worked out in the background (one at a time) and marked replay. */
let filling: Promise<void> | null = null;
let fillProgress = { done: 0, total: 0 };
function fillReplays(days: string[]) {
  // Heavy (every stock, every day): never while the market is open, so the live feed keeps its speed.
  const m = nowMin();
  if (filling || (m >= 540 && m <= 940 && new Date().getUTCDay() % 6 !== 0)) return;
  filling = (async () => {
    const missing: string[] = [];
    for (const d of days) if (d < todayIst() && !(await readSaved(d))) missing.push(d);
    fillProgress = { done: 0, total: missing.length };
    for (const d of missing.reverse()) { // newest first, so the recent weeks appear soonest
      await save({ date: d, kind: 'replay', savedAt: new Date().toISOString(), picks: await scanAt930(d) });
      fillProgress.done++;
    }
  })().finally(() => { filling = null; });
}

/** The log: every saved day with each pick's result, newest first, and how many replay days are still being worked out. */
export async function paperLog(): Promise<{ formula: string; days: PaperDay[]; filling: { done: number; total: number } | null }> {
  const days = await minuteDays();
  fillReplays(days);
  const saved = (await Promise.all((await readdir(DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => readSaved(f.slice(0, 10)))))
    .filter((s): s is Saved => !!s).sort((a, b) => b.date.localeCompare(a.date));
  const out: PaperDay[] = [];
  for (const s of saved) out.push({ date: s.date, kind: s.kind, savedAt: s.savedAt, picks: await Promise.all(s.picks.map((p) => statusOf(p.symbol, s.date, p.p930))) });
  return { formula: BLIND_BUY, days: out, filling: filling ? { ...fillProgress } : null };
}
