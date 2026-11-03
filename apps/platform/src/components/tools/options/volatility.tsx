'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { day, fetchExpiryStats, fetchIvGrid, ivPct, rupees, useLoad, type IvGridRow } from '@/lib/fno';
import { fetchChain, type Chain } from '@/lib/options';
import type { Tool } from '@/lib/tools';
import { DateStepper, Loading, Segmented, Stat, useToolParams } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { PALETTE, SERIES, XYChart } from '../xy-chart';
import { AsOf, ChainControls, useChainTool } from './chain-common';
import { DerivedControls, useDerivedTool } from './derived-common';

const pts1 = (v: number | null) => (v == null ? '—' : v.toFixed(0));
const signedVol = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1)}`);

/** 30-day IV, 20-day HV, IV rank and IV percentile by day. */
export function IvTool({ tool }: { tool: Tool }) {
  const t = useDerivedTool(365);
  const pts = t.series.data?.points ?? [];
  const latest = [...pts].reverse().find((p) => p.iv30 != null) ?? pts.at(-1);
  const series = useMemo<TimeSeries[]>(() => [
    { title: 'IV 30-day', type: 'line', color: SERIES.accent, data: pts.filter((p) => p.iv30 != null).map((p) => ({ time: p.date, value: p.iv30! * 100 })), format: (v) => `${v.toFixed(1)}%` },
    { title: 'HV 20-day', type: 'line', color: SERIES.blue, dashed: true, data: pts.filter((p) => p.hv20 != null).map((p) => ({ time: p.date, value: p.hv20! * 100 })), format: (v) => `${v.toFixed(1)}%` },
    { title: 'IV rank', type: 'line', color: SERIES.violet, pane: 1, data: pts.filter((p) => p.ivRank != null).map((p) => ({ time: p.date, value: p.ivRank! })), format: (v) => v.toFixed(0) },
    { title: 'IV percentile', type: 'line', color: SERIES.teal, pane: 1, data: pts.filter((p) => p.ivPercentile != null).map((p) => ({ time: p.date, value: p.ivPercentile! })), format: (v) => v.toFixed(0) },
  ], [pts]);
  const rows = useMemo(() => [...pts].reverse(), [pts]);
  const columns: Column<(typeof pts)[number]>[] = [
    { key: 'date', label: 'Date', align: 'left', render: (r) => day(r.date, true), value: (r) => r.date },
    { key: 'spot', label: 'Spot', render: (r) => rupees(r.spotPaise), value: (r) => (r.spotPaise == null ? null : r.spotPaise / 100), wide: true },
    { key: 'iv30', label: 'IV 30d', render: (r) => <b title={r.iv30Exact ? undefined : 'No expiry on one side of 30 days: the nearest one is used'}>{ivPct(r.iv30)}{r.iv30 != null && !r.iv30Exact ? '*' : ''}</b>, value: (r) => r.iv30 },
    { key: 'atm', label: 'ATM IV (expiry)', render: (r) => ivPct(r.atmIv), value: (r) => r.atmIv, wide: true },
    { key: 'hv', label: 'HV 20d', render: (r) => ivPct(r.hv20), value: (r) => r.hv20 },
    { key: 'gap', label: 'IV − HV', render: (r) => (r.iv30 != null && r.hv20 != null ? signedVol(r.iv30 - r.hv20) : '—'), value: (r) => (r.iv30 != null && r.hv20 != null ? r.iv30 - r.hv20 : null) },
    { key: 'ivr', label: 'IV rank', render: (r) => pts1(r.ivRank), value: (r) => r.ivRank },
    { key: 'ivp', label: 'IV pctl', render: (r) => pts1(r.ivPercentile), value: (r) => r.ivPercentile },
  ];
  return (
    <ToolShell tool={tool} controls={<DerivedControls t={t} withExpiry={false} />}
      about={<>
        <p>IV is implied from each option&rsquo;s official close with the Black-76 model, on the forward price implied by put-call parity at the ATM strike, with a 6.5% rate. The ATM IV of an expiry is the average of its ATM call and put IV.</p>
        <p>IV 30-day blends the two expiries either side of 30 calendar days, interpolating total variance (σ² × time). Expiries under 3 days away are left out. When no expiry lies on one side of 30 days, the nearest one is used and the value is marked *.</p>
        <p>HV 20-day is the annualised standard deviation of the last 20 daily log returns of the corporate-action-adjusted close (√252). It is left blank where the price history has a break.</p>
        <p>IV rank places today&rsquo;s IV between the lowest (0) and highest (100) of the previous 252 sessions; IV percentile is the share of those sessions with a lower IV. Both need at least 20 earlier sessions.</p>
      </>}>
      {!t.series.data ? <div className="panel grid min-h-[300px]"><Loading error={t.series.error} loading={t.series.loading} /></div> : (
        <>
          {latest && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label={`IV 30-day · ${day(latest.date)}`} value={ivPct(latest.iv30)} />
              <Stat label="HV 20-day" value={ivPct(latest.hv20)} />
              <Stat label="IV − HV (points)" value={latest.iv30 != null && latest.hv20 != null ? signedVol(latest.iv30 - latest.hv20) : '—'} />
              <Stat label="IV rank" value={pts1(latest.ivRank)} />
              <Stat label="IV percentile" value={pts1(latest.ivPercentile)} />
            </div>
          )}
          <Card title="Implied and historical volatility" right={<><Key color={SERIES.accent} label="IV 30-day" /><Key dashed color={SERIES.blue} label="HV 20-day" /><Key color={SERIES.violet} label="IV rank" /><Key color={SERIES.teal} label="IV percentile" /></>}>
            {pts.length ? <TimeChart series={series} height={460} paneHeight={150} /> : <div className="grid min-h-[200px]"><Loading empty="No statistics stored for this choice yet." /></div>}
          </Card>
          <Card title="Day by day"><DataTable rows={rows} columns={columns} rowKey={(r) => r.date} csvName={`${t.u}-iv.csv`} maxHeight="55dvh" /></Card>
        </>
      )}
    </ToolShell>
  );
}

/** Out-of-the-money IV by strike: puts below the forward, calls at and above it. */
function smile(c: Chain, band: number) {
  const F = c.forwardPaise ?? c.spotPaise;
  if (F == null) return [];
  return c.rows
    .filter((r) => Math.abs(r.strikePaise - F) / F <= band)
    .map((r) => ({ x: r.strikePaise / 100, y: ((r.strikePaise < F ? r.PE?.iv : r.CE?.iv) ?? null) }))
    .map((p) => ({ ...p, y: p.y == null ? null : p.y * 100 }));
}

/** IV across strikes for several expiries, and ATM IV across expiries. */
export function SkewTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const [n, setN] = useState(3);
  const [band, setBand] = useState(0.1);
  const c = t.chain.data;
  const picked = useMemo(() => {
    if (!c) return [];
    const i = Math.max(0, c.expiries.indexOf(c.expiry));
    return c.expiries.slice(i, i + n);
  }, [c, n]);
  const chains = useLoad(c ? `${c.underlying}|${c.date}|${picked.join(',')}` : null, () => Promise.all(picked.map((e) => (e === c!.expiry ? Promise.resolve(c!) : fetchChain(c!.underlying, e, c!.date)))));
  const term = useLoad(c ? `${c.underlying}|${c.date}` : null, (s) => fetchExpiryStats({ underlying: c!.underlying, date: c!.date }, s));
  const smiles = (chains.data ?? []).map((ch, i) => ({ name: day(ch.expiry, true), kind: 'line' as const, color: PALETTE[i % PALETTE.length], points: smile(ch, band) }));
  const termPts = (term.data?.expiries ?? []).filter((e) => e.atmIv != null && e.daysToExpiry > 0);
  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} extra={<>
        <Segmented label="Expiries" value={n} onChange={setN} options={[{ value: 1, label: '1 expiry' }, { value: 3, label: '3' }, { value: 5, label: '5' }]} />
        <Segmented label="Strikes" value={band} onChange={setBand} options={[{ value: 0.05, label: '±5%' }, { value: 0.1, label: '±10%' }, { value: 0.2, label: '±20%' }]} />
        <AsOf c={c} />
      </>} />}
      about={<>
        <p>The skew uses the out-of-the-money side at each strike: put IV below the forward price and call IV at or above it, because out-of-the-money options trade more. Only contracts that traded that day have an IV; gaps are strikes with no trade.</p>
        <p>The term structure plots each expiry&rsquo;s ATM IV against calendar days to expiry on the selected day.</p>
      </>}>
      <Card title="IV by strike (skew)" right={smiles.map((s) => <Key key={s.name} color={s.color} label={s.name} />)}>
        <div className="p-2">
          {chains.data ? <XYChart height={340} series={smiles} xLabel="Strike" xFormat={(x) => x.toLocaleString('en-IN')} yFormat={(y) => `${y.toFixed(1)}%`}
            markers={c?.forwardPaise != null ? [{ x: c.forwardPaise / 100, label: 'Forward', color: SERIES.grey }] : []} />
            : <div className="grid min-h-[280px]"><Loading error={chains.error ?? t.chain.error} loading={chains.loading || t.chain.loading} /></div>}
        </div>
      </Card>
      <Card title="ATM IV by expiry (term structure)">
        <div className="p-2">
          {term.data ? <XYChart height={280} series={[{ name: 'ATM IV', kind: 'line', color: SERIES.accent, points: termPts.map((e) => ({ x: e.daysToExpiry, y: e.atmIv! * 100 })) }]}
            xLabel="Days to expiry" xFormat={(x) => String(Math.round(x))} yFormat={(y) => `${y.toFixed(1)}%`} />
            : <div className="grid min-h-[200px]"><Loading error={term.error} loading={term.loading} /></div>}
        </div>
        {termPts.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[12px] text-ink-2">
            {termPts.map((e) => <span key={e.expiry} className="num">{day(e.expiry)}: <b>{ivPct(e.atmIv)}</b></span>)}
          </div>
        )}
      </Card>
    </ToolShell>
  );
}

const heat = (v: number | null) => (v == null ? '' : v >= 80 ? 'bg-down-soft text-down font-bold' : v <= 20 ? 'bg-up-soft text-up font-bold' : '');

/** IV, HV, IV rank and percentile of every F&O underlying on one day. */
export function IvGridTool({ tool }: { tool: Tool }) {
  const p = useToolParams();
  const date = p.get('date') ?? null;
  const [scope, setScope] = useState<'all' | 'index' | 'stock'>('all');
  const grid = useLoad(date ?? 'latest', (s) => fetchIvGrid(date ?? undefined, s));
  const rows = (grid.data?.rows ?? []).filter((r) => scope === 'all' || (scope === 'index') === r.isIndex);
  const columns: Column<IvGridRow>[] = [
    { key: 'sym', label: 'Symbol', align: 'left', render: (r) => <Link className="font-semibold hover:text-accent-deep" href={`/options/iv?u=${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link>, value: (r) => r.symbol },
    { key: 'spot', label: 'Price', render: (r) => rupees(r.spotPaise), value: (r) => (r.spotPaise == null ? null : r.spotPaise / 100), wide: true },
    { key: 'iv', label: 'IV 30d', render: (r) => <b>{ivPct(r.iv30)}</b>, value: (r) => r.iv30 },
    { key: 'ivc', label: 'IV chg', render: (r) => signedVol(r.iv30Change), value: (r) => r.iv30Change, className: (r) => (r.iv30Change == null ? '' : r.iv30Change > 0 ? 'text-up' : 'text-down') },
    { key: 'hv', label: 'HV 20d', render: (r) => ivPct(r.hv20), value: (r) => r.hv20 },
    { key: 'gap', label: 'IV − HV', render: (r) => signedVol(r.ivMinusHv), value: (r) => r.ivMinusHv },
    { key: 'ivr', label: 'IV rank', render: (r) => pts1(r.ivRank), value: (r) => r.ivRank, className: (r) => heat(r.ivRank) },
    { key: 'ivp', label: 'IV pctl', render: (r) => pts1(r.ivPercentile), value: (r) => r.ivPercentile, className: (r) => heat(r.ivPercentile) },
  ];
  return (
    <ToolShell tool={tool}
      controls={<>
        <DateStepper underlying="NIFTY" value={date} onChange={(d) => p.set({ date: d })} />
        <Segmented label="Show" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, { value: 'index', label: 'Indices' }, { value: 'stock', label: 'Stocks' }]} />
        {grid.data && <span className="text-[12px] text-muted">Close of {day(grid.data.date, true)} · {rows.length} symbols</span>}
      </>}
      about={<>
        <p>Same definitions as the IV &amp; HV page: IV 30-day from the expiries either side of 30 days, HV 20-day from adjusted closes, IV rank and percentile over the previous 252 sessions. IV change is against the previous trading day, in volatility points.</p>
        <p>IV rank or percentile of 80 and above is shaded red, 20 and below green. Stock options are held from 8 July 2024, so a stock&rsquo;s rank uses at most the sessions since then.</p>
      </>}>
      <Card>
        {grid.data ? <DataTable rows={rows} columns={columns} rowKey={(r) => r.symbol} csvName={`iv-table-${grid.data.date}.csv`} initialSort={{ key: 'ivr', desc: true }} maxHeight="70dvh" />
          : <div className="grid min-h-[300px]"><Loading error={grid.error} loading={grid.loading} /></div>}
      </Card>
    </ToolShell>
  );
}

