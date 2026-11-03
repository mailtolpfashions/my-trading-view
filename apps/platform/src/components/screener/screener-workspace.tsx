'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eraser, FilePlus2, Play, Redo2, Save, Undo2 } from 'lucide-react';
import { isIntraday, type Tf } from '@mtv/rules';
import { fromTree, group, toTree, type Group } from '@/lib/builder';
import { FeedError, feed } from '@/lib/feed';
import { NEW_SCREEN, type Meta, type Screen, type ScreenResult } from '@/lib/screener';
import { CATEGORIES, userApi, type Category, type RecentRun, type SavedScreen, type Watchlist } from '@/lib/user';
import { InfoTip } from '../info-tip';
import { Button, Card, Segmented, inputCls } from '../ui';
import { FormulaEditor, useFormula } from './formula-editor';
import { LibraryPanel } from './library-panel';
import { ResultsTable } from './results-table';
import { TreeBuilder } from './tree-builder';
import { UniversePicker } from './universe-picker';
import { TimeframeSelect } from '../timeframe-select';

const DRAFT_KEY = 'platform.screener.draft';
/** What decides "unsaved changes": everything the user edits, not the id. */
const snapshot = (s: Screen) => JSON.stringify({ ...s, id: undefined });

export function ScreenerWorkspace() {
  const params = useSearchParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(NEW_SCREEN);
  const [saved, setSaved] = useState<string | null>(null); // snapshot of the saved version
  const [view, setView] = useState<'builder' | 'formula'>('builder');
  const [tree, setTree] = useState<Group>(() => toTree(NEW_SCREEN.formula)!);
  const [hist, setHist] = useState<{ past: Group[]; future: Group[] }>({ past: [], future: [] });
  const lastEdit = useRef<{ key?: string; at: number }>({ at: 0 });
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [screens, setScreens] = useState<SavedScreen[] | null>(null);
  const [recent, setRecent] = useState<RecentRun[] | null>(null);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);

  const refreshLibrary = useCallback(() => {
    userApi.screens().then(setScreens, (e: Error) => setLoadError(e.message));
    userApi.recent().then(setRecent, () => setRecent([]));
    userApi.watchlists().then(setWatchlists, () => {});
  }, []);

  // ---- loading a screen into the editor ----
  const load = useCallback((s: Screen, savedVersion: string | null) => {
    setScreen(s);
    setSaved(savedVersion);
    const t = toTree(s.formula);
    setTree(t ?? group());
    setView(t ? 'builder' : 'formula');
    setHist({ past: [], future: [] });
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    let draft: Screen | null = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { /* ignore a broken draft */ }
    const base: Screen = draft?.formula != null ? { ...NEW_SCREEN, ...draft } : NEW_SCREEN;
    const wl = params.get('watchlist');
    load(wl ? { ...base, id: undefined, name: 'Untitled screen', universe: { kind: 'watchlist', id: wl } } : base, null);
    feed<Meta>('screener/meta').then(setMeta, (e: Error) => setLoadError(e.message));
    refreshLibrary();
  }, [load, params, refreshLibrary]);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(screen)); } catch { /* storage blocked */ } }, [screen]);
  // A draft that belongs to a saved screen knows its saved version once the library arrives.
  useEffect(() => {
    if (saved == null && screen.id && screens) {
      const s = screens.find((x) => x.id === screen.id);
      if (s) setSaved(snapshot(fromSaved(s)));
    }
  }, [screens, screen.id, saved]);

  const update = (p: Partial<Screen>) => setScreen((s) => ({ ...s, ...p }));
  const dirty = saved == null ? !!screen.id || screen.formula !== NEW_SCREEN.formula : snapshot(screen) !== saved;

  // ---- builder edits with undo / redo (typing in one field merges into one step) ----
  const commit = (next: Group, key?: string) => {
    const now = Date.now();
    const merge = key && key === lastEdit.current.key && now - lastEdit.current.at < 1500;
    lastEdit.current = { key, at: now };
    if (!merge) setHist((h) => ({ past: [...h.past, tree].slice(-100), future: [] }));
    setTree(next);
    update({ formula: fromTree(next) });
  };
  const undo = () => {
    if (!hist.past.length) return;
    const prev = hist.past[hist.past.length - 1];
    setHist({ past: hist.past.slice(0, -1), future: [tree, ...hist.future] });
    setTree(prev);
    update({ formula: fromTree(prev) });
    lastEdit.current = { at: 0 };
  };
  const redo = () => {
    if (!hist.future.length) return;
    const [next, ...rest] = hist.future;
    setHist({ past: [...hist.past, tree], future: rest });
    setTree(next);
    update({ formula: fromTree(next) });
    lastEdit.current = { at: 0 };
  };

  const parsed = useFormula(screen.formula);
  const canRun = !!parsed?.ok && parsed.type === 'bool' && !running;
  const treeable = useMemo(() => toTree(screen.formula) != null, [screen.formula]);
  const switchView = (v: 'builder' | 'formula') => {
    if (v === 'builder') {
      const t = toTree(screen.formula);
      if (!t) return;
      setHist((h) => ({ past: [...h.past, tree].slice(-100), future: [] }));
      setTree(t);
    }
    setView(v);
  };

  // ---- saving ----
  const save = async (asNew = false) => {
    setError(null);
    try {
      const s = await userApi.saveScreen({ ...screen, id: asNew ? undefined : screen.id, name: asNew && screen.id ? `${screen.name} (copy)` : screen.name });
      const next = fromSaved(s);
      setScreen(next);
      setSaved(snapshot(next));
      setNotice(asNew || !screen.id ? 'Saved to My screens' : 'Changes saved');
      setTimeout(() => setNotice(null), 2500);
      refreshLibrary();
    } catch (e) {
      setError(e instanceof FeedError ? e.message : 'Could not save the screen');
    }
  };
  const confirmLeave = () => !dirty || window.confirm('Your changes to this screen are not saved. Continue anyway?');

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await feed<ScreenResult>('screener/run', { formula: screen.formula, tf: screen.tf, candle: screen.candle, universe: screen.universe, filters: screen.filters, columns: screen.columns, screenId: screen.id, name: screen.name }));
      refreshLibrary();
    } catch (e) {
      setError(e instanceof FeedError ? e.message : 'The screen could not run. Is the data service running?');
    } finally {
      setRunning(false);
    }
  };

  // Intraday screens can re-run on their own, 5 seconds after each minute closes.
  const intradayScreen = isIntraday(screen.tf) || /[d+[mh]]/.test(screen.formula);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!auto || !intradayScreen) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { void runRef.current(); next(); }, 60_000 - (Date.now() % 60_000) + 5_000); };
    next();
    return () => clearTimeout(t);
  }, [auto, intradayScreen]);

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <LibraryPanel meta={meta} screens={screens} recent={recent} activeId={screen.id}
        onPreset={(p) => confirmLeave() && load({ ...NEW_SCREEN, name: p.name, category: p.category as Category, formula: p.formula, tf: p.tf, universe: screen.universe, filters: screen.filters }, null)}
        onOpen={(s) => confirmLeave() && load(fromSaved(s), snapshot(fromSaved(s)))}
        onFavourite={(s) => userApi.favourite(s.id, !s.favourite).then(refreshLibrary, (e: Error) => setError(e.message))}
        onDuplicate={(s) => userApi.saveScreen({ ...fromSaved(s), id: undefined, name: `${s.name} (copy)` }).then(refreshLibrary, (e: Error) => setError(e.message))}
        onDelete={(s) => {
          if (!window.confirm(`Delete "${s.name}"? Its run history goes with it.`)) return;
          userApi.deleteScreen(s.id).then(() => {
            if (screen.id === s.id) { update({ id: undefined }); setSaved(null); }
            refreshLibrary();
          }, (e: Error) => setError(e.message));
        }}
        onRecent={(r) => {
          if (!confirmLeave()) return;
          const s = r.screenId ? screens?.find((x) => x.id === r.screenId) : undefined;
          if (s) load(fromSaved(s), snapshot(fromSaved(s)));
          else load({ ...NEW_SCREEN, name: r.name, formula: r.formula, tf: r.tf }, null);
        }} />

      <div className="grid min-w-0 gap-5">
        <Card title={
          <span className="flex min-w-0 items-center gap-3">
            <input value={screen.name} onChange={(e) => update({ name: e.target.value })} aria-label="Screen name"
              className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold tracking-[-0.01em] focus:outline-none" />
            {dirty && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-deep">Unsaved changes</span>}
            {notice && <span className="shrink-0 text-[12.5px] font-semibold text-up" role="status">{notice}</span>}
          </span>
        } actions={
          <>
            <select value={screen.category} onChange={(e) => update({ category: e.target.value as Category })} aria-label="Category" className={`${inputCls} h-9 pr-7 text-[13px]`}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <Button onClick={() => save(false)} disabled={!dirty && !!screen.id} title={screen.id ? 'Save changes to this screen' : 'Save to My screens'}><Save size={15} /> Save</Button>
            {screen.id && <Button variant="ghost" onClick={() => save(true)}>Save as new</Button>}
            <Button variant="ghost" onClick={() => confirmLeave() && load({ ...NEW_SCREEN, formula: '' }, null)} title="Start an empty screen"><FilePlus2 size={15} /> New</Button>
          </>
        }>
          {loadError && <p className="mb-3 rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{loadError}</p>}
          <div className="grid gap-5">
            <UniversePicker universe={screen.universe} filters={screen.filters} meta={meta} watchlists={watchlists} onChange={(universe, filters) => update({ universe, filters })} />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="eyebrow">Timeframe</span>
                <TimeframeSelect value={screen.tf} onChange={(tf) => update({ tf })} />
                <InfoTip label="About timeframes">
                  <p>This is the screen&apos;s own timeframe. Each condition can use another one: pick Weekly or Monthly next to it.</p>
                  <p>A weekly or monthly value on a given day comes from the week or month that contains that day, built from data up to that day, so a past day never sees later data.</p>
                  <p>Intraday timeframes (1 minute to 4 hours) use live Kite data for NIFTY 500 and F&amp;O stocks; connect Kite from the top bar.</p>
                </InfoTip>
              </div>
              <div className="flex items-center gap-2">
                <span className="eyebrow">Candle</span>
                <Segmented label="Candle" value={screen.candle} onChange={(candle) => update({ candle })}
                  options={[{ value: 'closed', label: 'Closed', title: 'Only completed bars: a signal is confirmed' }, { value: 'live', label: 'Live', title: 'Include the bar still forming: a match can change before it closes' }]} />
                <InfoTip label="Closed or live candle">
                  <p><b>Closed</b>: the newest bar is used only once it has closed, so a match is final.</p>
                  <p><b>Live</b>: the bar still forming is used as it stands (for example this week in a weekly screen). A match can appear and disappear until it closes.</p>
                </InfoTip>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented label="Editor" value={view} onChange={switchView}
                  options={[{ value: 'builder', label: 'Builder', title: treeable ? undefined : 'Fix the formula first' }, { value: 'formula', label: 'Formula' }]} />
                <span className="text-[12.5px] text-muted">Both edit the same screen.</span>
                {view === 'builder' && (
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" className="h-9 px-2.5" onClick={undo} disabled={!hist.past.length} aria-label="Undo" title="Undo"><Undo2 size={16} /></Button>
                    <Button variant="ghost" className="h-9 px-2.5" onClick={redo} disabled={!hist.future.length} aria-label="Redo" title="Redo"><Redo2 size={16} /></Button>
                    <Button variant="ghost" className="h-9 px-2.5" onClick={() => commit(group(tree.op))} disabled={!tree.children.length} title="Remove every condition"><Eraser size={16} /> Clear all</Button>
                  </div>
                )}
              </div>
              {view === 'builder'
                ? <TreeBuilder root={tree} meta={meta} screenTf={screen.tf} onChange={commit} />
                : <FormulaEditor value={screen.formula} onChange={(formula) => update({ formula })} meta={meta} />}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-line-strong pt-4">
              <Button variant="primary" onClick={run} disabled={!canRun} className="min-w-[150px]">
                <Play size={16} /> {running ? 'Running…' : 'Run screen'}
              </Button>
              {intradayScreen && (
                <label className="flex items-center gap-2 text-[13px] text-ink-2" title="Runs again 5 seconds after every minute closes">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[var(--color-accent)]" /> Refresh every minute
                </label>
              )}
              {parsed?.ok && parsed.type === 'bool' && <code className="min-w-0 flex-1 truncate text-[12.5px] text-muted" title={parsed.formula}>{parsed.formula}</code>}
              {!parsed && <span className="text-[13px] text-muted">Add a condition to run.</span>}
              {parsed && !parsed.ok && view === 'builder' && <span className="text-[13px] text-down">Finish or fix the condition marked in red.</span>}
            </div>
            {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
          </div>
        </Card>

        {result && (
          <Card title="Results">
            <ResultsTable result={result} columns={screen.columns} onColumns={(columns) => update({ columns })}
              watchlists={watchlists} onWatchlists={() => userApi.watchlists().then(setWatchlists, () => {})} />
          </Card>
        )}
      </div>
    </div>
  );
}

/** The editable part of a saved screen. */
function fromSaved(s: SavedScreen): Screen {
  return { id: s.id, name: s.name, category: s.category, formula: s.formula, tf: s.tf, candle: s.candle, universe: s.universe, filters: s.filters, columns: s.columns };
}
