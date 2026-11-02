'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { day, fetchFnoDates, fetchUnderlyings, type Underlying } from '@/lib/fno';
import { DEFAULT_UNDERLYING } from '@/lib/tools';
import { TradingDatePicker } from './trading-date-picker';

export const selectClass = 'h-9 rounded-full bg-panel px-3 text-[12.5px] font-semibold shadow-[var(--shadow-panel)] outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * Tool parameters kept in the URL (?u=NIFTY&date=…&expiry=…), so a view can be bookmarked or shared. Changing the
 * underlying clears the date-specific choices (expiry, strikes).
 */
export function useToolParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = useCallback((k: string) => params.get(k) ?? undefined, [params]);
  const set = useCallback((patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params.toString());
    if (patch.u !== undefined && patch.u !== params.get('u')) for (const k of ['expiry', 'strikes', 'strike']) next.delete(k);
    for (const [k, v] of Object.entries(patch)) if (v == null || v === '') next.delete(k); else next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, router, pathname]);
  return { u: (params.get('u') ?? DEFAULT_UNDERLYING).toUpperCase(), get, set };
}

/** F&O underlying picker: indices first, then stocks A–Z, from the latest NSE file. */
export function UnderlyingPicker({ value, onChange, indicesOnly }: { value: string; onChange: (u: string) => void; indicesOnly?: boolean }) {
  const [list, setList] = useState<Underlying[] | null>(null);
  useEffect(() => { fetchUnderlyings().then((r) => setList(r.underlyings), () => setList([])); }, []);
  const indices = list?.filter((x) => x.isIndex) ?? [];
  const stocks = indicesOnly ? [] : list?.filter((x) => !x.isIndex) ?? [];
  const known = !list || list.some((x) => x.symbol === value);
  return (
    <select className={`${selectClass} max-w-[180px]`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Underlying">
      {!known && <option value={value}>{value}</option>}
      {!list && <option value={value}>{value}</option>}
      {indices.length > 0 && <optgroup label="Indices">{indices.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}</optgroup>}
      {stocks.length > 0 && <optgroup label="Stocks">{stocks.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}</optgroup>}
    </select>
  );
}

export function ExpirySelect({ value, expiries, onChange, label = 'Expiry' }: { value: string | null | undefined; expiries: string[]; onChange: (e: string) => void; label?: string }) {
  return (
    <select className={selectClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={!expiries.length}>
      {!expiries.length && <option value="">{label}</option>}
      {expiries.map((e) => <option key={e} value={e}>{day(e, true)}</option>)}
    </select>
  );
}

/**
 * A trading day: previous / next session buttons and a date box. `value` null means the latest day. Steps over
 * weekends and holidays using the days held for the underlying.
 */
export function DateStepper({ underlying, value, onChange }: { underlying: string; value: string | null; onChange: (d: string | null) => void }) {
  const [dates, setDates] = useState<string[]>([]);
  useEffect(() => { let on = true; fetchFnoDates(underlying).then((d) => on && setDates(d), () => on && setDates([])); return () => { on = false; }; }, [underlying]);
  const latest = dates.at(-1) ?? null;
  const current = value ?? latest;
  const idx = useMemo(() => {
    if (!current) return -1;
    let i = dates.length - 1;
    while (i >= 0 && dates[i] > current) i--;
    return i;
  }, [dates, current]);
  const go = (i: number) => { const d = dates[i]; if (d) onChange(d === latest ? null : d); };
  const btn = 'grid h-9 w-9 place-items-center rounded-full bg-panel text-ink-2 shadow-[var(--shadow-panel)] hover:text-ink disabled:opacity-40';
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label="Previous trading day"><ChevronLeft size={16} /></button>
      <TradingDatePicker underlying={underlying} value={value} onChange={onChange} />
      <button type="button" className={btn} onClick={() => go(idx + 1)} disabled={idx < 0 || idx >= dates.length - 1} aria-label="Next trading day"><ChevronRight size={16} /></button>
      {value && <button type="button" className="ml-1 text-[12px] font-semibold text-accent-deep hover:underline" onClick={() => onChange(null)}>Latest</button>}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded-full bg-panel p-1 shadow-[var(--shadow-panel)]" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-[12.5px] font-semibold whitespace-nowrap ${o.value === value ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:bg-raised'}`}>{o.label}</button>
      ))}
    </div>
  );
}

/** A small figure: label above, value below. */
export function Stat({ label, value, hint, className = '' }: { label: string; value: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-raised px-3.5 py-2.5" title={hint}>
      <p className="truncate text-[11px] font-semibold text-muted">{label}</p>
      <p className={`num mt-0.5 truncate text-[15px] font-bold ${className}`}>{value}</p>
    </div>
  );
}

export function Loading({ error, loading, empty }: { error?: string | null; loading?: boolean; empty?: string }) {
  if (error) return <p className="m-auto p-6 text-center text-[13px] font-semibold text-down">{error}</p>;
  if (loading) return <p className="m-auto p-6 text-center text-[13px] text-muted">Loading…</p>;
  return <p className="m-auto p-6 text-center text-[13px] text-muted">{empty ?? 'No data for this choice.'}</p>;
}
