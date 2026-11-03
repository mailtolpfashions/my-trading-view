'use client';

// A plain candle chart of NSE end-of-day bars: candles, volume, D / W / M. The full chart (indicators, drawings,
// compare) moves over from the old app in a later step.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CandlestickSeries, CrosshairMode, HistogramSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@mtv/shared';
import { FeedError, feed } from '@/lib/feed';
import { CHART_COLORS, chartThemeOptions, useTheme } from '@/lib/theme';
import { Segmented, inputCls } from '../ui';

const IST = 5.5 * 3600;
const toChart = (t: number) => (t + IST) as UTCTimestamp;
type Tf = 'D' | 'W' | 'M';

export function BasicChart({ symbol, tf: initialTf }: { symbol: string; tf: Tf }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ c: ISeriesApi<'Candlestick'>; v: ISeriesApi<'Histogram'> } | null>(null);
  const [tf, setTf] = useState<Tf>(initialTf);
  const [data, setData] = useState<{ name: string; candles: Candle[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    const c = createChart(host.current!, {
      autoSize: true,
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: false, rightOffset: 6 },
      rightPriceScale: { minimumWidth: 72 },
      layout: { fontSize: 11, fontFamily: `${getComputedStyle(document.documentElement).getPropertyValue('--font-outfit').trim() || 'system-ui'}, system-ui, sans-serif` },
    });
    const candles = c.addSeries(CandlestickSeries, { upColor: '#0a9b76', downColor: '#e5484d', borderVisible: false, wickUpColor: '#0a9b76', wickDownColor: '#e5484d' });
    const vol = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    chart.current = c;
    series.current = { c: candles, v: vol };
    return () => { c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    const t = chartThemeOptions(CHART_COLORS[theme]);
    chart.current?.applyOptions({
      ...t,
      layout: { ...t.layout, fontSize: 11 },
      crosshair: { vertLine: { ...t.crosshair.vertLine, style: LineStyle.Dotted }, horzLine: { ...t.crosshair.horzLine, style: LineStyle.Dotted } },
    });
  }, [theme]);

  useEffect(() => {
    let live = true;
    setError(null);
    feed<{ instrument: { name: string }; candles: Candle[] }>(`candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`)
      .then((r) => { if (live) setData({ name: r.instrument.name, candles: r.candles }); })
      .catch((e) => { if (live) { setData(null); setError(e instanceof FeedError ? e.message : 'Could not load the chart'); } });
    return () => { live = false; };
  }, [symbol, tf]);

  useEffect(() => {
    if (!series.current) return;
    const c = data?.candles ?? [];
    series.current.c.setData(c.map((b) => ({ time: toChart(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    series.current.v.setData(c.map((b) => ({ time: toChart(b.time), value: b.volume, color: b.close >= b.open ? 'rgba(10,155,118,0.28)' : 'rgba(229,72,77,0.28)' })));
    if (c.length) chart.current?.timeScale().setVisibleLogicalRange({ from: c.length - (tf === 'D' ? 180 : tf === 'W' ? 150 : 120), to: c.length + 6 });
  }, [data, tf]);

  const last = data?.candles.at(-1), prev = data?.candles.at(-2);
  const chg = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  return (
    <div className="panel grid gap-4 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">{symbol}</h1>
          <p className="text-[13px] text-muted">{data?.name ?? ' '}</p>
        </div>
        {last && (
          <p className="num text-[18px] font-semibold">
            {last.close.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {chg != null && <span className={`ml-2 text-[14px] ${chg >= 0 ? 'text-up' : 'text-down'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
          </p>
        )}
        <Segmented<Tf> label="Timeframe" value={tf} onChange={setTf} options={[{ value: 'D', label: 'D' }, { value: 'W', label: 'W' }, { value: 'M', label: 'M' }]} />
        <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/chart/${encodeURIComponent(q.trim().toUpperCase())}?tf=${tf}`); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol, e.g. TCS" aria-label="Open another symbol" className={`${inputCls} w-44 uppercase`} />
        </form>
        <Link href="/screener" className="text-[13.5px] font-semibold text-accent-deep hover:underline">Back to screener</Link>
      </div>
      {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
      <div ref={host} className="h-[62vh] min-h-[360px] w-full" />
      <p className="text-[12px] text-muted">NSE end-of-day prices, adjusted for splits, bonuses and rights.</p>
    </div>
  );
}
