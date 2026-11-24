// The ₹5 lakh portfolio view (2026-11-24): every mix of the four option rules that worked, from the saved run of
// scripts/research/theta/portfolio.ts (.data/research/theta/portfolio.json), beside NIFTY on the same money.
// Nothing is re-run here.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { indexCloses } from '../eod/store';

const FILE = path.resolve(import.meta.dirname, '../../.data/research/theta/portfolio.json');

export type PortfolioRow = {
  names: string; from: string; cagrPct: number; perYear: number; maxDdPct: number; worstDay: number; worstDayOn: string;
  need: number; needOn: string; fits: boolean; losingYears: string[]; curve: [string, number][]; byYear: Record<string, number>;
};
export type PortfolioBook = { trades: number; from: string; wonPct: number; total: number; worstTrade: number; worstOpen: number; margin: number | null };
export type Portfolio = {
  built: string; capital: number; from: string; recent: string; to: string;
  books: Record<string, PortfolioBook>; corr: Record<string, number>;
  rows: PortfolioRow[]; nifty: { curve: [string, number][]; byYear: Record<string, number>; cagrPct: number; maxDdPct: number };
} | null;

export function quantPortfolio(): Portfolio {
  if (!existsSync(FILE)) return null;
  const j = JSON.parse(readFileSync(FILE, 'utf8')) as Omit<NonNullable<Portfolio>, 'nifty'> & { trades?: unknown; margins?: unknown };
  // NIFTY bought with the same ₹5 lakh on the first day, for comparison
  const q = indexCloses('NIFTY 50').filter((x) => x.date >= j.from);
  const units = q.length ? j.capital / q[0].close : 0;
  const curve: [string, number][] = q.filter((_, i) => i % 3 === 0 || i === q.length - 1).map((x) => [x.date, Math.round(x.close * units)]);
  const byYear: Record<string, number> = {};
  let prev = q[0]?.close ?? 0;
  for (const y of [...new Set(q.map((x) => x.date.slice(0, 4)))]) {
    const end = q.filter((x) => x.date.startsWith(y)).at(-1)!.close;
    byYear[y] = Math.round((end / prev - 1) * 10000) / 100;
    prev = end;
  }
  const years = q.length ? (Date.parse(q.at(-1)!.date) - Date.parse(q[0].date)) / (365.25 * 864e5) : 1;
  const cagrPct = q.length ? Math.round((Math.pow(q.at(-1)!.close / q[0].close, 1 / years) - 1) * 10000) / 100 : 0;
  let peak = 0, dd = 0;
  for (const x of q) { peak = Math.max(peak, x.close); dd = Math.max(dd, 1 - x.close / peak); }
  return { built: j.built, capital: j.capital, from: j.from, recent: j.recent, to: j.to, books: j.books, corr: j.corr, rows: j.rows, nifty: { curve, byYear, cagrPct, maxDdPct: Math.round(dd * 1000) / 10 } };
}
