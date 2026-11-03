'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AreaChart, BarChart3, Camera, CandlestickChart, Check, ChevronDown, History, LineChart, Maximize2, Minimize2, Pause, Play, Plus, Search, Settings2, SkipForward, TrendingUp, X } from 'lucide-react';
import { EOD_TIMEFRAMES, type Candle, type DataQuality, type Timeframe } from '@mtv/shared';
import { PULSE_NAMES, chartHref, useShell } from '@/components/app/shell-context';
import { ScannerView } from '@/components/signals/scanner-view';
import { fetchCatalog, newUid, type LibIndicator, type LibStudy } from '@/lib/chart/library';
import { fetchCandles } from '@/lib/feed';
import { fmt, tfLabel } from '@/lib/format';
import { rememberChart, usePersisted, useSymbolPersisted } from '@/lib/persisted';
import { MODE_TF, modeIsNew, useTradingMode } from '@/lib/today';
import { ChartView, DEFAULT_CHART_SETTINGS, type ChartSettings, type ChartType, type CompareLine, type ScaleMode } from './chart-view';
import { SymbolSearch } from './symbol-search';
import { position, type Fill } from '@/lib/practice';
import { DataCheck } from './data-check';
import { IndicatorPicker } from './indicator-picker';
import { LibSettings } from './lib-settings';
import { Watchlist } from './watchlist';

/** Minute bars come from the owner's Kite data (NIFTY 500 and F&O stocks, about a year); D/W/M from NSE's end-of-day files. */
const INTRADAY_TFS: Timeframe[] = ['1', '5', '15', '60'];
const TFS: Timeframe[] = [...INTRADAY_TFS, ...EOD_TIMEFRAMES];
const DAY = 86400;
const RANGES: [label: string, tf: Timeframe, seconds: number | (() => number)][] = [
  ['1M', 'D', 31 * DAY], ['3M', 'D', 92 * DAY], ['6M', 'D', 183 * DAY],
  ['YTD', 'D', () => Date.now() / 1000 - Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000], ['1Y', 'D', 365 * DAY], ['5Y', 'W', 5 * 365 * DAY], ['All', 'M', 1e10],
];
/** Practice replays never show the last this-many days of data (SEBI circular of 8 May 2026). */
const REPLAY_MIN_AGE_DAYS = 30;
type Replay = { idx: number; cap: number; playing: boolean; speed: number; qty: number; fills: Fill[]; key: string };
/** IST calendar date (YYYY-MM-DD) of a bar time. */
const istDate = (t: number) => new Date((t + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Line colours for compared symbols. */
const COMPARE_COLORS = ['#2f5bff', '#7346ff', '#c2410c', '#0891b2'];
const CHART_TYPES: [ChartType, string, typeof CandlestickChart][] = [
  ['candles', 'Candles', CandlestickChart], ['ha', 'Heikin Ashi', CandlestickChart], ['bars', 'Bars', BarChart3], ['line', 'Line', LineChart], ['area', 'Area', AreaChart],
];

/** The side panel tab survives moving between symbols (each symbol is its own page), for this browser session. */
let lastSide: 'watch' | 'scanner' = 'watch';

/** TradingView-style chart page for one symbol (from the address), with the watchlist and scanner beside it. */
export function ChartWorkspace({ symbol }: { symbol: string }) {
  const router = useRouter();
  const { quotes, watch, setWatch, openSearch, openChart, notify } = useShell();
  const [savedTf, setTf] = usePersisted<Timeframe>('mtv.tf', 'D');
  const tf: Timeframe = TFS.includes(savedTf) ? savedTf : 'D';
  const intraday = INTRADAY_TFS.includes(tf);
  // A new trading mode (Today page) opens the chart on that mode's timeframe, once; the owner's own pick holds after.
  const mode = useTradingMode();
  useEffect(() => { if (mode && modeIsNew('chart', mode)) setTf(MODE_TF[mode].chart); }, [mode, setTf]);
  // Chart type, indicators, scale and compare list are saved per symbol (see useSymbolPersisted); the timeframe is shared.
  const [chartType, setChartType] = useSymbolPersisted<ChartType>(symbol, 'mtv.chartType', 'candles');
  const [studies, setStudies] = useSymbolPersisted<string[]>(symbol, 'mtv.studies', ['st', 'rsi']);
  /** TradingView-library indicators (calculated by the feed service), and the picker / settings dialogs. */
  const [libStudies, setLibStudies] = useSymbolPersisted<LibStudy[]>(symbol, 'mtv.libStudies', []);
  const [picker, setPicker] = useState(false);
  const [editLib, setEditLib] = useState<string | null>(null);
  const [libCatalog, setLibCatalog] = useState<LibIndicator[]>([]);
  useEffect(() => { if (picker || editLib) fetchCatalog().then(setLibCatalog, () => {}); }, [picker, editLib]);
  const [data, setData] = useState<{ candles: Candle[]; key: string; quality: DataQuality | null; name: string; exchange: string }>({ candles: [], key: '', quality: null, name: PULSE_NAMES[symbol] ?? symbol, exchange: 'NSE' });
  const [visibleSeconds, setVisibleSeconds] = useState<number | undefined>();
  const [range, setRange] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<null | 'type' | 'settings' | 'replay'>(null);
  const [chartSettings, setChartSettings] = usePersisted<ChartSettings>('mtv.chartSettings', DEFAULT_CHART_SETTINGS);
  const [side, setSideState] = useState<'watch' | 'scanner'>(() => lastSide);
  const setSide = (s: 'watch' | 'scanner') => { lastSide = s; setSideState(s); };
  const shownSymbol = useRef(symbol);
  const [scale, setScale] = useSymbolPersisted<ScaleMode>(symbol, 'mtv.scale', 'normal');

  // Compare: other symbols as % lines on the price pane (up to 4).
  const [compares, setCompares] = useSymbolPersisted<string[]>(symbol, 'mtv.compare', [], false);
  const [comparePick, setComparePick] = useState(false);
  const [compareData, setCompareData] = useState<Record<string, { name: string; candles: Candle[] }>>({});
  const shownCompares = compares.filter((c) => c !== symbol);
  useEffect(() => {
    const ctrl = new AbortController();
    for (const c of shownCompares) {
      fetchCandles(c, tf, ctrl.signal)
        .then((r) => setCompareData((d) => ({ ...d, [`${c}:${tf}`]: { name: r.instrument?.name ?? c, candles: r.candles } })))
        .catch((e: Error) => { if (e.name !== 'AbortError') notify(`No data for ${c}`); });
    }
    return () => ctrl.abort();
  }, [shownCompares.join(','), tf]); // eslint-disable-line react-hooks/exhaustive-deps
  const compareLines: CompareLine[] = shownCompares.flatMap((c, i) => {
    const d = compareData[`${c}:${tf}`];
    return d ? [{ symbol: c, name: d.name, color: COMPARE_COLORS[i % COMPARE_COLORS.length], candles: d.candles }] : [];
  });
  // Prices of different symbols only line up as % change, so comparing switches the scale to %.
  const shownScale: ScaleMode = shownCompares.length ? 'percent' : scale;
  const shot = useRef<(() => HTMLCanvasElement) | null>(null);

  // Full screen: the chart panel covers the window (works everywhere, including phones that refuse the
  // browser's full-screen mode) and, where the browser allows it, also goes browser full screen.
  const chartPanel = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const toggleFull = () => {
    if (full) { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); setFull(false); return; }
    setFull(true);
    void chartPanel.current?.requestFullscreen?.().catch(() => { /* not allowed here: the in-page cover still applies */ });
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && full && !document.fullscreenElement) setFull(false);
      if (e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); toggleFull(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the chart as a PNG, with a title line naming the symbol, timeframe and last close.
  const saveImage = () => {
    const chart = shot.current?.();
    if (!chart) return;
    const css = getComputedStyle(document.documentElement);
    const head = 44 * (chart.width / Math.max(1, chart.clientWidth || chart.width));
    const out = document.createElement('canvas');
    out.width = chart.width; out.height = chart.height + head;
    const g = out.getContext('2d')!;
    g.fillStyle = css.getPropertyValue('--color-panel').trim() || '#fff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(chart, 0, head);
    const font = css.getPropertyValue('--font-outfit').trim() || 'system-ui';
    const k = head / 44;
    const last = data.candles.at(-1);
    const day = last ? new Date((last.time + 5.5 * 3600) * 1000).toISOString().slice(0, 10) : '';
    g.fillStyle = css.getPropertyValue('--color-ink').trim() || '#000';
    g.font = `600 ${15 * k}px ${font}, system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(`${data.name} · ${tfLabel(tf)} · NSE${last ? ` · close ${fmt(last.close)} on ${day}` : ''}`, 14 * k, head / 2);
    g.textAlign = 'right';
    g.fillStyle = css.getPropertyValue('--color-muted').trim() || '#888';
    g.font = `500 ${12 * k}px ${font}, system-ui, sans-serif`;
    g.fillText('Nandibull · NSE end-of-day data', out.width - 14 * k, head / 2);
    out.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${symbol}_${tfLabel(tf)}_${day || 'chart'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    if (shownSymbol.current !== symbol) { shownSymbol.current = symbol; setVisibleSeconds(undefined); setRange(null); }
    fetchCandles(symbol, tf, ctrl.signal)
      .then((r) => { setData({ candles: r.candles, key: `${symbol}:${tf}:${Date.now()}`, quality: r.quality, name: r.instrument?.name ?? symbol, exchange: r.instrument?.exchange ?? 'NSE' }); if (r.candles.length) rememberChart(symbol); })
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [symbol, tf]);
  useEffect(() => { const close = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);

  const changeTf = (t: Timeframe) => { setVisibleSeconds(undefined); setRange(null); setTf(t); };
  const applyRange = (label: string, rtf: Timeframe, secs: number) => {
    setRange(label);
    setVisibleSeconds(secs);
    if (rtf === tf) setData((d) => ({ ...d, key: d.key + 'r' }));
    else setTf(rtf);
  };
  // ---- bar replay (practice) ----
  // SEBI's circular of 8 May 2026 allows practice only on data at least 30 days old, with no prizes, so replay
  // never shows the last 30 days of history.
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayFrom, setReplayFrom] = useState('');
  const replayCap = (() => {
    const last = data.candles.at(-1);
    if (!last) return -1;
    const limit = last.time - REPLAY_MIN_AGE_DAYS * 86400;
    let i = data.candles.length - 1;
    while (i >= 0 && data.candles[i].time > limit) i--;
    return i;
  })();
  const replayMaxDate = replayCap >= 0 ? istDate(data.candles[replayCap].time) : '';
  const replayMinDate = data.candles.length > 1 ? istDate(data.candles[Math.min(20, data.candles.length - 1)].time) : '';
  const startReplay = () => {
    if (replayCap < 1 || !replayFrom) return;
    let i = data.candles.findIndex((b) => istDate(b.time) >= replayFrom);
    if (i < 0) i = replayCap;
    i = Math.max(1, Math.min(i, replayCap));
    setReplay({ idx: i, cap: replayCap, playing: false, speed: 1, qty: 1, fills: [], key: `${data.key}:replay:${Date.now()}` });
    setMenu(null);
  };
  const step = () => setReplay((r) => (r && r.idx < r.cap ? { ...r, idx: r.idx + 1 } : r && { ...r, playing: false }));
  useEffect(() => {
    if (!replay?.playing) return;
    const id = setInterval(step, 1000 / replay.speed);
    return () => clearInterval(id);
  }, [replay?.playing, replay?.speed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReplay(null); }, [symbol, tf]); // a new symbol or timeframe ends the replay
  // /chart/X?replay=1 (from the Practice page) opens the replay panel.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('replay') === '1') setMenu('replay'); }, []);
  useEffect(() => {
    if (!replay) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); step(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!replay]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownCandles = replay ? data.candles.slice(0, replay.idx + 1) : data.candles;
  const replayBar = replay ? data.candles[replay.idx] : null;
  const book = replay ? position(replay.fills, replayBar?.close ?? 0) : null;
  const trade = (side: 1 | -1) => setReplay((r) => r && replayBar ? { ...r, fills: [...r.fills, { qty: side * r.qty, price: replayBar.close, time: replayBar.time }] } : r);

  const toggleStudy = (id: string) => setStudies(studies.includes(id) ? studies.filter((s) => s !== id) : [...studies, id]);
  const TypeIcon = CHART_TYPES.find(([k]) => k === chartType)?.[2] ?? CandlestickChart;

  return (
    <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]" onClick={() => setMenu(null)}>
      <section ref={chartPanel} className={`panel grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden ${full ? 'fixed inset-0 z-[60] h-dvh rounded-none' : 'h-[72dvh] min-h-[420px] lg:h-auto lg:min-h-0'}`}>
        {/* chart toolbar */}
        <div className="flex min-h-[44px] flex-wrap items-center gap-0.5 border-b border-line px-2 py-1 whitespace-nowrap">
          <button type="button" onClick={() => openSearch('chart')} className="flex h-[30px] items-center gap-2 rounded-full bg-raised px-3 text-[13px] font-bold sm:min-w-[130px]">
            <Search size={14} className="text-muted" aria-hidden="true" /> <h1>{symbol}</h1>
          </button>
          <span className="mx-1.5 hidden h-5 w-px bg-line sm:block" />
          {TFS.map((t) => (
            <button key={t} type="button" onClick={() => changeTf(t)} aria-pressed={t === tf}
              className={`num h-7 rounded-full px-2.5 text-[12px] font-medium ${t === tf ? 'bg-inverse text-on-inverse' : 'hover:bg-raised'}`}>
              {tfLabel(t)}
            </button>
          ))}
          <span className="mx-1.5 hidden h-5 w-px bg-line sm:block" />
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setMenu(menu === 'type' ? null : 'type')} className="flex h-[30px] items-center gap-1 rounded-full px-2 hover:bg-raised" aria-label="Chart type" aria-expanded={menu === 'type'}>
              <TypeIcon size={17} /><ChevronDown size={12} />
            </button>
            {menu === 'type' && (
              <div className="absolute top-9 left-0 z-30 w-44 rounded-[12px] bg-panel py-1.5 shadow-[var(--shadow-pop)]">
                {CHART_TYPES.map(([k, label, Icon]) => (
                  <button key={k} type="button" onClick={() => { setChartType(k); setMenu(null); }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-raised">
                    <Icon size={15} /> {label} {k === chartType && <Check size={14} className="ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setComparePick(true)} disabled={shownCompares.length >= 4} title={shownCompares.length >= 4 ? 'Up to 4 symbols' : 'Compare with another symbol'}
            className="flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold hover:bg-raised disabled:opacity-40">
            <Plus size={16} /> <span className="hidden sm:inline">Compare</span>
          </button>
          <button type="button" onClick={() => setPicker(true)} className="flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold hover:bg-raised">
            <TrendingUp size={16} /> <span className="hidden sm:inline">Indicators</span>
          </button>
          {loading && <span className="ml-3 text-[12px] text-muted">Loading…</span>}
          <span className="flex-1" />
          {!loading && <span className="hidden sm:block"><DataCheck quality={data.quality} delayed={false} /></span>}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => (replay ? setReplay(null) : setMenu(menu === 'replay' ? null : 'replay'))} aria-pressed={!!replay}
              title={replay ? 'Exit replay' : 'Bar replay: practise on past data'} disabled={!replay && replayCap < 1}
              className={`flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold disabled:opacity-40 ${replay ? 'bg-inverse text-on-inverse' : 'hover:bg-raised'}`}>
              <History size={16} /> <span className="hidden sm:inline">Replay</span>
            </button>
            {menu === 'replay' && (
              <div className="absolute top-9 right-0 z-30 w-64 space-y-2.5 rounded-[14px] bg-panel p-3.5 text-[13px] whitespace-normal shadow-[var(--shadow-pop)]" role="dialog" aria-label="Bar replay">
                <p className="font-bold">Bar replay</p>
                <p className="text-[12px] text-muted">Start from a past date and reveal the chart bar by bar. Practice uses data at least {REPLAY_MIN_AGE_DAYS} days old, so the replay ends on {replayMaxDate ? fmtDay(replayMaxDate) : '—'}.</p>
                <input type="date" className="num h-9 w-full rounded-[10px] border border-line bg-panel px-2" value={replayFrom} min={replayMinDate} max={replayMaxDate}
                  onChange={(e) => setReplayFrom(e.target.value)} aria-label="Replay start date" />
                <button type="button" onClick={startReplay} disabled={!replayFrom} className="w-full rounded-[10px] bg-inverse py-2 font-semibold text-on-inverse disabled:opacity-40">Start replay</button>
              </div>
            )}
          </div>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setMenu(menu === 'settings' ? null : 'settings')} aria-expanded={menu === 'settings'} title="Chart settings" aria-label="Chart settings"
              className="grid h-[30px] w-[30px] place-items-center rounded-full text-ink-2 hover:bg-raised"><Settings2 size={16} /></button>
            {menu === 'settings' && (
              <div className="absolute top-9 right-0 z-30 w-60 space-y-2.5 rounded-[14px] bg-panel p-3.5 text-[13px] whitespace-normal shadow-[var(--shadow-pop)]" role="dialog" aria-label="Chart settings">
                <p className="font-bold">Chart settings</p>
                {([['upColor', 'Up candles'], ['downColor', 'Down candles']] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center justify-between">{label}
                    <input type="color" value={chartSettings[k]} onChange={(e) => setChartSettings({ ...chartSettings, [k]: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-line bg-panel" aria-label={label} />
                  </label>
                ))}
                {([['grid', 'Grid lines'], ['volume', 'Volume'], ['watermark', 'Symbol watermark']] as const).map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center justify-between">{label}
                    <input type="checkbox" checked={chartSettings[k]} onChange={(e) => setChartSettings({ ...chartSettings, [k]: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" />
                  </label>
                ))}
                <button type="button" onClick={() => setChartSettings(DEFAULT_CHART_SETTINGS)} className="w-full rounded-[10px] border border-line py-1.5 text-[12.5px] font-semibold text-ink-2 hover:bg-raised">Reset to default</button>
              </div>
            )}
          </div>
          <button type="button" onClick={saveImage} disabled={!data.candles.length} title="Save chart as image" aria-label="Save chart as image"
            className="grid h-[30px] w-[30px] place-items-center rounded-full text-ink-2 hover:bg-raised disabled:opacity-40"><Camera size={16} /></button>
          <button type="button" onClick={toggleFull} aria-pressed={full} title={full ? 'Exit full screen (F or Esc)' : 'Full screen (F)'} aria-label={full ? 'Exit full screen' : 'Full screen'}
            className="grid h-[30px] w-[30px] place-items-center rounded-full text-ink-2 hover:bg-raised">{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        </div>

        {/* chart */}
        <div className="relative min-h-0">
          <ChartView
            candles={shownCandles}
            loadKey={replay?.key ?? data.key}
            symbol={symbol}
            name={data.name}
            exchange={data.exchange}
            tf={tf}
            chartType={chartType}
            studies={studies}
            visibleSeconds={visibleSeconds}
            onRemoveStudy={(id) => setStudies(studies.filter((s) => s !== id))}
            libStudies={replay || intraday ? [] : libStudies} // library indicators are computed by the feed on D/W/M only
            positions={book && book.qty ? [{ product: 'Practice', qty: book.qty, avgPricePaise: Math.round(book.avg * 100) }] : undefined}
            onRemoveLib={(uid) => setLibStudies(libStudies.filter((s) => s.uid !== uid))}
            onEditLib={setEditLib}
            scaleMode={shownScale}
            compare={replayBar ? compareLines.map((x) => ({ ...x, candles: x.candles.filter((b) => b.time <= replayBar.time) })) : compareLines}
            settings={chartSettings}
            onRemoveCompare={(c) => setCompares(compares.filter((x) => x !== c))}
            shotRef={shot}
          />
          {error && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-panel/80">
              <div className="panel max-w-sm p-6 text-center">
                <p className="font-bold">{error}</p>
                <p className="mt-1 text-[13px] text-muted">Pick another symbol or timeframe. If every symbol fails, the data service may be restarting.</p>
              </div>
            </div>
          )}
        </div>

        {replay && replayBar && book && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line px-2 py-1.5 text-[12.5px]" role="toolbar" aria-label="Replay controls">
            <button type="button" onClick={() => setReplay({ ...replay, playing: !replay.playing })} disabled={replay.idx >= replay.cap} aria-label={replay.playing ? 'Pause' : 'Play'}
              className="grid h-8 w-8 place-items-center rounded-full bg-inverse text-on-inverse disabled:opacity-40">{replay.playing ? <Pause size={15} /> : <Play size={15} />}</button>
            <button type="button" onClick={step} disabled={replay.idx >= replay.cap} aria-label="Next bar" title="Next bar (Shift+→)"
              className="grid h-8 w-8 place-items-center rounded-full hover:bg-raised disabled:opacity-40"><SkipForward size={15} /></button>
            <select value={replay.speed} onChange={(e) => setReplay({ ...replay, speed: Number(e.target.value) })} aria-label="Replay speed" className="h-8 rounded-full bg-raised px-2 font-semibold">
              {[1, 2, 5, 10].map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
            <span className="num font-semibold">{fmtDay(istDate(replayBar.time))}</span>
            <span className="text-muted">{replay.idx >= replay.cap ? '· end of practice data' : `· ${replay.cap - replay.idx} bars left`}</span>
            <span className="flex-1" />
            <input type="number" min={1} value={replay.qty} onChange={(e) => setReplay({ ...replay, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              className="num h-8 w-16 rounded-[8px] border border-line bg-panel px-2 text-right" aria-label="Quantity" title="Quantity" />
            <button type="button" onClick={() => trade(1)} className="h-8 rounded-full bg-blue px-3 font-bold text-white">Buy</button>
            <button type="button" onClick={() => trade(-1)} className="h-8 rounded-full bg-down px-3 font-bold text-white">Sell</button>
            <span className="num" title="Practice P&L at this bar's close, before charges">
              {book.qty ? <>{book.qty > 0 ? 'Long' : 'Short'} {Math.abs(book.qty)} @ {fmt(book.avg)} · open <b className={book.open >= 0 ? 'text-up' : 'text-down'}>{fmt(book.open)}</b> · </> : null}
              booked <b className={book.booked >= 0 ? 'text-up' : 'text-down'}>{fmt(book.booked)}</b>
            </span>
            <button type="button" onClick={() => setReplay(null)} aria-label="Exit replay" title="Exit replay" className="grid h-8 w-8 place-items-center rounded-full hover:bg-raised"><X size={15} /></button>
          </div>
        )}
        {/* range bar */}
        <div className={`h-[34px] items-center gap-0.5 border-t border-line px-2 text-[12.5px] ${replay ? 'hidden' : 'flex'}`}>
          {RANGES.map(([label, rtf, secs]) => (
            <button key={label} type="button" aria-pressed={range === label} onClick={() => applyRange(label, rtf, typeof secs === 'function' ? secs() : secs)}
              className={`rounded-full px-2.5 py-1 font-medium ${range === label ? 'bg-inverse text-on-inverse' : 'hover:bg-raised'}`}>
              {label}
            </button>
          ))}
          <span className="flex-1" />
          <span className="hidden truncate px-3 text-[10.5px] text-muted xl:inline">NSE end-of-day data. Not investment advice.</span>
          {([['percent', '%', 'Percent scale: change from the first visible bar'], ['log', 'log', 'Logarithmic scale']] as const).map(([m, label, title]) => (
            <button key={m} type="button" aria-pressed={shownScale === m} title={shownCompares.length ? 'Comparing symbols: the scale shows % change' : title}
              disabled={shownCompares.length > 0} onClick={() => setScale(scale === m ? 'normal' : m)}
              className={`rounded-full px-2.5 py-1 font-medium disabled:cursor-not-allowed ${shownScale === m ? 'bg-inverse text-on-inverse' : 'hover:bg-raised disabled:opacity-40'}`}>{label}</button>
          ))}
        </div>
        {picker && (
          <IndicatorPicker quick={studies} onToggleQuick={toggleStudy} onClose={() => setPicker(false)}
            onAdd={(ind) => { setLibStudies([...libStudies, { uid: newUid(), id: ind.id, inputs: {} }]); setPicker(false); notify(`${ind.name} added`); }} />
        )}
        {(() => {
          const s = editLib ? libStudies.find((x) => x.uid === editLib) : undefined;
          const ind = s && libCatalog.find((c) => c.id === s.id);
          return s && ind ? (
            <LibSettings ind={ind} inputs={s.inputs} onClose={() => setEditLib(null)}
              onSave={(inputs) => setLibStudies(libStudies.map((x) => (x.uid === s.uid ? { ...x, inputs } : x)))} />
          ) : null;
        })()}
        <SymbolSearch open={comparePick} title="Compare with" onClose={() => setComparePick(false)}
          onPick={(i) => { if (i.symbol !== symbol && !compares.includes(i.symbol)) setCompares([...compares.filter((c) => c !== symbol), i.symbol].slice(-4)); }} />
      </section>

      {/* side panel */}
      <section className="panel flex h-[70dvh] flex-col overflow-hidden lg:h-auto lg:min-h-0">
        <div className="m-2.5 mb-1.5 flex gap-0.5 rounded-full bg-raised p-[3px]" role="tablist">
          {([['watch', 'Watchlist'], ['scanner', 'Scanner']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={side === k} onClick={() => setSide(k)}
              className={`flex-1 rounded-full py-1.5 text-[12px] font-semibold ${side === k ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2'}`}>
              {label}
            </button>
          ))}
        </div>
        {side === 'watch' && (
          <Watchlist symbols={watch} quotes={quotes} active={symbol}
            onSelect={(s) => s !== symbol && router.push(chartHref(s))}
            onAdd={() => openSearch('watch')}
            onRemove={(s) => setWatch(watch.filter((w) => w !== s))} />
        )}
        {side === 'scanner' && <ScannerView compact active={symbol} onOpenChart={openChart} />}
      </section>

    </div>
  );
}
