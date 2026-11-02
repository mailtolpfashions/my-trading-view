'use client';

import { useMemo } from 'react';
import { day, lakh, ratio, rupees, tone } from '@/lib/fno';
import type { Tool } from '@/lib/tools';
import { Loading, Stat } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { SERIES } from '../xy-chart';
import { DerivedControls, percentileOf, useDerivedTool } from './derived-common';

export function PcrTool({ tool }: { tool: Tool }) {
  const t = useDerivedTool();
  const pts = t.series.data?.points ?? [];
  const latest = pts.at(-1);
  const pcrs = pts.map((p) => p.oiPcr).filter((v): v is number => v != null);

  const series = useMemo<TimeSeries[]>(() => [
    { title: 'Spot', type: 'line', color: SERIES.blue, data: pts.filter((p) => p.spotPaise != null).map((p) => ({ time: p.date, value: p.spotPaise! / 100 })) },
    { title: 'PCR (OI)', type: 'line', color: SERIES.accent, pane: 1, data: pts.filter((p) => p.oiPcr != null).map((p) => ({ time: p.date, value: p.oiPcr! })), format: (v) => v.toFixed(2) },
    { title: 'PCR (volume)', type: 'line', color: SERIES.violet, pane: 1, dashed: true, data: pts.filter((p) => p.volumePcr != null).map((p) => ({ time: p.date, value: p.volumePcr! })), format: (v) => v.toFixed(2) },
  ], [pts]);

  const rows = useMemo(() => [...pts].reverse().map((p, i, a) => ({ ...p, prev: a[i + 1] && a[i + 1].expiry === p.expiry ? a[i + 1] : null })), [pts]);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'date', label: 'Date', align: 'left', render: (r) => day(r.date, true), value: (r) => r.date },
    { key: 'expiry', label: 'Expiry', align: 'left', render: (r) => day(r.expiry), value: (r) => r.expiry, wide: true },
    { key: 'spot', label: 'Spot', render: (r) => rupees(r.spotPaise), value: (r) => (r.spotPaise == null ? null : r.spotPaise / 100) },
    { key: 'ce', label: 'Call OI', render: (r) => lakh(r.ceOi), value: (r) => r.ceOi, wide: true },
    { key: 'pe', label: 'Put OI', render: (r) => lakh(r.peOi), value: (r) => r.peOi, wide: true },
    { key: 'pcr', label: 'PCR (OI)', render: (r) => <b>{ratio(r.oiPcr)}</b>, value: (r) => r.oiPcr },
    { key: 'chg', label: 'Change', render: (r) => (r.prev && r.oiPcr != null && r.prev.oiPcr != null ? `${r.oiPcr - r.prev.oiPcr >= 0 ? '+' : '−'}${Math.abs(r.oiPcr - r.prev.oiPcr).toFixed(2)}` : '—'), value: (r) => (r.prev && r.oiPcr != null && r.prev.oiPcr != null ? r.oiPcr - r.prev.oiPcr : null), className: (r) => tone(r.prev && r.oiPcr != null && r.prev.oiPcr != null ? r.oiPcr - r.prev.oiPcr : null) },
    { key: 'vpcr', label: 'PCR (volume)', render: (r) => ratio(r.volumePcr), value: (r) => r.volumePcr },
  ];

  return (
    <ToolShell tool={tool} controls={<DerivedControls t={t} />}
      about={<>
        <p>PCR (OI) is the total put open interest of one expiry divided by its total call open interest, at each day&rsquo;s close. PCR (volume) divides the put volume by the call volume that day.</p>
        <p>&ldquo;Current expiry&rdquo; uses each day&rsquo;s nearest expiry, so the series switches to the next expiry the day after one expires; the daily change is left blank across that switch. Pick an expiry to follow one contract month instead.</p>
        <p>The percentile says what share of the days shown had a lower PCR. This page reports the ratio only; it does not label it bullish or bearish.</p>
      </>}>
      {!t.series.data ? <div className="panel grid min-h-[300px]"><Loading error={t.series.error} loading={t.series.loading} /></div> : !pts.length ? <div className="panel grid min-h-[200px]"><Loading empty="No statistics stored for this choice yet." /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={`PCR (OI) · ${day(latest!.date)}`} value={ratio(latest!.oiPcr)} />
            <Stat label="PCR (volume)" value={ratio(latest!.volumePcr)} />
            <Stat label="Lowest in period" value={ratio(pcrs.length ? Math.min(...pcrs) : null)} />
            <Stat label="Highest in period" value={ratio(pcrs.length ? Math.max(...pcrs) : null)} />
            <Stat label="Percentile in period" value={latest!.oiPcr != null ? `${percentileOf(latest!.oiPcr, pcrs)?.toFixed(0)}` : '—'} hint="Share of the days shown with a lower PCR" />
            <Stat label="Expiry" value={day(latest!.expiry, true)} />
          </div>
          <Card title="Put-call ratio and the underlying" right={<><Key color={SERIES.blue} label="Spot" /><Key color={SERIES.accent} label="PCR (OI)" /><Key dashed color={SERIES.violet} label="PCR (volume)" /></>}>
            <TimeChart series={series} height={460} paneHeight={170} />
          </Card>
          <Card title="Day by day">
            <DataTable rows={rows} columns={columns} rowKey={(r) => r.date} csvName={`${t.u}-pcr.csv`} maxHeight="55dvh" />
          </Card>
        </>
      )}
    </ToolShell>
  );
}

