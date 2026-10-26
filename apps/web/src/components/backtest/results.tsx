'use client';

import { useEffect, useRef } from 'react';
import { AreaSeries, CandlestickSeries, createChart, createSeriesMarkers, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { formatRupees } from '@mtv/paper';
import type { BacktestResponse } from '@/lib/backtest';
import { DOWN, UP } from '@/lib/chart/studies';
import { DataCheck } from '@/components/terminal/data-check';
import { fmt, tfLabel } from '@/lib/format';

const IST = 5.5 * 3600;
const toChart = (t: number) => (t + IST) as UTCTimestamp;
const istDateTime = (t: number, intraday: boolean) => {
  const d = new Date((t + IST) * 1000).toISOString();
  return intraday ? `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}` : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
};
const pct = (v: number | null, digits = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);
const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'text-up' : 'text-down');
const REASON: Record<string, string> = { stop: 'Stop loss', target: 'Target', signal: 'Exit rule', 'square-off': 'Square-off', 'end-of-data': 'End of data' };

function chartBase(el: HTMLElement): IChartApi {
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-jakarta').trim() || 'system-ui';
  return createChart(el, {
    autoSize: true,
    layout: { background: { color: '#ffffff' }, textColor: '#131722', fontSize: 11, fontFamily: `${font}, system-ui, sans-serif`, panes: { separatorColor: '#ecebe6' } },
    grid: { vertLines: { color: '#f3f2ee' }, horzLines: { color: '#f3f2ee' } },
    rightPriceScale: { borderColor: '#ecebe6' },
    // Years of daily bars must fit the panel: allow sub-pixel spacing so fitContent can show the whole test period.
    timeScale: { borderColor: '#ecebe6', timeVisible: true, minBarSpacing: 0.05 },
    localization: { priceFormatter: (v: number) => fmt(v) },
  });
}

export function BacktestResults({ data }: { data: BacktestResponse }) {
  const { result, candles, quality, tf } = data;
  const m = result.metrics;
  const intraday = tf !== 'D' && tf !== 'W';
  const priceEl = useRef<HTMLDivElement>(null);
  const equityEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chart = chartBase(priceEl.current!);
    const s = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    s.setData(candles.map((c) => ({ time: toChart(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    const long = result.trades[0]?.side !== 'SHORT';
    // Compact B/S markers like TradingView's strategy tester; the exit is green for a winning trade, red for a loser.
    const markers: SeriesMarker<Time>[] = result.trades.flatMap((t) => [
      { time: toChart(t.entryTime), position: long ? 'belowBar' : 'aboveBar', color: '#2962ff', shape: long ? 'arrowUp' : 'arrowDown', text: long ? 'B' : 'S' },
      { time: toChart(t.exitTime), position: long ? 'aboveBar' : 'belowBar', color: t.netPaise > 0 ? UP : DOWN, shape: long ? 'arrowDown' : 'arrowUp', text: long ? 'S' : 'B' },
    ] as SeriesMarker<Time>[]).sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(s, markers);

    const eq = chartBase(equityEl.current!);
    const area = eq.addSeries(AreaSeries, { lineColor: '#121212', topColor: 'rgba(255,194,26,0.35)', bottomColor: 'rgba(255,194,26,0.02)', lineWidth: 2, priceLineVisible: false });
    area.setData(result.equity.map((e) => ({ time: toChart(e.time), value: e.equityPaise / 100 })));
    area.createPriceLine({ price: m.initialCapitalPaise / 100, color: '#8b8a83', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'Start' });
    // Fit after the charts have their real size (autoSize lays out on the next frame), so the whole test period shows.
    const fit = () => { chart.timeScale().fitContent(); eq.timeScale().fitContent(); };
    const raf = requestAnimationFrame(() => requestAnimationFrame(fit));
    return () => { cancelAnimationFrame(raf); chart.remove(); eq.remove(); };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = (label: string, value: string, cls = '', hint?: string, sub?: string) => (
    <div className="min-w-0 rounded-[12px] bg-raised px-3 py-2" title={hint}>
      <p className="truncate text-[11px] font-semibold text-muted">{label}</p>
      <p className={`num truncate text-[16px] font-semibold ${cls}`}>{value}</p>
      {sub && <p className="num truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-extrabold tracking-[-0.02em]">{data.instrument.symbol} · {tfLabel(tf)}</p>
        <p className="num text-[12px] text-muted">{m.from ? istDateTime(m.from, intraday) : ''} → {m.to ? istDateTime(m.to, intraday) : ''} · {m.bars.toLocaleString('en-IN')} bars</p>
        <span className="flex-1" />
        <DataCheck quality={quality} delayed={data.status.delayed} />
      </div>

      <div className="grid grid-cols-4 gap-2 min-[1800px]:grid-cols-8">
        {card('Net P&L', formatRupees(m.netPaise), tone(m.netPaise), 'After all charges')}
        {card('Return', pct(m.returnPct), tone(m.returnPct), `On starting capital ${formatRupees(m.initialCapitalPaise)}`)}
        {card('Buy & hold', pct(m.buyHoldReturnPct), tone(m.buyHoldReturnPct), 'Price change over the same period, for comparison')}
        {card('Trades', String(m.trades), '', undefined, `${m.wins} won · ${m.losses} lost`)}
        {card('Win rate', m.winRatePct == null ? '—' : `${m.winRatePct.toFixed(1)}%`)}
        {card('Profit factor', m.profitFactor == null ? '—' : m.profitFactor.toFixed(2), '', 'Gross wins ÷ gross losses, after charges')}
        {card('Max drawdown', m.maxDrawdownPaise ? `−${m.maxDrawdownPct.toFixed(2)}%` : '0.00%', m.maxDrawdownPaise ? 'text-down' : '', 'Largest fall in account value from a previous peak', formatRupees(-m.maxDrawdownPaise))}
        {card('Charges paid', formatRupees(m.chargesPaise), '', 'Brokerage, STT, exchange, SEBI, stamp duty and GST', `Gross ${formatRupees(m.grossPaise)}`)}
      </div>

      <div className="grid min-h-[300px] grid-cols-[1.6fr_1fr] gap-2">
        <div className="relative min-h-[300px] overflow-hidden rounded-[12px] border border-line"><div ref={priceEl} className="absolute inset-0" /></div>
        <div className="relative min-h-[300px] overflow-hidden rounded-[12px] border border-line">
          <p className="absolute top-2 left-3 z-10 text-[12px] font-bold">Equity curve</p>
          <div ref={equityEl} className="absolute inset-0" />
        </div>
      </div>

      <div className="rounded-[12px] border border-line">
        <div className="flex items-center gap-3 px-3 py-2 text-[12px]">
          <b className="text-[13px] font-extrabold">Trades</b>
          <span className="text-muted">Avg win <b className="num font-medium text-up">{m.avgWinPaise == null ? '—' : formatRupees(m.avgWinPaise)}</b></span>
          <span className="text-muted">Avg loss <b className="num font-medium text-down">{m.avgLossPaise == null ? '—' : formatRupees(m.avgLossPaise)}</b></span>
          <span className="text-muted">Largest loss <b className="num font-medium text-down">{m.largestLossPaise == null ? '—' : formatRupees(m.largestLossPaise)}</b></span>
          <span className="text-muted">Max losing streak <b className="num font-medium text-ink">{m.maxConsecutiveLosses}</b></span>
          <span className="text-muted">Time in market <b className="num font-medium text-ink">{m.exposurePct.toFixed(1)}%</b></span>
          {m.skippedEntries > 0 && <span className="text-down">{m.skippedEntries} entries skipped (capital too small for one share)</span>}
        </div>
        {result.trades.length ? (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] font-bold tracking-[0.05em] text-muted uppercase">
                {['#', 'Entry', 'Exit', 'Side', 'Qty', 'Entry price', 'Exit price', 'Exit reason', 'Gross', 'Charges', 'Net'].map((h) => <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...result.trades].reverse().map((t, i) => (
                <tr key={t.entryTime} className="num border-t border-line text-right">
                  <td className="px-3 py-1.5 text-left text-muted">{result.trades.length - i}</td>
                  <td className="px-3 py-1.5">{istDateTime(t.entryTime, intraday)}</td>
                  <td className="px-3 py-1.5">{istDateTime(t.exitTime, intraday)}</td>
                  <td className={`px-3 py-1.5 font-sans font-bold ${t.side === 'LONG' ? 'text-blue' : 'text-down'}`}>{t.side}</td>
                  <td className="px-3 py-1.5">{t.qty}</td>
                  <td className="px-3 py-1.5">{formatRupees(t.entryPricePaise)}</td>
                  <td className="px-3 py-1.5">{formatRupees(t.exitPricePaise)}</td>
                  <td className="px-3 py-1.5 font-sans">{REASON[t.exitReason]}</td>
                  <td className={`px-3 py-1.5 ${tone(t.grossPaise)}`}>{formatRupees(t.grossPaise)}</td>
                  <td className="px-3 py-1.5">{formatRupees(t.chargesPaise)}</td>
                  <td className={`px-3 py-1.5 font-semibold ${tone(t.netPaise)}`}>{formatRupees(t.netPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-3 pb-4 text-[13px] text-muted">No trades: the entry rules never fired in this period.</p>}
      </div>

      <p className="text-[11px] leading-snug text-muted">
        Backtests use historical data and simulated fills at bar prices; real results differ (slippage, spreads, liquidity, data defects shown above).
        Past performance does not guarantee future results. Not investment advice.
      </p>
    </div>
  );
}
