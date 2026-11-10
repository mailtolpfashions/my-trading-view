'use client';

import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { PULSE, useShell } from '@/components/app/shell-context';
import { InfoTip } from '@/components/info-tip';
import { SymbolSearch } from '@/components/terminal/symbol-search';
import { Segmented } from '@/components/ui';
import { DayCard } from '@/components/today/day-card';
import { MarketCard } from '@/components/today/market-card';
import { IndexTile, type TileCard } from '@/components/today/market-tiles';
import { MoodCard } from '@/components/today/mood-card';
import { MovingCard } from '@/components/today/moving-card';
import { OptionsCard } from '@/components/today/options-card';
import { FeedError, agoText, keepAnswer, useCloses, useFeed } from '@/lib/feed';
import { usePersisted } from '@/lib/persisted';
import { MODE_LABEL, MODE_TF, todayApi, type Brief, type Dashboard, type DaySettings } from '@/lib/today';

/**
 * Today, as one screen: the indices, the picked index with its levels, your day, the market's mood, the stocks moving
 * and the options picture. From lg up it fits the window and long lists scroll inside their card; below it stacks.
 */
export default function TodayPage() {
  // Each part shows the last picture this browser saw at once, then the fresh one (lib/feed.ts useFeed).
  const b = useFeed<Brief>('today', 60_000); // the live part moves during the session
  const d = useFeed<Dashboard>('dashboard', 300_000);
  const s = useFeed<DaySettings>('user/settings');
  const [savedSettings, setSavedSettings] = useState<DaySettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pick, setPick] = usePersisted<string>('mtv.today.index', 'NIFTY');
  // The six tiles are yours to choose: any index or stock, saved in this browser.
  const [tiles, setTiles] = usePersisted<string[]>('mtv.today.tiles', PULSE);
  const [editing, setEditing] = useState(false);
  const [slot, setSlot] = useState<number | null>(null); // the tile being changed (tiles.length = a new one)
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const { notify } = useShell();
  const { quotes } = useCloses(tiles);
  const brief = b.data, dash = d.data, settings = savedSettings ?? s.data;
  const cardFor = (sym: string): TileCard | undefined => {
    const c = dash?.indices?.find((i) => i.symbol === sym);
    if (c) return c;
    const q = quotes[sym];
    return q ? { symbol: sym, close: q.ltp, change: q.change, changePct: q.changePct } : undefined;
  };
  const putInSlot = (sym: string) => {
    if (slot == null) return;
    if (tiles.includes(sym)) { notify(`${sym} is already a tile`); return; }
    const next = [...tiles];
    next[slot] = sym;
    setTiles(next.slice(0, 6));
    setPick(sym);
  };
  const moveTile = (from: number, to: number) => {
    if (from === to) return;
    const next = [...tiles];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setTiles(next);
  };
  const reload = b.reload;

  // While the volume scan is still running, look again sooner than the regular minute.
  useEffect(() => {
    if (!brief?.volumeUpdating || b.stale) return;
    const t = setTimeout(reload, 10_000);
    return () => clearTimeout(t);
  }, [brief, b.stale, reload]);
  const saveSettings = async (p: Partial<DaySettings>) => {
    try {
      const next = await todayApi.saveSettings({ ...settings, ...p });
      setSavedSettings(next);
      keepAnswer('user/settings', next);
      setSaveError(null);
    } catch (e) { setSaveError(e instanceof FeedError ? e.message : 'Could not save'); }
  };
  const error = saveError ?? (brief ? null : b.error);

  const day = brief ? new Date(`${brief.today}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
  const liveFor = (sym: string) => {
    const c = dash?.indices?.find((i) => i.symbol === sym);
    const lv = brief?.indices.find((i) => i.symbol === sym)?.live;
    return lv && brief && c && c.date < brief.today ? lv : null;
  };
  const vixNote = brief?.vix ? (brief.vix.percentile < 30 ? 'VIX is calm for the past year' : brief.vix.percentile > 70 ? 'VIX is high for the past year' : 'VIX is normal for the past year') : undefined;
  const optPick = brief?.options?.some((o) => o.underlying === pick) ? pick : 'NIFTY';
  const priceOf = (sym: string) => brief?.indices.find((i) => i.symbol === sym)?.live?.ltp ?? dash?.indices?.find((i) => i.symbol === sym)?.close ?? null;

  return (
    <div className="grid gap-4 lg:h-[calc(100dvh-6.5rem-2px)] lg:min-h-[740px] lg:grid-rows-[auto_auto_minmax(0,1fr)_minmax(0,1fr)]">
      {/* The day, and the mode */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">
            {brief ? `${brief.greeting}${brief.name ? `, ${brief.name.split(' ')[0]}` : ''}.` : 'Today'}
          </h1>
          <p className="text-[13.5px] text-ink-2">
            {day}{brief ? ` · ${brief.market.text}` : ''}
            {brief && b.at && <Freshness at={b.at} stale={b.stale} error={b.error} />}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Choosing the tiles */}
          {editing && <span className="hidden text-[12.5px] text-muted xl:inline">Click a tile to change it, drag to reorder, × to remove</span>}
          {editing && (
            <button type="button" onClick={() => { setTiles(PULSE); setPick('NIFTY'); }} title="Back to the six indices"
              className="flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><RotateCcw size={13} /> Reset</button>
          )}
          <button type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing}
            className={`flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold ${editing ? 'bg-accent text-accent-ink hover:bg-accent-hover' : 'text-ink-2 hover:bg-raised hover:text-ink'}`}>
            {editing ? <><Check size={14} /> Done</> : <><Pencil size={13} /> Edit tiles</>}
          </button>
        {settings && !editing && (
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-ink-2 sm:inline">Today I&apos;m trading</span>
            <Segmented label="Mode" value={settings.mode} onChange={(m) => saveSettings({ mode: m })}
              options={[{ value: 'intraday', label: 'Intraday' }, { value: 'swing', label: 'Swing' }, { value: 'positional', label: 'Positional' }]} />
            <InfoTip label="What the mode changes">
              <p>The Scanner lists the ready-made scans for {MODE_LABEL[settings.mode].toLowerCase()} trading first, and an unsaved scan moves to {MODE_TF[settings.mode].screenWords} bars.</p>
              <p>Charts open on {MODE_TF[settings.mode].chartWords} bars.</p>
              <p>This happens once when you switch; your own choices on those pages stay until you switch again.</p>
            </InfoTip>
          </div>
        )}
        </div>
      </div>

      {/* Your six tiles: click one to see it in the Market card; Edit to choose them */}
      <section aria-label="Tiles">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {tiles.map((sym, i) => {
            const c = cardFor(sym);
            return (
              <div key={sym} className={`relative ${dragFrom === i ? 'opacity-50' : ''}`} draggable={editing}
                onDragStart={() => setDragFrom(i)} onDragOver={(e) => { if (dragFrom != null) { e.preventDefault(); moveTile(dragFrom, i); setDragFrom(i); } }} onDragEnd={() => setDragFrom(null)}>
                {c ? <IndexTile c={c} live={liveFor(sym)} selected={sym === pick} editing={editing} onSelect={() => (editing ? setSlot(i) : setPick(sym))} />
                  : <button type="button" onClick={() => editing && setSlot(i)} className="panel h-full min-h-[84px] w-full animate-pulse p-3.5 text-left text-[13px] font-semibold text-muted">{sym}</button>}
                {editing && tiles.length > 1 && (
                  <button type="button" onClick={() => { const rest = tiles.filter((t) => t !== sym); setTiles(rest); if (pick === sym) setPick(rest[0]); }} aria-label={`Remove ${sym} tile`} title="Remove this tile"
                    className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-down text-white shadow-[var(--shadow-panel)] hover:scale-110"><X size={13} /></button>
                )}
              </div>
            );
          })}
          {editing && tiles.length < 6 && (
            <button type="button" onClick={() => setSlot(tiles.length)} className="grid min-h-[84px] place-items-center rounded-[var(--radius-panel)] border-2 border-dashed border-line-strong text-[13px] font-semibold text-ink-2 hover:border-accent hover:text-accent-deep">
              <span className="flex items-center gap-1.5"><Plus size={15} /> Add a tile</span>
            </button>
          )}
        </div>
      </section>
      <SymbolSearch open={slot != null} onClose={() => setSlot(null)} title={slot != null && slot < tiles.length ? `Replace ${tiles[slot]}` : 'Add a tile'}
        onPick={(i) => { putInSlot(i.symbol); setSlot(null); }} />

      {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down lg:hidden">{error}</p>}

      {!brief ? (
        <div className="grid gap-4 lg:row-span-2 lg:grid-cols-3">
          {error ? <p role="alert" className="panel col-span-full hidden p-5 text-[14px] text-down lg:block">{error}</p>
            : Array.from({ length: 3 }, (_, i) => <div key={i} className="panel min-h-[220px] animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid min-h-0 gap-4 lg:grid-cols-3">
            <div className="grid min-h-0 lg:col-span-2">
              <MarketCard symbol={pick} x={brief.indices.find((i) => i.symbol === pick)} card={cardFor(pick)}
                live={liveFor(pick)} note={pick === 'INDIAVIX' ? vixNote : undefined} sessionLive={brief.live} />
            </div>
            <DayCard brief={brief} settings={settings} onSave={saveSettings} />
          </div>
          <div className="grid min-h-0 gap-4 lg:grid-cols-3">
            <MoodCard breadth={dash?.nifty500?.breadth} sectors={brief.sectors} fii={dash?.fii ?? null} fpi={dash?.fpi ?? null} />
            <MovingCard gainers={dash?.nifty50?.gainers} losers={dash?.nifty50?.losers} spikes={brief.volumeSpikes} scanning={brief.volumeUpdating} />
            <OptionsCard options={brief.options} pick={optPick} onPick={setPick} price={priceOf} />
          </div>
        </>
      )}
    </div>
  );
}

/** How fresh the shown picture is: a quiet note, never a blocker. */
function Freshness({ at, stale, error }: { at: number; stale: boolean; error: string | null }) {
  const ago = agoText(at);
  const text = !stale ? ` · updated ${ago}` : error ? ` · showing the picture from ${ago}. ${error}` : ` · showing the picture from ${ago}, updating…`;
  return <span className={error ? 'text-down' : 'text-muted'}>{text}</span>;
}
