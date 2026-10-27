'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, HistogramSeries, LineSeries, LineStyle, type IChartApi } from 'lightweight-charts';
import { fmt } from '@/lib/format';
import { BUILD_UP, FuturesAccessError, fetchFuturesHistory, fetchLiveFutures, type BuildUp, type FuturesDay, type LiveFutures } from '@/lib/futures';
import { fmtDate } from '@/lib/options';

const rupees = (p: number | null | undefined) => (p == null ? '—' : fmt(p / 100));
const signedRupees = (p: number | null | undefined) => (p == null ? '—' : `${p >= 0 ? '+' : '−'}${fmt(Math.abs(p) / 100)}`);
const pct = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`);
const lakh = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '−' : ''}${(Math.abs(n) / 1e5).toFixed(2)}L`);
const signedLakh = (n: number | null | undefined) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${(Math.abs(n) / 1e5).toFixed(2)}L`);
const tone = (n: number | null | undefined) => (n == null || n === 0 ? '' : n > 0 ? 'text-up' : 'text-down');
// Annualised carry over one or two days swings wildly; show it from 3 days to expiry.
const carry = (c: number | null, dte: number) => (dte < 3 ? '—' : pct(c, 1));

const TONE_CLASS: Record<string, string> = { up: 'bg-up text-white', 'up-soft': 'bg-up-soft text-up', down: 'bg-down text-white', 'down-soft': 'bg-down-soft text-down', neutral: 'bg-raised text-ink-2' };
const OI_COLOR: Record<BuildUp, string> = { 'long-buildup': '#089981', 'short-covering': 'rgba(8,153,129,0.45)', 'short-buildup': '#f23645', 'long-unwinding': 'rgba(242,54,69,0.45)', neutral: '#b8b7b0' };

function BuildUpPill({ b }: { b: BuildUp }) {
  return <span title={BUILD_UP[b].hint} className={`rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${TONE_CLASS[BUILD_UP[b].tone]}`}>{BUILD_UP[b].label}</span>;
}

/** Futures module: NIFTY / BANKNIFTY futures vs spot, open interest and build-up. Live strip for admin / Live plan. */
export function FuturesView() {
  const [u, setU] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [range, setRange] = useState(250);
  const [days, setDays] = useState<FuturesDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveFutures | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  useEffect(() => {
    setDays(null);
    fetchFuturesHistory(u, range).then((r) => { setDays(r.days); setError(null); }, (e: Error) => setError(e.message));
  }, [u, range]);

  useEffect(() => {
    setLive(null);
    let stop = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const load = () => fetchLiveFutures(u).then(
      (r) => { if (!stop) { setLive(r); setLiveNote(null); } },
      (e) => {
        if (stop) return;
        setLiveNote(e instanceof FuturesAccessError ? e.message : 'Live futures unavailable');
        // Not on the plan, or no live source: asking again every few seconds won't change that.
        if (e instanceof FuturesAccessError && ['live_plan_required', 'needs_broker'].includes(e.code)) clearInterval(id);
      },
    );
    void load();
    id = setInterval(load, 3000);
    return () => { stop = true; clearInterval(id); };
  }, [u]);

  const latest = days?.at(-1);
  const recent = days ? [...days].reverse().slice(0, 30) : [];

  return (
    <main className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-panel p-1 shadow-[var(--shadow-panel)]" role="tablist" aria-label="Index">
          {(['NIFTY', 'BANKNIFTY'] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={x === u} onClick={() => setU(x)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${x === u ? 'bg-ink text-white' : 'text-ink-2 hover:bg-raised'}`}>{x} futures</button>
          ))}
        </div>
        <select className="h-9 rounded-full bg-panel px-3 text-[12.5px] font-semibold shadow-[var(--shadow-panel)]" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="History">
          {[60, 120, 250, 500].map((n) => <option key={n} value={n}>Last {n} sessions</option>)}
        </select>
        <span className="text-[12px] text-muted">History from NSE&rsquo;s official F&amp;O files{latest ? ` · latest ${fmtDate(latest.date)}` : ''}</span>
      </div>

      <LiveStrip live={live} note={liveNote} />

      <div className="grid min-h-0 grid-cols-[1fr_580px] gap-2">
        <section className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-4 border-b border-line px-4 py-2.5 text-[12px] text-ink-2">
            <span className="font-bold text-ink">Near-month future vs spot</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 bg-[#2962ff]" />Future</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-0 w-4 border-t-2 border-dashed border-ink-2" />Spot (index close)</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-up" />OI coloured by build-up</span>
          </div>
          {error ? <p className="m-auto text-[13px] font-semibold text-down">{error}</p> : !days ? <p className="m-auto text-[13px] text-muted">Loading…</p> : <FuturesChart days={days} />}
        </section>

        <section className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-[13px] font-bold">Daily build-up (near month)</p>
            <p className="text-[11.5px] text-muted">Each day compares the same contract with its own previous close and open interest.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="num w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-panel text-[10.5px] text-muted">
                <tr className="text-right"><th className="py-1.5 pl-3 text-left font-semibold">Date</th><th className="font-semibold">Future</th><th className="font-semibold">Chg</th><th className="font-semibold">Basis</th><th className="font-semibold">OI</th><th className="font-semibold">OI chg</th><th className="pr-3 pl-3 text-left font-semibold">Build-up</th></tr>
              </thead>
              <tbody>
                {recent.map((d) => (
                  <tr key={d.date} className="border-t border-line text-right">
                    <td className="py-1.5 pl-3 text-left font-sans" title={d.near ? `Contract expiring ${fmtDate(d.near.expiry)} · rollover ${pct(d.rolloverPct, 1).replace('+', '')}` : undefined}>{fmtDate(d.date).slice(0, 6)}</td>
                    <td>{rupees(d.near?.closePaise)}</td>
                    <td className={tone(d.near?.changePaise)}>{signedRupees(d.near?.changePaise)}</td>
                    <td className={tone(d.near?.basisPaise)} title={d.near?.premiumPct != null ? `${pct(d.near.premiumPct)} premium · carry ${carry(d.near.carryPct, d.near.daysToExpiry)} a year` : undefined}>{signedRupees(d.near?.basisPaise)}</td>
                    <td>{lakh(d.near?.oi)}</td>
                    <td className={tone(d.near?.oiChange)}>{signedLakh(d.near?.oiChange)}</td>
                    <td className="pr-3 pl-3 text-left">{d.near && <BuildUpPill b={d.near.buildUp} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function LiveStrip({ live, note }: { live: LiveFutures | null; note: string | null }) {
  if (!live) {
    return note ? <p className="rounded-[14px] bg-panel px-4 py-2.5 text-[12.5px] text-ink-2 shadow-[var(--shadow-panel)]">{note}</p> : <p className="px-1 text-[12px] text-muted">Loading live futures…</p>;
  }
  const label = ['Near month', 'Next month', 'Far month'];
  return (
    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.8fr)] gap-2">
      {live.contracts.map((c, i) => (
        <div key={c.expiry} className="panel px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold text-ink-2">{label[i]} · {fmtDate(c.expiry)}</span>
            <BuildUpPill b={c.buildUp} />
          </div>
          <div className="num mt-1 flex items-baseline gap-2">
            <span className="text-[20px] font-extrabold tracking-[-0.02em]">{rupees(c.ltpPaise)}</span>
            <span className={`text-[12.5px] font-semibold ${tone(c.changePaise)}`}>{signedRupees(c.changePaise)}</span>
          </div>
          <div className="num mt-1 grid grid-cols-3 gap-1 text-[11.5px] text-ink-2">
            <span><span className="block text-[10.5px] text-muted">Basis</span><span className={tone(c.basisPaise)}>{signedRupees(c.basisPaise)}</span></span>
            <span><span className="block text-[10.5px] text-muted">OI</span>{lakh(c.oi)}</span>
            <span title={c.oiBaseDate ? `vs ${fmtDate(c.oiBaseDate)} close` : undefined}><span className="block text-[10.5px] text-muted">OI chg</span><span className={tone(c.oiChange)}>{signedLakh(c.oiChange)}</span></span>
          </div>
        </div>
      ))}
      <div className="panel px-4 py-3">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-ink-2"><span className="live-dot h-2 w-2 rounded-full bg-up" />Live · spot</span>
        <p className="num mt-1 text-[20px] font-extrabold tracking-[-0.02em]">{rupees(live.spotPaise)}</p>
        <p className="num mt-1 text-[11.5px] text-ink-2">Rollover {live.rolloverPct == null ? '—' : `${live.rolloverPct.toFixed(1)}%`} · lot {live.lot ?? '—'}</p>
      </div>
    </div>
  );
}

function FuturesChart({ days }: { days: FuturesDay[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    const chart = createChart(host.current!, {
      autoSize: true,
      layout: {
        background: { color: '#ffffff' }, textColor: '#131722', fontSize: 11,
        fontFamily: `${getComputedStyle(document.documentElement).getPropertyValue('--font-jakarta').trim() || 'system-ui'}, system-ui, sans-serif`,
        panes: { separatorColor: '#ecebe6' },
      },
      grid: { vertLines: { color: '#f3f2ee' }, horzLines: { color: '#f3f2ee' } },
      rightPriceScale: { borderColor: '#ecebe6', minimumWidth: 72 },
      timeScale: { borderColor: '#ecebe6' },
      localization: { priceFormatter: (v: number) => fmt(v) },
    });
    chartRef.current = chart;
    const withNear = days.filter((d) => d.near);
    chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, title: 'Future' })
      .setData(withNear.map((d) => ({ time: d.date, value: d.near!.closePaise / 100 })));
    chart.addSeries(LineSeries, { color: '#45453f', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'Spot', lastValueVisible: false, priceLineVisible: false })
      .setData(days.filter((d) => d.spotPaise != null).map((d) => ({ time: d.date, value: d.spotPaise! / 100 })));
    const oi = chart.addSeries(HistogramSeries, { title: 'Near OI (lakh)', lastValueVisible: false, priceLineVisible: false }, 1);
    oi.setData(withNear.map((d) => ({ time: d.date, value: d.near!.oi / 1e5, color: OI_COLOR[d.near!.buildUp] })));
    chart.panes()[1]?.setHeight(140);
    chart.timeScale().fitContent();
    return () => { chart.remove(); chartRef.current = null; };
  }, [days]);
  return <div ref={host} className="min-h-0 flex-1" />;
}
