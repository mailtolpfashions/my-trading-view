// Time helpers, 15-minute candles and the ten directional checks of the intraday seller engine (spec steps 0, 3, 4).
// The evidence study (apps/feed/scripts/research/seller-v14-evidence.ts) calls these same functions, so what is
// measured is exactly what the engine scores.
import type { CheckId, CheckResult, Evidence, Minute, Side, Snapshot } from './types';

export const OPEN = 9 * 60 + 15, CLOSE = 15 * 60 + 30;
/** IST minute of the day of an epoch-seconds time. */
export const istMinute = (t: number) => Math.floor((((t + 19800) % 86400) + 86400) % 86400 / 60);
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const sign = (x: number): Side => (x > 0 ? 1 : x < 0 ? -1 : 0);

export function phaseOf(m: number): string {
  return m < 10 * 60 + 30 ? 'Opening' : m < 12 * 60 ? 'Mid-morning' : m < 13 * 60 + 30 ? 'Lunch' : m < 14 * 60 + 45 ? 'Afternoon' : 'Close';
}

/** Minutes completed before `now` (a minute counts once it has ended). */
export function completed(bars: Minute[], now: number): Minute[] {
  return bars.filter((b) => b.time + 60 <= now).sort((a, b) => a.time - b.time);
}

/** Completed 15-minute candles of the session (09:15, 09:30, …), each with at least one minute inside. */
export function candles15(bars: Minute[], nowMin: number) {
  const out: { start: number; open: number; high: number; low: number; close: number }[] = [];
  for (let s = OPEN; s + 15 <= Math.min(nowMin, CLOSE); s += 15) {
    const inC = bars.filter((b) => { const m = istMinute(b.time); return m >= s && m < s + 15; });
    if (inC.length) out.push({ start: s, open: inC[0].open, high: Math.max(...inC.map((b) => b.high)), low: Math.min(...inC.map((b) => b.low)), close: inC.at(-1)!.close });
  }
  return out;
}

/** RSI(14), Wilder, over a close series; null until 15 closes exist. */
export function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const ch = closes[i] - closes[i - 1]; g += Math.max(ch, 0) / 14; l += Math.max(-ch, 0) / 14; }
  for (let i = 15; i < closes.length; i++) { const ch = closes[i] - closes[i - 1]; g = (g * 13 + Math.max(ch, 0)) / 14; l = (l * 13 + Math.max(-ch, 0)) / 14; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

export function vwapOf(bars: Minute[]): number | null {
  let pv = 0, v = 0;
  for (const b of bars) { pv += ((b.high + b.low + b.close) / 3) * b.volume; v += b.volume; }
  return v > 0 ? pv / v : null;
}

/** Opening range 09:15–09:30, once its three... fifteen minutes are complete. */
export function openingRange(bars: Minute[], nowMin: number) {
  if (nowMin < OPEN + 15) return null;
  const orb = bars.filter((b) => istMinute(b.time) < OPEN + 15);
  return orb.length ? { high: Math.max(...orb.map((b) => b.high)), low: Math.min(...orb.map((b) => b.low)) } : null;
}

export const CHECK_LABELS: Record<CheckId, string> = {
  refClose: 'Price vs reference close', vwap: 'Price vs VWAP proxy (time-weighted average stand-in)', structure: '15-min structure',
  rsi: '15-min RSI(14)', opening: 'Opening behaviour (vs opening range)', heavyGreen: 'Heavyweights green', heavyVwap: 'Heavyweights vs own VWAP',
  oiShift: 'Intraday OI shift', bank: 'Bank Nifty agreement', drift: 'Last 30-min drift',
};
/** Price-derived checks that describe the same short-term move (spec step 4A). */
export const PRICE_CHECKS: CheckId[] = ['refClose', 'vwap', 'structure', 'opening', 'drift'];
export const GROUPS: Record<'PRICE' | 'PARTICIPATION' | 'OPTIONS', CheckId[]> = { PRICE: ['vwap', 'structure', 'drift'], PARTICIPATION: ['heavyGreen', 'heavyVwap', 'bank'], OPTIONS: ['oiShift'] };

/**
 * The ten checks' sides at the snapshot time (null = no data). Definitions the spec leaves open are fixed here and
 * labelled JUDGMENT in the engine's audit: RSI side of 50 with >70/<30 scoring zero (spec rule 10); structure = the last
 * two completed 15-min candles making higher high + higher low (or lower + lower); heavyweights count when ≥4 or ≤1 of 5
 * agree; OI shift = put-minus-call OI change since the open above ±2% of the open's total OI.
 */
export function directionalSides(s: Snapshot): Record<CheckId, { side: Side | null; detail: string }> {
  const now = s.now, nowMin = istMinute(now);
  const bars = completed(s.nifty, now);
  const out = {} as Record<CheckId, { side: Side | null; detail: string }>;
  const spot = bars.at(-1)?.close ?? null;
  const set = (id: CheckId, side: Side | null, detail: string) => { out[id] = { side, detail }; };
  if (spot == null) { for (const id of Object.keys(CHECK_LABELS) as CheckId[]) set(id, null, 'no NIFTY minutes'); return out; }

  set('refClose', s.refClose == null ? null : sign(spot - s.refClose), s.refClose == null ? 'reference close unknown' : `spot ${spot.toFixed(2)} vs ${s.refClose.toFixed(2)}`);
  const twap = bars.reduce((a, b) => a + b.close, 0) / bars.length;
  set('vwap', sign(spot - twap), `spot vs time-weighted average ${twap.toFixed(2)} (NIFTY has no volume; VWAP stand-in)`);
  const c15 = candles15(bars, nowMin);
  const [a, b] = c15.slice(-2);
  set('structure', a && b ? (b.high > a.high && b.low > a.low ? 1 : b.high < a.high && b.low < a.low ? -1 : 0) : null, a && b ? `last two 15-min candles: highs ${a.high.toFixed(0)}→${b.high.toFixed(0)}, lows ${a.low.toFixed(0)}→${b.low.toFixed(0)}` : 'fewer than two 15-min candles');
  const r = rsi14([...s.prev15Closes, ...c15.map((c) => c.close)]);
  set('rsi', r == null ? null : r > 70 || r < 30 ? 0 : sign(r - 50), r == null ? 'not enough 15-min closes' : `RSI ${r.toFixed(1)}${r > 70 || r < 30 ? ' (extreme → scores zero)' : ''}`);
  const orb = openingRange(bars, nowMin);
  set('opening', orb ? (spot > orb.high ? 1 : spot < orb.low ? -1 : 0) : null, orb ? `opening range ${orb.low.toFixed(0)}–${orb.high.toFixed(0)}` : 'opening range not complete');
  let green = 0, aboveV = 0, seen = 0;
  for (const h of s.heavy) {
    const hb = completed(h.minutes, now);
    if (!hb.length || h.refClose == null) continue;
    seen++;
    if (hb.at(-1)!.close > h.refClose) green++;
    const vw = vwapOf(hb);
    if (vw != null && hb.at(-1)!.close > vw) aboveV++;
  }
  const full = seen === 5 && s.heavy.length === 5;
  set('heavyGreen', full ? (green >= 4 ? 1 : green <= 1 ? -1 : 0) : null, full ? `${green} of 5 above their reference close` : `heavyweight data for ${seen} of 5`);
  set('heavyVwap', full ? (aboveV >= 4 ? 1 : aboveV <= 1 ? -1 : 0) : null, full ? `${aboveV} of 5 above their own VWAP` : `heavyweight data for ${seen} of 5`);
  const bb = s.bank ? completed(s.bank.minutes, now) : [];
  set('bank', bb.length && s.bank?.refClose != null ? sign(bb.at(-1)!.close - s.bank.refClose) : null, bb.length && s.bank?.refClose != null ? `Bank Nifty ${bb.at(-1)!.close.toFixed(0)} vs ${s.bank.refClose.toFixed(0)}` : 'Bank Nifty data missing');
  const ago = bars.filter((x) => istMinute(x.time) < nowMin - 30).at(-1);
  set('drift', ago ? sign(spot - ago.close) : null, ago ? `${(spot - ago.close).toFixed(1)} pts in 30 min` : 'less than 30 minutes of data');
  // Intraday OI shift from the chain (not measurable in the evidence yet)
  const rows = s.chain?.rows.filter((x) => x.oi != null && x.oiOpen != null) ?? [];
  if (rows.length) {
    const d = (right: 'CE' | 'PE') => rows.filter((x) => x.right === right).reduce((acc, x) => acc + (x.oi! - x.oiOpen!), 0);
    const base = rows.reduce((acc, x) => acc + x.oiOpen!, 0);
    const shift = base ? (d('PE') - d('CE')) / base : 0;
    set('oiShift', Math.abs(shift) > 0.02 ? sign(shift) : 0, `put OI change − call OI change since the open = ${(shift * 100).toFixed(1)}% of opening OI`);
  } else set('oiShift', null, 'no intraday option OI');
  return out;
}

/** 95% band around a coin flip for n observations. */
export const chanceBand = (n: number) => (n > 0 ? 1.96 * Math.sqrt(0.25 / n) : Infinity);

/** The evidence row in force at `nowMin`: the latest measured decision time not after it, or null before the first. */
export function evidenceTime(ev: Evidence, nowMin: number): string | null {
  const t = ev.times.filter((x) => x <= nowMin).at(-1);
  return t == null ? null : hhmm(t);
}

/**
 * Weight of a check (spec step 4 + the user's extra rule): ≥55% AND beyond the 95% coin-flip band, then ≥60% over
 * 200+ sessions → 1, else 0.5; otherwise 0. Never measured → 0.5 with hit rate UNKNOWN.
 */
export function checkWeight(ev: Evidence, id: CheckId, time: string | null): { weight: number; basis: string } {
  const row = time ? ev.checks[id]?.[time] : undefined;
  if (!ev.checks[id] || !row) return { weight: 0.5, basis: 'hit rate UNKNOWN (not measured) → ±0.5' };
  if (row.hit == null || row.n === 0) return { weight: 0, basis: 'no measured sessions → 0' };
  const h = (row.hit * 100).toFixed(1), beats = Math.abs(row.hit - 0.5) > chanceBand(row.n);
  if (row.hit >= 0.55 && beats) return row.hit >= 0.6 && row.n >= 200 ? { weight: 1, basis: `${h}% over ${row.n} sessions → 1` } : { weight: 0.5, basis: `${h}% over ${row.n} sessions → 0.5` };
  return { weight: 0, basis: `${h}% over ${row.n} sessions${row.hit >= 0.55 ? ', inside the coin-flip band' : ''} → 0` };
}

export function scoreChecks(s: Snapshot, ev: Evidence): CheckResult[] {
  const sides = directionalSides(s), time = evidenceTime(ev, istMinute(s.now));
  return (Object.keys(CHECK_LABELS) as CheckId[]).map((id) => {
    const w = checkWeight(ev, id, time);
    return { id, label: CHECK_LABELS[id], side: sides[id].side, weight: w.weight, weightBasis: w.basis, detail: sides[id].detail };
  });
}
