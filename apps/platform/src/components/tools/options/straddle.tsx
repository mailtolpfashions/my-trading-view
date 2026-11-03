'use client';

import { useMemo, useState } from 'react';
import { day, daysBefore, fetchDerived, pct, rupees, strike, useLoad, type DerivedPoint } from '@/lib/fno';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented, Stat, UnderlyingPicker } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { PALETTE, SERIES, XYChart } from '../xy-chart';
import { AsOf, ChainControls, useChainTool } from './chain-common';
import { DerivedControls, useDerivedTool } from './derived-common';

type StrangleRow = { n: number; callStrike: number; putStrike: number; call: number | null; put: number | null; total: number | null; traded: boolean };

export function StraddleTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const d = useDerivedTool(180);
  const c = t.chain.data;
  const pts = d.series.data?.points ?? [];
  const latest = pts.at(-1);

  const series = useMemo<TimeSeries[]>(() => [
    { title: 'ATM straddle', type: 'line', color: SERIES.accent, data: pts.filter((p) => p.straddlePaise != null).map((p) => ({ time: p.date, value: p.straddlePaise! / 100 })) },
    { title: 'Spot', type: 'line', color: SERIES.blue, scale: 'left', dashed: true, data: pts.filter((p) => p.spotPaise != null).map((p) => ({ time: p.date, value: p.spotPaise! / 100 })) },
    { title: '% of spot', type: 'line', color: SERIES.violet, pane: 1, data: pts.filter((p) => p.straddlePaise != null && p.spotPaise).map((p) => ({ time: p.date, value: (p.straddlePaise! / p.spotPaise!) * 100 })), format: (v) => `${v.toFixed(2)}%` },
  ], [pts]);

  const strangles = useMemo<StrangleRow[]>(() => {
    if (!c || c.atmStrikePaise == null) return [];
    const step = c.strikeStepPaise ?? 0;
    if (!step) return [];
    const by = new Map(c.rows.map((r) => [r.strikePaise, r]));
    const out: StrangleRow[] = [];
    for (let n = 0; n <= 10; n++) {
      const kc = c.atmStrikePaise + n * step, kp = c.atmStrikePaise - n * step;
      const ce = by.get(kc)?.CE, pe = by.get(kp)?.PE;
      if (!ce && !pe) continue;
      out.push({ n, callStrike: kc, putStrike: kp, call: ce?.closePaise ?? null, put: pe?.closePaise ?? null, total: ce && pe ? ce.closePaise + pe.closePaise : null, traded: !!(ce?.traded && pe?.traded) });
    }
    return out;
  }, [c]);
  const spot = c?.spotPaise ?? null;
  const columns: Column<StrangleRow>[] = [
    { key: 'n', label: 'Width', align: 'left', render: (r) => (r.n === 0 ? 'Straddle (ATM)' : `ATM ± ${r.n} strike${r.n > 1 ? 's' : ''}`) },
    { key: 'ps', label: 'Put strike', render: (r) => strike(r.putStrike) },
    { key: 'p', label: 'Put close', render: (r) => rupees(r.put) },
    { key: 'cs', label: 'Call strike', render: (r) => strike(r.callStrike) },
    { key: 'c', label: 'Call close', render: (r) => rupees(r.call) },
    { key: 't', label: 'Total', render: (r) => <b title={r.traded ? undefined : 'At least one leg did not trade that day: its close is carried forward'}>{rupees(r.total)}{r.traded ? '' : ' *'}</b> },
    { key: 'pct', label: '% of spot', render: (r) => (r.total != null && spot ? pct((r.total / spot) * 100, 2) : '—'), wide: true },
    { key: 'be', label: 'Breakevens at expiry', render: (r) => (r.total != null ? `${strike(r.putStrike - r.total)} – ${strike(r.callStrike + r.total)}` : '—'), wide: true },
  ];

  return (
    <ToolShell tool={tool} controls={<DerivedControls t={d} />}
      about={<>
        <p>The ATM straddle is the close of the call plus the close of the put at the strike nearest the market-implied forward price (from put-call parity) that day. When one leg did not trade, NSE carries its previous close forward; such days are marked with an asterisk in the table.</p>
        <p>A strangle at width n sells or buys the call n strikes above ATM and the put n strikes below. Breakevens at expiry are the put strike minus the total premium and the call strike plus it.</p>
      </>}>
      {!d.series.data ? <div className="panel grid min-h-[300px]"><Loading error={d.series.error} loading={d.series.loading} /></div> : (
        <>
          {latest && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={`ATM straddle · ${day(latest.date)}`} value={rupees(latest.straddlePaise)} />
              <Stat label="ATM strike" value={strike(latest.atmStrikePaise)} />
              <Stat label="% of spot" value={latest.straddlePaise != null && latest.spotPaise ? pct((latest.straddlePaise / latest.spotPaise) * 100, 2) : '—'} />
              <Stat label="Days to expiry" value={`${latest.daysToExpiry} (${day(latest.expiry)})`} />
            </div>
          )}
          <Card title={d.expiry ? `ATM straddle until ${day(d.expiry, true)}` : 'ATM straddle, current expiry'} right={<><Key color={SERIES.accent} label="Straddle (₹, right)" /><Key dashed color={SERIES.blue} label="Spot (left)" /><Key color={SERIES.violet} label="% of spot" /></>}>
            {pts.length ? <TimeChart series={series} height={440} paneHeight={140} /> : <div className="grid min-h-[200px]"><Loading empty="No statistics stored for this choice yet." /></div>}
          </Card>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <h2 className="mr-2 text-[15px] font-bold">Straddle and strangle chain</h2>
        <ChainControls t={t} extra={<AsOf c={c} />} />
      </div>
      <Card>
        {c ? <DataTable rows={strangles} columns={columns} rowKey={(r) => String(r.n)} csvName={`${c.underlying}-${c.expiry}-strangles-${c.date}.csv`} maxHeight="none" />
          : <div className="grid min-h-[160px]"><Loading error={t.chain.error} loading={t.chain.loading} /></div>}
      </Card>
    </ToolShell>
  );
}

/** ATM straddle against days to expiry, several expiries on one chart. */
export function DecayTool({ tool }: { tool: Tool }) {
  const d = useDerivedTool(120);
  const [unit, setUnit] = useState<'rs' | 'pct'>('pct');
  const [count, setCount] = useState(4);
  const today = new Date().toISOString().slice(0, 10);
  const expiries = useMemo(() => {
    const all = d.series.data?.expiries ?? [];
    const upcoming = all.filter((e) => e >= (d.series.data?.to ?? today));
    const past = all.filter((e) => e < (d.series.data?.to ?? today));
    return [...past.slice(-(count - 1)), ...upcoming.slice(0, 1)];
  }, [d.series.data, count, today]);
  const key = expiries.length ? `${d.u}|${expiries.join(',')}` : null;
  const curves = useLoad(key, (s) => Promise.all(expiries.map((e) => fetchDerived({ underlying: d.u, expiry: e, from: daysBefore(e, 45), to: e }, s).then((r) => ({ expiry: e, points: r.points })))));
  const value = (p: DerivedPoint) => (p.straddlePaise == null ? null : unit === 'rs' ? p.straddlePaise / 100 : p.spotPaise ? (p.straddlePaise / p.spotPaise) * 100 : null);
  const series = (curves.data ?? []).map((c, i) => ({
    name: day(c.expiry, true), kind: 'line' as const, color: PALETTE[i % PALETTE.length], dashed: c.expiry >= today,
    points: c.points.filter((p) => p.daysToExpiry <= 45).map((p) => ({ x: p.daysToExpiry, y: value(p) })),
  }));

  return (
    <ToolShell tool={tool}
      controls={<>
        <UnderlyingPicker value={d.u} onChange={(u) => d.set({ u })} />
        <Segmented label="Expiries" value={count} onChange={setCount} options={[{ value: 3, label: '3 expiries' }, { value: 4, label: '4' }, { value: 6, label: '6' }]} />
        <Segmented label="Unit" value={unit} onChange={setUnit} options={[{ value: 'pct', label: '% of spot' }, { value: 'rs', label: '₹' }]} />
      </>}
      about={<>
        <p>Each line is one expiry&rsquo;s ATM straddle (call close + put close at the strike nearest the forward) on each trading day, plotted against the calendar days left to that expiry. Shown as a share of the spot price, expiries from different price levels can be compared.</p>
        <p>The current expiry is dashed. Days when a leg did not trade use NSE&rsquo;s carried-forward close.</p>
      </>}>
      <Card title="ATM straddle as expiry approaches" right={series.map((s) => <Key key={s.name} color={s.color} dashed={s.dashed} label={s.name} />)}>
        <div className="p-2">
          {curves.data ? <XYChart height={380} series={series} reverseX xLabel="Days to expiry" xFormat={(x) => String(Math.round(x))} yFormat={(y) => (unit === 'rs' ? `₹${y.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : `${y.toFixed(2)}%`)} />
            : <div className="grid min-h-[300px]"><Loading error={curves.error ?? d.series.error} loading={curves.loading || d.series.loading} /></div>}
        </div>
      </Card>
    </ToolShell>
  );
}
