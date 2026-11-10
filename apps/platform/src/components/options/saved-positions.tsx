'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react';
import { usePersisted } from '@/lib/persisted';
import { fmtDate, fmtStrike, type BuilderLeg } from '@/lib/options';

export type SavedPosition = { id: string; name: string; underlying: string; date: string; legs: BuilderLeg[]; savedAt: string };
const KEY = 'mtv.savedPositions';
const MAX = 40;

const describe = (legs: BuilderLeg[]) => legs.map((l) => `${l.side === 'BUY' ? 'B' : 'S'} ${l.lots > 1 ? `${l.lots}× ` : ''}${l.kind === 'FUT' ? `${fmtDate(l.expiry).slice(0, 6)} FUT` : `${fmtStrike(l.strikePaise)} ${l.kind}`}`).join(', ');

/**
 * Save the builder's position (underlying, day and legs at that day's prices) and load it again later. Kept in this
 * browser; up to 40 positions, newest first.
 */
export function SavedPositions({ underlying, date, legs, suggestedName, onLoad }: {
  underlying: string; date: string | null; legs: BuilderLeg[]; suggestedName: string; onLoad: (p: SavedPosition) => void;
}) {
  const [saved, setSaved] = usePersisted<SavedPosition[]>(KEY, []);
  const [open, setOpen] = useState<null | 'save' | 'list'>(null);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const save = () => {
    if (!date || !legs.length) return;
    const p: SavedPosition = { id: `${Date.now()}`, name: name.trim() || suggestedName, underlying, date, legs, savedAt: new Date().toISOString() };
    setSaved([p, ...saved].slice(0, MAX));
    setOpen(null);
  };
  const btn = 'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold';

  return (
    <div ref={box} className="relative flex items-center gap-1">
      {legs.length > 0 && (
        <button type="button" disabled={!date} onClick={() => { setName(suggestedName); setOpen(open === 'save' ? null : 'save'); }}
          className={`${btn} bg-up-soft text-up hover:bg-up hover:text-white disabled:opacity-40`} aria-expanded={open === 'save'}>
          <BookmarkPlus size={14} aria-hidden="true" /> Save
        </button>
      )}
      <button type="button" onClick={() => setOpen(open === 'list' ? null : 'list')} className={`${btn} bg-raised text-ink-2 hover:text-ink`} aria-expanded={open === 'list'}>
        <Bookmark size={14} aria-hidden="true" /> Saved{saved.length ? ` (${saved.length})` : ''}
      </button>
      {open === 'save' && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="absolute top-10 right-0 z-30 w-[300px] rounded-[14px] bg-panel p-3 shadow-[var(--shadow-pop)]">
          <label className="text-[12px] font-semibold text-ink-2">Name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              className="mt-1 h-9 w-full rounded-[10px] border border-line bg-panel px-2.5 text-[13px] text-ink outline-none focus:border-accent" />
          </label>
          <p className="mt-1.5 text-[11.5px] text-muted">{underlying} · {date ? fmtDate(date) : ''} · {describe(legs)}</p>
          <button type="submit" className="mt-2.5 h-8 w-full rounded-full bg-inverse text-[12.5px] font-bold text-on-inverse hover:bg-inverse-hover">Save in this browser</button>
        </form>
      )}
      {open === 'list' && (
        <div className="absolute top-10 right-0 z-30 max-h-[360px] w-[340px] overflow-y-auto rounded-[14px] bg-panel p-2 shadow-[var(--shadow-pop)]">
          {!saved.length && <p className="p-3 text-[12.5px] text-muted">Nothing saved yet. Build a position and click Save.</p>}
          {saved.map((p) => (
            <div key={p.id} className="group flex items-start gap-2 rounded-[10px] px-2 py-2 hover:bg-raised">
              <button type="button" onClick={() => { onLoad(p); setOpen(null); }} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                <span className="block truncate text-[11.5px] text-muted">{p.underlying} · {fmtDate(p.date)} · {describe(p.legs)}</span>
              </button>
              <button type="button" onClick={() => setSaved(saved.filter((x) => x.id !== p.id))} aria-label={`Delete ${p.name}`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-down-soft hover:text-down focus:opacity-100"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
