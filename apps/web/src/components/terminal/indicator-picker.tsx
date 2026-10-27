'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, Search, X } from 'lucide-react';
import { STUDIES } from '@/lib/chart/studies';
import { CATEGORY_ORDER, fetchCatalog, type LibIndicator } from '@/lib/chart/library';

/** TradingView-style indicator picker: search, categories, and our verified quick indicators on top. */
export function IndicatorPicker({ quick, onToggleQuick, onAdd, onClose }: { quick: string[]; onToggleQuick: (id: string) => void; onAdd: (ind: LibIndicator) => void; onClose: () => void }) {
  const [list, setList] = useState<LibIndicator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('All');
  useEffect(() => { fetchCatalog().then(setList, (e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter((i) => (cat === 'All' || i.category === cat) && (!s || i.name.toLowerCase().includes(s) || i.shortName.toLowerCase().includes(s) || i.id.includes(s)));
  }, [list, q, cat]);
  const cats = ['All', ...CATEGORY_ORDER.filter((c) => list?.some((i) => i.category === c))];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Indicators">
      <div className="panel flex h-[min(640px,90dvh)] w-full max-w-[760px] flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">Indicators</h2>
          <label className="relative ml-auto w-72">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. Ichimoku, ADX, VWAP" aria-label="Search indicators"
              className="h-9 w-full rounded-full border border-line bg-raised pr-3 pl-8 text-[13px] outline-none focus:border-ink" />
          </label>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-raised" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr]">
          <nav className="overflow-y-auto border-r border-line p-2" aria-label="Categories">
            <p className="eyebrow px-2 pt-1 pb-1.5">Quick (verified)</p>
            {STUDIES.map((s) => (
              <button key={s.id} type="button" onClick={() => onToggleQuick(s.id)} className="flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-raised">
                {s.name}{quick.includes(s.id) && <Check size={13} className="ml-auto text-up" />}
              </button>
            ))}
            <p className="eyebrow px-2 pt-3 pb-1.5">TradingView library</p>
            {cats.map((c) => (
              <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c}
                className={`w-full rounded-[8px] px-2 py-1.5 text-left text-[12.5px] ${cat === c ? 'bg-ink font-semibold text-white' : 'hover:bg-raised'}`}>{c}</button>
            ))}
          </nav>
          <div className="min-h-0 overflow-y-auto">
            {error && <p className="p-5 text-[13px] font-semibold text-down">{error}</p>}
            {!list && !error && <p className="p-5 text-[13px] text-muted">Loading indicators…</p>}
            {list && !shown.length && <p className="p-5 text-[13px] text-muted">No indicator matches &ldquo;{q}&rdquo;.</p>}
            {shown.map((i) => (
              <button key={i.id} type="button" onClick={() => onAdd(i)} className="flex w-full items-center gap-2 border-b border-line px-5 py-2.5 text-left hover:bg-raised">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{i.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">{i.category}{i.overlay ? ' · on the price chart' : ' · own pane'}</span>
                </span>
                {i.verified
                  ? <span className="flex items-center gap-1 rounded-full bg-up-soft px-2 py-0.5 text-[10.5px] font-bold text-up" title="Values measured equal to TradingView's"><BadgeCheck size={12} />Verified</span>
                  : <span className="rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-semibold text-ink-2" title="Pine Script formula; not yet measured against TradingView">Pine formula</span>}
              </button>
            ))}
          </div>
        </div>
        <p className="border-t border-line px-5 py-2 text-[11px] text-muted">Indicator library: lightweight-charts-indicators (MIT), Pine Script v6 formulas. Values are calculated on the same data your chart shows.</p>
      </div>
    </div>
  );
}
