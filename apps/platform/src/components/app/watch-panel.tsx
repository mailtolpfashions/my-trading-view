'use client';

// The right-hand panel in the app frame, on every page: the watchlist and the Scanner (the Scanner page's scans). It
// collapses to a thin strip (remembered per browser; the W key toggles it). Below lg it opens as a drawer from the header.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronsLeft, ChevronsRight, GripVertical, ListOrdered, Plus, X } from 'lucide-react';
import { PULSE_NAMES, chartHref, useShell } from '@/components/app/shell-context';
import { InfoTip } from '@/components/info-tip';
import { fmt } from '@/lib/format';
import { fmtDate } from '@/lib/options';
import { RECENT_KEY, readPersisted, usePersisted } from '@/lib/persisted';
import { ScanPanel } from './scan-panel';

const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');

export function WatchPanel({ open, onToggle, drawer, onCloseDrawer }: { open: boolean; onToggle: () => void; drawer: boolean; onCloseDrawer: () => void }) {
  const { watch, setWatch, quotes, asOf, openSearch } = useShell();
  const [sort, setSort] = usePersisted<'mine' | 'change'>('mtv.watchSort', 'mine');
  const [tab, setTab] = usePersisted<'watch' | 'scan'>('mtv.panelTab', 'watch');
  const [drag, setDrag] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readPersisted<string[]>(RECENT_KEY, [])), []);

  const list = useMemo(() => (sort === 'change'
    ? [...watch].sort((a, b) => (quotes[b]?.changePct ?? -Infinity) - (quotes[a]?.changePct ?? -Infinity))
    : watch), [watch, quotes, sort]);
  const moveTo = (s: string, target: string) => {
    if (s === target) return;
    const next = watch.filter((w) => w !== s);
    next.splice(next.indexOf(target), 0, s);
    setWatch(next);
  };

  const close = drawer
    ? <button type="button" onClick={onCloseDrawer} aria-label="Close panel" className="grid h-8 w-8 place-items-center rounded-[9px] text-ink-2 hover:bg-raised"><X size={16} /></button>
    : <button type="button" onClick={onToggle} title="Hide panel (W)" aria-label="Hide panel" className="grid h-8 w-8 place-items-center rounded-[9px] text-ink-2 hover:bg-raised hover:text-ink"><ChevronsRight size={16} /></button>;
  const tabs = (
    <div className="flex items-center gap-1 border-b border-line px-2.5 py-2">
      <div role="tablist" aria-label="Panel" className="grid flex-1 grid-cols-2 rounded-[11px] bg-raised p-[3px]">
        {([['watch', `Watchlist · ${watch.length}`], ['scan', 'Scanner']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-8 rounded-[9px] text-[12.5px] font-semibold ${tab === k ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2 hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {close}
    </div>
  );

  const watchBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-dashed border-line-strong px-4 py-2">
        <InfoTip label="About these prices">Last NSE close{asOf ? ` (${fmtDate(asOf)})` : ''}. Drag a row to reorder it; press W to show or hide this panel.</InfoTip>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => setSort(sort === 'mine' ? 'change' : 'mine')} title={sort === 'mine' ? 'Sort by % change' : 'Back to my order'} aria-label={sort === 'mine' ? 'Sort by % change' : 'Back to my order'}
            className={`grid h-8 w-8 place-items-center rounded-[9px] ${sort === 'change' ? 'bg-accent-soft text-accent-deep' : 'text-ink-2 hover:bg-raised hover:text-ink'}`}><ListOrdered size={16} /></button>
          <button type="button" onClick={() => openSearch('watch')} title="Add a symbol" aria-label="Add a symbol"
            className="grid h-8 w-8 place-items-center rounded-[9px] text-accent-deep hover:bg-accent-soft"><Plus size={17} /></button>
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {list.map((s) => {
          const q = quotes[s];
          const canDrag = sort === 'mine';
          return (
            <li key={s} draggable={canDrag}
              onDragStart={(e) => { setDrag(s); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (drag) { e.preventDefault(); moveTo(drag, s); } }}
              onDragEnd={() => setDrag(null)}
              className={`group flex items-center gap-1.5 rounded-[10px] px-1.5 transition-colors hover:bg-raised ${drag === s ? 'opacity-50' : ''}`}>
              {canDrag && <GripVertical size={13} aria-hidden="true" className="shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100" />}
              <Link href={chartHref(s)} onClick={onCloseDrawer} className="flex min-w-0 flex-1 items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{PULSE_NAMES[s] ?? s}</span>
                <span className="num text-right leading-tight">
                  <span className="block text-[13px] font-semibold">{q ? fmt(q.ltp) : '—'}</span>
                  <span className={`block text-[11.5px] font-semibold ${tone(q?.changePct)}`}>{q ? `${q.changePct > 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : ''}</span>
                </span>
              </Link>
              <button type="button" onClick={() => setWatch(watch.filter((w) => w !== s))} aria-label={`Remove ${s} from watchlist`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted opacity-0 hover:text-down focus:opacity-100 group-hover:opacity-100"><X size={13} /></button>
            </li>
          );
        })}
        {!watch.length && <li className="px-2 py-6 text-center text-[13px] text-muted">Nothing here yet. Press + to add a symbol.</li>}
      </ul>
      {recent.length > 0 && (
        <div className="border-t border-dashed border-line-strong px-4 py-3">
          <p className="eyebrow mb-2">Recent charts</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.slice(0, 6).map((s) => <Link key={s} href={chartHref(s)} onClick={onCloseDrawer} className="rounded-full bg-raised px-2.5 py-1 text-[12px] font-semibold hover:bg-accent-soft hover:text-accent-deep">{PULSE_NAMES[s] ?? s}</Link>)}
          </div>
        </div>
      )}
    </div>
  );
  const body = (
    <div className="flex h-full min-h-0 flex-col">
      {tabs}
      <div className="min-h-0 flex-1">{tab === 'watch' ? watchBody : <ScanPanel watch={watch} onOpen={onCloseDrawer} />}</div>
    </div>
  );

  return (
    <>
      {/* Wide screens: a column beside the page */}
      <aside aria-label="Watchlist and scanner" className={`sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 border-l border-line bg-panel transition-[width] duration-200 motion-reduce:transition-none lg:block ${open ? 'w-[300px]' : 'w-11'}`}>
        {open ? body : (
          <button type="button" onClick={onToggle} title="Show panel (W)" aria-label="Show watchlist and scanner"
            className="flex h-full w-full flex-col items-center gap-3 pt-4 text-ink-2 hover:bg-raised hover:text-ink">
            <ChevronsLeft size={16} />
            <span className="text-[12px] font-semibold tracking-[0.06em] [writing-mode:vertical-rl]">Watchlist · {watch.length} · Scanner</span>
          </button>
        )}
      </aside>
      {/* Phones and tablets: a drawer from the header button */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close watchlist" onClick={onCloseDrawer} className="absolute inset-0 bg-scrim" />
          <aside aria-label="Watchlist" className="absolute top-0 right-0 bottom-0 w-[min(320px,88vw)] bg-panel shadow-[var(--shadow-pop)]">{body}</aside>
        </div>
      )}
    </>
  );
}
