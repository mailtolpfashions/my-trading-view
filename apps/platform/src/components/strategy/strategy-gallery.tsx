'use client';

import { useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { TEMPLATES, type SavedStrategy, type Template } from '@/lib/strategy';
import { ago } from '@/lib/user';

type Show = 'all' | 'intraday' | 'swing' | 'positional' | 'saved';
const WORD: Record<Show, string> = { all: 'All', intraday: 'Intraday', swing: 'Swing', positional: 'Positional', saved: 'Saved' };
const GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]';
const TILE = 'panel flex h-full w-full flex-col gap-2 p-4 text-left transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] motion-reduce:transform-none';
const styleOf = (s: SavedStrategy) => (s.strategy.tf && ['1m', '5m', '15m', '1h'].includes(s.strategy.tf) ? 'intraday' : s.strategy.style ?? 'swing');

/**
 * Every strategy as a tile, under the editor (like the Scanner): saved ones first, then the templates. One centred row
 * of chips picks a style. A click opens the strategy in the editor; the tiles fold away once a backtest runs.
 */
export function StrategyGallery({ open, onToggle, list, activeId, onTemplate, onOpen, onDelete }: {
  open: boolean; onToggle: () => void; list: SavedStrategy[] | null; activeId?: string;
  onTemplate: (t: Template) => void; onOpen: (s: SavedStrategy) => void; onDelete: (s: SavedStrategy) => void;
}) {
  const [picked, setPicked] = useState<Show>('all');
  const saved = list ?? [];
  const choices: Show[] = ['all', ...(['intraday', 'swing', 'positional'] as const).filter((h) => TEMPLATES.some((t) => t.style === h) || saved.some((s) => styleOf(s) === h)), ...(saved.length ? ['saved' as const] : [])];
  const show = choices.includes(picked) ? picked : 'all';
  const savedTiles = show === 'all' || show === 'saved' ? saved : saved.filter((s) => styleOf(s) === show);
  const templates = show === 'saved' ? [] : TEMPLATES.filter((t) => show === 'all' || t.style === show);

  return (
    <section className="grid gap-4" aria-label="Strategies">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span />
        {open ? (
          <div role="radiogroup" aria-label="Style" className="flex flex-wrap justify-center gap-1.5">
            {choices.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={show === v} onClick={() => setPicked(v)}
                className={`h-9 rounded-full px-4 text-[13px] font-semibold ${show === v ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-panel text-ink-2 hover:text-ink'}`}>
                {WORD[v]}{v === 'saved' ? ` · ${saved.length}` : ''}
              </button>
            ))}
          </div>
        ) : <span />}
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex h-9 items-center gap-1 justify-self-end rounded-[12px] px-2.5 text-[13px] font-semibold text-accent-deep hover:bg-raised">
          {open ? 'Hide strategies' : 'Show strategies'} <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
        </button>
      </div>

      {open && (
        <div className={GRID}>
          {savedTiles.map((x) => {
            const b = x.backtests[0];
            return (
              <div key={x.id} className={`group relative ${x.id === activeId ? '[&>button]:ring-2 [&>button]:ring-accent' : ''}`}>
                <button type="button" onClick={() => onOpen(x)} className={TILE}>
                  <span className="flex items-center gap-1.5 pr-8 text-[11.5px] font-semibold text-accent-deep">
                    Saved <span className="rounded-full bg-raised px-2 py-0.5 text-muted">{WORD[styleOf(x) as Show]}</span>
                  </span>
                  <span className="text-[15px] font-semibold leading-snug text-ink">{x.name}</span>
                  {x.description && <span className="line-clamp-2 text-[12.5px] leading-relaxed text-muted">{x.description}</span>}
                  <span className="mt-auto text-[12px] text-muted">
                    {b ? <>Tested {ago(b.at)}: <b className={b.returnPct >= 0 ? 'text-up' : 'text-down'}>{b.returnPct >= 0 ? '+' : ''}{b.returnPct.toFixed(1)}%</b>, max drop {b.maxDrawdownPct.toFixed(1)}%</> : 'Not tested yet'}
                  </span>
                </button>
                <button type="button" onClick={() => onDelete(x)} aria-label={`Delete ${x.name}`} title="Delete"
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-[8px] text-muted opacity-0 hover:bg-raised hover:text-down focus:opacity-100 group-hover:opacity-100"><Trash2 size={14} /></button>
              </div>
            );
          })}
          {templates.map((t) => (
            <button key={t.id} type="button" onClick={() => onTemplate(t)} className={TILE}>
              <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-2">
                Template <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-muted">{WORD[t.style]}</span>
              </span>
              <span className="text-[15px] font-semibold leading-snug text-ink">{t.name}</span>
              <span className="line-clamp-3 text-[12.5px] leading-relaxed text-muted">{t.about}</span>
            </button>
          ))}
          {!list && <div className="panel h-[132px] animate-pulse" aria-hidden="true" />}
        </div>
      )}
    </section>
  );
}
