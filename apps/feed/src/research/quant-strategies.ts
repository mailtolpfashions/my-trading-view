// Every strategy the quant research tested, in plain words, for the "All strategies" list: one row per strategy with a
// sentence describing it, the result in everyday numbers and a Worked / Mixed / Didn't work label with its reasons.
// Built from the saved research files (nothing is re-run); options at 1 lot, stocks with all of ₹10 lakh invested.
// The development years only, plus the one-time final check (2024–26) where a strategy was part of it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { curveMetrics, equityFromTrades, type CurvePoint } from '@mtv/backtest';
import { indexCloses } from '../eod/store';
import { quantExperiments } from './quant';

const QUANT_DIR = path.resolve(import.meta.dirname, '../../.data/research/quant');
const CAPITAL = 1_000_000;
type T = { entry: string; exit: string; expiry?: string; net: number; worstMtm?: number; reason?: string; spotIn?: number; spotOut?: number; daily?: { date: string; mtm: number }[] };

export type Group = 'monthly' | 'weekly-nifty' | 'weekly-bank' | 'stocks-breakout' | 'stocks-momentum';
export type Verdict = 'worked' | 'mixed' | 'failed';
export type Strategy = {
  key: string; group: Group; title: string; plain: string;
  when: 'expensive' | 'always' | null; distance: 'at' | 'near' | 'medium' | 'far' | null;
  unit: 'option' | 'stock';
  period: { from: string; to: string };
  trades: number; wonPct: number | null;
  /** Options: ₹ a year for 1 lot. Stocks: null. */
  perYearRs: number | null;
  /** Options: perYearRs as % of ₹10 lakh. Stocks: compound growth a year on ₹10 lakh. */
  perYearPct: number;
  worstTradeRs: number | null; worstOpenRs: number | null;
  maxDdPct: number; maxDdRs: number;
  goodYears: number; years: number;
  byYear: { year: string; value: number }[];
  halves: { label: string; value: number }[];
  /** The one-time check on 2024 to Nov 2026, where this strategy was part of it. */
  final: { perYearRs: number | null; perYearPct: number | null; trades: number; won: number } | null;
  nifty: { perYearPct: number; maxDdPct: number } | null;
  verdict: Verdict; reasons: string[];
};
export type StrategyDetail = Strategy & {
  curve: [string, number][]; niftyCurve: [string, number][];
  tradeList: { opened: string; closed: string; expiry: string | null; indexIn: number | null; indexOut: number | null; result: number; worstAlong: number | null; how: string }[];
  finalTrades: StrategyDetail['tradeList'];
};

const MONTHLY_DIST: Record<string, [string, Strategy['distance']]> = {
  s10: ['far from the index (about 6–7% away)', 'far'], s16: ['about 5% away', 'medium'], s20: ['about 4% away', 'medium'],
  s25: ['about 3–4% away', 'near'], s30: ['about 2–3% away', 'near'], straddle: ['at today’s price', 'at'],
};
const WEEKLY_DIST: Record<string, [string, Strategy['distance']]> = {
  s10: ['about 2% away', 'far'], s16: ['about 1.5% away', 'medium'], s25: ['about 1% away', 'near'], straddle: ['at today’s price', 'at'],
};
// A3b's window labels. For a Thursday expiry "3 days before" was also a Monday, so the Tue→ rows repeat the Monday ones
// (dropped here); the row labelled Wed→exp entered on Tuesday.
const WINDOWS: Record<string, string | null> = {
  'Fri→exp': 'Enter Friday at the close, hold to expiry', 'Fri→Wed': 'Enter Friday at the close, exit the day before expiry',
  'Fri→Tue': 'Enter Friday at the close, exit Tuesday at the close (over the weekend only)',
  'Mon→exp': 'Enter Monday at the close, hold to expiry', 'Mon→Wed': 'Enter Monday at the close, exit the day before expiry',
  'Mon→Tue': 'Enter Monday at the close, exit Tuesday at the close (one night)',
  'Wed→exp': 'Enter Tuesday at the close, hold to expiry', 'Tue→exp': null, 'Tue→Wed': null,
};
const MONTHLY_SHORT: Record<string, string> = { s10: '6–7% away', s16: '5% away', s20: '4% away', s25: '3–4% away', s30: '2–3% away', straddle: 'at the price' };
const WEEKLY_SHORT: Record<string, string> = { s10: '2% away', s16: '1.5% away', s25: '1% away', straddle: 'at the price' };
const WINDOW_SHORT: Record<string, string> = { 'Fri→exp': 'Fri → expiry', 'Fri→Wed': 'Fri → day before expiry', 'Fri→Tue': 'Fri → Tue (weekend)', 'Mon→exp': 'Mon → expiry', 'Mon→Wed': 'Mon → day before expiry', 'Mon→Tue': 'Mon → Tue (1 night)', 'Wed→exp': 'Tue → expiry' };
const HOW: Record<string, string> = { expiry: 'Held to expiry', 'days-left': 'Closed on schedule', booked: 'Profit booked', stop: 'Stopped out' };
const FINAL_MAP: Record<string, string> = {
  'M s25 45→21 high': 'monthly|s25|45|21|high', 'C M s25 45→21 any': 'monthly|s25|45|21|any', 'C M s16 45→21 high': 'monthly|s16|45|21|high', 'C M straddle 60→7 high': 'monthly|straddle|60|7|high',
  'W Mon→1 day left s16 high': 'weekly-nifty|Mon→Wed|s16|high', 'W Mon→1 day left s16 any': 'weekly-nifty|Mon→Wed|s16|any',
  'Wx Mon→expiry s16 high': 'weekly-nifty|Mon→exp|s16|high', 'Wx Mon→expiry s16 any': 'weekly-nifty|Mon→exp|s16|any', 'Wx Mon→expiry s25 high': 'weekly-nifty|Mon→exp|s25|high',
  'C Fri→2 days left s16 any': 'weekly-nifty|Fri→Tue|s16|any',
};

const yrs = (a: string, b: string) => Math.max((Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000), 1 / 12);
const r0 = Math.round, r1 = (x: number) => Math.round(x * 10) / 10;
const inr = (v: number) => `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;
const read = <X,>(file: string): X | null => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as X) : null);

type Built = { list: Strategy[]; detail: Map<string, () => StrategyDetail> };
let cache: { stamp: string; built: Built } | null = null;

function files() {
  const reg = quantExperiments();
  const pick = (family: string, detail: string) => { const e = [...reg].reverse().find((x) => x.family === family && x.details.includes(detail)); return e ? path.join(QUANT_DIR, `${e.id}-${detail}.json`) : null; };
  return {
    monthly: pick('A1', 'settings'), weeklyNifty: pick('A3', 'nifty-settings'), weeklyBank: pick('A3', 'bank-settings'),
    breakout: pick('B10', 'curves'), momentum: pick('B9', 'curves'), holdout: existsSync(path.join(QUANT_DIR, 'E-holdout-trades.json')) ? path.join(QUANT_DIR, 'E-holdout-trades.json') : null,
    breakoutTable: [...reg].reverse().find((x) => x.family === 'B10' && x.details.includes('curves'))?.metrics as { settings?: { id: string; trades: number }[] } | undefined,
    momentumTable: [...reg].reverse().find((x) => x.family === 'B9')?.metrics as { settings?: { id: string; trades: number }[] } | undefined,
  };
}

function build(): Built {
  const f = files();
  const niftyAll = indexCloses('NIFTY 50');
  const niftyDates = niftyAll.map((q) => q.date);
  const niftyCurve = (from: string, to: string): CurvePoint[] => { const q = niftyAll.filter((x) => x.date >= from && x.date <= to); return q.map((x) => ({ date: x.date, equity: (CAPITAL * x.close) / q[0].close })); };
  const thin = (c: CurvePoint[]): [string, number][] => c.filter((_, i) => i % 2 === 0 || i === c.length - 1).map((p) => [p.date, r0(p.equity)]);
  const list: Strategy[] = [];
  const detail = new Map<string, () => StrategyDetail>();
  const hold = f.holdout ? read<Record<string, T[]>>(f.holdout) ?? {} : {};
  const finalBy = new Map<string, T[]>();
  for (const [book, key] of Object.entries(FINAL_MAP)) if (hold[book]) finalBy.set(key, hold[book]);
  const finalOf = (key: string) => {
    const ts = finalBy.get(key);
    if (!ts) return null;
    const total = ts.reduce((a, t) => a + t.net, 0), y = yrs('2024-01-01', ts.at(-1)?.exit ?? '2026-11-01');
    return { perYearRs: r0(total / y), perYearPct: r1((total / y / CAPITAL) * 100), trades: ts.length, won: ts.filter((t) => t.net > 0).length };
  };
  const tradeRows = (ts: T[]) => ts.map((t) => ({ opened: t.entry, closed: t.exit, expiry: t.expiry ?? null, indexIn: t.spotIn ?? null, indexOut: t.spotOut ?? null, result: r0(t.net), worstAlong: t.worstMtm != null ? r0(t.worstMtm) : null, how: HOW[t.reason ?? ''] ?? t.reason ?? '' }));

  // ---------------------------------------------------------------- options
  const option = (group: Group, key: string, title: string, plain: string, when: Strategy['when'], distance: Strategy['distance'], trades: T[], from: string, to: string, split: string, halfLabels: readonly [string, string]) => {
    if (!trades.length) return;
    const days = niftyDates.filter((d) => d >= from && d <= to);
    const curve = equityFromTrades(days, CAPITAL, trades.map((t) => ({ ...t, daily: t.daily ?? [] })));
    const m = curveMetrics(curve);
    const total = trades.reduce((a, t) => a + t.net, 0), perYear = total / yrs(from, to);
    const yearsList = [...new Set(days.map((d) => d.slice(0, 4)))];
    const byYear = yearsList.map((y) => ({ year: y, value: r0(trades.filter((t) => t.exit.startsWith(y)).reduce((a, t) => a + t.net, 0)) }));
    const h1 = trades.filter((t) => t.exit <= split), h2 = trades.filter((t) => t.exit > split);
    const halves = [{ label: halfLabels[0], value: r0(h1.reduce((a, t) => a + t.net, 0) / yrs(from, split)) }, { label: halfLabels[1], value: r0(h2.reduce((a, t) => a + t.net, 0) / yrs(split, to)) }];
    const goodYears = byYear.filter((y) => y.value > 0).length;
    const won = trades.filter((t) => t.net > 0).length;
    const final = finalOf(key);
    const worstTrade = Math.min(...trades.map((t) => t.net)), worstOpen = Math.min(0, ...trades.map((t) => t.worstMtm ?? t.net));
    const reasons: string[] = [];
    reasons.push(total > 0 ? `Made ${inr(perYear)} a year for 1 lot over ${from.slice(0, 4)}–${to.slice(0, 4)}.` : `Lost ${inr(-perYear)} a year for 1 lot over ${from.slice(0, 4)}–${to.slice(0, 4)}.`);
    reasons.push(`Made money in ${goodYears} of ${byYear.length} years.`);
    reasons.push(`${halves[0].label}: ${inr(halves[0].value)} a year; ${halves[1].label}: ${inr(halves[1].value)} a year.`);
    reasons.push(`Won ${won} of ${trades.length} trades; the worst one lost ${inr(-worstTrade)}${worstOpen < worstTrade ? `, and one was down ${inr(-worstOpen)} at a close before it ended` : ''}.`);
    if (final) reasons.push(`Final check, 2024 to Nov 2026 (never used to choose anything): ${final.perYearRs! >= 0 ? 'made' : 'lost'} ${inr(Math.abs(final.perYearRs!))} a year, ${final.won} of ${final.trades} trades won.`);
    const consistent = goodYears / byYear.length >= 0.7;
    const verdict: Verdict = total <= 0 ? 'failed' : halves.every((h) => h.value > 0) && consistent && (!final || (final.perYearRs ?? 0) > 0) ? 'worked' : 'mixed';
    const s: Strategy = {
      key, group, title, plain, when, distance, unit: 'option', period: { from, to }, trades: trades.length, wonPct: r1((won / trades.length) * 100),
      perYearRs: r0(perYear), perYearPct: r1((perYear / CAPITAL) * 100), worstTradeRs: r0(worstTrade), worstOpenRs: r0(worstOpen),
      maxDdPct: m.drawdown.maxDdPct, maxDdRs: r0(m.drawdown.maxDd), goodYears, years: byYear.length, byYear, halves, final, nifty: null, verdict, reasons,
    };
    list.push(s);
    detail.set(key, () => ({ ...s, curve: thin(curve), niftyCurve: thin(niftyCurve(from, to)), tradeList: tradeRows(trades), finalTrades: tradeRows(finalBy.get(key) ?? []) }));
  };

  const monthly = f.monthly ? read<{ p: { shape: string; daysBefore: number; daysLeft: number; iv: string }; trades: T[] }[]>(f.monthly) ?? [] : [];
  for (const r of monthly) {
    const [dist, distance] = MONTHLY_DIST[r.p.shape] ?? [r.p.shape, null];
    const when = r.p.iv === 'high' ? 'expensive' : 'always';
    option('monthly', `monthly|${r.p.shape}|${r.p.daysBefore}|${r.p.daysLeft}|${r.p.iv}`,
      `Monthly NIFTY · ${r.p.daysBefore}→${r.p.daysLeft} days · ${MONTHLY_SHORT[r.p.shape] ?? r.p.shape} · ${when === 'expensive' ? 'expensive months only' : 'every month'}`,
      `Sell one NIFTY call and one put ${dist}, ${r.p.daysBefore} days before the monthly expiry; buy them back when ${r.p.daysLeft} days are left. ${when === 'expensive' ? 'Only in months when options are expensive (high IV).' : 'Every month.'}`,
      when, distance, r.trades, '2011-01-03', '2023-12-31', '2018-12-31', ['2011–2018', '2019–2023']);
  }
  for (const [group, file, from, split, labels, index] of [
    ['weekly-nifty', f.weeklyNifty, '2019-02-01', '2021-12-31', ['2019–2021', '2022–2023'], 'NIFTY'],
    ['weekly-bank', f.weeklyBank, '2016-06-01', '2020-12-31', ['2016–2020', '2021–2023'], 'Bank Nifty'],
  ] as const) {
    const rows = file ? read<{ p: { window: string; shape: string; iv: string }; trades: T[] }[]>(file) ?? [] : [];
    for (const r of rows) {
      const words = WINDOWS[r.p.window];
      if (!words) continue;
      const [dist, distance] = WEEKLY_DIST[r.p.shape] ?? [r.p.shape, null];
      const when = r.p.iv === 'high' ? 'expensive' : 'always';
      option(group, `${group}|${r.p.window}|${r.p.shape}|${r.p.iv}`,
        `Weekly ${index} · ${WINDOW_SHORT[r.p.window] ?? r.p.window} · ${WEEKLY_SHORT[r.p.shape] ?? r.p.shape} · ${when === 'expensive' ? 'expensive weeks only' : 'every week'}`,
        `Sell one ${index} call and one put ${dist} on that week’s expiry. ${words}. ${when === 'expensive' ? 'Only in weeks when options are expensive (high IV).' : 'Every week.'} ${index === 'NIFTY' ? 'Tested when NIFTY weekly expiry was on Thursday (2019–2023), so "the day before expiry" was Wednesday; today expiry is Tuesday.' : 'Tested when Bank Nifty weekly expiry was on Thursday (Wednesday from Sep 2023); Bank Nifty weeklies stopped in Nov 2024.'}`,
        when, distance, r.trades, from, '2023-12-31', split, labels);
    }
  }

  // ---------------------------------------------------------------- stocks
  const stock = (group: Group, key: string, title: string, plain: string, curveRaw: { date: string; equity: number }[], trades: number) => {
    const curve = curveRaw.filter((c) => c.date <= '2023-12-31');
    if (curve.length < 30) return;
    const from = curve[0].date, to = curve[curve.length - 1].date;
    const m = curveMetrics(curve), n = curveMetrics(niftyCurve(from, to));
    const half = (a: string, b: string) => { const c = curve.filter((p) => p.date >= a && p.date <= b); return c.length > 30 ? curveMetrics(c).cagrPct : 0; };
    const halves = [{ label: '2011–2018', value: half(from, '2018-12-31') }, { label: '2019–2023', value: half('2019-01-01', to) }];
    const nh = [curveMetrics(niftyCurve(from, '2018-12-31')).cagrPct, curveMetrics(niftyCurve('2019-01-01', to)).cagrPct];
    const byYear = m.annual.map((y) => ({ year: y.year, value: y.returnPct }));
    const goodYears = byYear.filter((y) => y.value > 0).length;
    const beatsBoth = halves[0].value > nh[0] && halves[1].value > nh[1];
    const verdict: Verdict = m.cagrPct <= 0 || m.cagrPct < n.cagrPct ? 'failed' : beatsBoth && m.drawdown.maxDdPct <= n.drawdown.maxDdPct ? 'worked' : 'mixed';
    const reasons = [
      `Grew ₹10 lakh by ${r1(m.cagrPct)}% a year (${from.slice(0, 4)}–${to.slice(0, 4)}); NIFTY did ${r1(n.cagrPct)}% a year.`,
      `Worst fall from a high: ${r1(m.drawdown.maxDdPct)}% (NIFTY: ${r1(n.drawdown.maxDdPct)}%).`,
      `${halves[0].label}: ${r1(halves[0].value)}% a year (NIFTY ${r1(nh[0])}%); ${halves[1].label}: ${r1(halves[1].value)}% a year (NIFTY ${r1(nh[1])}%).`,
      `Made money in ${goodYears} of ${byYear.length} years.`,
    ];
    const s: Strategy = {
      key, group, title, plain, when: null, distance: null, unit: 'stock', period: { from, to }, trades, wonPct: null, perYearRs: null, perYearPct: r1(m.cagrPct),
      worstTradeRs: null, worstOpenRs: null, maxDdPct: m.drawdown.maxDdPct, maxDdRs: r0(m.drawdown.maxDd), goodYears, years: byYear.length, byYear, halves, final: null,
      nifty: { perYearPct: r1(n.cagrPct), maxDdPct: n.drawdown.maxDdPct }, verdict, reasons,
    };
    list.push(s);
    detail.set(key, () => ({ ...s, curve: thin(curve), niftyCurve: thin(niftyCurve(from, to)), tradeList: [], finalTrades: [] }));
  };
  const tradesOf = (table: { settings?: { id: string; trades: number }[] } | undefined, id: string) => table?.settings?.find((x) => x.id === id)?.trades ?? 0;
  const breakout = f.breakout ? read<{ p: { maxOpen: number; trail: number; maxBars: number; exitRule: string }; curve: { date: string; equity: number }[] }[]>(f.breakout) ?? [] : [];
  for (const r of breakout) {
    const id = `open${r.p.maxOpen} trail${r.p.trail} hold${r.p.maxBars} ${r.p.exitRule}`;
    stock('stocks-breakout', `breakout|${id}`, `52-week high · up to ${r.p.maxOpen} stocks · stop ${r.p.trail}× range · max ${r.p.maxBars} days${r.p.exitRule === 'sma50' ? ' · exit under 50-day avg' : ''}`,
      `Buy liquid NSE stocks the day they close at a 52-week high, up to ${r.p.maxOpen} at once. Sell on a trailing stop ${r.p.trail}× the daily range below the best price, or after ${r.p.maxBars} days${r.p.exitRule === 'sma50' ? ', or when the price closes under its 50-day average' : ''}.`,
      r.curve, tradesOf(f.breakoutTable, id));
  }
  const momentum = f.momentum ? read<{ p: { lookback: number; maxOpen: number; stopPct: number; skipMonth: number }; curve: { date: string; equity: number }[] }[]>(f.momentum) ?? [] : [];
  const months: Record<number, string> = { 63: '3-month', 126: '6-month', 252: '12-month' };
  for (const r of momentum) {
    const id = `lb${r.p.lookback} open${r.p.maxOpen} stop${r.p.stopPct} skip${r.p.skipMonth}`;
    stock('stocks-momentum', `momentum|${id}`, `Strongest stocks · top ${r.p.maxOpen} by ${months[r.p.lookback] ?? r.p.lookback} rise${r.p.skipMonth ? ' (skip last month)' : ''}${r.p.stopPct ? ` · ${r.p.stopPct}% stop` : ''}`,
      `Hold the ${r.p.maxOpen} liquid NSE stocks with the biggest ${months[r.p.lookback] ?? `${r.p.lookback}-day`} rise${r.p.skipMonth ? ' (ignoring the last month)' : ''} that are above their 200-day average, and swap them about once a month.${r.p.stopPct ? ` Sell any stock that falls ${r.p.stopPct}% from its buy price.` : ''}`,
      r.curve, tradesOf(f.momentumTable, id));
  }
  return { list, detail };
}

function stampOf() {
  const f = files();
  return [f.monthly, f.weeklyNifty, f.weeklyBank, f.breakout, f.momentum, f.holdout].map((x) => (x && existsSync(x) ? `${x}:${statSync(x).mtimeMs}` : '-')).join('|') + `|${indexCloses('NIFTY 50').length}`;
}
function built(): Built {
  const stamp = stampOf();
  if (!cache || cache.stamp !== stamp) cache = { stamp, built: build() };
  return cache.built;
}

export function quantStrategies(): { strategies: Strategy[]; capital: number } { return { strategies: built().list, capital: CAPITAL }; }
export function quantStrategy(key: string): StrategyDetail | null { const f = built().detail.get(key); return f ? f() : null; }
