'use client';

import { useEffect, useRef } from 'react';
import { createChart, HistogramSeries, LineSeries, LineStyle, type IChartApi } from 'lightweight-charts';
import { fmt } from '@/lib/format';
import { CHART_COLORS, chartThemeOptions, useTheme } from '@/lib/theme';

export type TimeSeries = {
  title: string;
  type: 'line' | 'histogram';
  color: string;
  data: { time: string; value: number; color?: string }[];
  /** 0 = main pane; higher numbers stack panes below. */
  pane?: number;
  /** 'left' puts the series on a second price scale in its pane. */
  scale?: 'left' | 'right';
  dashed?: boolean;
  format?: (v: number) => string;
};

/**
 * Daily series on a date axis (lightweight-charts), one or more panes. Each pane after the first gets `paneHeight`.
 */
export function TimeChart({ series, height = 380, paneHeight = 130 }: { series: TimeSeries[]; height?: number; paneHeight?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const C = CHART_COLORS[useTheme()];
  useEffect(() => {
    const chart = createChart(host.current!, {
      autoSize: true,
      ...chartThemeOptions(C),
      layout: {
        ...chartThemeOptions(C).layout, fontSize: 11,
        fontFamily: `${getComputedStyle(document.documentElement).getPropertyValue('--font-outfit').trim() || 'system-ui'}, system-ui, sans-serif`,
      },
      rightPriceScale: { borderColor: C.line, minimumWidth: 72 },
      // Long daily series (years of closes) must fit the width when the chart opens, not be cut at the left.
      timeScale: { borderColor: C.line, minBarSpacing: 0.01 },
      leftPriceScale: { borderColor: C.line, visible: series.some((s) => s.scale === 'left') },
      localization: { priceFormatter: (v: number) => fmt(v) },
    });
    chartRef.current = chart;
    for (const s of series) {
      const opts = {
        color: s.color, title: s.title, priceScaleId: s.scale === 'left' ? 'left' : 'right', lastValueVisible: true, priceLineVisible: false,
        ...(s.format ? { priceFormat: { type: 'custom' as const, formatter: s.format, minMove: 0.0001 } } : {}),
      };
      const api = s.type === 'histogram'
        ? chart.addSeries(HistogramSeries, opts, s.pane ?? 0)
        : chart.addSeries(LineSeries, { ...opts, lineWidth: 2, lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid }, s.pane ?? 0);
      api.setData([...s.data].sort((a, b) => (a.time < b.time ? -1 : 1)));
    }
    // Lower panes get about paneHeight each; the main pane takes the rest (stretch factors are relative).
    const panes = chart.panes();
    if (panes.length > 1) {
      const lower = paneHeight * (panes.length - 1);
      panes[0].setStretchFactor(Math.max(1, height - lower) / paneHeight);
      for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
    }
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [series, C, paneHeight, height]);
  return <div ref={host} className="w-full" style={{ height }} />;
}
