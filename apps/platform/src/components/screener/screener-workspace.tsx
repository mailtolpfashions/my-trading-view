'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bell, ChevronDown, Eraser, FilePlus2, FlaskConical, Play, Redo2, Save, SlidersHorizontal, Undo2 } from 'lucide-react';
import { isIntraday, parseFormula } from '@mtv/rules';
import { fromTree, group, toTree, type Group } from '@/lib/builder';
import { FeedError, feed, showKept } from '@/lib/feed';
import { DEFAULT_UNIVERSE, NEW_SCREEN, SCAN_DRAFT_KEY, type Meta, type Screen, type ScreenResult } from '@/lib/screener';
import { MODE_LABEL, MODE_TF, modeIsNew, useTradingMode } from '@/lib/today';
import { userApi, type Category, type SavedScreen, type Watchlist } from '@/lib/user';
import { confirmDialog } from '../dialog';
import { InfoTip } from '../info-tip';
import { Button, Card, Segmented, inputCls } from '../ui';
import { FormulaEditor, useFormula } from './formula-editor';
import { MagicBox } from './magic-box';
import { RowBuilder } from '../conditions/row-builder';
import { formulaToRows } from '@/lib/rows';
import { ScanGallery, Tested } from './scan-gallery';
import { ResultsTable } from './results-table';
import { TreeBuilder } from './tree-builder';
import { StockCountText, UniverseFilterFields, UniverseSelect, filterCount, isMyWatchlist, useStockCount } from './universe-picker';
import { useShell } from '../app/shell-context';
import { TimeframeOptions } from '../timeframe-select';
import { STRATEGY_HANDOFF_KEY, strategyFromScan } from '@/lib/strategy';

const DRAFT_KEY = SCAN_DRAFT_KEY;
/** What an unsaved scan looked like when it was opened (a ready-made scan or an empty one). */
const BASE_KEY = 'platform.screener.draftBase';
/** The ready-made scan the draft was opened from, so a reload still shows it by name. */
const PRESET_KEY = 'platform.screener.draftPreset';
/** What decides "unsaved changes": everything the user edits, not the id. */
const snapshot = (s: Screen) => JSON.stringify({ ...s, id: undefined });
const HORIZONS = [['intraday', 'Intraday'], ['swing', 'Swing'], ['positional', 'Positional']] as const;
/** A choice inside the sentence: looks like a highlighted word, works like a select. */
const WORD = 'h-11 max-w-full cursor-pointer rounded-[12px] border-0 bg-accent-soft py-0 pl-3 pr-8 text-[inherit] font-semibold text-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const PILL = 'inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-panel px-3 text-[13px] font-semibold text-ink-2 hover:text-ink';

/**
 * The Scanner: scans on the left (dot = tested result), and on the right one sentence to set it up ("Show me … stocks
 * where … on …"), the tested result, small pills for filters, the rules in one line (the editor opens on request) and
 * the results.
 */
export function ScreenerWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(NEW_SCREEN);
  const [saved, setSaved] = useState<string | null>(null); // snapshot of the saved version
  const [base, setBase] = useState(() => snapshot(NEW_SCREEN)); // snapshot of an unsaved scan as opened
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
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null); // the ready-made scan last opened
  const [rulesOpen, setRulesOpen] = useState(true); // the conditions show by default, as rows you can read and change
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(true); // the scan tiles, open until a scan runs
  const [runSoon, setRunSoon] = useState(false); // a tile was clicked: run its scan once it has loaded
  const resultsRef = useRef<HTMLDivElement>(null);
  const { watch } = useShell(); // the side panel's watchlist
  // "My watchlist" follows the side panel: add or remove a stock there and the next scan uses the new list.
  useEffect(() => {
    if (isMyWatchlist(screen.universe) && screen.universe.kind === 'symbols' && screen.universe.symbols.join() !== watch.join())
      setScreen((s) => ({ ...s, universe: { ...s.universe, symbols: watch } as Screen['universe'] }));
  }, [watch, screen.universe]);
  const mode = useTradingMode();
  const modeTf = mode ? MODE_TF[mode].screen : NEW_SCREEN.tf;
  const stockCount = useStockCount(screen.universe, screen.filters);

  const refreshLibrary = useCallback(() => {
    userApi.screens().then(setScreens, (e: Error) => setLoadError(e.message));
    userApi.watchlists().then(setWatchlists, () => {});
  }, []);

  // ---- loading a scan into the editor ----
  const load = useCallback((s: Screen, savedVersion: string | null, baseline = snapshot(s), preset: string | null = null) => {
    setScreen(s);
    setSaved(savedVersion);
    setBase(baseline);
    setPresetId(preset);
    try {
      localStorage.setItem(BASE_KEY, baseline);
      if (preset) localStorage.setItem(PRESET_KEY, preset); else localStorage.removeItem(PRESET_KEY);
    } catch { /* storage blocked */ }
    const t = toTree(s.formula);
    setTree(t ?? group());
    setView(t ? 'builder' : 'formula');
    setHist({ past: [], future: [] });
    setResult(null);
    setError(null);
    if (!s.formula.trim()) setRulesOpen(true); // an empty scan opens straight into the rules
  }, []);

  useEffect(() => {
    let draft: Screen | null = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { /* ignore a broken draft */ }
    const restored: Screen = draft?.formula != null ? { ...NEW_SCREEN, ...draft } : NEW_SCREEN;
    // The sentence offers index, sector and watchlist choices: a draft on anything else starts again on NIFTY 50.
    const offered = restored.universe.kind === 'index' || restored.universe.kind === 'watchlist' || isMyWatchlist(restored.universe);
    const start: Screen = offered ? restored : { ...restored, universe: DEFAULT_UNIVERSE, filters: {} };
    const wl = params.get('watchlist');
    // A restored draft keeps the baseline it was opened with, so edits made before a reload still count as unsaved.
    let baseline: string | undefined;
    try { baseline = (draft && localStorage.getItem(BASE_KEY)) || snapshot(NEW_SCREEN); } catch { baseline = snapshot(NEW_SCREEN); }
    if (wl) load({ ...start, id: undefined, name: 'Untitled scan', universe: { kind: 'watchlist', id: wl } }, null);
    else {
      // The ready-made scan the draft came from (it only counts while the rules still match it).
      let preset: string | null = null;
      try { preset = draft ? localStorage.getItem(PRESET_KEY) : null; } catch { /* storage blocked */ }
      load(start, null, baseline, preset);
    }
    draftReady.current = true;
    showKept(['screener/meta', setMeta], ['user/screens', setScreens], ['user/watchlists', setWatchlists]);
    feed<Meta>('screener/meta').then(setMeta, (e: Error) => setLoadError(e.message));
    refreshLibrary();
  }, [load, params, refreshLibrary]);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(screen)); } catch { /* storage blocked */ } }, [screen]);
  // A draft that belongs to a saved scan knows its saved version once the library arrives.
  useEffect(() => {
    if (saved == null && screen.id && screens) {
      const s = screens.find((x) => x.id === screen.id);
      if (s) setSaved(snapshot(fromSaved(s)));
    }
  }, [screens, screen.id, saved]);

  const update = (p: Partial<Screen>) => setScreen((s) => ({ ...s, ...p }));
  // A new trading mode (Today page) moves an unsaved scan to that mode's timeframe, once.
  const draftReady = useRef(false);
  useEffect(() => {
    if (!mode || !draftReady.current || !modeIsNew('screener', mode)) return;
    if (screen.id || screen.tf === MODE_TF[mode].screen) return;
    update({ tf: MODE_TF[mode].screen });
    setNotice(`Timeframe set to ${MODE_TF[mode].screenWords} bars for ${MODE_LABEL[mode].toLowerCase()} trading`);
    setTimeout(() => setNotice(null), 4000);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps -- once per mode, on the scan loaded by then
  const dirty = saved == null ? !!screen.id || snapshot(screen) !== base : snapshot(screen) !== saved;

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

  /** Magic filters: the conditions read from a phrase, added to the rules (or in their place). */
  const applyMagic = (conditions: string[], replace: boolean) => {
    const keep = !replace && screen.formula.trim() ? [`(${screen.formula})`] : [];
    const p = parseFormula([...keep, ...conditions.map((c) => `(${c})`)].join(' AND '));
    if (p.ok) { update({ formula: p.formula }); setView('builder'); }
  };
  /** Can the rows show this scan? (Candle patterns, time of day and the like need the formula view.) */
  const rowsFit = useMemo(() => formulaToRows(screen.formula) != null, [screen.formula]);

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
      setNotice(asNew || !screen.id ? 'Saved to My scans' : 'Changes saved');
      setTimeout(() => setNotice(null), 2500);
      refreshLibrary();
    } catch (e) {
      setError(e instanceof FeedError ? e.message : 'Could not save the scan');
    }
  };
  /** Runs `go` straight away, or after the owner agrees to drop unsaved changes. */
  const leaving = (go: () => void) => {
    if (!dirty) return go();
    void confirmDialog({ title: 'Discard unsaved changes?', message: 'Your changes to this scan are not saved.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }).then((ok) => ok && go());
  };

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await feed<ScreenResult>('screener/run', { formula: screen.formula, tf: screen.tf, candle: screen.candle, universe: screen.universe, filters: screen.filters, columns: screen.columns, screenId: screen.id, name: screen.name }));
      setGalleryOpen(false);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      refreshLibrary();
    } catch (e) {
      setError(e instanceof FeedError ? e.message : 'The scan could not run. Is the data service running?');
    } finally {
      setRunning(false);
    }
  };

  // Intraday scans can re-run on their own, 5 seconds after each minute closes.
  const intradayScreen = isIntraday(screen.tf) || /\[\d+[mh]\]/.test(screen.formula);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!auto || !intradayScreen) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { void runRef.current(); next(); }, 60_000 - (Date.now() % 60_000) + 5_000); };
    next();
    return () => clearTimeout(t);
  }, [auto, intradayScreen]);

  // A clicked tile runs straight away, on the next render (once its rules are loaded).
  useEffect(() => {
    if (!runSoon) return;
    setRunSoon(false);
    void runRef.current();
  }, [runSoon]);

  // ---- opening scans ----
  type Preset = Meta['presets'][number];
  const openPreset = (p: Preset, andRun = false) => leaving(() => {
    load({ ...NEW_SCREEN, name: p.name, category: p.category as Category, formula: p.formula, tf: p.tf, universe: screen.universe, filters: screen.filters }, null, undefined, p.id);
    setRunSoon(andRun);
  });
  const openSaved = (s: SavedScreen, andRun = false) => leaving(() => { load(fromSaved(s), snapshot(fromSaved(s))); setRunSoon(andRun); });
  const presets = meta?.presets ?? [];
  // Still exactly the ready-made scan? Then its tested result applies; once its rules change, it is "my own rules".
  // An unsaved draft with a ready-made scan's exact name, rules and timeframe is that scan too (drafts kept before the link was stored).
  const activePreset = presets.find((p) => p.formula === screen.formula && p.tf === screen.tf
    && (p.id === presetId || (!presetId && !screen.id && p.name === screen.name))) ?? null;
  const scanKey = activePreset ? `p:${activePreset.id}` : screen.id && !dirty ? `s:${screen.id}` : 'custom';
  const pickScan = (v: string) => {
    if (v.startsWith('p:')) { const p = presets.find((x) => x.id === v.slice(2)); if (p) openPreset(p); }
    else if (v.startsWith('s:')) { const s = screens?.find((x) => x.id === v.slice(2)); if (s) openSaved(s); }
    else setRulesOpen(true);
  };
  const nFilters = filterCount(screen.filters);

  return (
    <div className="grid min-w-0 content-start gap-5">
        <section className="panel grid gap-4 p-5">
          {loadError && <p className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{loadError}</p>}

          {/* The sentence */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[clamp(16px,1.6vw,20px)] font-semibold text-ink">
            <span>Show me</span>
            <UniverseSelect universe={screen.universe} filters={screen.filters} meta={meta} watchlists={watchlists} watch={watch} className={WORD}
              onChange={(universe, filters) => update({ universe, filters })} />
            <span>stocks where</span>
            <select value={scanKey} onChange={(e) => pickScan(e.target.value)} aria-label="Which scan" className={`${WORD} min-w-0`}>
              {scanKey === 'custom' && <option value="custom">my own rules{screen.name && screen.name !== 'Untitled scan' ? `: ${screen.name}` : ''}</option>}
              {HORIZONS.map(([h, label]) => presets.some((p) => p.horizon === h) && (
                <optgroup key={h} label={label}>
                  {presets.filter((p) => p.horizon === h).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
                </optgroup>
              ))}
              {!!screens?.length && (
                <optgroup label="My scans">
                  {screens.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
                </optgroup>
              )}
            </select>
            <span>on</span>
            <select value={screen.tf} onChange={(e) => update({ tf: e.target.value as Screen['tf'] })} aria-label="Timeframe" className={WORD}>
              <TimeframeOptions />
            </select>
            <Button variant="primary" onClick={run} disabled={!canRun} className="ml-auto h-11 min-w-[140px] text-[15px]">
              <Play size={16} /> {running ? 'Running…' : 'Run scan'}
            </Button>
          </div>

          {/* What the scan is worth, and how many stocks it searches */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {activePreset ? <Tested e={activePreset.evidence} />
              : <span className="text-[12.5px] text-muted">Your own rules are not tested. A strategy backtest (Strategies) shows how they did.</span>}
            <StockCountText {...stockCount} />
            {notice && <span className="text-[12.5px] font-semibold text-up" role="status">{notice}</span>}
          </div>

          {/* Pills: filters, candle, refresh; and saving */}
          <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line-strong pt-3">
            <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className={`${PILL} ${nFilters ? 'border-accent text-accent-deep' : ''}`}>
              <SlidersHorizontal size={14} /> Filters{nFilters ? ` · ${nFilters}` : ''} <ChevronDown size={13} className={filtersOpen ? 'rotate-180' : ''} />
            </button>
            <Segmented label="Candle" value={screen.candle} onChange={(candle) => update({ candle })}
              options={[{ value: 'closed', label: 'Closed bar', title: 'Only completed bars: a match is final' }, { value: 'live', label: 'Live bar', title: 'Include the bar still forming: a match can change before it closes' }]} />
            <InfoTip label="About the timeframe and the bar">
              <p>The timeframe in the sentence is the scan&apos;s own; each rule can use another one (Weekly, Monthly) in the rules editor.</p>
              <p><b>Closed bar</b>: the newest bar counts only once it has closed, so a match is final. <b>Live bar</b>: the bar still forming counts as it stands, so a match can appear and disappear until it closes.</p>
              <p>Intraday timeframes use live Kite data for NIFTY 500 and F&amp;O stocks; connect Kite from the top bar.</p>
            </InfoTip>
            {intradayScreen && (
              <label className="flex items-center gap-2 text-[13px] text-ink-2" title="Runs again 5 seconds after every minute closes">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[var(--color-accent)]" /> Refresh every minute
              </label>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {dirty && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-deep">Unsaved</span>}
              <Button className="h-9" onClick={() => save(false)} disabled={!dirty && !!screen.id} title={screen.id ? 'Save changes to this scan' : 'Save to My scans'}><Save size={15} /> Save</Button>
              {screen.id && <Button variant="ghost" className="h-9" onClick={() => save(true)}>Save as new</Button>}
              <Button variant="ghost" className="h-9" disabled={!(parsed?.ok && parsed.type === 'bool')} title="Open this rule in Backtest with the same timeframe and stocks"
                onClick={() => { try { localStorage.setItem(STRATEGY_HANDOFF_KEY, JSON.stringify(strategyFromScan(screen))); } catch { /* storage blocked */ } router.push('/strategies'); }}><FlaskConical size={15} /> Backtest this</Button>
              {screen.id && <Link href={`/alerts?screen=${screen.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><Bell size={15} /> Alert me</Link>}
              <Button variant="ghost" className="h-9" onClick={() => leaving(() => load({ ...NEW_SCREEN, formula: '', tf: modeTf }, null))} title="Start an empty scan on NIFTY 50"><FilePlus2 size={15} /> New</Button>
            </span>
          </div>
          {filtersOpen && <UniverseFilterFields universe={screen.universe} filters={screen.filters} meta={meta} onChange={(universe, filters) => update({ universe, filters })} />}

          {/* The rules in one line; the editor on request */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="text-muted">Rules:</span>
            {parsed?.ok && parsed.type === 'bool'
              ? <code className="min-w-0 flex-1 truncate text-ink-2" title={parsed.formula}>{parsed.formula}</code>
              : <span className={`flex-1 ${parsed ? 'text-down' : 'text-muted'}`}>{parsed ? 'need fixing in the editor' : 'none yet: add a condition'}</span>}
            <button type="button" onClick={() => setRulesOpen((o) => !o)} aria-expanded={rulesOpen} className="inline-flex items-center gap-1 font-semibold text-accent-deep hover:underline">
              {rulesOpen ? 'Hide the rules' : 'Edit the rules'} <ChevronDown size={13} className={rulesOpen ? 'rotate-180' : ''} />
            </button>
          </div>

          {rulesOpen && (
            <div className="grid gap-3 rounded-[14px] bg-raised p-4">
              <MagicBox onApply={applyMagic} />
              <div className="flex flex-wrap items-center gap-3">
                <input value={screen.name} onChange={(e) => update({ name: e.target.value })} aria-label="Scan name" title="Scan name"
                  className={`${inputCls} h-9 min-w-[12rem] text-[14px] font-semibold`} />
                <Segmented label="Editor" value={view} onChange={setView}
                  options={[{ value: 'builder', label: 'Rows', title: rowsFit ? undefined : 'This scan has parts the rows cannot show' }, { value: 'formula', label: 'Formula (advanced)' }]} />
                {view === 'builder' && (
                  <Button variant="ghost" className="ml-auto h-9 px-2.5" onClick={() => update({ formula: '' })} disabled={!screen.formula.trim()} title="Remove every condition"><Eraser size={16} /> Clear all</Button>
                )}
              </div>
              {view === 'builder' && !rowsFit && <p className="rounded-[10px] bg-panel px-3 py-2 text-[13px] text-ink-2">This scan uses parts the rows can&apos;t show (candle patterns, rising/falling, maths like ABS or ×…), so it stays a formula. Edit it below, or clear it to start with rows.</p>}
              {view === 'builder' && rowsFit
                ? <RowBuilder formula={screen.formula} onChange={(formula) => update({ formula })} mainTf={screen.tf} intraday={isIntraday(screen.tf)} examples />
                : <FormulaEditor value={screen.formula} onChange={(formula) => update({ formula })} meta={meta} />}
            </div>
          )}
          {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
        </section>

        {/* Every scan as a tile; a click opens it and runs it */}
        <ScanGallery open={galleryOpen} onToggle={() => setGalleryOpen((o) => !o)}
          mode={mode} meta={meta} screens={screens} activeId={screen.id} activePreset={activePreset?.id ?? null}
          onPreset={(p) => openPreset(p, true)}
          onOpen={(s) => openSaved(s, true)}
          onFavourite={(s) => userApi.favourite(s.id, !s.favourite).then(refreshLibrary, (e: Error) => setError(e.message))}
          onDuplicate={(s) => userApi.saveScreen({ ...fromSaved(s), id: undefined, name: `${s.name} (copy)` }).then(refreshLibrary, (e: Error) => setError(e.message))}
          onDelete={(s) => {
            void confirmDialog({ title: `Delete "${s.name}"?`, message: 'Its run history goes with it.', confirmLabel: 'Delete', danger: true }).then((ok) => void (ok && userApi.deleteScreen(s.id).then(() => {
              if (screen.id === s.id) { update({ id: undefined }); setSaved(null); }
              refreshLibrary();
            }, (e: Error) => setError(e.message))));
          }} />

        <div ref={resultsRef} className="scroll-mt-20">
          {result ? (
            <Card title="Results">
              <ResultsTable result={result} columns={screen.columns} onColumns={(columns) => update({ columns })}
                watchlists={watchlists} onWatchlists={() => userApi.watchlists().then(setWatchlists, () => {})} />
            </Card>
          ) : !galleryOpen && (
            <p className="panel px-5 py-8 text-center text-[14px] text-muted">Pick a scan from <b className="text-ink-2">Show scans</b> or in the sentence, then press <b className="text-ink-2">Run scan</b>.</p>
          )}
        </div>
    </div>
  );
}

/** The editable part of a saved scan. */
function fromSaved(s: SavedScreen): Screen {
  return { id: s.id, name: s.name, category: s.category, formula: s.formula, tf: s.tf, candle: s.candle, universe: s.universe, filters: s.filters, columns: s.columns };
}
