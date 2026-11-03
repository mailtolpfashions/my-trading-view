'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { crore, day, fetchBuildUpCycle, fetchMovers, lakh, pct, ratio, rupees, tone, useLoad, type Mover } from '@/lib/fno';
import { BUILD_UP, type BuildUp } from '@/lib/futures';
import type { Tool } from '@/lib/tools';
import { DateStepper, Loading, Segmented, Stat, selectClass, useToolParams } from '../controls';
import { DataTable, type Column } from '../data-table';
import { Card, ToolShell } from '../tool-shell';

const PHASES: BuildUp[] = ['long-buildup', 'short-covering', 'short-buildup', 'long-unwinding'];
const PHASE_COLOR: Record<BuildUp, string> = { 'long-buildup': '#0a9b76', 'short-covering': '#7fd1b9', 'short-buildup': '#e5484d', 'long-unwinding': '#f2a3a5', neutral: '#d9d0c1' };
const futuresHref = (s: string) => `/futures?u=${encodeURIComponent(s)}`;
type Scope = 'all' | 'index' | 'stock';
const inScope = (scope: Scope, isIndex: boolean) => scope === 'all' || (scope === 'index') === isIndex;

function BuildUpTag({ b }: { b: BuildUp }) {
  return <span title={BUILD_UP[b].hint} className="inline-flex items-center gap-1.5 whitespace-nowrap"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[b] }} />{BUILD_UP[b].label}</span>;
}

/** Tile colour: green for a rise, red for a fall, stronger with a bigger move (full at ±4%). */
function tileStyle(changePct: number | null): React.CSSProperties {
  if (changePct == null) return { background: 'var(--color-raised)' };
  const a = 0.14 + 0.86 * Math.min(1, Math.abs(changePct) / 4);
  return { background: changePct >= 0 ? `rgba(10,155,118,${a})` : `rgba(229,72,77,${a})`, color: a > 0.55 ? '#fff' : undefined };
}

/** Every near-month future on one day: table or heatmap. */
export function MoversTool({ tool }: { tool: Tool }) {
  const p = useToolParams();
  const date = p.get('date') ?? null;
  const [scope, setScope] = useState<Scope>('stock');
  const [view, setView] = useState<'heatmap' | 'table'>('heatmap');
  const [filter, setFilter] = useState<BuildUp | 'all'>('all');
  const m = useLoad(date ?? 'latest', (s) => fetchMovers(date ?? undefined, s));
  const rows = useMemo(() => (m.data?.rows ?? []).filter((r) => inScope(scope, r.isIndex) && (filter === 'all' || r.buildUp === filter)), [m.data, scope, filter]);
  const counts = useMemo(() => {
    const c = Object.fromEntries([...PHASES, 'neutral'].map((b) => [b, 0])) as Record<BuildUp, number>;
    for (const r of m.data?.rows ?? []) if (inScope(scope, r.isIndex)) c[r.buildUp]++;
    return c;
  }, [m.data, scope]);
  const up = rows.filter((r) => (r.changePct ?? 0) > 0).length, down = rows.filter((r) => (r.changePct ?? 0) < 0).length;
  const tiles = useMemo(() => [...rows].sort((a, b) => (b.valueApprox ?? 0) - (a.valueApprox ?? 0)), [rows]);
  const maxValue = Math.max(1, ...tiles.map((t) => t.valueApprox ?? 0));

  const columns: Column<Mover>[] = [
    { key: 's', label: 'Symbol', align: 'left', render: (r) => <Link href={futuresHref(r.symbol)} className="font-semibold hover:text-accent-deep">{r.symbol}</Link>, value: (r) => r.symbol },
    { key: 'c', label: 'Future', render: (r) => rupees(r.closePaise), value: (r) => r.closePaise / 100 },
    { key: 'cp', label: 'Chg %', render: (r) => pct(r.changePct, 2, true), value: (r) => r.changePct, className: (r) => tone(r.changePct) },
    { key: 'sp', label: 'Spot chg %', render: (r) => pct(r.spotChangePct, 2, true), value: (r) => r.spotChangePct, className: (r) => tone(r.spotChangePct), wide: true },
    { key: 'oi', label: 'OI', render: (r) => lakh(r.oi), value: (r) => r.oi, wide: true },
    { key: 'oic', label: 'OI chg', render: (r) => lakh(r.oiChange, true), value: (r) => r.oiChange, className: (r) => tone(r.oiChange), wide: true },
    { key: 'oip', label: 'OI chg %', render: (r) => pct(r.oiChangePct, 1, true), value: (r) => r.oiChangePct, className: (r) => tone(r.oiChangePct) },
    { key: 'v', label: 'Contracts', render: (r) => r.volume.toLocaleString('en-IN'), value: (r) => r.volume, wide: true },
    { key: 'val', label: 'Value ≈', title: 'Contracts × lot size × close', render: (r) => crore(r.valueApprox), value: (r) => r.valueApprox, wide: true },
    { key: 'b', label: 'Build-up', align: 'left', render: (r) => <BuildUpTag b={r.buildUp} />, value: (r) => r.buildUp },
    { key: 'pcr', label: 'PCR', title: 'Put ÷ call open interest, nearest option expiry', render: (r) => ratio(r.oiPcr), value: (r) => r.oiPcr, wide: true },
  ];

  return (
    <ToolShell tool={tool}
      controls={<>
        <DateStepper underlying="NIFTY" value={date} onChange={(d) => p.set({ date: d })} />
        <Segmented label="Show" value={scope} onChange={setScope} options={[{ value: 'stock', label: 'Stocks' }, { value: 'index', label: 'Indices' }, { value: 'all', label: 'All' }]} />
        <select className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value as BuildUp | 'all')} aria-label="Build-up">
          <option value="all">Every build-up</option>
          {[...PHASES, 'neutral' as const].map((b) => <option key={b} value={b}>{BUILD_UP[b].label}</option>)}
        </select>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'heatmap', label: 'Heatmap' }, { value: 'table', label: 'Table' }]} />
        {m.data && <span className="text-[12px] text-muted">Close of {day(m.data.date, true)}{m.data.prevDate ? ` against ${day(m.data.prevDate, true)}` : ''}</span>}
      </>}
      about={<>
        <p>Each row is the underlying&rsquo;s nearest futures contract on the day shown, compared with the same contract on the previous trading day, so a roll from one month to the next is never counted as a change.</p>
        <p>Build-up reads the price change against the open-interest change: both up is long build-up, price down with OI up is short build-up, price up with OI down is short covering, both down is long unwinding. Value is approximate: contracts traded × lot size × closing price, since NSE&rsquo;s exact turnover is not stored here.</p>
        <p>Heatmap tiles are ordered and sized by that traded value, and coloured by the future&rsquo;s price change (full colour at ±4%).</p>
      </>}>
      {!m.data ? <div className="panel grid min-h-[300px]"><Loading error={m.error} loading={m.loading} /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {PHASES.map((b) => (
              <button key={b} type="button" onClick={() => setFilter(filter === b ? 'all' : b)} className={`text-left ${filter === b ? 'ring-2 ring-accent rounded-[14px]' : ''}`}>
                <Stat label={BUILD_UP[b].label} value={String(counts[b])} hint={BUILD_UP[b].hint} />
              </button>
            ))}
            <Stat label="Futures up / down" value={`${up} / ${down}`} />
            <Stat label="Shown" value={String(rows.length)} />
          </div>
          {view === 'table' ? (
            <Card><DataTable rows={rows} columns={columns} rowKey={(r) => r.symbol} csvName={`futures-${m.data.date}.csv`} initialSort={{ key: 'oip', desc: true }} maxHeight="65dvh" empty="No future matches these filters." /></Card>
          ) : (
            <Card>
              <div className="flex flex-wrap gap-1 p-2">
                {tiles.map((r) => {
                  const share = Math.sqrt((r.valueApprox ?? 0) / maxValue);
                  return (
                    <Link key={r.symbol} href={futuresHref(r.symbol)} style={{ ...tileStyle(r.changePct), flexBasis: `min(${70 + share * 190}px, 46%)`, height: `${52 + share * 58}px` }}
                      title={`${r.symbol}: future ${pct(r.changePct, 2, true)}, OI ${pct(r.oiChangePct, 1, true)}, ${BUILD_UP[r.buildUp].label}, value ≈ ${crore(r.valueApprox)}`}
                      className="flex grow flex-col justify-center rounded-[8px] px-2 text-center hover:outline hover:outline-2 hover:outline-ink">
                      <span className="truncate text-[12px] font-bold">{r.symbol}</span>
                      <span className="num text-[11.5px] font-semibold">{pct(r.changePct, 2, true)}</span>
                      <span className="num truncate text-[10px] opacity-80">OI {pct(r.oiChangePct, 1, true)}</span>
                    </Link>
                  );
                })}
                {!tiles.length && <p className="p-6 text-[13px] text-muted">No future matches these filters.</p>}
              </div>
            </Card>
          )}
        </>
      )}
    </ToolShell>
  );
}

/** Build-up phases of every near-month future over recent sessions. */
export function BuildUpCycleTool({ tool }: { tool: Tool }) {
  const [sessions, setSessions] = useState(50);
  const [scope, setScope] = useState<Scope>('stock');
  const [sortBy, setSortBy] = useState<BuildUp | 'streak'>('long-buildup');
  const c = useLoad(String(sessions), (s) => fetchBuildUpCycle(sessions, s));
  const rows = useMemo(() => (c.data?.rows ?? []).filter((r) => inScope(scope, r.isIndex)).map((r) => {
    const count = Object.fromEntries([...PHASES, 'neutral'].map((b) => [b, r.phases.filter((x) => x === b).length])) as Record<BuildUp, number>;
    const last = r.phases.at(-1) ?? null;
    let streak = 0;
    for (let i = r.phases.length - 1; last && i >= 0 && r.phases[i] === last; i--) streak++;
    return { ...r, count, last, streak };
  }), [c.data, scope]);
  type Row = (typeof rows)[number];
  const dates = c.data?.dates ?? [];
  const columns: Column<Row>[] = [
    { key: 's', label: 'Symbol', align: 'left', render: (r) => <Link href={futuresHref(r.symbol)} className="font-semibold hover:text-accent-deep">{r.symbol}</Link>, value: (r) => r.symbol },
    ...PHASES.map((b): Column<Row> => ({ key: b, label: BUILD_UP[b].label, render: (r) => String(r.count[b]), value: (r) => r.count[b] })),
    { key: 'last', label: 'Latest', align: 'left', render: (r) => (r.last ? <BuildUpTag b={r.last} /> : <span className="text-muted">No data</span>), value: (r) => r.last },
    { key: 'streak', label: 'Days in a row', render: (r) => String(r.streak), value: (r) => r.streak },
    {
      key: 'tl', label: dates.length ? `${day(dates[0])} → ${day(dates[dates.length - 1])}` : 'Timeline', align: 'left', wide: true,
      render: (r) => (
        <span className="flex gap-px" aria-label={`Build-up by day for ${r.symbol}`}>
          {r.phases.map((b, i) => <i key={i} title={`${day(dates[i], true)}: ${b ? BUILD_UP[b].label : 'no data'}`} className={`inline-block h-3.5 w-[5px] rounded-[1px] ${b ? '' : 'border border-dashed border-line-strong'}`} style={b ? { background: PHASE_COLOR[b] } : undefined} />)}
        </span>
      ),
    },
  ];
  return (
    <ToolShell tool={tool}
      controls={<>
        <Segmented label="Sessions" value={sessions} onChange={setSessions} options={[{ value: 20, label: '20 sessions' }, { value: 50, label: '50' }, { value: 100, label: '100' }]} />
        <Segmented label="Show" value={scope} onChange={setScope} options={[{ value: 'stock', label: 'Stocks' }, { value: 'index', label: 'Indices' }, { value: 'all', label: 'All' }]} />
        <select className={selectClass} value={sortBy} onChange={(e) => setSortBy(e.target.value as BuildUp | 'streak')} aria-label="Sort by">
          {PHASES.map((b) => <option key={b} value={b}>Most days of {BUILD_UP[b].label.toLowerCase()}</option>)}
          <option value="streak">Longest current run</option>
        </select>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">{[...PHASES, 'neutral' as const].map((b) => <BuildUpTag key={b} b={b} />)}<span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-line-strong" />No data</span></span>
      </>}
      about={<>
        <p>For each trading day, the underlying&rsquo;s nearest futures contract is compared with the same contract the day before and given one of the four build-up labels (or neutral when price or open interest did not change, or the contract was new). The table counts the days of each label over the sessions chosen and shows how many days in a row the latest label has held.</p>
        <p>The list covers the underlyings in the latest day&rsquo;s F&amp;O file. Stock futures are held from 8 July 2024. A day with no stored data for the contract, that day or the day before, is shown with a dashed box and not counted.</p>
      </>}>
      <Card>
        {c.data ? <DataTable key={sortBy} rows={rows} columns={columns} rowKey={(r) => r.symbol} csvName={`buildup-cycle-${sessions}.csv`} initialSort={{ key: sortBy, desc: true }} maxHeight="70dvh" />
          : <div className="grid min-h-[300px]"><Loading error={c.error} loading={c.loading} /></div>}
      </Card>
    </ToolShell>
  );
}
