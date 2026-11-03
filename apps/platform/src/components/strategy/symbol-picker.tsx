'use client';

// Picks the stocks and indices a strategy is tested on: search with suggestions, chips to remove, quick buttons for
// the tradable indices. Pasting "RELIANCE, TCS INFY" adds each one.

import { useEffect, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { Instrument } from '@mtv/shared';
import { searchSymbols } from '@/lib/feed';

/** Indices the backtest can stand in for futures or an ETF (feed strategy/backtest.ts TRADABLE_INDICES). */
export const TEST_INDICES: { symbol: string; name: string }[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50' }, { symbol: 'BANKNIFTY', name: 'BANK NIFTY' }, { symbol: 'FINNIFTY', name: 'FIN NIFTY' },
  { symbol: 'MIDCPNIFTY', name: 'MIDCAP SELECT' }, { symbol: 'NIFTYNXT50', name: 'NIFTY NEXT 50' }, { symbol: 'NIFTYIT', name: 'NIFTY IT' },
];
const NAME = new Map(TEST_INDICES.map((i) => [i.symbol, i.name]));

export function SymbolPicker({ symbols, onChange }: { symbols: string[]; onChange: (s: string[]) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Instrument[]>([]);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term || /[\s,]/.test(term)) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => searchSymbols(term, ctrl.signal).then((r) => {
      // VIX and BSE indices can't be tested; everything else NSE can.
      setHits(r.filter((i) => i.exchange === 'NSE' && (i.kind !== 'INDEX' || NAME.has(i.symbol))).slice(0, 8));
      setAt(0);
    }, () => {}), 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);

  const add = (list: string[]) => {
    const next = [...symbols];
    for (const s of list.map((x) => x.trim().toUpperCase()).filter(Boolean)) if (!next.includes(s)) next.push(s);
    onChange(next);
    setQ('');
    setHits([]);
  };
  const remove = (s: string) => onChange(symbols.filter((x) => x !== s));

  return (
    <div className="grid gap-3">
      <div ref={box} className="relative max-w-[560px]">
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-[12px] border border-line-strong bg-panel px-2 py-1.5 focus-within:border-accent">
          {symbols.map((s) => (
            <span key={s} className={`inline-flex h-7 items-center gap-1 rounded-full pl-2.5 pr-1 text-[12.5px] font-semibold ${NAME.has(s) ? 'bg-accent-soft text-accent-deep' : 'bg-raised text-ink'}`}>
              {NAME.get(s) ?? s}
              <button type="button" onClick={() => remove(s)} aria-label={`Remove ${NAME.get(s) ?? s}`} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-panel hover:text-down"><X size={12} /></button>
            </span>
          ))}
          <span className="flex min-w-[10rem] flex-1 items-center gap-1.5">
            {!symbols.length && <Search size={15} className="ml-1 text-muted" aria-hidden="true" />}
            <input value={q} placeholder={symbols.length ? 'Add more…' : 'Search a stock or index, or paste a list'}
              aria-label="Add a stock or index" role="combobox" aria-expanded={open && hits.length > 0} aria-controls="pick-list"
              onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,]/.test(t.trim())) { e.preventDefault(); add(t.split(/[\s,;]+/)); } }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, hits.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
                else if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  if (hits[at]) add([hits[at].symbol]);
                  else if (q.trim()) add(q.split(/[\s,;]+/));
                } else if (e.key === 'Backspace' && !q && symbols.length) remove(symbols[symbols.length - 1]);
                else if (e.key === 'Escape') setOpen(false);
              }}
              className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none" />
          </span>
        </div>
        {open && hits.length > 0 && (
          <ul id="pick-list" role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 max-h-[300px] overflow-y-auto rounded-[12px] border border-line bg-panel p-1 shadow-[var(--shadow-pop)]">
            {hits.map((h, i) => (
              <li key={h.symbol} role="option" aria-selected={i === at}>
                <button type="button" onMouseEnter={() => setAt(i)} onClick={() => add([h.symbol])}
                  className={`flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left ${i === at ? 'bg-raised' : ''}`}>
                  <span className="text-[13.5px] font-semibold">{NAME.get(h.symbol) ?? h.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{h.name}</span>
                  <span className="text-[11px] font-semibold text-muted">{h.kind === 'INDEX' ? 'Index' : 'Stock'}</span>
                  {symbols.includes(h.symbol) && <span className="text-[11px] font-semibold text-up">Added</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12.5px] text-muted">Indices:</span>
        {TEST_INDICES.map((i) => {
          const on = symbols.includes(i.symbol);
          return (
            <button key={i.symbol} type="button" onClick={() => (on ? remove(i.symbol) : add([i.symbol]))} aria-pressed={on}
              className={`inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12.5px] font-semibold ${on ? 'bg-inverse text-on-inverse' : 'border border-line-strong text-ink-2 hover:text-ink'}`}>
              {!on && <Plus size={12} aria-hidden="true" />}{i.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
