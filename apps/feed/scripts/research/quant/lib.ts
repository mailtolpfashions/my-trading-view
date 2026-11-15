// Shared helpers for the quant experiment scripts: today's SPAN margin per lot, model gap stress at entry, overnight
// gap frequency from index closes. Estimates are labelled where they are used.
import { previewLab, type LabStrategy, type LabData, type LabTrade } from '@mtv/backtest';
import { GAP_SHOCKS, gapPnl, ivOf, positionMargin, yearsBetween, type ShockLeg } from '@mtv/options';
import { prisma } from '@mtv/db';
import { spanToday } from '../../../src/fno/span';

let spanP: ReturnType<typeof spanToday> | null = null;
/** Today's SPAN + exposure for one lot of the rule's position now (₹), or null. An estimate for old dates. */
export async function marginPerLot(s: LabStrategy, data: LabData, underlying: 'NIFTY' | 'BANKNIFTY' = 'NIFTY'): Promise<number | null> {
  spanP ??= spanToday();
  const span = await spanP, p = await previewLab(s, data), d = span?.data[underlying];
  if (typeof p === 'string' || !d || !span) return null;
  const legs = p.legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strike: l.strike, qty: (l.side === 'BUY' ? 1 : -1) * l.lots * p.lot, pricePaise: Math.round(l.price * 100) }));
  const m = positionMargin(d, legs, Math.round(p.spot * 100), span.tradeDate);
  return m.missing.length ? null : Math.round(m.marginPaise / 100);
}

export type GapStress = { unpriced: number; shocks: { gapPct: number; ivMultiple: number; worst: number | null; median: number | null }[] };
/**
 * Model gap stress at entry for every trade: Black-76 IV from each leg's own entry price (index as the forward), re-priced
 * under GAP_SHOCKS. ₹ per lot at today's size (today's lot, index ratio). A model estimate, not data.
 */
export function gapStress(trades: LabTrade[], today: { spot: number; lot: number }): GapStress {
  const per = GAP_SHOCKS.map(() => [] as number[]);
  let unpriced = 0;
  for (const t of trades) {
    const T0 = yearsBetween(t.entry, t.expiry), F = t.spotIn * 100;
    const legs: ShockLeg[] = [];
    for (const l of t.legs) {
      if (l.kind === 'FUT' || l.added) continue;
      const iv = ivOf(l.kind, Math.round(l.entry * 100), F, Math.round(l.strike * 100), T0);
      if (iv == null) { legs.length = 0; break; }
      legs.push({ kind: l.kind, side: l.side, qty: l.lots * today.lot, strikePaise: Math.round(l.strike * 100), pricePaise: Math.round(l.entry * 100), iv, T: T0, forwardPaise: F });
    }
    if (!legs.length) { unpriced++; continue; }
    GAP_SHOCKS.forEach((s, i) => per[i].push((gapPnl(legs, s) / 100) * (today.spot / t.spotIn)));
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };
  return { unpriced, shocks: GAP_SHOCKS.map((s, i) => ({ gapPct: s.gapPct, ivMultiple: s.ivMultiple, worst: per[i].length ? Math.round(Math.min(...per[i])) : null, median: med(per[i]) })) };
}

/** How often the index opened ≥ x% away from the previous close, by weekday of the gap day, from NSE index files. */
export async function overnightGaps(name: 'NIFTY 50' | 'NIFTY BANK', from: string, to: string, thresholds = [2, 3, 5]) {
  const rows = await prisma.indexEod.findMany({ where: { name, date: { gte: from, lte: to } }, orderBy: { date: 'asc' }, select: { date: true, openPaise: true, closePaise: true } });
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out: Record<string, Record<string, number>> = {};
  const days: Record<string, number> = {};
  let worst = { date: '', gapPct: 0 };
  for (let i = 1; i < rows.length; i++) {
    const g = (rows[i].openPaise / rows[i - 1].closePaise - 1) * 100, w = wd[new Date(rows[i].date).getUTCDay()];
    days[w] = (days[w] ?? 0) + 1;
    if (Math.abs(g) > Math.abs(worst.gapPct)) worst = { date: rows[i].date, gapPct: Math.round(g * 100) / 100 };
    for (const t of thresholds) if (Math.abs(g) >= t) { (out[`≥${t}%`] ??= {}); out[`≥${t}%`][w] = (out[`≥${t}%`][w] ?? 0) + 1; out[`≥${t}%`].all = (out[`≥${t}%`].all ?? 0) + 1; }
  }
  return { days: rows.length - 1, byWeekday: days, counts: out, worst };
}
