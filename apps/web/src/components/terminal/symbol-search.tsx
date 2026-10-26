'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Instrument } from '@mtv/shared';
import { searchSymbols } from '@/lib/feed';

/** TradingView-style symbol search dialog. Arrow keys move, Enter picks, Escape closes. */
export function SymbolSearch({ open, onClose, onPick, title = 'Symbol search' }: { open: boolean; onClose: () => void; onPick: (i: Instrument) => void; title?: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) { d.showModal(); setQ(''); }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => searchSymbols(q, ctrl.signal).then((r) => { setResults(r); setActive(0); }).catch(() => {}), 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const pick = (i?: Instrument) => { if (i) { onPick(i); onClose(); } };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[min(560px,94vw)] rounded-[18px] bg-panel p-0 shadow-[var(--shadow-pop)] backdrop:bg-ink/30"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close"><X size={18} /></button>
      </div>
      <label className="mx-5 flex h-11 items-center gap-2 rounded-full bg-raised px-4">
        <Search size={16} className="text-muted" aria-hidden="true" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter') pick(results[active]);
          }}
          placeholder="Search NSE stocks and indices: RELIANCE, NIFTY, Tata…"
          className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-muted"
          aria-label="Search symbols"
        />
      </label>
      <ul className="mt-3 max-h-[52vh] overflow-auto border-t border-line py-1" role="listbox">
        {results.map((r, idx) => (
          <li key={`${r.exchange}:${r.symbol}`} role="option" aria-selected={idx === active}>
            <button
              type="button"
              onMouseEnter={() => setActive(idx)}
              onClick={() => pick(r)}
              className={`grid w-full grid-cols-[150px_1fr_auto] items-center gap-3 px-5 py-2.5 text-left ${idx === active ? 'bg-raised' : ''}`}
            >
              <b className="font-bold">{r.symbol}</b>
              <span className="truncate text-[13.5px] text-ink-2">{r.name}</span>
              <span className="text-[11.5px] font-semibold text-muted">{r.kind === 'INDEX' ? 'INDEX' : r.exchange}</span>
            </button>
          </li>
        ))}
        {!results.length && <li className="px-5 py-6 text-center text-muted">No matches</li>}
      </ul>
    </dialog>
  );
}
