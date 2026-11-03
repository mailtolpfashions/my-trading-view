'use client';

import { useMemo, useState } from 'react';
import { crore, day, daysBefore, fetchDerived, fetchGex, lakh, pct, rupees, strike, tone, useLoad, type GexStrike } from '@/lib/fno';
import { BUILD_UP } from '@/lib/futures';
import type { ChainRow, ChainSide } from '@/lib/options';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented, Stat } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { SERIES, XYChart } from '../xy-chart';
import { AsOf, ChainControls, classifyBuildUp, strikeWindow, useChainTool } from './chain-common';

/** Vega of open positions per strike: vega per share (₹ per 1 IV point) × open interest (shares). */
export function VegaTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const [range, setRange] = useState(20);
  const c = t.chain.data;
  const rows = useMemo(() => (c ? strikeWindow(c, range) : []), [c, range]);
  const v = (s: ChainSide | null) => (s?.vega != null ? s.vega * s.oi : null);
  const totals = useMemo(() => {
    let ce = 0, pe = 0, missing = 0;
    for (const r of c?.rows ?? []) for (const k of ['CE', 'PE'] as const) {
      const s = r[k];
      if (!s?.oi) continue;
      if (s.vega == null) { missing += s.oi; continue; }
      if (k === 'CE') ce += s.vega * s.oi; else pe += s.vega * s.oi;
    }
    const oi = (c?.rows ?? []).reduce((a, r) => a + (r.CE?.oi ?? 0) + (r.PE?.oi ?? 0), 0);
    return { ce, pe, missingShare: oi ? (missing / oi) * 100 : 0 };
  }, [c]);
  const columns: Column<ChainRow>[] = [
    { key: 'k', label: 'Strike', align: 'left', render: (r) => <b className={r.strikePaise === c?.atmStrikePaise ? 'text-accent-deep' : ''}>{strike(r.strikePaise)}</b>, value: (r) => r.strikePaise },
    { key: 'cv', label: 'Call vega / share', render: (r) => (r.CE?.vega != null ? r.CE.vega.toFixed(2) : '—'), value: (r) => r.CE?.vega ?? null, wide: true },
    { key: 'cvo', label: 'Call vega × OI', render: (r) => crore(v(r.CE)), value: (r) => v(r.CE) },
    { key: 'pv', label: 'Put vega / share', render: (r) => (r.PE?.vega != null ? r.PE.vega.toFixed(2) : '—'), value: (r) => r.PE?.vega ?? null, wide: true },
    { key: 'pvo', label: 'Put vega × OI', render: (r) => crore(v(r.PE)), value: (r) => v(r.PE) },
    { key: 't', label: 'Total', render: (r) => <b>{crore((v(r.CE) ?? 0) + (v(r.PE) ?? 0))}</b>, value: (r) => (v(r.CE) ?? 0) + (v(r.PE) ?? 0) },
  ];
  return (
    <ToolShell tool={tool} controls={<ChainControls t={t} range={range} setRange={setRange} extra={<AsOf c={c} />} />}
      about={<>
        <p>Vega is how much an option&rsquo;s price changes for a 1-point change in implied volatility (Black-76, from the traded close). Multiplied by the open interest in shares, it gives the rupee change in the value of all open positions at that strike for a 1-point IV move: holders gain that much if IV rises one point, writers lose it.</p>
        <p>Contracts that did not trade that day have no IV and are left out; the share of open interest affected is shown.</p>
      </>}>
      {!c ? <div className="panel grid min-h-[300px]"><Loading error={t.chain.error} loading={t.chain.loading} /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Calls: vega × OI" value={crore(totals.ce)} />
            <Stat label="Puts: vega × OI" value={crore(totals.pe)} />
            <Stat label="Total per 1 IV point" value={crore(totals.ce + totals.pe)} />
            <Stat label="OI without IV (untraded)" value={pct(totals.missingShare, 1)} />
          </div>
          <Card title="Vega of open interest by strike (₹ per 1 IV point)" right={<><Key bar color={SERIES.ce} label="Calls" /><Key bar color={SERIES.pe} label="Puts" /><Key dashed color={SERIES.blue} label="Spot" /></>}>
            <div className="p-2">
              <XYChart height={320} xLabel="Strike" xFormat={(x) => x.toLocaleString('en-IN')} yFormat={(y) => crore(y)}
                series={[
                  { name: 'Calls', kind: 'bar', color: SERIES.ce, points: rows.map((r) => ({ x: r.strikePaise / 100, y: v(r.CE) })) },
                  { name: 'Puts', kind: 'bar', color: SERIES.pe, points: rows.map((r) => ({ x: r.strikePaise / 100, y: v(r.PE) })) },
                ]}
                markers={c.spotPaise != null ? [{ x: c.spotPaise / 100, label: 'Spot', color: SERIES.blue }] : []} />
            </div>
          </Card>
          <Card title="Strike by strike"><DataTable rows={rows} columns={columns} rowKey={(r) => String(r.strikePaise)} csvName={`${c.underlying}-${c.expiry}-vega-${c.date}.csv`} maxHeight="55dvh" /></Card>
        </>
      )}
    </ToolShell>
  );
}

/** Gamma exposure by strike, walls and flip level, and their history. */
export function GexTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const [range, setRange] = useState(20);
  const [split, setSplit] = useState<'net' | 'split'>('net');
  const g = useLoad(`${t.u}|${t.date ?? ''}|${t.expiry ?? ''}`, (s) => fetchGex({ underlying: t.u, date: t.date ?? undefined, expiry: t.expiry ?? undefined }, s));
  const d = g.data;
  const strikes = useMemo<GexStrike[]>(() => {
    const all = d?.gex?.strikes ?? [];
    const ref = d?.forwardPaise ?? d?.spotPaise;
    if (!range || ref == null) return all;
    const i = all.reduce((best, s, j) => (Math.abs(s.strikePaise - ref) < Math.abs(all[best].strikePaise - ref) ? j : best), 0);
    return all.slice(Math.max(0, i - range), i + range + 1);
  }, [d, range]);
  const expiry = d?.expiry;
  const hist = useLoad(expiry ? `${t.u}|${expiry}` : null, (s) => fetchDerived({ underlying: t.u, expiry: expiry!, from: daysBefore(expiry!, 120), to: expiry! }, s));
  const histSeries = useMemo<TimeSeries[]>(() => {
    const pts = hist.data?.points ?? [];
    return [
      { title: 'Spot', type: 'line', color: SERIES.blue, data: pts.filter((p) => p.spotPaise != null).map((p) => ({ time: p.date, value: p.spotPaise! / 100 })) },
      { title: 'Gamma flip', type: 'line', color: SERIES.accent, dashed: true, data: pts.filter((p) => p.gammaFlipPaise != null).map((p) => ({ time: p.date, value: p.gammaFlipPaise! / 100 })) },
      { title: 'Net GEX (₹ Cr per 1%)', type: 'histogram', color: SERIES.pe, pane: 1, data: pts.filter((p) => p.gexNet != null).map((p) => ({ time: p.date, value: p.gexNet! / 1e7, color: p.gexNet! >= 0 ? SERIES.pe : SERIES.ce })) },
    ];
  }, [hist.data]);
  const markers = [
    ...(d?.spotPaise != null ? [{ x: d.spotPaise / 100, label: 'Spot', color: SERIES.blue }] : []),
    ...(d?.gex?.flipPaise != null ? [{ x: d.gex.flipPaise / 100, label: 'Flip', color: SERIES.accent }] : []),
  ];
  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} range={range} setRange={setRange} extra={<>
        <Segmented label="Bars" value={split} onChange={setSplit} options={[{ value: 'net', label: 'Net' }, { value: 'split', label: 'Calls and puts' }]} />
        <AsOf c={t.chain.data} />
      </>} />}
      about={<>
        <p>Gamma exposure at a strike is gamma (Black-76, per share) × open interest (shares) × forward² × 1%: the rupee change in the delta of the open positions for a 1% move in the underlying. Calls are counted positive and puts negative, the usual convention that assumes market makers hold the calls the public sold and the puts the public bought. That convention is an assumption about who holds what, not data.</p>
        <p>Contracts with open interest that did not trade that day get an IV interpolated from the nearest traded strikes on the same side. The call wall and put wall are the strikes with the largest call and put gamma exposure. The flip is the underlying level, within ±15%, where total gamma exposure would change sign, nearest the forward.</p>
      </>}>
      {!d ? <div className="panel grid min-h-[300px]"><Loading error={g.error} loading={g.loading} /></div> : !d.gex ? <div className="panel grid min-h-[200px]"><Loading empty="No gamma exposure for this day: no time left to expiry, or no traded options." /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Net GEX (per 1% move)" value={crore(d.gex.net, true)} className={tone(d.gex.net)} />
            <Stat label="Spot" value={rupees(d.spotPaise)} />
            <Stat label="Call wall" value={strike(d.gex.callWallPaise)} />
            <Stat label="Put wall" value={strike(d.gex.putWallPaise)} />
            <Stat label="Gamma flip" value={d.gex.flipPaise != null ? strike(Math.round(d.gex.flipPaise)) : '—'} />
            <Stat label="Legs with interpolated IV" value={String(d.gex.ivFilled)} />
          </div>
          <Card title={`Gamma exposure by strike · ${day(d.date, true)} · expiry ${day(d.expiry, true)}`}
            right={split === 'net' ? <><Key bar color={SERIES.pe} label="Positive" /><Key bar color={SERIES.ce} label="Negative" /></> : <><Key bar color={SERIES.pe} label="Calls (+)" /><Key bar color={SERIES.ce} label="Puts (−)" /></>}>
            <div className="p-2">
              <XYChart height={340} xLabel="Strike" xFormat={(x) => x.toLocaleString('en-IN')} yFormat={(y) => crore(y)} markers={markers}
                series={split === 'net'
                  ? [
                    { name: 'Net +', kind: 'bar', color: SERIES.pe, points: strikes.map((s) => ({ x: s.strikePaise / 100, y: s.net >= 0 ? s.net : null })) },
                    { name: 'Net −', kind: 'bar', color: SERIES.ce, points: strikes.map((s) => ({ x: s.strikePaise / 100, y: s.net < 0 ? s.net : null })) },
                  ]
                  : [
                    { name: 'Calls', kind: 'bar', color: SERIES.pe, points: strikes.map((s) => ({ x: s.strikePaise / 100, y: s.ce })) },
                    { name: 'Puts', kind: 'bar', color: SERIES.ce, points: strikes.map((s) => ({ x: s.strikePaise / 100, y: s.pe })) },
                  ]} />
            </div>
          </Card>
          <Card title={`Net gamma exposure and flip level until ${day(d.expiry, true)}`} right={<><Key color={SERIES.blue} label="Spot" /><Key dashed color={SERIES.accent} label="Flip" /></>}>
            {hist.data?.points.length ? <TimeChart series={histSeries} height={360} paneHeight={130} /> : <div className="grid min-h-[200px]"><Loading error={hist.error} loading={hist.loading} /></div>}
          </Card>
        </>
      )}
    </ToolShell>
  );
}

type Contract = { kind: 'CE' | 'PE'; strikePaise: number; side: ChainSide };

/** Contracts with the largest open-interest changes, and strikes where put and call OI crossed. */
export function OiSpurtsTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const c = t.chain.data;
  const contracts = useMemo<Contract[]>(() => (c?.rows ?? []).flatMap((r) => (['CE', 'PE'] as const).filter((k) => r[k]?.oiChange != null).map((k) => ({ kind: k, strikePaise: r.strikePaise, side: r[k]! }))), [c]);
  const added = [...contracts].sort((a, b) => b.side.oiChange! - a.side.oiChange!).slice(0, 12).filter((x) => x.side.oiChange! > 0);
  const shed = [...contracts].sort((a, b) => a.side.oiChange! - b.side.oiChange!).slice(0, 12).filter((x) => x.side.oiChange! < 0);
  const crossings = useMemo(() => (c?.rows ?? []).flatMap((r) => {
    if (!r.CE || !r.PE || r.CE.oiChange == null || r.PE.oiChange == null) return [];
    const now = r.PE.oi - r.CE.oi, before = (r.PE.oi - r.PE.oiChange) - (r.CE.oi - r.CE.oiChange);
    if (Math.sign(now) === Math.sign(before) || now === 0 || before === 0) return [];
    return [{ strikePaise: r.strikePaise, now, before, toPuts: now > 0 }];
  }), [c]);
  const cols: Column<Contract>[] = [
    { key: 'c', label: 'Contract', align: 'left', render: (x) => <b>{strike(x.strikePaise)} {x.kind}</b>, value: (x) => `${x.strikePaise} ${x.kind}` },
    { key: 'oi', label: 'OI', render: (x) => lakh(x.side.oi), value: (x) => x.side.oi },
    { key: 'chg', label: 'OI change', render: (x) => lakh(x.side.oiChange, true), value: (x) => x.side.oiChange ?? null, className: (x) => tone(x.side.oiChange) },
    { key: 'pct', label: '%', render: (x) => { const b = x.side.oi - (x.side.oiChange ?? 0); return b > 0 ? pct(((x.side.oiChange ?? 0) / b) * 100, 0, true) : 'new'; }, wide: true },
    { key: 'p', label: 'Close', render: (x) => rupees(x.side.closePaise), value: (x) => x.side.closePaise, wide: true },
    { key: 'bu', label: 'Build-up', align: 'left', render: (x) => { const b = classifyBuildUp(x.side.prevClosePaise != null ? x.side.closePaise - x.side.prevClosePaise : null, x.side.oiChange); return b === 'neutral' ? '—' : BUILD_UP[b].label; } },
  ];
  return (
    <ToolShell tool={tool} controls={<ChainControls t={t} extra={<AsOf c={c} />} />}
      about={<>
        <p>Open-interest change is today&rsquo;s open interest minus the previous trading day&rsquo;s, for the same contract. The lists show the 12 contracts of the selected expiry with the largest additions and reductions.</p>
        <p>A crossover is a strike where put open interest was above call open interest the day before and is now below it, or the other way round.</p>
      </>}>
      {!c ? <div className="panel grid min-h-[300px]"><Loading error={t.chain.error} loading={t.chain.loading} /></div> : (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card title="Most open interest added"><DataTable rows={added} columns={cols} rowKey={(x) => `${x.kind}${x.strikePaise}`} maxHeight="none" empty="No contract added open interest." /></Card>
            <Card title="Most open interest reduced"><DataTable rows={shed} columns={cols} rowKey={(x) => `${x.kind}${x.strikePaise}`} maxHeight="none" empty="No contract reduced open interest." /></Card>
          </div>
          <Card title="Put / call OI crossovers since the previous day">
            <DataTable rows={crossings} rowKey={(x) => String(x.strikePaise)} maxHeight="none" empty="No strike changed sides today."
              columns={[
                { key: 'k', label: 'Strike', align: 'left', render: (x) => <b>{strike(x.strikePaise)}</b>, value: (x) => x.strikePaise },
                { key: 'w', label: 'Now', align: 'left', render: (x) => (x.toPuts ? 'Put OI above call OI' : 'Call OI above put OI') },
                { key: 'b', label: 'PE − CE before', render: (x) => lakh(x.before, true), value: (x) => x.before },
                { key: 'n', label: 'PE − CE now', render: (x) => lakh(x.now, true), value: (x) => x.now, className: (x) => tone(x.now) },
              ]} />
          </Card>
        </>
      )}
    </ToolShell>
  );
}
