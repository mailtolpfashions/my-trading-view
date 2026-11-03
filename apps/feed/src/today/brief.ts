// The "Today" brief: the facts a trader checks before and during the session, all derived from data we hold (NSE
// end-of-day files, F&O files, and the owner's live Kite minutes). No forecasts: every line is a level, a measured
// change or a comparison with the past, stated plainly ([[feedback-research-method]]: no prediction until the owner
// has seen the evidence tables and agreed).

import { pivotLevelValues } from '@mtv/indicators';
import { Evaluator, parseFormula, type Tf } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { dailyHistory, indexCloses } from '../eod/store';
import { derivedOn, fnoCalendar, ivGrid, latestFnoDay } from '../fno/analytics';
import { indexMembers } from '../research/overview';
import { userStore } from '../user/store';
import { live } from '../intraday/instance';
import { dateOfIst } from '../intraday/store';
import { RRG_SECTORS } from '../market/service';

const IST = 5.5 * 3600;
const LEVEL_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);

function evalLast(c: Candle[], formula: string): number | null {
  const p = parseFormula(formula);
  if (!p.ok) return null;
  const s = new Evaluator((tf: Tf) => (tf === 'D' ? c : null)).series(p.node, 'D');
  return s[s.length - 1] ?? null;
}

/** Key levels from the last completed session, and where price sits against its trend. */
function levelsOf(symbol: string) {
  const c = dailyHistory(symbol)?.candles;
  if (!c || c.length < 30) return null;
  const last = c[c.length - 1];
  const [P, R1, S1, R2, S2, R3, S3] = pivotLevelValues('CLASSIC', last.high, last.low, last.close, last.open, last.open) as number[];
  const bc = (last.high + last.low) / 2, tc = 2 * P - bc;
  const cprWidth = (Math.abs(tc - bc) / P) * 100;
  // How today's CPR width compares with the last 20 sessions' (a narrow CPR is just a fact here, not a call).
  const widths = c.slice(-21, -1).map((b) => { const p = (b.high + b.low + b.close) / 3, m = (b.high + b.low) / 2; return (Math.abs(2 * p - 2 * m) / p) * 100; });
  const cprRank = widths.filter((w) => w < cprWidth).length; // 0 = narrowest of the 21
  const hi = (n: number) => Math.max(...c.slice(-n).map((b) => b.high)), lo = (n: number) => Math.min(...c.slice(-n).map((b) => b.low));
  const close = last.close;
  const ema = (n: number) => evalLast(c, `EMA(CLOSE, ${n})`);
  return {
    symbol, session: dateOfIst(last.time), open: last.open, high: last.high, low: last.low, close,
    changePct: c.length > 1 ? pct(close, c[c.length - 2].close) : null,
    pivots: { P: r2(P), R1: r2(R1), R2: r2(R2), R3: r2(R3), S1: r2(S1), S2: r2(S2), S3: r2(S3) },
    cpr: { top: r2(Math.max(tc, bc)), bottom: r2(Math.min(tc, bc)), widthPct: r2(cprWidth), narrowerThan: 20 - cprRank, of: 20 },
    ranges: { week: { high: hi(5), low: lo(5) }, month: { high: hi(21), low: lo(21) }, year: { high: hi(252), low: lo(252) } },
    trend: { ema20: ema(20), ema50: ema(50), ema200: ema(200), rsi14: evalLast(c, 'RSI(CLOSE, 14)'), supertrendUp: evalLast(c, 'SUPERTREND_DIR(10, 3)') === 1 },
  };
}

/** Where India VIX stands against its own last year. */
function vix() {
  const c = dailyHistory('INDIAVIX')?.candles;
  if (!c || c.length < 30) return null;
  const last = c[c.length - 1].close, year = c.slice(-252).map((b) => b.close);
  return { close: last, changePct: pct(last, c[c.length - 2].close), percentile: Math.round((year.filter((v) => v < last).length / year.length) * 100), yearLow: Math.min(...year), yearHigh: Math.max(...year) };
}

function sectors() {
  return RRG_SECTORS.map((name) => {
    const s = indexCloses(name);
    if (s.length < 22) return null;
    const last = s[s.length - 1].close, ago = (n: number) => s[s.length - 1 - n].close;
    return { name, close: last, d1: pct(last, ago(1)), w1: pct(last, ago(5)), m1: pct(last, ago(21)) };
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.d1 - a.d1);
}

async function expiries(today: string) {
  const out: { underlying: string; expiry: string; calendarDays: number }[] = [];
  for (const u of ['NIFTY', 'BANKNIFTY']) {
    const cal = await fnoCalendar(u).catch(() => null);
    for (const e of (cal?.expiries ?? []).filter((x) => x >= today).slice(0, 2)) out.push({ underlying: u, expiry: e, calendarDays: Math.round((Date.parse(e) - Date.parse(today)) / 86400_000) });
  }
  return out;
}

/** This session so far from live minutes: the gap, the 15-minute opening range, and where price is against levels. */
async function session(symbol: string, lv: NonNullable<ReturnType<typeof levelsOf>>, today: string) {
  if (lv.session >= today) return null; // the end-of-day file for today is already in: nothing live to add
  const m = (await live.bars(symbol, '1m', true)).filter((b) => dateOfIst(b.time) === today);
  if (!m.length) return null;
  const or = m.slice(0, 15);
  const now = m[m.length - 1].close;
  const orHigh = Math.max(...or.map((b) => b.high)), orLow = Math.min(...or.map((b) => b.low));
  const facts: string[] = [];
  const gap = pct(m[0].open, lv.close);
  facts.push(Math.abs(gap) < 0.1 ? 'Opened flat to the previous close' : `Opened ${gap > 0 ? 'up' : 'down'} ${Math.abs(gap).toFixed(2)}% from the previous close`);
  facts.push(now > lv.high ? 'Trading above the previous day\'s high' : now < lv.low ? 'Trading below the previous day\'s low' : 'Trading inside the previous day\'s range');
  facts.push(now > lv.cpr.top ? 'Above the CPR' : now < lv.cpr.bottom ? 'Below the CPR' : 'Inside the CPR');
  if (or.length === 15) facts.push(now > orHigh ? 'Above the 15-minute opening range' : now < orLow ? 'Below the 15-minute opening range' : 'Inside the 15-minute opening range');
  return {
    ltp: now, changePct: pct(now, lv.close), open: m[0].open, gapPct: gap, high: Math.max(...m.map((b) => b.high)), low: Math.min(...m.map((b) => b.low)),
    openingRange: or.length === 15 ? { high: orHigh, low: orLow } : null, lastBar: m[m.length - 1].time, facts,
  };
}

/** NIFTY and BANKNIFTY options, nearest expiry, from NSE's F&O close: PCR, max pain, ATM IV, straddle and OI walls. */
async function options() {
  const date = await latestFnoDay();
  if (!date) return null;
  const grid = await ivGrid(date).catch(() => []);
  const out = [];
  for (const u of ['NIFTY', 'BANKNIFTY']) {
    const d = (await derivedOn(u, date)).find((x) => x.daysToExpiry >= 0);
    if (!d) continue;
    const iv = grid.find((g) => g.symbol === u);
    const spot = d.spotPaise != null ? d.spotPaise / 100 : null, straddle = d.straddlePaise != null ? d.straddlePaise / 100 : null;
    out.push({
      underlying: u, date, expiry: d.expiry, daysToExpiry: d.daysToExpiry, spot,
      pcr: d.ceOi ? d.peOi / d.ceOi : null,
      maxPain: d.maxPainPaise != null ? d.maxPainPaise / 100 : null,
      atmIv: d.atmIv, ivRank: iv?.ivRank ?? null, ivPercentile: iv?.ivPercentile ?? null,
      straddle, impliedMovePct: straddle != null && spot ? (straddle / spot) * 100 : null,
      callWall: d.callWallPaise != null ? d.callWallPaise / 100 : null, putWall: d.putWallPaise != null ? d.putWallPaise / 100 : null,
    });
  }
  return out;
}

/**
 * Stocks trading far more than usual. During the session (live minutes): volume so far today against the same time on
 * the previous 20 sessions (RVOL_CUM on 15-minute bars). Otherwise: the last session's volume against its 20-day average.
 */
let spikeCache: { key: string; at: number; rows: Spike[] } | null = null;
type Spike = { symbol: string; rvol: number; changePct: number; close: number; basis: 'today so far' | 'last session' };
async function volumeSpikes(today: string, liveOn: boolean): Promise<Spike[]> {
  const key = `${today}|${liveOn}`;
  if (spikeCache?.key === key && Date.now() - spikeCache.at < (liveOn ? 120_000 : 3600_000)) return spikeCache.rows;
  const members = (await indexMembers('NIFTY 500').catch(() => ({ symbols: [] as string[] }))).symbols;
  const rows: Spike[] = [];
  const liveRvol = parseFormula('RVOL_CUM(20)'), eodRvol = parseFormula('RVOL(20)');
  for (let k = 0; k < members.length; k++) {
    if (k % 50 === 0) await new Promise((r) => setImmediate(r));
    const sym = members[k];
    const daily = dailyHistory(sym)?.candles;
    if (!daily || daily.length < 25) continue;
    const prevClose = daily[daily.length - 1].close;
    if (liveOn && live.has(sym) && liveRvol.ok) {
      const bars = await live.bars(sym, '15m', true);
      const t = bars.filter((b) => dateOfIst(b.time) === today);
      if (!t.length) continue;
      const v = new Evaluator((tf: Tf) => (tf === '15m' ? bars : null)).series(liveRvol.node, '15m').at(-1);
      const close = t[t.length - 1].close;
      if (v != null && v >= 2) rows.push({ symbol: sym, rvol: v, changePct: pct(close, prevClose), close, basis: 'today so far' });
    } else if (!liveOn && eodRvol.ok) {
      const v = new Evaluator((tf: Tf) => (tf === 'D' ? daily : null)).series(eodRvol.node, 'D').at(-1);
      if (v != null && v >= 2.5) rows.push({ symbol: sym, rvol: v, changePct: pct(prevClose, daily[daily.length - 2].close), close: prevClose, basis: 'last session' });
    }
  }
  rows.sort((a, b) => b.rvol - a.rvol);
  spikeCache = { key, at: Date.now(), rows: rows.slice(0, 12) };
  return spikeCache.rows;
}

/** Open, closed, or how long until the session starts or ends (weekdays 09:15–15:30 IST; exchange holidays not known). */
function marketStatus(now: number) {
  const local = (now + IST) % 86400, dow = new Date((now + IST) * 1000).getUTCDay();
  const open = 9 * 3600 + 15 * 60, close = 15 * 3600 + 30 * 60;
  if (dow === 0 || dow === 6) return { state: 'closed' as const, minutes: null, text: 'Weekend: the market is closed' };
  if (local < open) return { state: 'pre' as const, minutes: Math.ceil((open - local) / 60), text: `The market opens in ${Math.ceil((open - local) / 60)} minutes` };
  if (local < close) return { state: 'open' as const, minutes: Math.ceil((close - local) / 60), text: `The market is open, closing in ${Math.floor((close - local) / 3600)}h ${Math.ceil(((close - local) % 3600) / 60)}m` };
  return { state: 'closed' as const, minutes: null, text: 'The market has closed for the day' };
}

/** What needs the owner today: alerts that fired since midnight. */
async function needsYou(today: string) {
  const events = (await userStore.alertEvents()).filter((e) => e.hits.length && e.at.slice(0, 10) >= today.slice(0, 10));
  return { alertsToday: events.length, latest: events.slice(0, 3).map((e) => ({ name: e.alertName, symbols: e.hits.slice(0, 5).map((h) => h.symbol), at: e.at })) };
}

export async function todayBrief(now = Math.floor(Date.now() / 1000)) {
  const today = new Date((now + IST) * 1000).toISOString().slice(0, 10);
  const indices = [];
  for (const s of LEVEL_INDICES) {
    const lv = levelsOf(s);
    if (lv) indices.push({ ...lv, live: await session(s, lv, today).catch(() => null) });
  }
  const liveOn = live.status.state === 'live';
  const hour = ((now + IST) % 86400) / 3600;
  return {
    today, live: liveOn, greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening', name: live.status.userName,
    market: marketStatus(now), indices, vix: vix(), sectors: sectors(), expiries: await expiries(today),
    options: await options().catch(() => null), volumeSpikes: await volumeSpikes(today, liveOn).catch(() => []), needsYou: await needsYou(today),
  };
}
