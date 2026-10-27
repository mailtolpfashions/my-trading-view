'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createTextWatermark,
  type IChartApi,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Trash2, X } from 'lucide-react';
import { heikinAshi, type Series } from '@mtv/indicators';
import type { Candle, Timeframe } from '@mtv/shared';
import { IndicatorRenderer } from 'lightweight-charts-indicators/render';
import { Settings2 } from 'lucide-react';
import { DrawingLayer, type AlertLine } from '@/lib/chart/drawings/layer';
import { computeLib, fetchCatalog, type LibIndicator, type LibStudy } from '@/lib/chart/library';
import { COLORS, TWO_POINT, channelOffset, hitTest, loadDrawings, logicalToTime, measureText, newId, saveDrawings, timeToLogical, type Drawing, type Point, type Tool } from '@/lib/chart/drawings/model';
import { DOWN, UP, studyById, type PointColors } from '@/lib/chart/studies';
import { fmt, tfLabel } from '@/lib/format';
import { DrawingRail } from './drawing-rail';

export type ChartType = 'candles' | 'bars' | 'ha' | 'line' | 'area';

const IST = 5.5 * 3600;
// lightweight-charts renders timestamps as UTC, so bars are shifted to IST wall-clock time for display.
const toChart = (t: number) => (t + IST) as UTCTimestamp;
const DEFAULT_BARS = 150;

type Props = {
  candles: Candle[];
  /** Changes whenever a new symbol/timeframe is loaded, so the view resets only then (not on live ticks). */
  loadKey: string;
  symbol: string;
  name: string;
  exchange: string;
  tf: Timeframe;
  chartType: ChartType;
  studies: string[];
  delayed: boolean;
  /** Seconds of history to show after a load (from the range bar); defaults to the last 150 bars. */
  visibleSeconds?: number;
  onRemoveStudy: (id: string) => void;
  onTrade: (side: 'BUY' | 'SELL') => void;
  /** Open paper positions in this symbol, drawn as average-price lines like TradingView's position lines. */
  positions?: { product: string; qty: number; avgPricePaise: number }[];
  /** Active price alerts on this symbol, drawn as dashed lines. */
  alertLines?: AlertLine[];
  /** The alert tool was clicked at this price. */
  onAlertAt?: (price: number) => void;
  /** TradingView-library indicators on the chart (calculated by the feed service). */
  libStudies?: LibStudy[];
  onRemoveLib?: (uid: string) => void;
  onEditLib?: (uid: string) => void;
};

type LibResult = { plots: Record<string, { time: number; value: number; color?: string }[]> };

type Built = { id: string; pane: number; series: ISeriesApi<SeriesType>[] };

export function ChartView(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const wmRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const builtRef = useRef<Built[]>([]);
  const builtKey = useRef('');
  const viewKey = useRef('');
  const computed = useRef(new Map<string, { values: Record<string, Series>; colors?: PointColors }>());
  const indexByTime = useRef(new Map<number, number>());
  const layer = useRef(new DrawingLayer());
  // TradingView-library indicators: one renderer each, keyed by the study's uid.
  const libRenderers = useRef(new Map<string, IndicatorRenderer>());
  const libResults = useRef(new Map<string, LibResult>());
  const [catalog, setCatalog] = useState<LibIndicator[]>([]);
  const clearLib = () => {
    for (const r of libRenderers.current.values()) { try { r.clear(); } catch { /* its pane may already be gone */ } }
    libRenderers.current.clear();
    libResults.current.clear();
  };
  const [hover, setHover] = useState<number | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([]);
  const [, setVersion] = useState(0);

  // ---- create the chart once ----
  useEffect(() => {
    const chart = createChart(host.current!, {
      autoSize: true,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#131722',
        fontSize: 11,
        // Canvas text can't read CSS variables, so resolve next/font's generated family name for Plus Jakarta Sans.
        fontFamily: `${getComputedStyle(document.documentElement).getPropertyValue('--font-jakarta').trim() || 'system-ui'}, system-ui, sans-serif`,
        panes: { separatorColor: '#ecebe6', separatorHoverColor: 'rgba(18,18,18,0.08)' },
      },
      grid: { vertLines: { color: '#f3f2ee' }, horzLines: { color: '#f3f2ee' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9598a1', style: LineStyle.Dotted, labelBackgroundColor: '#121212' },
        horzLine: { color: '#9598a1', style: LineStyle.Dotted, labelBackgroundColor: '#121212' },
      },
      rightPriceScale: { borderColor: '#ecebe6', minimumWidth: 72 },
      timeScale: { borderColor: '#ecebe6', timeVisible: true, rightOffset: 8 },
      localization: { priceFormatter: (v: number) => fmt(v) },
    });
    chartRef.current = chart;
    // Re-apply the font once web fonts finish loading so the scales don't stay on the fallback font.
    document.fonts?.ready.then(() => chartRef.current?.applyOptions({ layout: { fontFamily: chart.options().layout.fontFamily } }));
    volRef.current = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    wmRef.current = createTextWatermark(chart.panes()[0], { horzAlign: 'center', vertAlign: 'center', lines: [] });

    const onMove = (e: MouseEventParams<Time>) => setHover(e.time == null ? null : indexByTime.current.get(e.time as number) ?? null);
    chart.subscribeCrosshairMove(onMove);
    const measure = () => {
      let top = 0;
      setPaneTops(chart.panes().map((pane) => { const t = top; top += pane.getHeight() + 1; return t; }));
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // ---- main series follows the chart type ----
  useEffect(() => {
    const chart = chartRef.current!;
    clearLib(); // library renderers hold the old main series; they are rebuilt below
    if (mainRef.current) chart.removeSeries(mainRef.current);
    const ohlc = { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false };
    mainRef.current =
      p.chartType === 'line' ? chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2 })
      : p.chartType === 'area' ? chart.addSeries(AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.25)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2 })
      : p.chartType === 'bars' ? chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN })
      : chart.addSeries(CandlestickSeries, ohlc);
    mainRef.current.setData([]); // filled by the data effect below
    mainRef.current.attachPrimitive(layer.current); // drawings follow the main series
  }, [p.chartType]);

  // ---- data, studies and view ----
  useEffect(() => {
    const chart = chartRef.current, main = mainRef.current;
    if (!chart || !main) return;
    const c = p.candles;
    indexByTime.current = new Map(c.map((b, i) => [toChart(b.time), i]));
    layer.current.set({ times: c.map((b) => b.time) });

    const shown = p.chartType === 'ha' ? heikinAshi(c) : c;
    main.setData(
      p.chartType === 'line' || p.chartType === 'area'
        ? c.map((b) => ({ time: toChart(b.time), value: b.close }))
        : shown.map((b) => ({ time: toChart(b.time), open: b.open, high: b.high, low: b.low, close: b.close })),
    );
    const hasVolume = c.some((b) => b.volume > 0); // Yahoo has no volume for indices
    volRef.current!.applyOptions({ visible: hasVolume });
    volRef.current!.setData(hasVolume ? c.map((b) => ({ time: toChart(b.time), value: b.volume, color: b.close >= b.open ? 'rgba(8,153,129,0.28)' : 'rgba(242,54,69,0.28)' })) : []);

    // Rebuild indicator series only when the selection changes; otherwise just refresh their data.
    const key = p.studies.join(',');
    if (key !== builtKey.current) {
      clearLib(); // pane numbers change: library indicators are drawn again after this rebuild
      builtRef.current.forEach((b) => b.series.forEach((s) => chart.removeSeries(s)));
      for (let i = chart.panes().length - 1; i > 0; i--) chart.removePane(i);
      let nextPane = 1;
      builtRef.current = p.studies.flatMap((id) => {
        const st = studyById(id);
        if (!st) return [];
        const pane = st.place === 'main' ? 0 : nextPane++;
        const series = st.lines.map((ln) => {
          const common = { priceLineVisible: false, lastValueVisible: st.place === 'pane', title: '' };
          return ln.kind === 'histogram'
            ? chart.addSeries(HistogramSeries, { ...common, color: ln.color }, pane)
            : chart.addSeries(LineSeries, { ...common, color: ln.color, lineWidth: ln.width ?? 1, crosshairMarkerVisible: st.place === 'pane',
                autoscaleInfoProvider: st.range ? () => ({ priceRange: { minValue: st.range![0], maxValue: st.range![1] } }) : undefined }, pane);
        });
        st.levels?.forEach((price) => series[0].createPriceLine({ price, color: '#b2b5be', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
        // Bounded oscillators (RSI 0–100) get tight margins so the scale doesn't run past the range.
        if (st.range) series[0].priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });
        return [{ id, pane, series }];
      });
      const panes = chart.panes();
      panes.forEach((pane, i) => pane.setStretchFactor(i === 0 ? 3 : 1));
      builtKey.current = key;
    }
    computed.current = new Map();
    for (const b of builtRef.current) {
      const st = studyById(b.id)!;
      const out = st.compute(c);
      computed.current.set(b.id, out);
      st.lines.forEach((ln, i) => {
        const vals = out.values[ln.key], cols = out.colors?.[ln.key];
        b.series[i].setData(c.map((bar, j) => {
          const v = vals[j];
          if (v == null) return { time: toChart(bar.time) };
          return cols?.[j] ? { time: toChart(bar.time), value: v, color: cols[j]! } : { time: toChart(bar.time), value: v };
        }));
      });
    }

    // Reset the visible range on a new symbol/timeframe only, so live ticks don't fight the user's scrolling.
    if (viewKey.current !== p.loadKey && c.length) {
      viewKey.current = p.loadKey;
      const last = c[c.length - 1].time;
      if (p.visibleSeconds) {
        const from = c.find((b) => b.time >= last - p.visibleSeconds!)?.time ?? c[0].time;
        chart.timeScale().setVisibleRange({ from: toChart(from), to: toChart(last) });
      } else {
        chart.timeScale().setVisibleLogicalRange({ from: c.length - DEFAULT_BARS, to: c.length + 8 });
      }
    }
    // New panes are laid out on the chart's next paint, so measure one frame after that.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      let top = 0;
      setPaneTops(chart.panes().map((pane) => { const t = top; top += pane.getHeight() + 1; return t; }));
    }));
    setVersion((v) => v + 1);
  }, [p.candles, p.chartType, p.studies, p.loadKey, p.visibleSeconds]);

  // ---- TradingView-library indicators: calculated by the feed service on the chart's own data, drawn by the
  // library's renderer. Runs after the data effect above (effects run in order), so our panes are already laid out. ----
  const libKey = JSON.stringify(p.libStudies ?? []);
  useEffect(() => { if (p.libStudies?.length && !catalog.length) fetchCatalog().then(setCatalog, () => {}); }, [p.libStudies?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastBarTime = p.candles.at(-1)?.time ?? 0;
  const [libTick, setLibTick] = useState(0);
  useEffect(() => {
    if (!p.libStudies?.length) return;
    const id = setInterval(() => setLibTick((t) => t + 1), 15_000); // the forming bar
    return () => clearInterval(id);
  }, [p.libStudies?.length]);
  const libGen = useRef(0);
  const structureKey = `${p.symbol}|${p.tf}|${p.chartType}|${p.studies.join(',')}|${libKey}|${catalog.length}`;
  const builtFor = useRef('');
  useEffect(() => {
    const chart = chartRef.current, main = mainRef.current;
    const studies = p.libStudies ?? [];
    if (!chart || !main) return;
    if (builtFor.current !== structureKey) { clearLib(); builtFor.current = structureKey; } // add/remove/reorder: draw all again
    if (!studies.length || !catalog.length || !p.candles.length) return;
    const gen = ++libGen.current;
    const ctrl = new AbortController();
    const bars = p.candles.map((b) => ({ time: toChart(b.time) as number, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    let nextPane = 1 + new Set(builtRef.current.filter((b) => b.pane > 0).map((b) => b.pane)).size;
    const plan = studies.map((s) => {
      const entry = catalog.find((c) => c.id === s.id);
      return entry ? { s, entry, pane: entry.overlay ? 0 : nextPane++ } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    void (async () => {
      for (const { s, entry, pane } of plan) {
        let result;
        try { result = await computeLib(p.symbol, p.tf, s.id, s.inputs, ctrl.signal); } catch { continue; }
        if (gen !== libGen.current) return; // a newer symbol/timeframe/indicator set replaced this run
        let r = libRenderers.current.get(s.uid);
        const fresh = !r;
        if (!r) { r = new IndicatorRenderer(chart, { paneIndex: pane, mainSeries: main }); libRenderers.current.set(s.uid, r); }
        try {
          r.render(entry as never, result as never, bars as never, { inputs: s.inputs, reuseSeries: !fresh, lastValueVisible: !entry.overlay });
          libResults.current.set(s.uid, result as LibResult);
        } catch { /* a bad result must not break the chart */ }
      }
      requestAnimationFrame(() => {
        let top = 0;
        setPaneTops(chart.panes().map((pane) => { const t = top; top += pane.getHeight() + 1; return t; }));
        setVersion((v) => v + 1);
      });
    })();
    return () => ctrl.abort();
  }, [structureKey, lastBarTime, libTick, p.loadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Position lines follow the main series, which is recreated when the chart type changes.
  const posKey = (p.positions ?? []).map((x) => `${x.product}:${x.qty}:${x.avgPricePaise}`).join('|');
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const lines = (p.positions ?? []).map((x) =>
      main.createPriceLine({
        price: Math.round(x.avgPricePaise) / 100,
        color: x.qty > 0 ? '#2962ff' : DOWN,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${x.product} ${x.qty > 0 ? '+' : ''}${x.qty}`,
      }),
    );
    return () => lines.forEach((l) => main.removePriceLine(l));
  }, [posKey, p.chartType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    wmRef.current?.applyOptions({
      lines: [
        { text: `${p.symbol}, ${tfLabel(p.tf)}`, color: 'rgba(18,18,18,0.06)', fontSize: 72, fontStyle: '600' },
        { text: p.name, color: 'rgba(18,18,18,0.06)', fontSize: 26 },
      ],
    });
  }, [p.symbol, p.name, p.tf]);

  // ---- drawings: trend lines, rays, horizontal/vertical lines, zones, notes, measure, alert-by-click ----
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number; point: Point } | null>(null);
  const live = useRef({ tool, drawings, selected, start: null as Point | null, end: null as Point | null, measureDone: false });
  live.current.tool = tool; live.current.drawings = drawings; live.current.selected = selected;
  const loadedFor = useRef('');

  // Each symbol keeps its own drawings, shown on every timeframe.
  useEffect(() => {
    loadedFor.current = p.symbol;
    setDrawings(loadDrawings(p.symbol));
    setSelected(null);
    live.current.start = live.current.end = null;
    layer.current.set({ preview: null, measure: null });
  }, [p.symbol]);
  useEffect(() => { if (loadedFor.current === p.symbol) saveDrawings(p.symbol, drawings); }, [drawings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { layer.current.set({ drawings, selected }); }, [drawings, selected]);
  useEffect(() => { layer.current.set({ alerts: p.alertLines ?? [] }); }, [p.alertLines]);

  const pickTool = (t: Tool) => {
    setTool(t);
    live.current.start = live.current.end = null;
    live.current.measureDone = false;
    layer.current.set({ preview: null, measure: null });
    if (t !== 'cursor') setSelected(null);
  };

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    /** Chart point (time, price) under pane-0 coordinates, or null outside the data. */
    const pointAt = (x: number, y: number): Point | null => {
      const main = mainRef.current, ts = chart.timeScale();
      const x0 = ts.logicalToCoordinate(0 as never), x1 = ts.logicalToCoordinate(1 as never);
      const price = main?.coordinateToPrice(y);
      if (x0 == null || x1 == null || x1 === x0 || price == null) return null;
      const time = logicalToTime(layer.current.state.times, (x - x0) / (x1 - x0));
      return time == null ? null : { time, price };
    };
    const bars = (a: Point, b: Point) => Math.abs((timeToLogical(layer.current.state.times, b.time) ?? 0) - (timeToLogical(layer.current.state.times, a.time) ?? 0));
    const add = (d: Drawing) => { setDrawings((list) => [...list, d]); setSelected(d.id); };

    /** A click with a drawing tool at pane-0 coordinates (detected from pointer down/up, see below). */
    const onClick = (at: { x: number; y: number }) => {
      const L = live.current;
      if (L.tool === 'cursor') return;
      const e = { point: at };
      const pt = pointAt(at.x, at.y);
      if (!pt) return;
      const color = COLORS[0];
      if (L.tool === 'alert') { p.onAlertAt?.(Math.round(pt.price * 20) / 20); pickTool('cursor'); return; }
      if (L.tool === 'hline' || L.tool === 'vline') { add({ id: newId(), kind: L.tool, p1: pt, color }); pickTool('cursor'); return; }
      // Opened after this pointer event finishes, so the release doesn't immediately take focus away from the box.
      if (L.tool === 'text') { setTimeout(() => setTextAt({ x: e.point.x, y: e.point.y, point: pt }), 0); return; }
      if (L.tool === 'measure') {
        if (!L.start || L.measureDone) { L.start = pt; L.measureDone = false; layer.current.set({ measure: { from: pt, to: pt, text: measureText(pt, pt, 0) } }); }
        else { L.measureDone = true; layer.current.set({ measure: { from: L.start, to: pt, text: measureText(L.start, pt, bars(L.start, pt)) } }); }
        return;
      }
      if (L.tool === 'channel') { // base line start, base line end, then a third click for the width
        if (!L.start) { L.start = pt; layer.current.set({ preview: { id: 'preview', kind: 'channel', p1: pt, p2: pt, color } }); }
        else if (!L.end) { L.end = pt; layer.current.set({ preview: { id: 'preview', kind: 'channel', p1: L.start, p2: pt, p3: pt, color } }); }
        else { add({ id: newId(), kind: 'channel', p1: L.start, p2: L.end, p3: pt, color }); L.start = L.end = null; layer.current.set({ preview: null }); pickTool('cursor'); }
        return;
      }
      if (TWO_POINT.includes(L.tool)) {
        if (!L.start) { L.start = pt; layer.current.set({ preview: { id: 'preview', kind: L.tool as Drawing['kind'], p1: pt, p2: pt, color } }); }
        else { add({ id: newId(), kind: L.tool as Drawing['kind'], p1: L.start, p2: pt, color }); L.start = null; layer.current.set({ preview: null }); pickTool('cursor'); }
      }
    };
    const onMove = (e: MouseEventParams<Time>) => {
      const L = live.current;
      if (!L.start || !e.point) return;
      const pt = pointAt(e.point.x, e.point.y);
      if (!pt) return;
      if (L.tool === 'measure' && !L.measureDone) layer.current.set({ measure: { from: L.start, to: pt, text: measureText(L.start, pt, bars(L.start, pt)) } });
      else if (layer.current.state.preview) layer.current.set({ preview: { ...layer.current.state.preview, ...(L.end ? { p3: pt } : { p2: pt }) } });
    };
    chart.subscribeCrosshairMove(onMove);

    // Pointer handling, captured before the chart sees it. Drawing tools: a press and release in the same spot is a
    // click (the chart's own click event can be swallowed right after another interaction). Cursor tool: select and
    // drag drawings, without also panning the chart.
    const el = host.current!;
    let drag: { id: string; handle: 'p1' | 'p2' | 'p3' | 'body'; from: Point; orig: Drawing } | null = null;
    let press: { x: number; y: number } | null = null;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const inMainPane = (xy: { x: number; y: number }) => xy.y >= 0 && xy.y <= (chart.panes()[0]?.getHeight() ?? 0) && xy.x >= 0 && xy.x <= chart.timeScale().width();
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const xy = local(e);
      if (!inMainPane(xy)) return;
      if (live.current.tool !== 'cursor') { press = xy; return; }
      const hit = hitTest(layer.current.placeAll(live.current.drawings), xy, chart.timeScale().width());
      if (!hit) { setSelected(null); return; }
      setSelected(hit.id);
      const from = pointAt(xy.x, xy.y), orig = live.current.drawings.find((d) => d.id === hit.id);
      if (!from || !orig) return;
      drag = { id: hit.id, handle: hit.handle, from, orig };
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.stopPropagation();
    };
    const onDrag = (e: PointerEvent) => {
      if (!drag) return;
      const xy = local(e), pt = pointAt(xy.x, xy.y);
      if (!pt) return;
      const { orig, handle, from } = drag;
      const shift = (q: Point): Point => ({ time: q.time + (pt.time - from.time), price: q.price + (pt.price - from.price) });
      let next: Drawing = handle === 'p1' ? { ...orig, p1: pt } : handle === 'p2' ? { ...orig, p2: pt } : handle === 'p3' ? { ...orig, p3: pt }
        : { ...orig, p1: shift(orig.p1), p2: orig.p2 && shift(orig.p2), p3: orig.p3 && shift(orig.p3) };
      // Moving a channel's base line keeps its width.
      if (orig.kind === 'channel' && orig.p2 && orig.p3 && next.p2 && (handle === 'p1' || handle === 'p2')) {
        next = { ...next, p3: { time: orig.p3.time, price: orig.p3.price - channelOffset(next.p1, next.p2, orig.p3) + channelOffset(orig.p1, orig.p2, orig.p3) } };
      }
      setDrawings((list) => list.map((d) => (d.id === next.id ? next : d)));
    };
    const onUp = (e: PointerEvent) => {
      if (press) {
        const xy = local(e), at = press;
        press = null;
        if (Math.hypot(xy.x - at.x, xy.y - at.y) <= 5) onClick(at); // a click, not a pan
      }
      if (!drag) return;
      drag = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
    };
    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', onUp);

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') { pickTool('cursor'); setSelected(null); setTextAt(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && live.current.selected) {
        const id = live.current.selected;
        setDrawings((list) => list.filter((d) => d.id !== id));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [p.onAlertAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedDrawing = drawings.find((d) => d.id === selected);

  // ---- legend ----
  const c = p.candles;
  const i = hover ?? c.length - 1;
  const bar = c[i];
  const prev = c[i - 1] ?? bar;
  const last = c[c.length - 1];
  const ch = bar && prev ? bar.close - prev.close : 0;
  const tone = ch >= 0 ? 'text-up' : 'text-down';
  // Read after the data effect rebuilds the series; its setVersion call re-renders with the new list.
  const studyRows = builtRef.current;

  // Library indicators in the legend: name, values at the crosshair (or the last bar), settings and remove.
  let libPane = 1 + new Set(studyRows.filter((b) => b.pane > 0).map((b) => b.pane)).size;
  const libRows = (p.libStudies ?? []).flatMap((s) => {
    const entry = catalog.find((c) => c.id === s.id);
    return entry ? [{ s, entry, pane: entry.overlay ? 0 : libPane++ }] : [];
  });
  const libRow = ({ s, entry }: (typeof libRows)[number]) => {
    const res = libResults.current.get(s.uid);
    const lens = entry.inputConfig.filter((x) => x.type === 'int' || x.type === 'float').slice(0, 3).map((x) => s.inputs[x.id] ?? x.defval);
    return (
      <div key={s.uid} className="pointer-events-auto flex w-fit items-center gap-1.5 text-[12px] text-ink-2">
        <span>{entry.shortName}{lens.length ? ` ${lens.join(' ')}` : ''}</span>
        {entry.plotConfig.slice(0, 4).map((pc) => {
          const v = res?.plots[pc.id]?.[i]?.value;
          return <span key={pc.id} className="num" style={{ color: pc.color }}>{v == null || !Number.isFinite(v) ? '—' : fmt(v)}</span>;
        })}
        <button type="button" onClick={() => p.onEditLib?.(s.uid)} className="rounded px-1 text-muted hover:bg-raised hover:text-ink" aria-label={`${entry.name} settings`}><Settings2 size={12} /></button>
        <button type="button" onClick={() => p.onRemoveLib?.(s.uid)} className="rounded px-1 text-muted hover:bg-raised hover:text-ink" aria-label={`Remove ${entry.name}`}><X size={12} /></button>
      </div>
    );
  };

  const row = (id: string) => {
    const st = studyById(id)!;
    const out = computed.current.get(id);
    return (
      <div key={id} className="pointer-events-auto flex w-fit items-center gap-1.5 text-[12px] text-ink-2">
        <span>{st.name}</span>
        {st.lines.map((ln) => {
          const v = out?.values[ln.key]?.[i];
          const col = out?.colors?.[ln.key]?.[i] ?? ln.color;
          return <span key={ln.key} className="num" style={{ color: col }}>{v == null ? '—' : fmt(v)}</span>;
        })}
        <button type="button" onClick={() => p.onRemoveStudy(id)} className="rounded px-1 text-muted hover:bg-raised hover:text-ink" aria-label={`Remove ${st.name}`}>
          <X size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full">
    <DrawingRail tool={tool} onTool={pickTool} count={drawings.length} onClearAll={() => { setDrawings([]); setSelected(null); }} />
    <div className="relative h-full min-w-0 flex-1">
      <div ref={host} className={`absolute inset-0 ${tool !== 'cursor' ? 'cursor-crosshair' : ''}`} />
      {selectedDrawing && (
        <div className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-panel px-2 py-1 shadow-[var(--shadow-pop)]" role="toolbar" aria-label="Selected drawing">
          {COLORS.map((col) => (
            <button key={col} type="button" onClick={() => setDrawings((list) => list.map((d) => (d.id === selectedDrawing.id ? { ...d, color: col } : d)))}
              className={`h-5 w-5 rounded-full border-2 ${selectedDrawing.color === col ? 'border-ink' : 'border-transparent'}`} style={{ background: col }} aria-label={`Colour ${col}`} />
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <button type="button" onClick={() => { setDrawings((list) => list.filter((d) => d.id !== selectedDrawing.id)); setSelected(null); }}
            className="rounded-full p-1 text-ink-2 hover:bg-down-soft hover:text-down" aria-label="Delete drawing" title="Delete (Del)"><Trash2 size={14} /></button>
        </div>
      )}
      {textAt && (
        <form className="absolute z-20" style={{ left: textAt.x, top: textAt.y - 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const text = String(new FormData(e.currentTarget).get('note') ?? '').trim();
            if (text) { const d: Drawing = { id: newId(), kind: 'text', p1: textAt.point, text: text.slice(0, 80), color: COLORS[4] }; setDrawings((list) => [...list, d]); setSelected(d.id); }
            setTextAt(null);
            pickTool('cursor');
          }}>
          <input name="note" autoFocus maxLength={80} placeholder="Note, then Enter" onBlur={(e) => { if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit(); }}
            className="h-8 w-56 rounded-[8px] border border-ink bg-panel px-2 text-[13px] shadow-[var(--shadow-pop)] outline-none" />
        </form>
      )}
      {bar && (
        <div className="pointer-events-none absolute top-1.5 left-2.5 z-10 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 text-[13px] whitespace-nowrap">
            <b className="font-bold">{p.name} · {tfLabel(p.tf)} · {p.exchange}</b>
            {p.delayed && <span title="Delayed data" className="grid h-4 w-4 place-items-center rounded-full border border-accent bg-accent-soft text-[9px] font-bold text-accent-ink">D</span>}
            <span className={`num text-[12.5px] ${tone}`}>
              O<span className="mr-1.5 ml-0.5">{fmt(bar.open)}</span>H<span className="mr-1.5 ml-0.5">{fmt(bar.high)}</span>L<span className="mr-1.5 ml-0.5">{fmt(bar.low)}</span>C<span className="mr-1.5 ml-0.5">{fmt(bar.close)}</span>
              {ch >= 0 ? '+' : ''}{fmt(ch)} ({ch >= 0 ? '+' : ''}{fmt(prev.close ? (ch / prev.close) * 100 : 0)}%)
            </span>
          </div>
          {last && (
            <div className="pointer-events-auto flex w-fit items-center gap-1">
              <button type="button" onClick={() => p.onTrade('SELL')} className="flex flex-col items-center rounded-md border border-down bg-white px-2.5 py-0.5 text-[12.5px] leading-tight font-bold text-down hover:bg-down hover:text-white">
                <span className="num">{fmt(last.close)}</span><span className="text-[9.5px] font-semibold">SELL</span>
              </button>
              <span className="num px-0.5 text-[10.5px] text-muted">0.05</span>
              <button type="button" onClick={() => p.onTrade('BUY')} className="flex flex-col items-center rounded-md border border-blue bg-white px-2.5 py-0.5 text-[12.5px] leading-tight font-bold text-blue hover:bg-blue hover:text-white">
                <span className="num">{fmt(last.close + 0.05)}</span><span className="text-[9.5px] font-semibold">BUY</span>
              </button>
            </div>
          )}
          {studyRows.filter((b) => b.pane === 0).map((b) => row(b.id))}
          {libRows.filter((x) => x.pane === 0).map(libRow)}
        </div>
      )}
      {libRows.filter((x) => x.pane > 0).map((x) => (
        <div key={x.s.uid} className="pointer-events-none absolute left-2.5 z-10" style={{ top: (paneTops[x.pane] ?? 0) + 4 }}>
          {libRow(x)}
        </div>
      ))}
      {studyRows.filter((b) => b.pane > 0).map((b) => (
        <div key={b.id} className="pointer-events-none absolute left-2.5 z-10" style={{ top: (paneTops[b.pane] ?? 0) + 4 }}>
          {row(b.id)}
        </div>
      ))}
    </div>
    </div>
  );
}
