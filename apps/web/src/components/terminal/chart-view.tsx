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
import { X } from 'lucide-react';
import { heikinAshi, type Series } from '@mtv/indicators';
import type { Candle, Timeframe } from '@mtv/shared';
import { DOWN, UP, studyById, type PointColors } from '@/lib/chart/studies';
import { fmt, tfLabel } from '@/lib/format';

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
};

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
    if (mainRef.current) chart.removeSeries(mainRef.current);
    const ohlc = { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false };
    mainRef.current =
      p.chartType === 'line' ? chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2 })
      : p.chartType === 'area' ? chart.addSeries(AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.25)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2 })
      : p.chartType === 'bars' ? chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN })
      : chart.addSeries(CandlestickSeries, ohlc);
    mainRef.current.setData([]); // filled by the data effect below
  }, [p.chartType]);

  // ---- data, studies and view ----
  useEffect(() => {
    const chart = chartRef.current, main = mainRef.current;
    if (!chart || !main) return;
    const c = p.candles;
    indexByTime.current = new Map(c.map((b, i) => [toChart(b.time), i]));

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

  const row = (id: string) => {
    const st = studyById(id)!;
    const out = computed.current.get(id);
    return (
      <div key={id} className="pointer-events-auto flex items-center gap-1.5 text-[12px] text-ink-2">
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
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
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
            <div className="pointer-events-auto flex items-center gap-1">
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
        </div>
      )}
      {studyRows.filter((b) => b.pane > 0).map((b) => (
        <div key={b.id} className="pointer-events-none absolute left-2.5 z-10" style={{ top: (paneTops[b.pane] ?? 0) + 4 }}>
          {row(b.id)}
        </div>
      ))}
    </div>
  );
}
