'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { impliedVol, yearsToExpiry } from '@mtv/options';
import { day, daysBefore, fetchDerived, fetchStrikeHistory, ivPct, lakh, rupees, strike, tone, useLoad, type StrikeQuote } from '@/lib/fno';
import type { Chain } from '@/lib/options';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented, Stat, selectClass } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { PALETTE, SERIES } from '../xy-chart';
import { AsOf, ChainControls, useChainTool } from './chain-common';

const RISK_FREE = 0.065; // same rate as the server's IV and Greeks
const closeOf = (date: string) => Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600;
type Kind = 'CE' | 'PE';
type Metric = 'close' | 'oi' | 'volume';
const metricValue = (q: StrikeQuote, m: Metric) => (m === 'close' ? q.closePaise / 100 : m === 'oi' ? q.oi / 1e5 : q.volume);
const metricFormat = (m: Metric) => (m === 'close' ? (v: number) => `₹${v.toFixed(2)}` : m === 'oi' ? (v: number) => `${v.toFixed(2)}L` : (v: number) => Math.round(v).toLocaleString('en-IN'));

/** Strikes `n` steps either side of ATM that are listed in the chain. */
function aroundAtm(c: Chain, n: number): number[] {
  if (c.atmStrikePaise == null) return [];
  const listed = new Set(c.rows.map((r) => r.strikePaise));
  const step = c.strikeStepPaise ?? 0;
  if (!step) return [c.atmStrikePaise];
  const out: number[] = [];
  for (let i = -n; i <= n; i++) if (listed.has(c.atmStrikePaise + i * step)) out.push(c.atmStrikePaise + i * step);
  return out;
}
const parseStrikes = (s: string | undefined) => (s ? s.split(',').map((x) => Math.round(Number(x) * 100)).filter((x) => x > 0) : []);
const joinStrikes = (ks: number[]) => ks.map((k) => k / 100).join(',');

function StrikeChips({ c, value, onChange, max = 6 }: { c: Chain | null; value: number[]; onChange: (ks: number[]) => void; max?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((k, i) => (
        <span key={k} className="num flex items-center gap-1 rounded-full bg-panel py-1 pr-1 pl-3 text-[12.5px] font-semibold shadow-[var(--shadow-panel)]">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{strike(k)}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== k))} aria-label={`Remove ${strike(k)}`} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"><X size={12} /></button>
        </span>
      ))}
      {value.length < max && c && (
        <select className={selectClass} value="" onChange={(e) => e.target.value && onChange([...value, Number(e.target.value)].sort((a, b) => a - b))} aria-label="Add a strike">
          <option value="">+ Strike</option>
          {c.rows.filter((r) => !value.includes(r.strikePaise)).map((r) => <option key={r.strikePaise} value={r.strikePaise}>{strike(r.strikePaise)}{r.strikePaise === c.atmStrikePaise ? ' (ATM)' : ''}</option>)}
        </select>
      )}
    </div>
  );
}

/** Up to six strikes of one expiry on one chart. */
export function MultiStrikeTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const c = t.chain.data;
  const [kind, setKind] = useState<Kind>('CE');
  const [metric, setMetric] = useState<Metric>('oi');
  const chosen = parseStrikes(t.get('strikes'));
  const strikes = chosen.length ? chosen : c ? aroundAtm(c, 2).filter((_, i, a) => i % 2 === 0 || a.length <= 3) : [];
  const key = c && strikes.length ? `${c.underlying}|${c.expiry}|${kind}|${strikes.join(',')}` : null;
  const h = useLoad(key, (s) => fetchStrikeHistory({ underlying: c!.underlying, expiry: c!.expiry, strikes: strikes.map((k) => k / 100), kind, to: c!.date }, s));
  const series = useMemo<TimeSeries[]>(() => {
    const q = h.data?.quotes ?? [];
    return [
      ...strikes.map((k, i) => ({ title: `${strike(k)} ${kind}`, type: 'line' as const, color: PALETTE[i % PALETTE.length], format: metricFormat(metric), data: q.filter((x) => x.strikePaise === k).map((x) => ({ time: x.date, value: metricValue(x, metric) })) })),
      { title: 'Spot', type: 'line', color: SERIES.grey, pane: 1, data: (h.data?.days ?? []).filter((d) => d.spotPaise != null).map((d) => ({ time: d.date, value: d.spotPaise! / 100 })) },
    ];
  }, [h.data, strikes.join(','), kind, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} extra={<>
        <Segmented label="Side" value={kind} onChange={setKind} options={[{ value: 'CE', label: 'Calls' }, { value: 'PE', label: 'Puts' }]} />
        <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ value: 'oi', label: 'OI' }, { value: 'close', label: 'Premium' }, { value: 'volume', label: 'Volume' }]} />
        <StrikeChips c={c} value={strikes} onChange={(ks) => t.set({ strikes: joinStrikes(ks) })} />
      </>} />}
      about={<p>Each line is one contract&rsquo;s official close, open interest (shares, in lakh) or traded volume (contracts) on every trading day it was listed, up to the selected day. Premium on a day with no trades is NSE&rsquo;s carried-forward close.</p>}>
      <Card title={`${c?.underlying ?? t.u} ${kind === 'CE' ? 'calls' : 'puts'}${c ? `, expiry ${day(c.expiry, true)}` : ''}`} right={<><Key color={SERIES.grey} label="Spot (lower pane)" /><AsOf c={c} /></>}>
        {h.data ? <TimeChart series={series} height={460} paneHeight={120} /> : <div className="grid min-h-[300px]"><Loading error={h.error ?? t.chain.error} loading={h.loading || t.chain.loading} /></div>}
      </Card>
    </ToolShell>
  );
}

/** One contract's whole life: premium, OI, volume and IV by day. */
export function ContractTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const c = t.chain.data;
  const kind = (t.get('kind') === 'PE' ? 'PE' : 'CE') as Kind;
  const k = parseStrikes(t.get('strike'))[0] ?? c?.atmStrikePaise ?? null;
  const key = c && k != null ? `${c.underlying}|${c.expiry}|${kind}|${k}` : null;
  const h = useLoad(key, (s) => fetchStrikeHistory({ underlying: c!.underlying, expiry: c!.expiry, strikes: [k! / 100], kind }, s));
  const fwd = useLoad(c ? `${c.underlying}|${c.expiry}` : null, (s) => fetchDerived({ underlying: c!.underlying, expiry: c!.expiry, from: daysBefore(c!.expiry, 1500), to: c!.expiry }, s));
  const rows = useMemo(() => {
    const F = new Map((fwd.data?.points ?? []).map((p) => [p.date, p.forwardPaise]));
    const spot = new Map((h.data?.days ?? []).map((d) => [d.date, d.spotPaise]));
    return (h.data?.quotes ?? []).map((q, i, a) => {
      const f = F.get(q.date), T = c ? yearsToExpiry(closeOf(q.date), c.expiry) : 0;
      const iv = q.traded && f && T > 0 ? impliedVol(kind, q.closePaise / 100, f / 100, q.strikePaise / 100, T, RISK_FREE) : null;
      const prev = a[i - 1];
      return { ...q, iv, spotPaise: spot.get(q.date) ?? null, change: prev ? q.closePaise - prev.closePaise : null, oiChange: prev ? q.oi - prev.oi : null };
    });
  }, [h.data, fwd.data, c, kind]);
  const series = useMemo<TimeSeries[]>(() => [
    { title: 'Close', type: 'line', color: kind === 'CE' ? SERIES.ce : SERIES.pe, data: rows.map((r) => ({ time: r.date, value: r.closePaise / 100 })) },
    { title: 'Spot', type: 'line', color: SERIES.blue, dashed: true, scale: 'left', data: rows.filter((r) => r.spotPaise != null).map((r) => ({ time: r.date, value: r.spotPaise! / 100 })) },
    { title: 'OI (lakh)', type: 'histogram', color: SERIES.grey, pane: 1, data: rows.map((r) => ({ time: r.date, value: r.oi / 1e5 })) },
    { title: 'IV', type: 'line', color: SERIES.violet, pane: 2, format: (v) => `${v.toFixed(1)}%`, data: rows.filter((r) => r.iv != null).map((r) => ({ time: r.date, value: r.iv! * 100 })) },
  ], [rows, kind]);
  const last = rows.at(-1);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'd', label: 'Date', align: 'left', render: (r) => day(r.date, true), value: (r) => r.date },
    { key: 's', label: 'Spot', render: (r) => rupees(r.spotPaise), value: (r) => (r.spotPaise == null ? null : r.spotPaise / 100), wide: true },
    { key: 'c', label: 'Close', render: (r) => <b title={r.traded ? undefined : 'No trades: carried-forward close'}>{rupees(r.closePaise)}{r.traded ? '' : ' *'}</b>, value: (r) => r.closePaise / 100 },
    { key: 'ch', label: 'Change', render: (r) => (r.change == null ? '—' : `${r.change >= 0 ? '+' : '−'}${rupees(Math.abs(r.change))}`), value: (r) => r.change, className: (r) => tone(r.change) },
    { key: 'oi', label: 'OI', render: (r) => lakh(r.oi), value: (r) => r.oi },
    { key: 'oic', label: 'OI chg', render: (r) => lakh(r.oiChange, true), value: (r) => r.oiChange, className: (r) => tone(r.oiChange) },
    { key: 'v', label: 'Contracts traded', render: (r) => r.volume.toLocaleString('en-IN'), value: (r) => r.volume, wide: true },
    { key: 'iv', label: 'IV', render: (r) => ivPct(r.iv), value: (r) => r.iv },
  ];
  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} extra={<>
        <Segmented label="Side" value={kind} onChange={(v) => t.set({ kind: v })} options={[{ value: 'CE', label: 'Call' }, { value: 'PE', label: 'Put' }]} />
        <select className={selectClass} value={k ?? ''} onChange={(e) => t.set({ strike: String(Number(e.target.value) / 100) })} aria-label="Strike">
          {k != null && !c?.rows.some((r) => r.strikePaise === k) && <option value={k}>{strike(k)}</option>}
          {c?.rows.map((r) => <option key={r.strikePaise} value={r.strikePaise}>{strike(r.strikePaise)}{r.strikePaise === c.atmStrikePaise ? ' (ATM)' : ''}</option>)}
        </select>
      </>} />}
      about={<>
        <p>Every trading day the contract was listed, from NSE&rsquo;s F&amp;O files: official close, open interest (shares) and volume (contracts traded). Days marked * had no trades, so the close is carried forward and no IV is shown.</p>
        <p>IV is implied from the close with Black-76 on that day&rsquo;s put-call-parity forward for the expiry, at a 6.5% rate. To see an expired contract, step the date back to a day when it was listed and pick its expiry.</p>
      </>}>
      {last && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={`Close · ${day(last.date)}`} value={rupees(last.closePaise)} />
          <Stat label="Open interest" value={lakh(last.oi)} />
          <Stat label="IV" value={ivPct(last.iv)} />
          <Stat label="Days listed" value={String(rows.length)} />
        </div>
      )}
      <Card title={c && k != null ? `${c.underlying} ${day(c.expiry, true)} ${strike(k)} ${kind}` : 'Contract'} right={<><Key color={kind === 'CE' ? SERIES.ce : SERIES.pe} label="Close (right)" /><Key dashed color={SERIES.blue} label="Spot (left)" /><Key bar color={SERIES.grey} label="OI" /><Key color={SERIES.violet} label="IV" /></>}>
        {h.data ? <TimeChart series={series} height={520} paneHeight={110} /> : <div className="grid min-h-[300px]"><Loading error={h.error ?? t.chain.error} loading={h.loading || t.chain.loading} /></div>}
      </Card>
      {rows.length > 0 && <Card title="Day by day"><DataTable rows={[...rows].reverse()} columns={columns} rowKey={(r) => r.date} csvName={`${c?.underlying}-${c?.expiry}-${k! / 100}${kind}.csv`} maxHeight="50dvh" /></Card>}
    </ToolShell>
  );
}

/** Date × strike grid of one expiry over recent sessions. */
export function TimeseriesChainTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const c = t.chain.data;
  const [kind, setKind] = useState<Kind>('CE');
  const [metric, setMetric] = useState<'oi' | 'oiChange' | 'close'>('oi');
  const [width, setWidth] = useState(6);
  const strikes = useMemo(() => (c ? aroundAtm(c, width) : []), [c, width]);
  const key = c && strikes.length ? `${c.underlying}|${c.expiry}|${c.date}|${kind}|${strikes.join(',')}` : null;
  const h = useLoad(key, (s) => fetchStrikeHistory({ underlying: c!.underlying, expiry: c!.expiry, strikes: strikes.map((k) => k / 100), kind, from: daysBefore(c!.date, 45), to: c!.date }, s));
  const grid = useMemo(() => {
    const q = h.data?.quotes ?? [];
    const by = new Map(q.map((x) => [`${x.date}|${x.strikePaise}`, x]));
    const dates = [...new Set(q.map((x) => x.date))].sort();
    return dates.map((d, i) => ({
      date: d,
      cells: strikes.map((k) => {
        const x = by.get(`${d}|${k}`), p = i > 0 ? by.get(`${dates[i - 1]}|${k}`) : undefined;
        if (!x) return null;
        return metric === 'oi' ? x.oi : metric === 'close' ? x.closePaise : p ? x.oi - p.oi : null;
      }),
    })).reverse().slice(0, 20);
  }, [h.data, strikes, metric]);
  const fmtCell = (v: number | null) => (v == null ? '—' : metric === 'close' ? rupees(v) : lakh(v, metric === 'oiChange'));
  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} extra={<>
        <Segmented label="Side" value={kind} onChange={setKind} options={[{ value: 'CE', label: 'Calls' }, { value: 'PE', label: 'Puts' }]} />
        <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ value: 'oi', label: 'OI' }, { value: 'oiChange', label: 'OI change' }, { value: 'close', label: 'Premium' }]} />
        <Segmented label="Strikes" value={width} onChange={setWidth} options={[{ value: 4, label: '±4' }, { value: 6, label: '±6' }, { value: 10, label: '±10' }]} />
        <AsOf c={c} />
      </>} />}
      about={<p>Rows are the last 20 trading days up to the selected day; columns are the strikes around that day&rsquo;s ATM strike. Each cell is the contract&rsquo;s open interest, its change from the previous row, or its official close.</p>}>
      <Card title={c ? `${c.underlying} ${kind === 'CE' ? 'calls' : 'puts'}, expiry ${day(c.expiry, true)}` : 'Chain over time'}>
        {!h.data ? <div className="grid min-h-[300px]"><Loading error={h.error ?? t.chain.error} loading={h.loading || t.chain.loading} /></div> : (
          <div className="overflow-auto">
            <table className="num w-full text-[12px]">
              <thead className="sticky top-0 bg-panel text-[10.5px] text-muted">
                <tr><th className="py-2 pl-3 text-left font-semibold">Date</th>{strikes.map((k) => <th key={k} className={`px-2 text-right font-semibold ${k === c?.atmStrikePaise ? 'text-accent-deep' : ''}`}>{strike(k)}</th>)}</tr>
              </thead>
              <tbody>
                {grid.map((r) => (
                  <tr key={r.date} className="border-t border-line">
                    <td className="py-1.5 pl-3 text-left font-sans whitespace-nowrap">{day(r.date)}</td>
                    {r.cells.map((v, i) => <td key={i} className={`px-2 text-right whitespace-nowrap ${metric === 'oiChange' ? tone(v) : ''} ${strikes[i] === c?.atmStrikePaise ? 'bg-itm' : ''}`}>{fmtCell(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </ToolShell>
  );
}

/** Strikes whose OI change is far above their own recent average change. */
export function OiClustersTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const c = t.chain.data;
  const [mult, setMult] = useState(3);
  const key = c ? `${c.underlying}|${c.expiry}|${c.date}` : null;
  const h = useLoad(key, (s) => fetchStrikeHistory({ underlying: c!.underlying, expiry: c!.expiry, from: daysBefore(c!.date, 40), to: c!.date }, s));
  const flagged = useMemo(() => {
    const q = h.data?.quotes ?? [];
    if (!c) return [];
    const by = new Map<string, StrikeQuote[]>();
    for (const x of q) { const k = `${x.kind}|${x.strikePaise}`; const l = by.get(k) ?? []; l.push(x); by.set(k, l); }
    const out: { kind: Kind; strikePaise: number; oi: number; change: number; avg: number; ratio: number; days: number; closePaise: number; priceChange: number | null }[] = [];
    let largest = 0;
    for (const list of by.values()) {
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      const today = list.at(-1)!;
      if (today.date !== c.date || list.length < 11) continue;
      const changes = list.slice(1).map((x, i) => x.oi - list[i].oi);
      const todayChange = changes.at(-1)!;
      largest = Math.max(largest, Math.abs(todayChange));
      const past = changes.slice(-21, -1).map(Math.abs);
      const avg = past.reduce((a, b) => a + b, 0) / past.length;
      if (!avg || Math.abs(todayChange) < mult * avg) continue;
      const prev = list.at(-2)!;
      out.push({ kind: today.kind, strikePaise: today.strikePaise, oi: today.oi, change: todayChange, avg, ratio: Math.abs(todayChange) / avg, days: past.length, closePaise: today.closePaise, priceChange: today.closePaise - prev.closePaise });
    }
    // Size floor: at least 1% of the expiry's largest change that day, so tiny far strikes don't fill the list.
    return out.filter((x) => Math.abs(x.change) >= largest * 0.01).sort((a, b) => b.ratio - a.ratio);
  }, [h.data, c, mult]);
  return (
    <ToolShell tool={tool}
      controls={<ChainControls t={t} extra={<>
        <Segmented label="Threshold" value={mult} onChange={setMult} options={[{ value: 3, label: '3× average' }, { value: 5, label: '5×' }, { value: 10, label: '10×' }]} />
        <AsOf c={c} />
      </>} />}
      about={<>
        <p>The rule, in full: for each contract of the selected expiry, take its daily open-interest changes over the previous 20 sessions (at least 10). A contract is listed when the size of today&rsquo;s change is at least the chosen multiple of the average size of those changes, and at least 1% of the largest change of any contract of that expiry that day (so tiny far-away strikes don&rsquo;t fill the list).</p>
        <p>This only says that a contract&rsquo;s open interest moved unusually for that contract. It does not say who traded or why.</p>
      </>}>
      <Card title={c ? `Unusual open-interest changes · ${day(c.date, true)} · expiry ${day(c.expiry, true)}` : 'Unusual open-interest changes'}>
        {!h.data ? <div className="grid min-h-[300px]"><Loading error={h.error ?? t.chain.error} loading={h.loading || t.chain.loading} /></div> : (
          <DataTable rows={flagged} rowKey={(r) => `${r.kind}${r.strikePaise}`} maxHeight="65dvh" csvName={`${c?.underlying}-${c?.expiry}-unusual-oi-${c?.date}.csv`} empty="No contract passed the threshold on this day."
            columns={[
              { key: 'c', label: 'Contract', align: 'left', render: (r) => <b>{strike(r.strikePaise)} {r.kind}</b>, value: (r) => `${r.strikePaise} ${r.kind}` },
              { key: 'ch', label: 'OI change', render: (r) => lakh(r.change, true), value: (r) => r.change, className: (r) => tone(r.change) },
              { key: 'avg', label: 'Avg |change|', render: (r) => lakh(r.avg), value: (r) => r.avg },
              { key: 'x', label: 'Times average', render: (r) => <b>{r.ratio.toFixed(1)}×</b>, value: (r) => r.ratio },
              { key: 'oi', label: 'OI', render: (r) => lakh(r.oi), value: (r) => r.oi },
              { key: 'p', label: 'Close', render: (r) => rupees(r.closePaise), value: (r) => r.closePaise, wide: true },
              { key: 'pc', label: 'Price chg', render: (r) => (r.priceChange == null ? '—' : `${r.priceChange >= 0 ? '+' : '−'}${rupees(Math.abs(r.priceChange))}`), value: (r) => r.priceChange, className: (r) => tone(r.priceChange), wide: true },
              { key: 'n', label: 'Sessions', render: (r) => String(r.days), wide: true },
            ]} />
        )}
      </Card>
    </ToolShell>
  );
}

type Leg = { id: number; kind: Kind; side: 'BUY' | 'SELL'; strikePaise: number; lots: number };

/** Combined premium of the user's legs by day. */
export function StrategyChartTool({ tool }: { tool: Tool }) {
  const t = useChainTool();
  const c = t.chain.data;
  const [legs, setLegs] = useState<Leg[]>([]);
  // A short straddle at ATM to start with, rebuilt when the underlying or expiry changes.
  useEffect(() => {
    if (c?.atmStrikePaise == null) return;
    setLegs([{ id: 1, kind: 'CE', side: 'SELL', strikePaise: c.atmStrikePaise, lots: 1 }, { id: 2, kind: 'PE', side: 'SELL', strikePaise: c.atmStrikePaise, lots: 1 }]);
  }, [c?.underlying, c?.expiry]); // eslint-disable-line react-hooks/exhaustive-deps
  const strikes = [...new Set(legs.map((l) => l.strikePaise))];
  const key = c && legs.length ? `${c.underlying}|${c.expiry}|${strikes.join(',')}` : null;
  const h = useLoad(key, (s) => fetchStrikeHistory({ underlying: c!.underlying, expiry: c!.expiry, strikes: strikes.map((k) => k / 100) }, s));
  const days = useMemo(() => {
    const q = h.data?.quotes ?? [];
    const by = new Map(q.map((x) => [`${x.date}|${x.kind}|${x.strikePaise}`, x]));
    const lot = new Map((h.data?.days ?? []).map((d) => [d.date, d.lotSize]));
    const spot = new Map((h.data?.days ?? []).map((d) => [d.date, d.spotPaise]));
    return [...new Set(q.map((x) => x.date))].sort().flatMap((d) => {
      const quotes = legs.map((l) => by.get(`${d}|${l.kind}|${l.strikePaise}`));
      if (quotes.some((x) => !x)) return [];
      const l = lot.get(d) ?? c?.lotSize ?? null;
      const net = legs.reduce((a, leg, i) => a + (leg.side === 'BUY' ? 1 : -1) * quotes[i]!.closePaise * leg.lots, 0); // paise per lot-unit
      return [{ date: d, netPerUnit: net, lot: l, value: l ? (net * l) / 100 : null, allTraded: quotes.every((x) => x!.traded), spotPaise: spot.get(d) ?? null }];
    });
  }, [h.data, legs, c]);
  const first = days[0];
  const series = useMemo<TimeSeries[]>(() => [
    { title: 'Net premium (₹/unit)', type: 'line', color: SERIES.accent, data: days.map((d) => ({ time: d.date, value: d.netPerUnit / 100 })) },
    { title: 'Spot', type: 'line', color: SERIES.blue, dashed: true, scale: 'left', data: days.filter((d) => d.spotPaise != null).map((d) => ({ time: d.date, value: d.spotPaise! / 100 })) },
  ], [days]);
  const update = (id: number, patch: Partial<Leg>) => setLegs(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const last = days.at(-1);
  const short = legs.length && legs.every((l) => l.side === 'SELL');
  return (
    <ToolShell tool={tool} controls={<ChainControls t={t} extra={<AsOf c={c} />} />}
      about={<>
        <p>Net premium is the sum over legs of (+1 for a buy, −1 for a sell) × lots × that leg&rsquo;s official close, per unit of the underlying. Multiplied by the lot size of each day it gives the position&rsquo;s value. Only days on which every leg was listed are shown; days when a leg did not trade use NSE&rsquo;s carried-forward close.</p>
        <p>For a position entered on the first day shown and held, the profit is the change in value (before charges): for net-short positions, a fall in net premium is a gain.</p>
      </>}>
      <Card title="Legs" right={legs.length < 4 && c?.atmStrikePaise != null && (
        <button type="button" className="rounded-full bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent-deep" onClick={() => setLegs([...legs, { id: Date.now(), kind: 'CE', side: 'BUY', strikePaise: c.atmStrikePaise!, lots: 1 }])}>+ Add leg</button>
      )}>
        <div className="flex flex-col gap-2 p-3">
          {legs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2">
              <Segmented label="Buy or sell" value={l.side} onChange={(v) => update(l.id, { side: v })} options={[{ value: 'BUY', label: 'Buy' }, { value: 'SELL', label: 'Sell' }]} />
              <Segmented label="Call or put" value={l.kind} onChange={(v) => update(l.id, { kind: v })} options={[{ value: 'CE', label: 'CE' }, { value: 'PE', label: 'PE' }]} />
              <select className={selectClass} value={l.strikePaise} onChange={(e) => update(l.id, { strikePaise: Number(e.target.value) })} aria-label="Strike">
                {c?.rows.map((r) => <option key={r.strikePaise} value={r.strikePaise}>{strike(r.strikePaise)}{r.strikePaise === c.atmStrikePaise ? ' (ATM)' : ''}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2">Lots
                <input type="number" min={1} max={50} value={l.lots} onChange={(e) => update(l.id, { lots: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className={`${selectClass} num w-[70px]`} />
              </label>
              <button type="button" onClick={() => setLegs(legs.filter((x) => x.id !== l.id))} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink" aria-label="Remove leg"><X size={14} /></button>
            </div>
          ))}
          {!legs.length && <p className="text-[13px] text-muted">Add a leg to start.</p>}
        </div>
      </Card>
      {first && last && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={`Net premium · ${day(first.date)}`} value={rupees(first.netPerUnit)} />
          <Stat label={`Net premium · ${day(last.date)}`} value={rupees(last.netPerUnit)} />
          <Stat label="Position value then → now" value={first.value != null && last.value != null ? `₹${Math.round(first.value).toLocaleString('en-IN')} → ₹${Math.round(last.value).toLocaleString('en-IN')}` : '—'} />
          <Stat label="P&L if held (before charges)" value={first.value != null && last.value != null ? `₹${Math.round(last.value - first.value).toLocaleString('en-IN')}` : '—'} className={tone(first.value != null && last.value != null ? last.value - first.value : null)} hint={short ? 'Net short: value is negative, so a smaller premium shows as a gain' : undefined} />
        </div>
      )}
      <Card title="Net premium by day" right={<><Key color={SERIES.accent} label="Net premium (right)" /><Key dashed color={SERIES.blue} label="Spot (left)" /></>}>
        {h.data ? (days.length ? <TimeChart series={series} height={400} /> : <div className="grid min-h-[200px]"><Loading empty="No day on which every leg was listed." /></div>)
          : <div className="grid min-h-[300px]"><Loading error={h.error ?? t.chain.error} loading={h.loading || t.chain.loading} /></div>}
      </Card>
    </ToolShell>
  );
}
