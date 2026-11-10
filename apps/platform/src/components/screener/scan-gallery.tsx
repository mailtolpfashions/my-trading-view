'use client';

import { useState } from 'react';
import { ChevronDown, Copy, Star, Trash2 } from 'lucide-react';
import type { Meta, PresetEvidence } from '@/lib/screener';
import type { TradingMode } from '@/lib/today';
import { ago, type SavedScreen } from '@/lib/user';

type Show = 'all' | 'intraday' | 'swing' | 'positional' | 'saved';
const TF_WORD: Record<string, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly', '1m': '1 min', '3m': '3 min', '5m': '5 min', '15m': '15 min', '30m': '30 min', '1h': '1 hour', '2h': '2 hours', '4h': '4 hours' };
const SHOW_WORD: Record<Show, string> = { all: 'All', intraday: 'Intraday', swing: 'Swing', positional: 'Positional', saved: 'Saved' };
/** Tiles fill the row: as many 250px-wide columns as fit. */
const GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]';
const TILE = 'panel flex h-full w-full flex-col gap-2 p-4 text-left transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] motion-reduce:transform-none';

/**
 * One line from the preset's test on NSE history: did stocks that matched do better than the average stock over the
 * preset's own horizon, and in how many years (months for intraday)? "Edge" needs the right sign, a t of 2 or more
 * and at least two thirds of the periods; "worse" is the same the other way; anything else is "no clear edge".
 */
export function verdictOf(e?: PresetEvidence | null) {
  if (!e) return { word: 'Not tested yet', tone: 'bg-line-strong', line: '', detail: 'Not tested on NSE history yet.' };
  if (e.neutral) return { word: 'No direction', tone: 'bg-line-strong', line: '', detail: 'A pattern of indecision: it says neither up nor down, so there is no direction to test.' };
  const dir = e.bearish ? -1 : 1, share = e.periods ? e.better / e.periods : 0;
  // When the typical match is known (patterns), it must lean the same way: a few huge moves can carry an average alone.
  const typicalOk = (want: 1 | -1) => e.median == null || want * dir * e.median > 0;
  const edge = dir * e.excess > 0 && Math.abs(e.t) >= 2 && share >= 2 / 3 && typicalOk(1);
  const worse = dir * e.excess < 0 && Math.abs(e.t) >= 2 && share <= 1 / 3 && typicalOk(-1);
  const pct = `${e.excess >= 0 ? '+' : '−'}${Math.abs(e.excess * 100).toFixed(2)}%`;
  return {
    word: edge ? 'Edge in tests' : worse ? 'Worse than average' : 'No clear edge',
    tone: edge ? 'bg-up' : worse ? 'bg-down' : 'bg-muted',
    line: `${pct} vs the average stock over ${e.horizon} · better in ${e.better} of ${e.periods} ${e.period}`,
    detail: `${e.signals.toLocaleString('en-IN')} matches, ${e.from} to ${e.to}. After a match the stock moved ${(e.stock * 100).toFixed(2)}% over ${e.horizon}; the average liquid stock moved ${(e.crowd * 100).toFixed(2)}% over the same window. ${e.median != null ? `The typical match was ${(e.median * 100).toFixed(2)}% against the typical stock. ` : ''}${e.bearish ? 'A bearish one works when the stock lags. ' : ''}A match counts on every day it holds, so treat the t value (${e.t.toFixed(1)}) as rough. Costs not included.`,
  };
}

/** The tested result in one line, with the full numbers on hover. */
export function Tested({ e }: { e?: PresetEvidence | null }) {
  const v = verdictOf(e);
  return (
    <span className="flex items-start gap-1.5 text-[12.5px] text-ink-2" title={v.detail}>
      <i className={`mt-[6px] inline-block h-2 w-2 shrink-0 rounded-full ${v.tone}`} aria-hidden="true" />
      <span><b className="font-semibold">{v.word}</b>{v.line && ` · ${v.line}`}</span>
    </span>
  );
}

/**
 * Every scan as a tile, under the Scanner's sentence: the owner's saved scans first, then the ready-made ones with
 * their tested result. One centred row of chips picks a trading style. A click opens the scan and runs it; the tiles
 * fold away once results show.
 */
export function ScanGallery({ open, onToggle, mode, meta, screens, activeId, activePreset, onPreset, onOpen, onFavourite, onDuplicate, onDelete }: {
  open: boolean; onToggle: () => void;
  mode: TradingMode | null; meta: Meta | null; screens: SavedScreen[] | null; activeId?: string; activePreset?: string | null;
  onPreset: (p: Meta['presets'][number]) => void; onOpen: (s: SavedScreen) => void; onFavourite: (s: SavedScreen) => void;
  onDuplicate: (s: SavedScreen) => void; onDelete: (s: SavedScreen) => void;
}) {
  const [picked, setPicked] = useState<Show | null>(null); // null = the trading mode's style, or all
  const presets = meta?.presets ?? [];
  const saved = screens ?? [];
  const choices: Show[] = ['all', ...(['intraday', 'swing', 'positional'] as const).filter((h) => presets.some((p) => p.horizon === h)), ...(saved.length ? ['saved' as const] : [])];
  const show: Show = picked && choices.includes(picked) ? picked : mode && choices.includes(mode) ? mode : 'all';
  const presetTiles = show === 'saved' ? [] : presets.filter((p) => show === 'all' || p.horizon === show);
  const savedTiles = show === 'all' || show === 'saved' ? saved : [];

  return (
    <section className="grid gap-4" aria-label="Scans">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span />
        {open ? (
          <div role="radiogroup" aria-label="Trading style" className="flex flex-wrap justify-center gap-1.5">
            {choices.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={show === v} onClick={() => setPicked(v)}
                className={`h-9 rounded-full px-4 text-[13px] font-semibold ${show === v ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-panel text-ink-2 hover:text-ink'}`}>
                {SHOW_WORD[v]}{v === 'saved' ? ` · ${saved.length}` : ''}
              </button>
            ))}
          </div>
        ) : <span />}
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex h-9 items-center gap-1 justify-self-end rounded-[12px] px-2.5 text-[13px] font-semibold text-accent-deep hover:bg-raised">
          {open ? 'Hide scans' : 'Show scans'} <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
        </button>
      </div>

      {open && (
        <div className={GRID}>
          {!meta && Array.from({ length: 8 }, (_, i) => <div key={i} className="panel h-[132px] animate-pulse" aria-hidden="true" />)}

          {savedTiles.map((s) => {
            const last = s.runs[0];
            return (
              <div key={s.id} className={`group relative ${s.id === activeId ? '[&>button]:ring-2 [&>button]:ring-accent' : ''}`}>
                <button type="button" onClick={() => onOpen(s)} title={s.formula} className={TILE}>
                  <span className="flex items-center gap-1.5 pr-[84px] text-[11.5px] font-semibold text-accent-deep">
                    Saved <span className="rounded-full bg-raised px-2 py-0.5 text-muted">{TF_WORD[s.tf] ?? s.tf}</span>
                  </span>
                  <span className="text-[15px] font-semibold leading-snug text-ink">{s.name}</span>
                  <span className="mt-auto text-[12px] text-muted">{last ? `Ran ${ago(last.at)}: ${last.matches.toLocaleString('en-IN')} matches` : 'Not run yet'}</span>
                </button>
                <div className="absolute right-2 top-2 flex">
                  <button type="button" onClick={() => onFavourite(s)} aria-label={s.favourite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={s.favourite}
                    className="grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-raised hover:text-accent-deep">
                    <Star size={15} fill={s.favourite ? 'var(--color-accent)' : 'none'} className={s.favourite ? 'text-accent' : ''} />
                  </button>
                  <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    <button type="button" onClick={() => onDuplicate(s)} aria-label={`Duplicate ${s.name}`} title="Duplicate" className="grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-raised hover:text-ink"><Copy size={14} /></button>
                    <button type="button" onClick={() => onDelete(s)} aria-label={`Delete ${s.name}`} title="Delete" className="grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-raised hover:text-down"><Trash2 size={14} /></button>
                  </span>
                </div>
              </div>
            );
          })}

          {presetTiles.map((p) => {
            const v = verdictOf(p.evidence);
            const active = activePreset === p.id;
            return (
              <button key={p.id} type="button" onClick={() => onPreset(p)} aria-current={active ? 'true' : undefined}
                title={`${v.word}${v.line ? `: ${v.line}` : ''}\n\n${v.detail}`} className={`${TILE} ${active ? 'ring-2 ring-accent' : ''}`}>
                <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-2">
                  <i className={`inline-block h-2 w-2 shrink-0 rounded-full ${v.tone}`} aria-hidden="true" /> {v.word}
                  <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-muted">{TF_WORD[p.tf] ?? p.tf}</span>
                </span>
                <span className="text-[15px] font-semibold leading-snug text-ink">{p.name}</span>
                <span className="line-clamp-2 text-[12.5px] leading-relaxed text-muted">{p.about}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
