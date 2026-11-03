'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { day, fetchLotSizes, useLoad, type LotSizeRow } from '@/lib/fno';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented } from '../controls';
import { DataTable, type Column } from '../data-table';
import { Card, ToolShell } from '../tool-shell';

/** Lot size of every F&O underlying, and its changes over the data held. */
export function LotSizeTool({ tool }: { tool: Tool }) {
  const l = useLoad('lots', () => fetchLotSizes());
  const [scope, setScope] = useState<'all' | 'index' | 'stock'>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => (l.data?.rows ?? [])
    .filter((r) => r.current && (scope === 'all' || (scope === 'index') === r.isIndex) && (!q || r.symbol.includes(q.toUpperCase()))), [l.data, scope, q]);
  const last = (r: LotSizeRow) => r.changes.at(-1);
  const prev = (r: LotSizeRow) => r.changes.at(-2);
  const columns: Column<LotSizeRow>[] = [
    { key: 's', label: 'Symbol', align: 'left', render: (r) => <Link href={`/options?u=${encodeURIComponent(r.symbol)}`} className="font-semibold hover:text-accent-deep">{r.symbol}</Link>, value: (r) => r.symbol },
    { key: 't', label: 'Type', align: 'left', render: (r) => (r.isIndex ? 'Index' : 'Stock'), value: (r) => (r.isIndex ? 'Index' : 'Stock'), wide: true },
    { key: 'l', label: 'Lot size', render: (r) => <b>{r.lotSize?.toLocaleString('en-IN') ?? '—'}</b>, value: (r) => r.lotSize },
    { key: 'p', label: 'Before', render: (r) => prev(r)?.lotSize.toLocaleString('en-IN') ?? '—', value: (r) => prev(r)?.lotSize ?? null },
    { key: 'd', label: 'Since', render: (r) => (prev(r) && last(r) ? day(last(r)!.from, true) : '—'), value: (r) => (prev(r) ? last(r)?.from ?? null : null) },
    { key: 'n', label: 'Changes held', title: 'Lot-size changes in the data held (index F&O from 2011, stock F&O from July 2024)', render: (r) => String(Math.max(0, r.changes.length - 1)), value: (r) => r.changes.length - 1, wide: true },
  ];
  return (
    <ToolShell tool={tool}
      controls={<>
        <label className="flex h-9 items-center gap-2 rounded-full bg-panel px-3 shadow-[var(--shadow-panel)]">
          <Search size={15} className="text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a symbol" aria-label="Find a symbol" className="w-[150px] bg-transparent text-[12.5px] font-semibold outline-none" />
        </label>
        <Segmented label="Show" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, { value: 'index', label: 'Indices' }, { value: 'stock', label: 'Stocks' }]} />
        {l.data?.date && <span className="text-[12px] text-muted">From NSE&rsquo;s F&amp;O file of {day(l.data.date, true)} · {rows.length} symbols</span>}
      </>}
      about={<>
        <p>The lot size is the number of units in one futures or options contract. It is read from each day&rsquo;s NSE F&amp;O file (the file states it from July 2024; for earlier index files it is worked out from futures turnover, and days where that is ambiguous are left out).</p>
        <p>&ldquo;Before&rdquo; and &ldquo;Since&rdquo; show the previous lot size and the first day the current one appeared in the files we hold. NSE revises lot sizes from time to time by circular; the circular says which contracts each change applies to.</p>
      </>}>
      <Card>
        {l.data ? <DataTable rows={rows} columns={columns} rowKey={(r) => r.symbol} csvName={`fno-lot-sizes-${l.data.date}.csv`} maxHeight="72dvh" empty="No symbol matches." />
          : <div className="grid min-h-[300px]"><Loading error={l.error} loading={l.loading} /></div>}
      </Card>
    </ToolShell>
  );
}
