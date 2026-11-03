'use client';

import { useMemo } from 'react';
import { day, lakh, ratio, rupees, tone, useLoad } from '@/lib/fno';
import { fetchFuturesHistory } from '@/lib/futures';
import type { Tool } from '@/lib/tools';
import { Loading, Stat } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { SERIES } from '../xy-chart';
import { DerivedControls, useDerivedTool } from './derived-common';

/** Daily put − call open interest, its change, and the change-in-OI ratio. */
export function PeCeTool({ tool }: { tool: Tool }) {
  const t = useDerivedTool(180);
  const pts = t.series.data?.points ?? [];
  const rows = useMemo(() => pts.map((p, i) => {
    const prev = i > 0 && pts[i - 1].expiry === p.expiry ? pts[i - 1] : null;
    const dCe = prev ? p.ceOi - prev.ceOi : null, dPe = prev ? p.peOi - prev.peOi : null;
    return { ...p, diff: p.peOi - p.ceOi, diffChange: prev ? p.peOi - p.ceOi - (prev.peOi - prev.ceOi) : null, dCe, dPe, chgPcr: dCe && dPe != null ? dPe / dCe : null };
  }).reverse(), [pts]);
  const latest = rows[0];
  const series = useMemo<TimeSeries[]>(() => [
    { title: 'Spot', type: 'line', color: SERIES.blue, data: pts.filter((p) => p.spotPaise != null).map((p) => ({ time: p.date, value: p.spotPaise! / 100 })) },
    { title: 'PE − CE OI (lakh)', type: 'histogram', color: SERIES.pe, pane: 1, data: pts.map((p) => ({ time: p.date, value: (p.peOi - p.ceOi) / 1e5, color: p.peOi >= p.ceOi ? SERIES.pe : SERIES.ce })) },
  ], [pts]);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'date', label: 'Date', align: 'left', render: (r) => day(r.date, true), value: (r) => r.date },
    { key: 'spot', label: 'Spot', render: (r) => rupees(r.spotPaise), value: (r) => (r.spotPaise == null ? null : r.spotPaise / 100) },
    { key: 'ce', label: 'Call OI', render: (r) => lakh(r.ceOi), value: (r) => r.ceOi },
    { key: 'pe', label: 'Put OI', render: (r) => lakh(r.peOi), value: (r) => r.peOi },
    { key: 'diff', label: 'PE − CE', render: (r) => <b>{lakh(r.diff, true)}</b>, value: (r) => r.diff, className: (r) => tone(r.diff) },
    { key: 'dd', label: 'Change in PE − CE', render: (r) => lakh(r.diffChange, true), value: (r) => r.diffChange, className: (r) => tone(r.diffChange) },
    { key: 'dce', label: 'Call OI chg', render: (r) => lakh(r.dCe, true), value: (r) => r.dCe, wide: true },
    { key: 'dpe', label: 'Put OI chg', render: (r) => lakh(r.dPe, true), value: (r) => r.dPe, wide: true },
    { key: 'pcr', label: 'PCR', render: (r) => ratio(r.oiPcr), value: (r) => r.oiPcr },
    { key: 'cpcr', label: 'Chg-in-OI PCR', title: 'Change in put OI ÷ change in call OI', render: (r) => ratio(r.chgPcr), value: (r) => r.chgPcr, wide: true },
  ];
  return (
    <ToolShell tool={tool} controls={<DerivedControls t={t} />}
      about={<>
        <p>PE − CE is the expiry&rsquo;s total put open interest minus its total call open interest at the close. The change columns compare with the previous trading day for the same expiry; they are blank on the day the current expiry rolls to the next one.</p>
        <p>Change-in-OI PCR divides the day&rsquo;s change in put OI by the change in call OI. It is blank when call OI did not change, and can be negative when one side fell.</p>
      </>}>
      {!t.series.data ? <div className="panel grid min-h-[300px]"><Loading error={t.series.error} loading={t.series.loading} /></div> : (
        <>
          {latest && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={`PE − CE · ${day(latest.date)}`} value={lakh(latest.diff, true)} className={tone(latest.diff)} />
              <Stat label="Change today" value={lakh(latest.diffChange, true)} className={tone(latest.diffChange)} />
              <Stat label="PCR" value={ratio(latest.oiPcr)} />
              <Stat label="Chg-in-OI PCR" value={ratio(latest.chgPcr)} />
            </div>
          )}
          <Card title="Put minus call open interest" right={<><Key color={SERIES.blue} label="Spot" /><Key bar color={SERIES.pe} label="Puts ahead" /><Key bar color={SERIES.ce} label="Calls ahead" /></>}>
            {pts.length ? <TimeChart series={series} height={420} paneHeight={160} /> : <div className="grid min-h-[200px]"><Loading empty="No statistics stored for this choice yet." /></div>}
          </Card>
          <Card title="Day by day"><DataTable rows={rows} columns={columns} rowKey={(r) => r.date} csvName={`${t.u}-pe-ce.csv`} maxHeight="55dvh" /></Card>
        </>
      )}
    </ToolShell>
  );
}

/** Underlying price against option open interest and near-month futures open interest. */
export function PriceVsOiTool({ tool }: { tool: Tool }) {
  const t = useDerivedTool(180);
  const pts = t.series.data?.points ?? [];
  const sessions = Math.min(750, Math.max(20, Math.round(t.period * 0.7)));
  const fut = useLoad(`${t.u}|${sessions}`, () => fetchFuturesHistory(t.u, sessions));
  const options = useMemo<TimeSeries[]>(() => [
    { title: 'Spot', type: 'line', color: SERIES.blue, data: pts.filter((p) => p.spotPaise != null).map((p) => ({ time: p.date, value: p.spotPaise! / 100 })) },
    { title: 'Call OI (lakh)', type: 'line', color: SERIES.ce, pane: 1, data: pts.map((p) => ({ time: p.date, value: p.ceOi / 1e5 })) },
    { title: 'Put OI (lakh)', type: 'line', color: SERIES.pe, pane: 1, data: pts.map((p) => ({ time: p.date, value: p.peOi / 1e5 })) },
  ], [pts]);
  const futures = useMemo<TimeSeries[]>(() => {
    const days = (fut.data?.days ?? []).filter((d) => d.near);
    return [
      { title: 'Near future', type: 'line', color: SERIES.accent, data: days.map((d) => ({ time: d.date, value: d.near!.closePaise / 100 })) },
      { title: 'Futures OI, all expiries (lakh)', type: 'histogram', color: SERIES.grey, pane: 1, data: days.map((d) => ({ time: d.date, value: d.totalOi / 1e5 })) },
    ];
  }, [fut.data]);
  return (
    <ToolShell tool={tool} controls={<DerivedControls t={t} />}
      about={<>
        <p>The first chart shows the underlying&rsquo;s official close with the total call and put open interest of the selected expiry (or each day&rsquo;s current expiry, which resets when an expiry ends).</p>
        <p>The second shows the near-month future&rsquo;s close with open interest summed over all futures expiries, so a roll from one month to the next does not show as a drop.</p>
      </>}>
      <Card title="Underlying and option open interest" right={<><Key color={SERIES.blue} label="Spot" /><Key color={SERIES.ce} label="Call OI" /><Key color={SERIES.pe} label="Put OI" /></>}>
        {pts.length ? <TimeChart series={options} height={420} paneHeight={160} /> : <div className="grid min-h-[200px]"><Loading error={t.series.error} loading={t.series.loading} empty="No statistics stored for this choice yet." /></div>}
      </Card>
      <Card title="Near-month future and futures open interest" right={<><Key color={SERIES.accent} label="Future" /><Key bar color={SERIES.grey} label="Futures OI" /></>}>
        {fut.data ? <TimeChart series={futures} height={380} paneHeight={140} /> : <div className="grid min-h-[200px]"><Loading error={fut.error} loading={fut.loading} /></div>}
      </Card>
    </ToolShell>
  );
}
