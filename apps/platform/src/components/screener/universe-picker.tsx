'use client';

import { useEffect, useState } from 'react';
import { feed } from '@/lib/feed';
import type { Meta, UniverseFilters, UniverseSpec } from '@/lib/screener';
import type { Watchlist } from '@/lib/user';
import { InfoTip } from '../info-tip';
import { inputCls } from '../ui';

/** Broad-market lists shown under "Index" in the Scanner's sentence; every other NSE list is a sector or theme. */
const INDEX_LISTS = ['NIFTY 50', 'NIFTY NEXT 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500', 'NIFTY MIDCAP 100', 'NIFTY MIDCAP 150', 'NIFTY MIDCAP SELECT', 'NIFTY SMALLCAP 100', 'NIFTY SMALLCAP 250'];

/** The label that marks a universe as "the stocks in my watchlist" (the side panel's list; it follows that list). */
export const MY_WATCHLIST = 'My watchlist';
export const isMyWatchlist = (u: UniverseSpec) => u.kind === 'symbols' && u.label === MY_WATCHLIST;
const keyOf = (u: UniverseSpec) => (u.kind === 'index' ? `index:${u.name}` : u.kind === 'watchlist' ? `watchlist:${u.id}` : isMyWatchlist(u) ? 'mywatch' : u.kind);
type Change = (u: UniverseSpec, f: UniverseFilters) => void;
export type StockCount = { eligible: number; excluded: { reason: string; count: number }[] };

/** How many stocks a universe and its filters leave (asked from the data service, 0.4 s after the last change). */
export function useStockCount(universe: UniverseSpec, filters: UniverseFilters) {
  const [count, setCount] = useState<StockCount | null>(null);
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setCounting(true);
    const t = setTimeout(() => {
      feed<StockCount>('screener/count', { universe, filters }, ctl.signal)
        .then((c) => { setCount(c); setError(null); }, (e: Error) => { if (!ctl.signal.aborted) { setCount(null); setError(e.message); } })
        .finally(() => { if (!ctl.signal.aborted) setCounting(false); });
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [universe, filters]);
  return { count, counting, error };
}

/** "N stocks to search", with what was left out behind an info tip. */
export function StockCountText({ count, counting, error }: ReturnType<typeof useStockCount>) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2" aria-live="polite">
      {count ? <><span className="num font-semibold text-ink">{count.eligible.toLocaleString('en-IN')}</span> stocks to search</> : counting ? 'Counting…' : error ? <span className="text-down">{error}. Pick another list.</span> : ''}
      {count && count.excluded.length > 0 && (
        <InfoTip label="Stocks left out">
          {count.excluded.map((x) => <p key={x.reason}>{x.reason}: <span className="num">{x.count.toLocaleString('en-IN')}</span></p>)}
          <p>The traded-value filter averages close × volume over the last 20 sessions.</p>
        </InfoTip>
      )}
    </span>
  );
}

/** A plain name for a universe the sentence no longer offers (an older saved scan, or a watchlist link). */
const otherName = (u: UniverseSpec, watchlists: Watchlist[]) =>
  u.kind === 'all' ? 'All NSE (saved earlier)' : u.kind === 'fno' ? 'F&O stocks (saved earlier)' : u.kind === 'symbols' ? `my list of ${u.symbols.length} (saved earlier)`
    : u.kind === 'watchlist' ? `watchlist ${watchlists.find((w) => w.id === u.id)?.name ?? ''}`.trim() : '';

/**
 * Which stocks to search: an index list (NIFTY 50 by default), a sector list, or only the stocks in a watchlist (the
 * side panel's, `watch`, and any named list). `className` styles the select.
 */
export function UniverseSelect({ universe, filters, meta, watchlists, watch, onChange, onPick, className }: {
  universe: UniverseSpec; filters: UniverseFilters; meta: Meta | null; watchlists: Watchlist[]; watch: string[]; onChange: Change;
  /** Offers "Pick stocks or an index…" (Strategies: test NIFTY itself or a hand-picked list); called when chosen. */
  onPick?: () => void;
  className?: string;
}) {
  const all = meta?.indices ?? INDEX_LISTS;
  const index = INDEX_LISTS.filter((i) => all.includes(i));
  const sector = all.filter((i) => !INDEX_LISTS.includes(i));
  const key = keyOf(universe);
  const picking = !!onPick && universe.kind === 'symbols' && !isMyWatchlist(universe);
  const offered = picking || universe.kind === 'index' || isMyWatchlist(universe) || (universe.kind === 'watchlist' && watchlists.some((w) => w.id === universe.id));
  const pick = (v: string) => {
    if (v.startsWith('index:')) onChange({ kind: 'index', name: v.slice(6) }, filters);
    else if (v === 'mywatch') onChange({ kind: 'symbols', symbols: watch, label: MY_WATCHLIST }, filters);
    else if (v.startsWith('watchlist:')) onChange({ kind: 'watchlist', id: v.slice(10) }, filters);
    else if (v === 'pick') onPick?.();
  };
  return (
    <select value={picking ? 'pick' : key} onChange={(e) => pick(e.target.value)}
      aria-label="Which stocks" className={className ?? `${inputCls} min-w-[220px] pr-8`}>
      {!offered && <option value={key}>{otherName(universe, watchlists)}</option>}
      <optgroup label="Watchlist">
        <option value="mywatch" disabled={!watch.length}>{MY_WATCHLIST} ({watch.length})</option>
        {watchlists.map((w) => <option key={w.id} value={`watchlist:${w.id}`}>{w.name} ({w.symbols.length})</option>)}
      </optgroup>
      <optgroup label="Index">
        {index.map((i) => <option key={i} value={`index:${i}`}>{i}</option>)}
      </optgroup>
      {sector.length > 0 && (
        <optgroup label="Sector">
          {sector.map((i) => <option key={i} value={`index:${i}`}>{i.replace(/^NIFTY /, '')}</option>)}
        </optgroup>
      )}
      {onPick && <optgroup label="Other"><option value="pick">Pick stocks or an index (NIFTY, BANK NIFTY…)</option></optgroup>}
    </select>
  );
}

/** How many filters are set (for the Filters button). */
export const filterCount = (f: UniverseFilters) =>
  [f.minPrice, f.maxPrice, f.minAvgValueCr, f.minHistory].filter((v) => v != null).length + (f.industries?.length ? 1 : 0);

/** Price, traded value, history and industry filters on the chosen stocks. */
export function UniverseFilterFields({ universe, filters, meta, onChange }: { universe: UniverseSpec; filters: UniverseFilters; meta: Meta | null; onChange: Change }) {
  const num = (k: keyof UniverseFilters) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value === '' ? undefined : Number(e.target.value);
    onChange(universe, { ...filters, [k]: Number.isFinite(v) ? v : undefined });
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Num label="Min price ₹" value={filters.minPrice} onChange={num('minPrice')} />
        <Num label="Max price ₹" value={filters.maxPrice} onChange={num('maxPrice')} />
        <Num label="Min traded value ₹ cr/day" value={filters.minAvgValueCr} onChange={num('minAvgValueCr')} />
        <Num label="Min history (sessions)" value={filters.minHistory} onChange={num('minHistory')} />
        {meta && meta.industries.length > 0 && (
          <label className="grid gap-1">
            <span className="eyebrow">Industry</span>
            <select value={filters.industries?.[0] ?? ''} onChange={(e) => onChange(universe, { ...filters, industries: e.target.value ? [e.target.value] : undefined })}
              className={`${inputCls} min-w-[180px] pr-8`}>
              <option value="">Any industry</option>
              {meta.industries.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
        )}
      </div>
      {filters.industries?.length ? <p className="text-[12.5px] text-muted">Industry comes from NSE&apos;s NIFTY 500 list, so the industry filter keeps NIFTY 500 stocks only.</p> : null}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | undefined; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="grid gap-1">
      <span className="eyebrow">{label}</span>
      <input type="number" inputMode="decimal" min={0} value={value ?? ''} onChange={onChange} className={`${inputCls} num w-[130px]`} />
    </label>
  );
}
