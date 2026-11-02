'use client';

import { useMemo, useState } from 'react';
import { BUILD_UP } from '@/lib/futures';
import { lakh, ratio, rupees, strike, tone } from '@/lib/fno';
import type { ChainRow, ChainSide } from '@/lib/options';
import { Loading, Segmented, Stat } from '../controls';
import { Card, Key, ToolShell } from '../tool-shell';
import { SERIES, XYChart } from '../xy-chart';
import { DataTable, type Column } from '../data-table';
import { AsOf, ChainControls, classifyBuildUp, strikeWindow, useChainTool } from './chain-common';
import type { Tool } from '@/lib/tools';

type Mode = 'oi' | 'change' | 'volume';
const pick = (s: ChainSide | null, m: Mode) => (!s ? null : m === 'oi' ? s.oi : m === 'change' ? s.oiChange ?? null : s.volume);
const priceChange = (s: ChainSide | null) => (s && s.prevClosePaise != null ? s.closePaise - s.prevClosePaise : null);

export function OpenInterestTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const [range, setRange] = useState(20);
  const [mode, setMode] = useState<Mode>('oi');
  const c = t.chain.data;
  const rows = useMemo(() => (c ? strikeWindow(c, range) : []), [c, range]);
  const totals = useMemo(() => {
    const all = c?.rows ?? [];
    const sum = (f: (r: ChainRow) => number | null | undefined) => all.reduce((a, r) => a + (f(r) ?? 0), 0);
    const ceOi = sum((r) => r.CE?.oi), peOi = sum((r) => r.PE?.oi);
    const top = (side: 'CE' | 'PE', f: (s: ChainSide) => number) => all.reduce<ChainRow | null>((a, r) => (r[side] && (!a || f(r[side]!) > f(a[side]!)) ? r : a), null);
    return {
      ceOi, peOi, ceChg: sum((r) => r.CE?.oiChange), peChg: sum((r) => r.PE?.oiChange), pcr: ceOi ? peOi / ceOi : null,
      maxCe: top('CE', (s) => s.oi), maxPe: top('PE', (s) => s.oi), addCe: top('CE', (s) => s.oiChange ?? -Infinity), addPe: top('PE', (s) => s.oiChange ?? -Infinity),
    };
  }, [c]);

  const series = useMemo(() => [
    { name: 'Calls', kind: 'bar' as const, color: SERIES.ce, points: rows.map((r) => ({ x: r.strikePaise / 100, y: pick(r.CE, mode) })) },
    { name: 'Puts', kind: 'bar' as const, color: SERIES.pe, points: rows.map((r) => ({ x: r.strikePaise / 100, y: pick(r.PE, mode) })) },
  ], [rows, mode]);
  const markers = c?.spotPaise != null ? [{ x: c.spotPaise / 100, label: `Spot ${rupees(c.spotPaise)}`, color: SERIES.blue }] : [];

  const bu = (s: ChainSide | null) => {
    if (!s) return null;
    const b = classifyBuildUp(priceChange(s), s.oiChange);
    return b === 'neutral' ? <span className="text-muted">—</span> : <span title={BUILD_UP[b].hint} className={b === 'long-buildup' || b === 'short-covering' ? 'text-up' : 'text-down'}>{BUILD_UP[b].label}</span>;
  };
  const columns: Column<ChainRow>[] = [
    { key: 'ceb', label: 'Call build-up', align: 'left', render: (r) => bu(r.CE), wide: true },
    { key: 'cep', label: 'Call close', render: (r) => rupees(r.CE?.closePaise), value: (r) => r.CE?.closePaise ?? null, wide: true },
    { key: 'cec', label: 'Call OI chg', render: (r) => lakh(r.CE?.oiChange, true), value: (r) => r.CE?.oiChange ?? null, className: (r) => tone(r.CE?.oiChange) },
    { key: 'ceo', label: 'Call OI', render: (r) => lakh(r.CE?.oi), value: (r) => r.CE?.oi ?? null },
    { key: 'k', label: 'Strike', render: (r) => <b className={r.strikePaise === c?.atmStrikePaise ? 'text-accent-deep' : ''}>{strike(r.strikePaise)}</b>, value: (r) => r.strikePaise },
    { key: 'peo', label: 'Put OI', render: (r) => lakh(r.PE?.oi), value: (r) => r.PE?.oi ?? null },
    { key: 'pec', label: 'Put OI chg', render: (r) => lakh(r.PE?.oiChange, true), value: (r) => r.PE?.oiChange ?? null, className: (r) => tone(r.PE?.oiChange) },
    { key: 'pep', label: 'Put close', render: (r) => rupees(r.PE?.closePaise), value: (r) => r.PE?.closePaise ?? null, wide: true },
    { key: 'peb', label: 'Put build-up', align: 'left', render: (r) => bu(r.PE), wide: true },
    { key: 'pcr', label: 'PCR', render: (r) => ratio(r.CE?.oi ? (r.PE?.oi ?? 0) / r.CE.oi : null), value: (r) => (r.CE?.oi ? (r.PE?.oi ?? 0) / r.CE.oi : null) },
  ];

  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} range={range} setRange={setRange} extra={<>
        <Segmented label="Measure" value={mode} onChange={setMode} options={[{ value: 'oi', label: 'Total OI' }, { value: 'change', label: 'Change in OI' }, { value: 'volume', label: 'Contracts traded' }]} />
        <AsOf c={c} />
      </>} />}
      about={<>
        <p>Open interest is the number of option contracts still open at the close, shown in shares (lakh). Volume is the number of contracts traded that day. The change is against the same contract&rsquo;s open interest on the previous trading day.</p>
        <p>Build-up compares a contract&rsquo;s close with its previous close, and its open interest with the previous day&rsquo;s: price up and OI up is long build-up, price down and OI up is short build-up, price up and OI down is short covering, price down and OI down is long unwinding.</p>
        <p>PCR is put open interest divided by call open interest.</p>
      </>}>
      {!c ? <div className="panel grid min-h-[300px]"><Loading error={t.chain.error} loading={t.chain.loading} /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="Call OI" value={lakh(totals.ceOi)} />
            <Stat label="Put OI" value={lakh(totals.peOi)} />
            <Stat label="Call OI change" value={lakh(totals.ceChg, true)} className={tone(totals.ceChg)} />
            <Stat label="Put OI change" value={lakh(totals.peChg, true)} className={tone(totals.peChg)} />
            <Stat label="PCR (OI)" value={ratio(totals.pcr)} />
            <Stat label="Most call OI" value={strike(totals.maxCe?.strikePaise)} />
            <Stat label="Most put OI" value={strike(totals.maxPe?.strikePaise)} />
            <Stat label="Most added (C / P)" value={`${strike(totals.addCe?.strikePaise)} / ${strike(totals.addPe?.strikePaise)}`} />
          </div>
          <Card title={mode === 'oi' ? 'Open interest by strike' : mode === 'change' ? 'Change in open interest by strike' : 'Contracts traded by strike'}
            right={<><Key bar color={SERIES.ce} label="Calls" /><Key bar color={SERIES.pe} label="Puts" /><Key dashed color={SERIES.blue} label="Spot" /></>}>
            <div className="p-2"><XYChart series={series} markers={markers} height={340} xFormat={(x) => x.toLocaleString('en-IN')} yFormat={(y) => (mode === 'volume' ? Math.round(y).toLocaleString('en-IN') : lakh(y))} xLabel="Strike" /></div>
          </Card>
          <Card title="Strike by strike">
            <DataTable rows={rows} columns={columns} rowKey={(r) => String(r.strikePaise)} csvName={`${c.underlying}-${c.expiry}-oi-${c.date}.csv`} maxHeight="60dvh" />
          </Card>
        </>
      )}
    </ToolShell>
  );
}
