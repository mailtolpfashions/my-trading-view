'use client';

import { useState } from 'react';
import { Copy, Search, Star, Trash2 } from 'lucide-react';
import type { Meta } from '@/lib/screener';
import { CATEGORIES, ago, type Category, type RecentRun, type SavedScreen } from '@/lib/user';
import { Card } from '../ui';

type Tab = 'ready' | 'mine' | 'recent';
const TF_WORD: Record<string, string> = { D: 'Daily', W: 'Weekly', M: 'Monthly' };
const conditionCount = (f: string) => f.split(/\b(?:AND|OR)\b/).length;

/** Ready-made screens by category, the owner's saved screens, and recently run ones. */
export function LibraryPanel({ meta, screens, recent, activeId, onPreset, onOpen, onFavourite, onDuplicate, onDelete, onRecent }: {
  meta: Meta | null; screens: SavedScreen[] | null; recent: RecentRun[] | null; activeId?: string;
  onPreset: (p: Meta['presets'][number]) => void; onOpen: (s: SavedScreen) => void; onFavourite: (s: SavedScreen) => void;
  onDuplicate: (s: SavedScreen) => void; onDelete: (s: SavedScreen) => void; onRecent: (r: RecentRun) => void;
}) {
  const [tab, setTab] = useState<Tab>('ready');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category>('technical');
  const [favOnly, setFavOnly] = useState(false);
  const needle = q.trim().toLowerCase();
  const hit = (...s: (string | undefined)[]) => !needle || s.some((x) => x?.toLowerCase().includes(needle));

  return (
    <Card className="h-fit xl:sticky xl:top-24">
      <div role="tablist" aria-label="Screens" className="mb-4 grid grid-cols-3 rounded-[12px] border border-line-strong bg-raised p-1">
        {([['ready', 'Ready-made'], ['mine', 'My screens'], ['recent', 'Recent']] as const).map(([v, l]) => (
          <button key={v} role="tab" type="button" aria-selected={tab === v} onClick={() => setTab(v)}
            className={`h-8 rounded-[9px] text-[13px] font-semibold ${tab === v ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {tab !== 'recent' && (
        <label className="mb-3 flex h-10 items-center gap-2 rounded-[12px] border border-line-strong bg-panel px-3">
          <Search size={15} className="text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search screens" aria-label="Search screens" className="w-full bg-transparent text-[14px] focus:outline-none" />
        </label>
      )}

      {tab === 'ready' && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const n = meta?.presets.filter((p) => p.category === c.value).length ?? 0;
              return (
                <button key={c.value} type="button" onClick={() => setCat(c.value)} aria-pressed={cat === c.value}
                  className={`h-7 rounded-full px-3 text-[12.5px] font-semibold ${cat === c.value ? 'bg-inverse text-on-inverse' : 'border border-line-strong text-ink-2 hover:text-ink'}`}>
                  {c.label}{n ? ` ${n}` : ''}
                </button>
              );
            })}
          </div>
          <ul className="grid max-h-[62vh] gap-1 overflow-y-auto">
            {!meta && <li className="text-[13px] text-muted">Loading…</li>}
            {meta?.presets.filter((p) => p.category === cat && hit(p.name, p.about)).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPreset(p)} className="w-full rounded-[10px] px-2.5 py-2 text-left hover:bg-raised">
                  <span className="block text-[14px] font-medium text-ink">{p.name}</span>
                  <span className="line-clamp-2 block text-[12px] text-muted">{p.about}</span>
                </button>
              </li>
            ))}
            {cat === 'fundamental' && <li className="px-2.5 text-[13px] text-muted">Fundamental screens arrive with company financials (NSE / BSE filings) in a later step.</li>}
            {cat === 'fno' && <li className="px-2.5 text-[13px] text-muted">F&amp;O screens (OI build-up, IV, PCR) arrive in a later step.</li>}
            {cat === 'custom' && <li className="px-2.5 text-[13px] text-muted">Custom screens mix categories. Build one on the right and save it.</li>}
          </ul>
        </>
      )}

      {tab === 'mine' && (
        <>
          <label className="mb-2 flex items-center gap-2 px-1 text-[13px] text-ink-2">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} className="accent-[var(--color-accent)]" /> Favourites only
          </label>
          <ul className="grid max-h-[62vh] gap-1 overflow-y-auto">
            {!screens && <li className="text-[13px] text-muted">Loading…</li>}
            {screens?.length === 0 && <li className="px-1 text-[13px] text-muted">No saved screens yet. Build one and press Save.</li>}
            {screens?.filter((s) => (!favOnly || s.favourite) && hit(s.name, s.formula)).map((s) => {
              const last = s.runs[0];
              return (
                <li key={s.id} className={`group flex items-start gap-1 rounded-[10px] pr-1 ${s.id === activeId ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
                  <button type="button" onClick={() => onFavourite(s)} aria-label={s.favourite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={s.favourite}
                    className="mt-2 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted hover:text-accent-deep">
                    <Star size={15} fill={s.favourite ? 'var(--color-accent)' : 'none'} className={s.favourite ? 'text-accent' : ''} />
                  </button>
                  <button type="button" onClick={() => onOpen(s)} className="min-w-0 flex-1 py-2 text-left">
                    <span className="block truncate text-[14px] font-medium text-ink">{s.name}</span>
                    <span className="block text-[12px] text-muted">
                      {CATEGORIES.find((c) => c.value === s.category)?.label} · {TF_WORD[s.tf]} · {conditionCount(s.formula)} condition{conditionCount(s.formula) === 1 ? '' : 's'}
                    </span>
                    <span className="block text-[12px] text-muted">{last ? `Ran ${ago(last.at)}: ${last.matches.toLocaleString('en-IN')} matches` : 'Not run yet'}</span>
                  </button>
                  <div className="mt-2 flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    <button type="button" onClick={() => onDuplicate(s)} aria-label={`Duplicate ${s.name}`} title="Duplicate" className="grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-panel hover:text-ink"><Copy size={14} /></button>
                    <button type="button" onClick={() => onDelete(s)} aria-label={`Delete ${s.name}`} title="Delete" className="grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-panel hover:text-down"><Trash2 size={14} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'recent' && (
        <ul className="grid max-h-[68vh] gap-1 overflow-y-auto">
          {!recent && <li className="text-[13px] text-muted">Loading…</li>}
          {recent?.length === 0 && <li className="px-1 text-[13px] text-muted">Screens you run appear here.</li>}
          {recent?.map((r, i) => (
            <li key={`${r.at}-${i}`}>
              <button type="button" onClick={() => onRecent(r)} title={r.formula} className="w-full rounded-[10px] px-2.5 py-2 text-left hover:bg-raised">
                <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
                <span className="block text-[12px] text-muted">{ago(r.at)} · {TF_WORD[r.tf]} · {r.matches.toLocaleString('en-IN')} of {r.scanned.toLocaleString('en-IN')} matched</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
