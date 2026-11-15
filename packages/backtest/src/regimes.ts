// Market regime labels per trading day, so every result can be split by the kind of market it was earned in.
// Labels are built only from data up to that day (no look-ahead):
// - trend: bull = close above its 200-day average and up over the past 126 sessions; bear = below and down; else sideways.
// - vol: tercile of the 20-day realized volatility against the previous 3 years (expanding until 250 days exist).
// - vix: the same terciles on INDIA VIX closes (null where VIX is missing; VIX is complete only from 2015).
// - crisis: the tagged shock windows from selling.ts (CRISIS_TAGS), null elsewhere.
// - expiryWeek: within 6 calendar days before a monthly expiry (inclusive).

import { CRISIS_TAGS } from './selling';

export type RegimeLabels = { trend: 'bull' | 'bear' | 'sideways' | null; vol: 'low' | 'mid' | 'high' | null; vix: 'low' | 'mid' | 'high' | null; crisis: string | null; expiryWeek: boolean };
export type Quote = { date: string; close: number };

const tercile = (values: (number | null)[], window: number, minDays: number): ('low' | 'mid' | 'high' | null)[] => {
  const out: ('low' | 'mid' | 'high' | null)[] = new Array(values.length).fill(null);
  const hist: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (hist.length >= minDays) {
      const ref = hist.slice(-window).sort((a, b) => a - b);
      const lo = ref[Math.floor(ref.length / 3)], hi = ref[Math.floor((2 * ref.length) / 3)];
      out[i] = v <= lo ? 'low' : v >= hi ? 'high' : 'mid';
    }
    hist.push(v);
  }
  return out;
};

export function regimeTable(index: Quote[], vix: Quote[] | null, monthlyExpiries: string[] | null): Map<string, RegimeLabels> {
  const n = index.length, c = index.map((q) => q.close);
  const sma200: (number | null)[] = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) { sum += c[i]; if (i >= 200) sum -= c[i - 200]; if (i >= 199) sma200[i] = sum / 200; }
  const rv: (number | null)[] = new Array(n).fill(null);
  const lr = c.map((v, i) => (i ? Math.log(v / c[i - 1]) : 0));
  for (let i = 20; i < n; i++) {
    const w = lr.slice(i - 19, i + 1), m = w.reduce((a, b) => a + b, 0) / 20;
    rv[i] = Math.sqrt((w.reduce((a, b) => a + (b - m) ** 2, 0) / 19) * 252) * 100;
  }
  const volT = tercile(rv, 756, 250);
  const vixBy = new Map((vix ?? []).map((q) => [q.date, q.close]));
  const vixT = tercile(index.map((q) => vixBy.get(q.date) ?? null), 756, 250);
  const exp = (monthlyExpiries ?? []).slice().sort();
  const out = new Map<string, RegimeLabels>();
  for (let i = 0; i < n; i++) {
    const d = index[i].date;
    let trend: RegimeLabels['trend'] = null;
    if (sma200[i] != null && i >= 126) {
      const up = c[i] > sma200[i]!, rising = c[i] > c[i - 126];
      trend = up && rising ? 'bull' : !up && !rising ? 'bear' : 'sideways';
    }
    const crisis = CRISIS_TAGS.find((t) => d >= t.from && d <= t.to)?.id ?? null;
    const next = exp.find((e) => e >= d);
    const expiryWeek = !!next && (Date.parse(next) - Date.parse(d)) / 86_400_000 <= 6;
    out.set(d, { trend, vol: volT[i], vix: vixT[i], crisis, expiryWeek });
  }
  return out;
}

/** Days per label, for a quick table. */
export function regimeCounts(table: Map<string, RegimeLabels>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of table.values()) for (const k of [`trend:${r.trend}`, `vol:${r.vol}`, `vix:${r.vix}`, r.crisis ? `crisis:${r.crisis}` : 'crisis:none', `expiryWeek:${r.expiryWeek}`]) out[k] = (out[k] ?? 0) + 1;
  return out;
}
