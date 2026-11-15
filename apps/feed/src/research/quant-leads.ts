// The plain view of the quant research: only the models that worked, stitched over the development years and the
// holdout from the saved trades, on ₹10 lakh at the lot counts the sizing study chose, beside NIFTY and a 7% deposit.
// Everything here is derived from files already in .data/research/quant (nothing is re-run) and NSE's index closes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { combineCurves, curveMetrics, equityFromTrades, tradeMetrics, type CurvePoint } from '@mtv/backtest';
import { indexCloses } from '../eod/store';

const QUANT_DIR = path.resolve(import.meta.dirname, '../../.data/research/quant');
const CAPITAL = 1_000_000, HOLDOUT_FROM = '2024-01-01', FROM = '2019-02-01', FD_RATE = 0.07;
type T = { entry: string; exit: string; net: number; worstMtm: number; daily: { date: string; mtm: number }[] };
type SettingFile = { p: Record<string, string | number>; trades: T[] }[];

const read = <X,>(name: string): X | null => { const f = path.join(QUANT_DIR, name); return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as X) : null; };
/** The newest detail file matching the pattern (A1: "<id>-settings.json"; A3b: "<id>-nifty-settings.json"). */
const latest = (pattern: RegExp): string | null => (existsSync(QUANT_DIR) ? readdirSync(QUANT_DIR).filter((f) => pattern.test(f)).sort().at(-1) ?? null : null);

export type LeadBook = {
  id: string; name: string; lots: number; marginPct: number;
  /** Plain words: what you do, and what can go wrong. */
  what: string[]; risk: string;
  curve: [string, number][];
  yearly: { year: string; returnPct: number; net: number; unseen: boolean; trades: number; won: number }[];
  stats: { cagrPct: number; maxDdPct: number; worstMonthPct: number; worstDayPct: number; worstDayDate: string | null; sharpe: number | null; trades: number; wonPct: number | null; worstTrade: number | null; avgWin: number | null; avgLoss: number | null; losingYears: number; years: number };
  holdout: { cagrPct: number; maxDdPct: number; net: number };
};
export type Leads = { from: string; to: string; holdoutFrom: string; capital: number; books: LeadBook[]; nifty: { curve: [string, number][]; yearly: { year: string; returnPct: number }[]; cagrPct: number; maxDdPct: number; worstYearPct: number }; fd: { ratePct: number; curve: [string, number][] } } | null;

const thin = (c: CurvePoint[]): [string, number][] => c.filter((p, i) => i % 3 === 0 || i === c.length - 1).map((p) => [p.date, Math.round(p.equity)]);
const scaled = (ts: T[], lots: number) => ts.map((t) => ({ ...t, net: t.net * lots, daily: (t.daily ?? []).map((p) => ({ date: p.date, mtm: p.mtm * lots })) }));

export function quantLeads(): Leads {
  const a3b = latest(/^E-\d{8}-\d{3}-nifty-settings\.json$/);
  // The A1 file is the newest "<id>-settings.json" whose settings carry a monthly schedule (A3's file has the same suffix).
  const a1 = (existsSync(QUANT_DIR) ? readdirSync(QUANT_DIR).filter((f) => /^E-\d{8}-\d{3}-settings\.json$/.test(f)).sort().reverse() : []).find((f) => { const first = read<SettingFile>(f)?.[0]; return first?.p?.daysBefore != null && first.p.shape != null; }) ?? null;
  const weekly = a3b ? read<SettingFile>(a3b) : null, monthly = a1 ? read<SettingFile>(a1) : null, hold = read<Record<string, T[]>>('E-holdout-trades.json');
  if (!weekly || !monthly || !hold) return null;
  const find = (file: SettingFile, want: Record<string, string | number>) => file.find((r) => Object.entries(want).every(([k, v]) => (r.p ?? {})[k] === v))?.trades ?? [];
  const dev = { W: find(weekly, { window: 'Mon→exp', shape: 's16', iv: 'high' }), M: find(monthly, { shape: 's25', daysBefore: 45, daysLeft: 21, iv: 'high' }) };
  const ho = { W: hold['Wx Mon→expiry s16 high'] ?? [], M: hold['M s25 45→21 high'] ?? [] };
  const trades = { W: [...dev.W.filter((t) => t.exit >= FROM), ...ho.W], M: [...dev.M.filter((t) => t.exit >= FROM), ...ho.M] };
  const nifty = indexCloses('NIFTY 50').filter((q) => q.date >= FROM);
  if (!nifty.length) return null;
  const to = nifty[nifty.length - 1].date;
  const dates = nifty.map((q) => q.date);

  const book = (id: string, name: string, parts: [T[], number][], what: string[], risk: string, marginPerLot: number[]): LeadBook => {
    const curve = combineCurves(parts.map(([ts, lots]) => equityFromTrades(dates, 0, scaled(ts, lots))), CAPITAL);
    const m = curveMetrics(curve), all = parts.flatMap(([ts]) => ts), tm = tradeMetrics(all);
    const hoCurve = curve.filter((p) => p.date >= HOLDOUT_FROM), hm = hoCurve.length > 2 ? curveMetrics(hoCurve) : null;
    const yearly = m.annual.map((y) => { const ts = all.filter((t) => t.exit.startsWith(y.year)); return { year: y.year, returnPct: y.returnPct, net: y.net, unseen: y.year >= HOLDOUT_FROM.slice(0, 4), trades: ts.length, won: ts.filter((t) => t.net > 0).length }; });
    return {
      id, name, lots: parts.reduce((a, [, l]) => a + l, 0), marginPct: Math.round(parts.reduce((a, [, l], i) => a + l * marginPerLot[i], 0) / CAPITAL * 100), what, risk,
      curve: thin(curve), yearly,
      stats: { cagrPct: m.cagrPct, maxDdPct: m.drawdown.maxDdPct, worstMonthPct: m.worstMonthPct, worstDayPct: m.worstDayPct, worstDayDate: m.worstDayDate, sharpe: m.sharpe, trades: tm.trades, wonPct: tm.winRatePct, worstTrade: tm.largestLoss, avgWin: tm.avgWin, avgLoss: tm.avgLoss, losingYears: yearly.filter((y) => y.net < 0).length, years: m.years },
      holdout: { cagrPct: hm?.cagrPct ?? 0, maxDdPct: hm?.drawdown.maxDdPct ?? 0, net: Math.round(hoCurve.length ? hoCurve[hoCurve.length - 1].equity - hoCurve[0].equity : 0) },
    };
  };
  const W_MARGIN = 177_466, M_MARGIN = 175_608;
  const books = [
    book('weekly', 'Weekly premium: sell on Monday, hold to expiry', [[trades.W, 3]],
      ['Every Monday near the close, only when NIFTY’s option prices are above their one-year normal (high IV).', 'Sell one call and one put about 1.5% away from the index on that week’s expiry: 3 lots each.', 'Do nothing until expiry; the options settle on their own.'],
      'A big fall or rise while the position is on. On 12 March 2020 (Covid) this book lost about 16% of the money in one day, and on 4 June 2024 (election result) about 12%. Expect a day like that every few years.', [W_MARGIN]),
    book('monthly', 'Monthly premium: sell 45 days out, buy back at 21 days', [[trades.M, 3]],
      ['Once a month, about 45 days before the monthly expiry, only in high-IV months.', 'Sell one call and one put about 25-delta (roughly 3 to 4% away): 3 lots each.', 'Buy both back when 21 days are left, whatever has happened.'],
      'A fast move of 5% or more while the position is on: one such month costs a quarter to a third of a year’s profit at 3 lots. Deeper falls from a peak than the weekly book (up to a third of the money in 2011 to 2023).', [M_MARGIN]),
    book('mix', 'Mix: 2 weekly lots + 1 monthly lot', [[trades.W, 2], [trades.M, 1]],
      ['Both rules above at once, smaller size each: 2 lots weekly, 1 lot monthly.', 'The two books rarely lose on the same days (their daily results move together only 12% of the time).', 'Uses about half the money as margin; the rest stays as a cushion for a bad night.'],
      'Same one-day risk as the weekly book, at two-thirds the size: about 11% of the money on 12 March 2020, about 8% on 4 June 2024.', [W_MARGIN, M_MARGIN]),
  ];
  const nCurve: CurvePoint[] = nifty.map((q) => ({ date: q.date, equity: Math.round((CAPITAL * q.close) / nifty[0].close) }));
  const nm = curveMetrics(nCurve);
  const fd = dates.map((d) => [d, Math.round(CAPITAL * Math.pow(1 + FD_RATE, (Date.parse(d) - Date.parse(dates[0])) / (365.25 * 86_400_000)))] as [string, number]).filter((_, i) => i % 3 === 0 || i === dates.length - 1);
  return { from: dates[0], to, holdoutFrom: HOLDOUT_FROM, capital: CAPITAL, books, nifty: { curve: thin(nCurve), yearly: nm.annual.map((y) => ({ year: y.year, returnPct: y.returnPct })), cagrPct: nm.cagrPct, maxDdPct: nm.drawdown.maxDdPct, worstYearPct: Math.min(...nm.annual.map((y) => y.returnPct)) }, fd: { ratePct: Math.round(FD_RATE * 100), curve: fd } };
}
