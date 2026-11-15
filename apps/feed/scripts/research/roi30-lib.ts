// Shared helpers for the 30% ROI search (roi30-*.ts). One lot of NIFTY, ₹3 lakh capital, money at today's size.
import { positionMargin } from '@mtv/options';
import { runLab, previewLab, type LabStrategy, type LabLeg, type LabResult, type LabTrade } from '@mtv/backtest';
import { labData } from '../../src/options-lab/data';
import { spanToday } from '../../src/fno/span';

export const data = await labData('NIFTY');
const span = await spanToday();

export const common = { underlying: 'NIFTY', missing: 'skip', slippage: 1, money: 'today' } as const;
export const sell = (kind: 'CE' | 'PE', delta: number, lots = 1, expiry: 0 | 1 | 2 = 0): LabLeg => ({ side: 'SELL', kind, lots, strike: { by: 'delta', delta }, expiry });
export const buy = (kind: 'CE' | 'PE', delta: number, lots = 1, expiry: 0 | 1 | 2 = 0): LabLeg => ({ side: 'BUY', kind, lots, strike: { by: 'delta', delta }, expiry });
export const buyPct = (kind: 'CE' | 'PE', pct: number, lots = 1): LabLeg => ({ side: 'BUY', kind, lots, strike: { by: 'pct', pct }, expiry: 0 });
export const fut = (side: 'BUY' | 'SELL', lots = 1): LabLeg => ({ side, kind: 'FUT', lots, strike: { by: 'atm' }, expiry: 0 });

const marginCache = new Map<string, number | null>();
/** Today's SPAN + exposure for the position the strategy would open now (₹). Bought legs' debit is added. */
export async function marginOf(s: LabStrategy): Promise<number | null> {
  const key = JSON.stringify([s.legs, s.schedule]);
  if (marginCache.has(key)) return marginCache.get(key)!;
  let out: number | null = null;
  const p = await previewLab(s, data);
  const d = span?.data.NIFTY;
  if (typeof p !== 'string' && d && span) {
    const legs = p.legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strike: l.strike, qty: (l.side === 'BUY' ? 1 : -1) * l.lots * p.lot, pricePaise: Math.round(l.price * 100) }));
    const m = positionMargin(d, legs, Math.round(p.spot * 100), span.tradeDate);
    const debit = p.legs.filter((l) => l.side === 'BUY' && l.kind !== 'FUT').reduce((a, l) => a + l.price * l.lots * p.lot, 0);
    if (!m.missing.length) out = Math.round(m.marginPaise / 100 + debit);
  }
  marginCache.set(key, out);
  return out;
}

export type Row = {
  name: string; trades: number; won: number; perYear: number; perYearSince16: number; perYearSince21: number;
  worst: number; worstMtm: number; losingYears: number; years: string; margin: number | null; first: string; last: string; skipped: number;
};

const yrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);
export function rowOf(name: string, r: LabResult, margin: number | null, trades: LabTrade[] = r.trades): Row {
  const sumFrom = (y: string) => trades.filter((t) => t.entry >= y).reduce((a, t) => a + t.net, 0);
  const by = new Map<string, number>();
  for (const t of trades) by.set(t.exit.slice(0, 4), (by.get(t.exit.slice(0, 4)) ?? 0) + t.net);
  const total = trades.reduce((a, t) => a + t.net, 0);
  return {
    name, trades: trades.length, won: trades.filter((t) => t.net > 0).length,
    perYear: Math.round(total / yrs(r.from, r.to)),
    perYearSince16: Math.round(sumFrom('2016-01-01') / yrs('2016-01-01', r.to)),
    perYearSince21: Math.round(sumFrom('2021-01-01') / yrs('2021-01-01', r.to)),
    worst: Math.min(0, ...trades.map((t) => t.net)), worstMtm: Math.min(0, ...trades.map((t) => t.worstMtm)),
    losingYears: [...by.values()].filter((v) => v < 0).length,
    years: [...by.entries()].map(([y, v]) => `${y.slice(2)}:${Math.round(v / 1000)}k`).join(' '),
    margin, first: trades[0]?.entry ?? '', last: trades.at(-1)?.exit ?? '', skipped: r.skipped.length,
  };
}

export async function run(name: string, s: Omit<LabStrategy, 'name' | keyof typeof common> & Partial<LabStrategy>) {
  const full = { ...common, name, ...s } as LabStrategy;
  const r = await runLab(full, data);
  return { r, row: rowOf(name, r, await marginOf(full)), s: full };
}

export const fmt = (x: Row) =>
  `${x.name.padEnd(46)} n=${String(x.trades).padStart(3)} won=${Math.round((100 * x.won) / Math.max(1, x.trades))}% /yr=${x.perYear} since16=${x.perYearSince16} since21=${x.perYearSince21} worst=${x.worst} mtm=${x.worstMtm} lossYrs=${x.losingYears} margin=${x.margin}`;
