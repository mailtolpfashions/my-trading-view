'use client';

import { daysBefore, day, fetchDerived, useLoad, type DerivedSeries } from '@/lib/fno';
import { Segmented, UnderlyingPicker, selectClass, useToolParams } from '../controls';

export const PERIODS = [{ value: 90, label: '3M' }, { value: 180, label: '6M' }, { value: 365, label: '1Y' }, { value: 1095, label: '3Y' }, { value: 1825, label: '5Y' }];

/**
 * Underlying, period (calendar days back from the latest day) and expiry from the URL, and the daily statistics
 * they select. No expiry = each day's current expiry (the nearest on or after that day).
 */
export function useDerivedTool(defaultPeriod = 365) {
  const p = useToolParams();
  const period = Number(p.get('period')) || defaultPeriod;
  const expiry = p.get('expiry') ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const series = useLoad<DerivedSeries>(`${p.u}|${period}|${expiry ?? ''}`, (signal) =>
    fetchDerived(expiry ? { underlying: p.u, expiry, from: daysBefore(expiry, 400), to: expiry } : { underlying: p.u, from: daysBefore(today, period) }, signal));
  return { ...p, period, expiry, series };
}

export function DerivedControls({ t, withExpiry = true, extra }: { t: ReturnType<typeof useDerivedTool>; withExpiry?: boolean; extra?: React.ReactNode }) {
  const expiries = t.series.data?.expiries ?? [];
  return (
    <>
      <UnderlyingPicker value={t.u} onChange={(u) => t.set({ u })} />
      {!t.expiry && <Segmented label="Period" value={t.period} onChange={(v) => t.set({ period: String(v) })} options={PERIODS} />}
      {withExpiry && (
        <select className={selectClass} value={t.expiry ?? ''} onChange={(e) => t.set({ expiry: e.target.value || null })} aria-label="Expiry">
          <option value="">Current expiry (rolls)</option>
          {t.expiry && !expiries.includes(t.expiry) && <option value={t.expiry}>{day(t.expiry, true)}</option>}
          {[...expiries].reverse().map((e) => <option key={e} value={e}>{day(e, true)}</option>)}
        </select>
      )}
      {extra}
    </>
  );
}

/** Percentile (0–100) of `v` within `values`: the share of values below it. */
export const percentileOf = (v: number, values: number[]) => (values.length ? (values.filter((x) => x < v).length / values.length) * 100 : null);
