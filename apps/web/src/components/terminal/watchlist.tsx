'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Quote } from '@mtv/shared';
import { fmt } from '@/lib/format';

/** Live watchlist. Prices flash green/red when they tick, as on TradingView. */
export function Watchlist({ symbols, quotes, active, onSelect, onAdd, onRemove }: {
  symbols: string[];
  quotes: Record<string, Quote>;
  active: string;
  onSelect: (s: string) => void;
  onAdd: () => void;
  onRemove: (s: string) => void;
}) {
  const last = useRef<Record<string, number>>({});
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({});

  useEffect(() => {
    const next: Record<string, 'up' | 'down'> = {};
    for (const [s, q] of Object.entries(quotes)) {
      const prev = last.current[s];
      if (prev != null && q.ltp !== prev) next[s] = q.ltp > prev ? 'up' : 'down';
      last.current[s] = q.ltp;
    }
    if (!Object.keys(next).length) return;
    setFlash(next);
    const t = setTimeout(() => setFlash({}), 700);
    return () => clearTimeout(t);
  }, [quotes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-1 pb-1">
        <span className="eyebrow">Watchlist · {symbols.length}</span>
        <button type="button" onClick={onAdd} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-raised hover:text-ink">
          <Plus size={14} aria-hidden="true" /> Add
        </button>
      </div>
      <div className="grid grid-cols-[1fr_84px_64px_62px_18px] gap-1 px-4 py-1 text-right text-[10.5px] font-bold tracking-[0.05em] text-muted">
        <span className="text-left">SYMBOL</span><span>LAST</span><span>CHG</span><span>CHG%</span><span />
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {symbols.map((s) => {
          const q = quotes[s];
          const dir = flash[s];
          const tone = !q ? 'text-muted' : q.change >= 0 ? 'text-up' : 'text-down';
          const on = s === active;
          return (
            <li key={s} className="group">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(s)}
                className={`grid h-9 cursor-pointer grid-cols-[1fr_84px_64px_62px_18px] items-center gap-1 rounded-[10px] px-2.5 text-right text-[12.5px] ${on ? 'bg-ink text-white' : 'hover:bg-raised'}`}
              >
                <b className="truncate text-left font-bold">{s}</b>
                <span className={`num rounded px-0.5 ${dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''}`}>{q ? fmt(q.ltp) : '—'}</span>
                <span className={`num ${on && q ? (q.change >= 0 ? 'text-accent' : 'text-[#ff8a8a]') : tone}`}>{q ? (q.change >= 0 ? '+' : '') + fmt(q.change) : ''}</span>
                <span className={`num ${on && q ? (q.change >= 0 ? 'text-accent' : 'text-[#ff8a8a]') : tone}`}>{q ? (q.changePct >= 0 ? '+' : '') + fmt(q.changePct) + '%' : ''}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(s); }}
                  className="invisible grid place-items-center rounded text-muted group-hover:visible hover:text-down"
                  aria-label={`Remove ${s} from watchlist`}
                >
                  <X size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
