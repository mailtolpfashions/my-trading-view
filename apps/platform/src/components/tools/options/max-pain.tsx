'use client';

import { useMemo, useState } from 'react';
import { day, daysBefore, fetchDerived, fetchMaxPainHistory, pct, rupees, strike, tone, useLoad, type MaxPainExpiry } from '@/lib/fno';
import type { ChainRow } from '@/lib/options';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented, Stat } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { SERIES, XYChart } from '../xy-chart';
import { AsOf, ChainControls, strikeWindow, useChainTool } from './chain-common';

/** Payout to option holders (rupees) if the expiry close were each listed strike. Same rule as the server. */
function painCurve(rows: ChainRow[]) {
  return rows.map(({ strikePaise: K }) => {
    let pain = 0;
    for (const r of rows) {
      if (r.CE?.oi && K > r.strikePaise) pain += (r.CE.oi * (K - r.strikePaise)) / 100;
      if (r.PE?.oi && K < r.strikePaise) pain += (r.PE.oi * (r.strikePaise - K)) / 100;
    }
    return { strikePaise: K, pain };
  });
}
const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function MaxPainTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const [range, setRange] = useState(20);
  const [before, setBefore] = useState(1);
  const c = t.chain.data;
  const curve = useMemo(() => (c ? painCurve(c.rows) : []), [c]);
  const best = curve.length && curve.some((p) => p.pain > 0) ? curve.reduce((a, b) => (b.pain < a.pain ? b : a)) : null;
  const shown = useMemo(() => {
    if (!c) return [];
    const keep = new Set(strikeWindow(c, range).map((r) => r.strikePaise));
    return curve.filter((p) => keep.has(p.strikePaise));
  }, [c, curve, range]);

  const expiry = c?.expiry;
  const trail = useLoad(expiry ? `${t.u}|${expiry}` : null, (s) => fetchDerived({ underlying: t.u, expiry: expiry!, from: daysBefore(expiry!, 120), to: expiry! }, s));
  const trailSeries = useMemo<TimeSeries[]>(() => {
    const pts = trail.data?.points ?? [];
    return [
      { title: 'Spot', type: 'line', color: SERIES.blue, data: pts.filter((p) => p.spotPaise != null).map((p) => ({ time: p.date, value: p.spotPaise! / 100 })) },
      { title: 'Max pain', type: 'line', color: SERIES.accent, data: pts.filter((p) => p.maxPainPaise != null).map((p) => ({ time: p.date, value: p.maxPainPaise! / 100 })) },
    ];
  }, [trail.data]);

  const hist = useLoad(`${t.u}|${before}`, (s) => fetchMaxPainHistory({ underlying: t.u, before, from: daysBefore(new Date().toISOString().slice(0, 10), 3 * 365) }, s));
  const past = useMemo(() => (hist.data?.expiries ?? []).map((e) => ({ ...e, gap: e.expiryClosePaise - e.maxPainPaise, gapPct: ((e.expiryClosePaise - e.maxPainPaise) / e.maxPainPaise) * 100 })).reverse(), [hist.data]);
  const absGaps = past.map((e) => Math.abs(e.gapPct));
  const within1 = past.length ? (absGaps.filter((g) => g <= 1).length / past.length) * 100 : null;
  const columns: Column<MaxPainExpiry & { gap: number; gapPct: number }>[] = [
    { key: 'expiry', label: 'Expiry', align: 'left', render: (r) => day(r.expiry, true), value: (r) => r.expiry },
    { key: 'date', label: 'Max pain as of', align: 'left', render: (r) => day(r.date), value: (r) => r.date, wide: true },
    { key: 'mp', label: 'Max pain', render: (r) => strike(r.maxPainPaise), value: (r) => r.maxPainPaise / 100 },
    { key: 'then', label: 'Spot then', render: (r) => rupees(r.spotThenPaise), value: (r) => (r.spotThenPaise == null ? null : r.spotThenPaise / 100), wide: true },
    { key: 'close', label: 'Expiry close', render: (r) => rupees(r.expiryClosePaise), value: (r) => r.expiryClosePaise / 100 },
    { key: 'gap', label: 'Close − max pain', render: (r) => `${r.gap >= 0 ? '+' : '−'}${rupees(Math.abs(r.gap))}`, value: (r) => r.gap / 100, className: (r) => tone(r.gap) },
    { key: 'gp', label: 'Gap %', render: (r) => pct(r.gapPct, 2, true), value: (r) => r.gapPct, className: (r) => tone(r.gapPct) },
  ];

  return (
    <ToolShell tool={tool} controls={<ChainControls t={t} range={range} setRange={setRange} extra={<AsOf c={c} />} />}
      about={<>
        <p>For each listed strike K, we add up what option holders would receive if the underlying closed exactly at K on expiry: every call below K pays (K − its strike) × its open interest, and every put above K pays (its strike − K) × its open interest. Max pain is the strike where that total is smallest. Open interest is the close of the day shown.</p>
        <p>The past-expiries table takes max pain a chosen number of sessions before each expiry and compares it with the underlying&rsquo;s official close on expiry day. It is a record of what happened, not a forecast.</p>
      </>}>
      {!c ? <div className="panel grid min-h-[300px]"><Loading error={t.chain.error} loading={t.chain.loading} /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Max pain" value={strike(best?.strikePaise)} />
            <Stat label="Spot" value={rupees(c.spotPaise)} />
            <Stat label="Spot − max pain" value={best && c.spotPaise != null ? `${pct(((c.spotPaise - best.strikePaise) / best.strikePaise) * 100, 2, true)}` : '—'} className={tone(best && c.spotPaise != null ? c.spotPaise - best.strikePaise : null)} />
            <Stat label="Expiry" value={day(c.expiry, true)} />
          </div>
          <Card title="Payout to option holders at each expiry close" right={<><Key bar color={SERIES.accent} label="Total payout" /><Key dashed color={SERIES.blue} label="Spot" /><Key dashed color={SERIES.ce} label="Max pain" /></>}>
            <div className="p-2">
              <XYChart height={320} xLabel="Expiry close (strike)" xFormat={(x) => x.toLocaleString('en-IN')} yFormat={(y) => `₹${(y / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`}
                series={[{ name: 'Payout', kind: 'bar', color: SERIES.accent, points: shown.map((p) => ({ x: p.strikePaise / 100, y: p.pain })) }]}
                markers={[...(c.spotPaise != null ? [{ x: c.spotPaise / 100, label: 'Spot', color: SERIES.blue }] : []), ...(best ? [{ x: best.strikePaise / 100, label: 'Max pain', color: SERIES.ce }] : [])]} />
            </div>
          </Card>
          <Card title={`Max pain and spot until ${day(c.expiry, true)}`} right={<><Key color={SERIES.blue} label="Spot" /><Key color={SERIES.accent} label="Max pain" /></>}>
            {trail.data?.points.length ? <TimeChart series={trailSeries} height={300} /> : <div className="grid min-h-[200px]"><Loading error={trail.error} loading={trail.loading} /></div>}
          </Card>
        </>
      )}
      <Card title="Past expiries: max pain against the expiry close"
        right={<Segmented label="Max pain taken" value={before} onChange={setBefore} options={[{ value: 1, label: '1 session before' }, { value: 3, label: '3 before' }, { value: 5, label: '5 before' }]} />}>
        {past.length > 0 && (
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
            <Stat label="Expiries compared" value={String(past.length)} />
            <Stat label="Median |gap|" value={pct(median(absGaps), 2)} />
            <Stat label="Closed within ±1%" value={pct(within1, 0)} hint="Share of expiries whose close was within 1% of max pain" />
          </div>
        )}
        {hist.data ? <DataTable rows={past} columns={columns} rowKey={(r) => r.expiry} csvName={`${t.u}-max-pain-expiries.csv`} maxHeight="50dvh" empty="No expiries with stored statistics yet." />
          : <div className="grid min-h-[160px]"><Loading error={hist.error} loading={hist.loading} /></div>}
      </Card>
    </ToolShell>
  );
}
