'use client';

import { useEffect, useState } from 'react';
import { feed } from '@/lib/feed';
import type { Meta, UniverseFilters, UniverseSpec } from '@/lib/screener';
import type { Watchlist } from '@/lib/user';
import { InfoTip } from '../info-tip';
import { inputCls } from '../ui';

const MAIN_INDICES = ['NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500', 'NIFTY MIDCAP 150', 'NIFTY SMALLCAP 250'];

const keyOf = (u: UniverseSpec) => (u.kind === 'index' ? `index:${u.name}` : u.kind === 'watchlist' ? `watchlist:${u.id}` : u.kind);

/** Which stocks to search, the filters on them, and how many that leaves (asked from the data service). */
export function UniversePicker({ universe, filters, meta, watchlists, onChange }: {
  universe: UniverseSpec; filters: UniverseFilters; meta: Meta | null; watchlists: Watchlist[];
  onChange: (u: UniverseSpec, f: UniverseFilters) => void;
}) {
  const [count, setCount] = useState<{ eligible: number; excluded: { reason: string; count: number }[] } | null>(null);
  const [counting, setCounting] = useState(false);
  const [listText, setListText] = useState(universe.kind === 'symbols' ? universe.symbols.join(', ') : '');

  useEffect(() => {
    const ctl = new AbortController();
    setCounting(true);
    const t = setTimeout(() => {
      feed<{ eligible: number; excluded: { reason: string; count: number }[] }>('screener/count', { universe, filters }, ctl.signal)
        .then(setCount, () => setCount(null))
        .finally(() => { if (!ctl.signal.aborted) setCounting(false); });
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [universe, filters]);

  const pick = (k: string) => {
    if (k === 'all' || k === 'fno') return onChange({ kind: k }, filters);
    if (k.startsWith('watchlist:')) return onChange({ kind: 'watchlist', id: k.slice(10) }, filters);
    if (k === 'symbols') return onChange({ kind: 'symbols', symbols: listText.split(/[\s,]+/).filter(Boolean) }, filters);
    onChange({ kind: 'index', name: k.slice(6) }, filters);
  };
  const num = (k: keyof UniverseFilters) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value === '' ? undefined : Number(e.target.value);
    onChange(universe, { ...filters, [k]: Number.isFinite(v) ? v : undefined });
  };
  const other = (meta?.indices ?? []).filter((i) => !MAIN_INDICES.includes(i));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="eyebrow">Stocks</span>
          <select value={keyOf(universe)} onChange={(e) => pick(e.target.value)} className={`${inputCls} min-w-[220px] pr-8`}>
            <option value="all">All NSE stocks</option>
            <option value="fno">F&amp;O stocks</option>
            <optgroup label="Index">
              {MAIN_INDICES.map((i) => <option key={i} value={`index:${i}`}>{i}</option>)}
            </optgroup>
            {other.length > 0 && (
              <optgroup label="Sector and theme indices">
                {other.map((i) => <option key={i} value={`index:${i}`}>{i}</option>)}
              </optgroup>
            )}
            {(watchlists.length > 0 || universe.kind === 'watchlist') && (
              <optgroup label="My watchlists">
                {watchlists.map((w) => <option key={w.id} value={`watchlist:${w.id}`}>{w.name} ({w.symbols.length})</option>)}
                {universe.kind === 'watchlist' && !watchlists.some((w) => w.id === universe.id) && <option value={`watchlist:${universe.id}`}>Watchlist (loading…)</option>}
              </optgroup>
            )}
            <option value="symbols">Type a list…</option>
          </select>
        </label>
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
        <p className="flex h-10 items-center gap-1.5 text-[14px] text-ink-2" aria-live="polite">
          {count ? <><span className="num font-semibold text-ink">{count.eligible.toLocaleString('en-IN')}</span> stocks to search</> : counting ? 'Counting…' : ''}
          {count && count.excluded.length > 0 && (
            <InfoTip label="Stocks left out">
              {count.excluded.map((x) => <p key={x.reason}>{x.reason}: <span className="num">{x.count.toLocaleString('en-IN')}</span></p>)}
              <p>The traded-value filter averages close × volume over the last 20 sessions.</p>
            </InfoTip>
          )}
        </p>
      </div>
      {universe.kind === 'symbols' && (
        <label className="grid gap-1">
          <span className="eyebrow">My list (NSE symbols, separated by commas or spaces)</span>
          <textarea value={listText} onChange={(e) => setListText(e.target.value)} rows={2} spellCheck={false}
            onBlur={() => onChange({ kind: 'symbols', symbols: listText.split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean) }, filters)}
            className={`${inputCls} h-auto py-2 font-mono`} placeholder="RELIANCE, TCS, INFY" />
        </label>
      )}
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
