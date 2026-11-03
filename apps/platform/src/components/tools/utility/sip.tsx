'use client';

import { useMemo, useState } from 'react';
import { fetchCandles } from '@/lib/feed';
import { amountAt, assumedGrowth, xirr } from '@/lib/sip';
import { crore, day, pct, useLoad } from '@/lib/fno';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented, Stat, selectClass } from '../controls';
import { DataTable } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { SERIES, XYChart } from '../xy-chart';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const input = 'h-9 w-[130px] rounded-full bg-panel px-3 text-[12.5px] font-semibold shadow-[var(--shadow-panel)] outline-none focus-visible:ring-2 focus-visible:ring-accent num';
const IST = 5.5 * 3600;

type YearRow = { year: number; invested: number; value: number };

function AssumedReturn({ monthly, years, rate, stepUp }: { monthly: number; years: number; rate: number; stepUp: number }) {
  const rows = useMemo<YearRow[]>(() => assumedGrowth(monthly, years, rate, stepUp), [monthly, years, rate, stepUp]);
  const last = rows.at(-1);
  if (!last) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="You invest" value={inr(last.invested)} />
        <Stat label="It grows to" value={inr(last.value)} />
        <Stat label="Gain" value={inr(last.value - last.invested)} className="text-up" />
        <Stat label="Value ÷ invested" value={`${(last.value / last.invested).toFixed(2)}×`} />
      </div>
      <Card title="Invested and value at the end of each year" right={<><Key bar color={SERIES.grey} label="Invested" /><Key bar color={SERIES.accent} label="Value" /></>}>
        <div className="p-2">
          <XYChart height={300} xLabel="Year" xFormat={(x) => String(Math.round(x))} yFormat={(y) => crore(y)}
            series={[
              { name: 'Invested', kind: 'bar', color: SERIES.grey, points: rows.map((r) => ({ x: r.year, y: r.invested })) },
              { name: 'Value', kind: 'bar', color: SERIES.accent, points: rows.map((r) => ({ x: r.year, y: r.value })) },
            ]} />
        </div>
      </Card>
      <Card title="Year by year">
        <DataTable rows={rows} rowKey={(r) => String(r.year)} csvName="sip-assumed.csv" maxHeight="50dvh"
          columns={[
            { key: 'y', label: 'Year', align: 'left', render: (r) => String(r.year), value: (r) => r.year },
            { key: 'i', label: 'Invested', render: (r) => inr(r.invested), value: (r) => Math.round(r.invested) },
            { key: 'v', label: 'Value', render: (r) => <b>{inr(r.value)}</b>, value: (r) => Math.round(r.value) },
            { key: 'g', label: 'Gain', render: (r) => inr(r.value - r.invested), value: (r) => Math.round(r.value - r.invested), className: () => 'text-up' },
          ]} />
      </Card>
    </>
  );
}

function NiftyHistory({ monthly, from, stepUp }: { monthly: number; from: string; stepUp: number }) {
  const c = useLoad('NIFTY|D', (s) => fetchCandles('NIFTY', 'D', s));
  const closes = useMemo(() => (c.data?.candles ?? []).map((k) => ({ date: new Date((k.time + IST) * 1000).toISOString().slice(0, 10), close: k.close })), [c.data]);
  const run = useMemo(() => {
    if (!closes.length) return null;
    const buys: { date: string; close: number; amount: number; units: number }[] = [];
    let month = '';
    for (const k of closes) {
      if (k.date < from || k.date.slice(0, 7) === month) continue;
      month = k.date.slice(0, 7); // first trading day of each month
      const amount = amountAt(monthly, stepUp, buys.length);
      buys.push({ date: k.date, close: k.close, amount, units: amount / k.close });
    }
    if (!buys.length) return null;
    const lastClose = closes[closes.length - 1];
    const units = buys.reduce((s, b) => s + b.units, 0), invested = buys.reduce((s, b) => s + b.amount, 0);
    const value = units * lastClose.close;
    const rate = xirr([...buys.map((b) => ({ date: b.date, amount: -b.amount })), { date: lastClose.date, amount: value }]);
    // Daily value of the units held so far, against the money put in so far.
    const series: { date: string; value: number; invested: number }[] = [];
    let u = 0, inv = 0, j = 0;
    for (const k of closes) {
      if (k.date < buys[0].date) continue;
      while (j < buys.length && buys[j].date <= k.date) { u += buys[j].units; inv += buys[j].amount; j++; }
      series.push({ date: k.date, value: u * k.close, invested: inv });
    }
    return { buys, invested, value, rate, lastClose, series };
  }, [closes, from, monthly, stepUp]);
  const chart = useMemo<TimeSeries[]>(() => !run ? [] : [
    { title: 'Value', type: 'line', color: SERIES.accent, data: run.series.map((s) => ({ time: s.date, value: s.value })), format: (v) => crore(v) },
    { title: 'Invested', type: 'line', color: SERIES.grey, dashed: true, data: run.series.map((s) => ({ time: s.date, value: s.invested })), format: (v) => crore(v) },
  ], [run]);
  if (!run) return <div className="panel grid min-h-[260px]"><Loading error={c.error} loading={c.loading} empty="No NIFTY 50 closes from that month." /></div>;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={`Invested · ${run.buys.length} months`} value={inr(run.invested)} />
        <Stat label={`Value on ${day(run.lastClose.date, true)}`} value={inr(run.value)} />
        <Stat label="Gain" value={inr(run.value - run.invested)} className={run.value >= run.invested ? 'text-up' : 'text-down'} />
        <Stat label="Annual return (XIRR)" value={run.rate == null ? '—' : pct(run.rate * 100, 1, true)} className={run.rate != null && run.rate >= 0 ? 'text-up' : 'text-down'} />
        <Stat label="First buy" value={`${day(run.buys[0].date, true)}`} />
      </div>
      <Card title="Value of the SIP against money invested" right={<><Key color={SERIES.accent} label="Value" /><Key dashed color={SERIES.grey} label="Invested" /></>}>
        <TimeChart series={chart} height={360} />
      </Card>
      <Card title="Every instalment">
        <DataTable rows={[...run.buys].reverse()} rowKey={(b) => b.date} csvName="sip-nifty50.csv" maxHeight="50dvh"
          columns={[
            { key: 'd', label: 'Date', align: 'left', render: (b) => day(b.date, true), value: (b) => b.date },
            { key: 'a', label: 'Amount', render: (b) => inr(b.amount), value: (b) => Math.round(b.amount) },
            { key: 'c', label: 'NIFTY 50 close', render: (b) => b.close.toLocaleString('en-IN', { minimumFractionDigits: 2 }), value: (b) => b.close },
            { key: 'u', label: 'Units', render: (b) => b.units.toFixed(4), value: (b) => b.units },
            { key: 'v', label: 'Worth now', render: (b) => inr(b.units * run.lastClose.close), value: (b) => Math.round(b.units * run.lastClose.close) },
          ]} />
      </Card>
    </>
  );
}

export function SipTool({ tool }: { tool: Tool }) {
  const [mode, setMode] = useState<'assumed' | 'nifty'>('assumed');
  const [monthly, setMonthly] = useState(10000);
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(12);
  const [stepUp, setStepUp] = useState(0);
  const [from, setFrom] = useState('2016-01');
  const yearsBack = Array.from({ length: 13 }, (_, i) => 2014 + i);
  const num = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));
  return (
    <ToolShell tool={tool}
      controls={<>
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'assumed', label: 'Assumed return' }, { value: 'nifty', label: 'NIFTY 50 history' }]} />
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">Monthly ₹<input type="number" className={input} value={monthly} min={100} step={500} onChange={(e) => setMonthly(num(e.target.value, 0, 1e8))} /></label>
        {mode === 'assumed' ? (
          <>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">Years<input type="number" className={`${input} w-[80px]`} value={years} min={1} max={50} onChange={(e) => setYears(num(e.target.value, 1, 50))} /></label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">Return % a year<input type="number" className={`${input} w-[90px]`} value={rate} step={0.5} min={-50} max={50} onChange={(e) => setRate(num(e.target.value, -50, 50))} /></label>
          </>
        ) : (
          <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">Start
            <select className={selectClass} value={from.slice(0, 4)} onChange={(e) => setFrom(`${e.target.value}-01`)} aria-label="Start year">
              {yearsBack.map((y) => <option key={y} value={y}>January {y}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">Step-up % a year<input type="number" className={`${input} w-[80px]`} value={stepUp} step={1} min={0} max={50} onChange={(e) => setStepUp(num(e.target.value, 0, 50))} /></label>
      </>}
      about={<>
        <p><b>Assumed return:</b> each instalment is invested at the start of a month and grows at the monthly rate equal to your yearly return, (1 + yearly)^(1/12) − 1. Step-up raises the instalment by that percentage every 12 months. The return you type is an assumption, not a forecast.</p>
        <p><b>NIFTY 50 history:</b> one instalment on the first trading day of each month, bought at that day&rsquo;s official NIFTY 50 close, valued at the latest close. This is the price index: it leaves out dividends, costs and taxes, so a real index fund&rsquo;s result differs. XIRR is the yearly return that makes these dated cash flows add up. Past results are not a guide to future ones.</p>
      </>}>
      {mode === 'assumed' ? <AssumedReturn monthly={monthly} years={years} rate={rate} stepUp={stepUp} /> : <NiftyHistory monthly={monthly} from={`${from}-01`} stepUp={stepUp} />}
    </ToolShell>
  );
}
