'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AreaChart, BarChart3, Camera, CandlestickChart, Check, ChevronDown, LineChart, Maximize2, Minimize2, Search, TrendingUp } from 'lucide-react';
import { EOD_TIMEFRAMES, type Candle, type DataQuality, type Timeframe } from '@mtv/shared';
import { PULSE_NAMES, chartHref, useShell } from '@/components/app/shell-context';
import { ScannerView } from '@/components/signals/scanner-view';
import { fetchCatalog, newUid, type LibIndicator, type LibStudy } from '@/lib/chart/library';
import { fetchCandles } from '@/lib/feed';
import { fmt, tfLabel } from '@/lib/format';
import { rememberChart, usePersisted } from '@/lib/persisted';
import { ChartView, type ChartType, type ScaleMode } from './chart-view';
import { DataCheck } from './data-check';
import { IndicatorPicker } from './indicator-picker';
import { LibSettings } from './lib-settings';
import { Watchlist } from './watchlist';

/** The site shows NSE end-of-day data only: daily bars, and weeks and months built from them. */
const TFS: Timeframe[] = EOD_TIMEFRAMES;
const DAY = 86400;
const RANGES: [label: string, tf: Timeframe, seconds: number | (() => number)][] = [
  ['1M', 'D', 31 * DAY], ['3M', 'D', 92 * DAY], ['6M', 'D', 183 * DAY],
  ['YTD', 'D', () => Date.now() / 1000 - Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000], ['1Y', 'D', 365 * DAY], ['5Y', 'W', 5 * 365 * DAY], ['All', 'M', 1e10],
];
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
  const tf: Timeframe = TFS.includes(savedTf) ? savedTf : 'D'; // an old intraday choice falls back to daily
  const [chartType, setChartType] = usePersisted<ChartType>('mtv.chartType', 'candles');
  const [studies, setStudies] = usePersisted<string[]>('mtv.studies', ['st', 'rsi']);
  /** TradingView-library indicators (calculated by the feed service), and the picker / settings dialogs. */
  const [libStudies, setLibStudies] = usePersisted<LibStudy[]>('mtv.libStudies', []);
  const [picker, setPicker] = useState(false);
  const [editLib, setEditLib] = useState<string | null>(null);
  const [libCatalog, setLibCatalog] = useState<LibIndicator[]>([]);
  useEffect(() => { if (picker || editLib) fetchCatalog().then(setLibCatalog, () => {}); }, [picker, editLib]);
  const [data, setData] = useState<{ candles: Candle[]; key: string; quality: DataQuality | null; name: string; exchange: string }>({ candles: [], key: '', quality: null, name: PULSE_NAMES[symbol] ?? symbol, exchange: 'NSE' });
  const [visibleSeconds, setVisibleSeconds] = useState<number | undefined>();
  const [range, setRange] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<null | 'type'>(null);
  const [side, setSideState] = useState<'watch' | 'scanner'>(() => lastSide);
  const setSide = (s: 'watch' | 'scanner') => { lastSide = s; setSideState(s); };
  const shownSymbol = useRef(symbol);
  const [scale, setScale] = usePersisted<ScaleMode>('mtv.scale', 'normal');
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
  const toggleStudy = (id: string) => setStudies(studies.includes(id) ? studies.filter((s) => s !== id) : [...studies, id]);
  const TypeIcon = CHART_TYPES.find(([k]) => k === chartType)?.[2] ?? CandlestickChart;

  return (
    <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]" onClick={() => setMenu(null)}>
      <section ref={chartPanel} className={`panel grid min-w-0 grid-rows-[auto_minmax(0,1fr)_34px] overflow-hidden ${full ? 'fixed inset-0 z-[60] h-dvh rounded-none' : 'h-[72dvh] min-h-[420px] lg:h-auto lg:min-h-0'}`}>
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
          <button type="button" onClick={() => setPicker(true)} className="flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold hover:bg-raised">
            <TrendingUp size={16} /> <span className="hidden sm:inline">Indicators</span>
          </button>
          {loading && <span className="ml-3 text-[12px] text-muted">Loading…</span>}
          <span className="flex-1" />
          {!loading && <span className="hidden sm:block"><DataCheck quality={data.quality} delayed={false} /></span>}
          <button type="button" onClick={saveImage} disabled={!data.candles.length} title="Save chart as image" aria-label="Save chart as image"
            className="grid h-[30px] w-[30px] place-items-center rounded-full text-ink-2 hover:bg-raised disabled:opacity-40"><Camera size={16} /></button>
          <button type="button" onClick={toggleFull} aria-pressed={full} title={full ? 'Exit full screen (F or Esc)' : 'Full screen (F)'} aria-label={full ? 'Exit full screen' : 'Full screen'}
            className="grid h-[30px] w-[30px] place-items-center rounded-full text-ink-2 hover:bg-raised">{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        </div>

        {/* chart */}
        <div className="relative min-h-0">
          <ChartView
            candles={data.candles}
            loadKey={data.key}
            symbol={symbol}
            name={data.name}
            exchange={data.exchange}
            tf={tf}
            chartType={chartType}
            studies={studies}
            visibleSeconds={visibleSeconds}
            onRemoveStudy={(id) => setStudies(studies.filter((s) => s !== id))}
            libStudies={libStudies}
            onRemoveLib={(uid) => setLibStudies(libStudies.filter((s) => s.uid !== uid))}
            onEditLib={setEditLib}
            scaleMode={scale}
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

        {/* range bar */}
        <div className="flex items-center gap-0.5 border-t border-line px-2 text-[12.5px]">
          {RANGES.map(([label, rtf, secs]) => (
            <button key={label} type="button" aria-pressed={range === label} onClick={() => applyRange(label, rtf, typeof secs === 'function' ? secs() : secs)}
              className={`rounded-full px-2.5 py-1 font-medium ${range === label ? 'bg-inverse text-on-inverse' : 'hover:bg-raised'}`}>
              {label}
            </button>
          ))}
          <span className="flex-1" />
          <span className="hidden truncate px-3 text-[10.5px] text-muted xl:inline">NSE end-of-day data. Not investment advice.</span>
          {([['percent', '%', 'Percent scale: change from the first visible bar'], ['log', 'log', 'Logarithmic scale']] as const).map(([m, label, title]) => (
            <button key={m} type="button" aria-pressed={scale === m} title={title} onClick={() => setScale(scale === m ? 'normal' : m)}
              className={`rounded-full px-2.5 py-1 font-medium ${scale === m ? 'bg-inverse text-on-inverse' : 'hover:bg-raised'}`}>{label}</button>
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
