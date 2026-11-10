'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { PATTERNS, patternLabel } from '@mtv/rules';
import { verdictOf } from '@/components/screener/scan-gallery';
import type { PatternMeta } from '@/lib/patterns';

const GROUPS = [['bullish', 'Bullish ▲'], ['bearish', 'Bearish ▼'], ['neutral', 'Neutral ●']] as const;

/**
 * The candlestick pattern list, like TradingView's: tick the patterns to mark on the chart. Each row shows how many
 * this chart has and, on its dot, how the pattern tested on NSE daily history.
 */
export function PatternPicker({ picked, onChange, meta, found }: {
  picked: string[]; onChange: (names: string[]) => void; meta: PatternMeta[] | null;
  /** How many of each picked pattern are on the chart now. */
  found: Map<string, number>;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const byName = new Map((meta ?? []).map((p) => [p.name, p]));
  const toggle = (name: string) => onChange(picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name]);

  return (
    <div className="absolute top-9 left-0 z-30 flex max-h-[min(560px,70dvh)] w-80 flex-col rounded-[14px] bg-panel text-[13px] whitespace-normal shadow-[var(--shadow-pop)]" role="dialog" aria-label="Candlestick patterns">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <label className="flex h-8 flex-1 items-center gap-2 rounded-[10px] border border-line-strong px-2.5">
          <Search size={14} className="text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patterns" aria-label="Search patterns" autoFocus className="w-full bg-transparent focus:outline-none" />
        </label>
        <button type="button" onClick={() => onChange([])} disabled={!picked.length} className="h-8 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-ink-2 hover:bg-raised disabled:opacity-40">Clear</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {GROUPS.map(([side, title]) => {
          const list = PATTERNS.filter((p) => p.side === side && (!needle || patternLabel(p.name).toLowerCase().includes(needle)));
          if (!list.length) return null;
          return (
            <div key={side}>
              <p className="eyebrow px-2 pt-2 pb-1">{title}</p>
              {list.map((p) => {
                const on = picked.includes(p.name);
                const v = verdictOf(byName.get(p.name)?.evidence);
                const n = found.get(p.name);
                return (
                  <label key={p.name} title={`${p.rule}\n\n${v.word}${v.line ? `: ${v.line}` : ''}. ${v.detail}`}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 ${on ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.name)} className="h-4 w-4 shrink-0 accent-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1 truncate">{patternLabel(p.name)}</span>
                    {on && n != null && <span className="num text-[11.5px] text-muted">{n} here</span>}
                    <i className={`inline-block h-2 w-2 shrink-0 rounded-full ${v.tone}`} aria-label={v.word} />
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11.5px] text-muted">
        Dot = how it tested on NSE daily candles: <i className="inline-block h-2 w-2 rounded-full bg-up" /> edge, <i className="inline-block h-2 w-2 rounded-full bg-muted" /> no clear edge, <i className="inline-block h-2 w-2 rounded-full bg-down" /> worse. Hover a row for the rule.
      </p>
    </div>
  );
}
