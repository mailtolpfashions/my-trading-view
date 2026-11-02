'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Pause, Play } from 'lucide-react';
import { day, fetchAllBreadth, fetchBreadth, fetchMarketIndices, fetchRrg, pct, ratio, tone, useLoad, type BreadthRow, type RrgSector } from '@/lib/fno';
import type { Tool } from '@/lib/tools';
import { Loading, Segmented, Stat, selectClass, useToolParams } from '../controls';
import { DataTable, type Column } from '../data-table';
import { TimeChart, type TimeSeries } from '../time-chart';
import { Card, Key, ToolShell } from '../tool-shell';
import { PALETTE, SERIES } from '../xy-chart';

const QUAD = {
  leading: { label: 'Leading', color: '#0a9b76', fill: 'rgba(10,155,118,0.07)' },
  weakening: { label: 'Weakening', color: '#d98a00', fill: 'rgba(245,154,11,0.08)' },
  lagging: { label: 'Lagging', color: '#e5484d', fill: 'rgba(229,72,77,0.07)' },
  improving: { label: 'Improving', color: '#2f5bff', fill: 'rgba(47,91,255,0.07)' },
} as const;
type Quadrant = keyof typeof QUAD;
const quadrantOf = (p: { rsRatio: number; rsMomentum: number }): Quadrant => (p.rsRatio >= 100 ? (p.rsMomentum >= 100 ? 'leading' : 'weakening') : p.rsMomentum >= 100 ? 'improving' : 'lagging');
const MAIN_SECTORS = ['NIFTY AUTO', 'NIFTY BANK', 'NIFTY FINANCIAL SERVICES', 'NIFTY IT', 'NIFTY FMCG', 'NIFTY METAL', 'NIFTY PHARMA', 'NIFTY REALTY', 'NIFTY ENERGY', 'NIFTY MEDIA', 'NIFTY PSU BANK', 'NIFTY INFRASTRUCTURE'];
const shortName = (n: string) => n.replace(/^NIFTY /, '').replace(' INDEX', '').replace('INDIA ', '');

/** Relative rotation chart: RS-Ratio (x) against RS-Momentum (y), each sector with a tail ending on the chosen date. */
function RrgChart({ sectors, colors, at, tail }: { sectors: RrgSector[]; colors: Map<string, string>; at: string; tail: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(700);
  useEffect(() => { const el = host.current!; const ro = new ResizeObserver(() => setW(el.clientWidth || 700)); ro.observe(el); return () => ro.disconnect(); }, []);
  const trails = sectors.map((s) => {
    const i = s.points.findIndex((p) => p.date === at);
    const end = i < 0 ? s.points.length - 1 : i;
    return { s, pts: s.points.slice(Math.max(0, end - tail + 1), end + 1) };
  }).filter((t) => t.pts.length);
  const all = trails.flatMap((t) => t.pts);
  // Each axis gets its own symmetric range around 100 (momentum moves far less than the ratio).
  const sx = Math.max(0.5, ...all.map((p) => Math.abs(p.rsRatio - 100))) * 1.12;
  const sy = Math.max(0.3, ...all.map((p) => Math.abs(p.rsMomentum - 100))) * 1.12;
  const H = Math.min(620, Math.max(360, w * 0.7)), pad = 34;
  const X = (v: number) => pad + ((v - (100 - sx)) / (2 * sx)) * (w - 2 * pad);
  const Y = (v: number) => pad + (1 - (v - (100 - sy)) / (2 * sy)) * (H - 2 * pad);
  const cx = X(100), cy = Y(100);
  return (
    <div ref={host} className="w-full">
      <svg width={w} height={H} role="img" aria-label="Relative rotation chart">
        <rect x={cx} y={pad} width={w - pad - cx} height={cy - pad} fill={QUAD.leading.fill} />
        <rect x={cx} y={cy} width={w - pad - cx} height={H - pad - cy} fill={QUAD.weakening.fill} />
        <rect x={pad} y={cy} width={cx - pad} height={H - pad - cy} fill={QUAD.lagging.fill} />
        <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill={QUAD.improving.fill} />
        <line x1={cx} x2={cx} y1={pad} y2={H - pad} stroke="var(--color-zero)" />
        <line x1={pad} x2={w - pad} y1={cy} y2={cy} stroke="var(--color-zero)" />
        <text x={w - pad - 6} y={pad + 14} textAnchor="end" className="text-[12px] font-bold" fill={QUAD.leading.color}>Leading</text>
        <text x={w - pad - 6} y={H - pad - 6} textAnchor="end" className="text-[12px] font-bold" fill={QUAD.weakening.color}>Weakening</text>
        <text x={pad + 6} y={H - pad - 6} className="text-[12px] font-bold" fill={QUAD.lagging.color}>Lagging</text>
        <text x={pad + 6} y={pad + 14} className="text-[12px] font-bold" fill={QUAD.improving.color}>Improving</text>
        <text x={(w) / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">RS-Ratio →</text>
        <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="fill-muted text-[11px]">RS-Momentum →</text>
        {trails.map(({ s, pts }) => {
          const c = colors.get(s.name)!;
          const last = pts[pts.length - 1];
          return (
            <g key={s.name}>
              <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.rsRatio).toFixed(1)},${Y(p.rsMomentum).toFixed(1)}`).join('')} fill="none" stroke={c} strokeWidth={1.6} opacity={0.75} />
              {pts.slice(0, -1).map((p) => <circle key={p.date} cx={X(p.rsRatio)} cy={Y(p.rsMomentum)} r={2} fill={c} opacity={0.6} />)}
              <circle cx={X(last.rsRatio)} cy={Y(last.rsMomentum)} r={5} fill={c}><title>{`${s.name} · ${day(last.date, true)} · RS-Ratio ${last.rsRatio.toFixed(2)}, RS-Momentum ${last.rsMomentum.toFixed(2)}`}</title></circle>
              <text x={X(last.rsRatio) + 7} y={Y(last.rsMomentum) + 4} className="text-[10.5px] font-semibold" fill={c}>{shortName(s.name)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RrgTool({ tool }: { tool: Tool }) {
  const p = useToolParams();
  const tf = p.get('tf') === 'D' ? 'D' : 'W';
  const bench = p.get('bench') ?? 'NIFTY 50';
  const [tail, setTail] = useState(8);
  // Start with the main sectoral indices; the thematic ones can be switched on in the table.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const r = useLoad(`${tf}|${bench}`, (s) => fetchRrg(tf, bench, s));
  useEffect(() => {
    if (touched || !r.data) return;
    setHidden(new Set(r.data.sectors.map((s) => s.name).filter((n) => !MAIN_SECTORS.includes(n))));
  }, [r.data, touched]);
  const dates = useMemo(() => [...new Set((r.data?.sectors ?? []).flatMap((s) => s.points.map((x) => x.date)))].sort(), [r.data]);
  const [atIdx, setAtIdx] = useState<number | null>(null);
  const idx = atIdx == null ? dates.length - 1 : Math.min(atIdx, dates.length - 1);
  useEffect(() => { setAtIdx(null); }, [r.data]);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setAtIdx((i) => { const cur = i ?? dates.length - 1; if (cur >= dates.length - 1) { setPlaying(false); return cur; } return cur + 1; }), 450);
    return () => clearInterval(t);
  }, [playing, dates.length]);
  const colors = useMemo(() => new Map((r.data?.sectors ?? []).map((s, i) => [s.name, PALETTE[i % PALETTE.length]])), [r.data]);
  const at = dates[idx];
  const shown = (r.data?.sectors ?? []).filter((s) => !hidden.has(s.name));
  const table = (r.data?.sectors ?? []).map((s) => {
    const i = s.points.findIndex((x) => x.date === at);
    const cur = s.points[i < 0 ? s.points.length - 1 : i], prev = s.points[(i < 0 ? s.points.length - 1 : i) - tail + 1];
    return { name: s.name, cur, quadrant: cur ? quadrantOf(cur) : null, prevQuadrant: prev ? quadrantOf(prev) : null };
  });
  const columns: Column<(typeof table)[number]>[] = [
    { key: 'n', label: 'Index', align: 'left', render: (x) => (
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={!hidden.has(x.name)} onChange={() => { setTouched(true); const h = new Set(hidden); if (h.has(x.name)) h.delete(x.name); else h.add(x.name); setHidden(h); }} />
        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colors.get(x.name) }} />{x.name}
      </label>), value: (x) => x.name },
    { key: 'q', label: 'Quadrant', align: 'left', render: (x) => (x.quadrant ? <b style={{ color: QUAD[x.quadrant].color }}>{QUAD[x.quadrant].label}</b> : '—'), value: (x) => x.quadrant },
    { key: 'pq', label: `${tail} points earlier`, align: 'left', render: (x) => (x.prevQuadrant ? QUAD[x.prevQuadrant].label : '—'), value: (x) => x.prevQuadrant, wide: true },
    { key: 'r', label: 'RS-Ratio', render: (x) => x.cur?.rsRatio.toFixed(2) ?? '—', value: (x) => x.cur?.rsRatio ?? null },
    { key: 'm', label: 'RS-Momentum', render: (x) => x.cur?.rsMomentum.toFixed(2) ?? '—', value: (x) => x.cur?.rsMomentum ?? null },
  ];
  return (
    <ToolShell tool={tool}
      controls={<>
        <Segmented label="Timeframe" value={tf} onChange={(v) => p.set({ tf: v })} options={[{ value: 'D', label: 'Daily' }, { value: 'W', label: 'Weekly' }]} />
        <select className={selectClass} value={bench} onChange={(e) => p.set({ bench: e.target.value })} aria-label="Benchmark">
          <option value="NIFTY 50">Against NIFTY 50</option><option value="NIFTY 500">Against NIFTY 500</option>
        </select>
        <Segmented label="Tail" value={tail} onChange={setTail} options={[4, 8, 12, 16].map((n) => ({ value: n, label: `${n} pts` }))} />
        {dates.length > 0 && (
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <button type="button" onClick={() => { if (!playing && idx >= dates.length - 1) setAtIdx(Math.max(0, dates.length - 30)); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play'}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-inverse text-on-inverse">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
            <input type="range" min={0} max={dates.length - 1} value={idx} onChange={(e) => { setPlaying(false); setAtIdx(Number(e.target.value)); }} className="flex-1 accent-[var(--color-accent)]" aria-label="Date" />
            <span className="num w-[100px] text-[12.5px] font-semibold">{at ? day(at, true) : ''}</span>
          </div>
        )}
      </>}
      about={<>
        <p>Each dot is a sector index on the chosen {tf === 'W' ? 'week' : 'day'}, with a tail through its previous points. The method is an open approximation of relative-rotation charts, not the proprietary original:</p>
        <p>RS = 100 × sector close ÷ benchmark close. RS-Ratio = 100 × the 10-point exponential average of RS ÷ that average&rsquo;s own mean over the last 26 weeks (50 days on the daily view). RS-Momentum = 100 × RS-Ratio ÷ RS-Ratio 4 weeks (5 days) earlier. Weekly points use each week&rsquo;s last close.</p>
        <p>Right of 100 means the sector has been stronger than the benchmark relative to its own recent range; above 100 means that relative strength is rising. Sectors usually move clockwise through the quadrants, but not always. All closes are NSE&rsquo;s official index closes.</p>
      </>}>
      {!r.data ? <div className="panel grid min-h-[400px]"><Loading error={r.error} loading={r.loading} /></div> : (
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card title={`Sector rotation against ${bench}${at ? ` · ${day(at, true)}` : ''}`}><div className="p-2"><RrgChart sectors={shown} colors={colors} at={at} tail={tail} /></div></Card>
          <Card title="Sectors" right={<button type="button" className="font-semibold text-accent-deep" onClick={() => { setTouched(true); setHidden(hidden.size ? new Set() : new Set((r.data?.sectors ?? []).map((s) => s.name))); }}>{hidden.size ? 'Show all' : 'Hide all'}</button>}>
            <DataTable rows={table} columns={columns} rowKey={(x) => x.name} maxHeight="70dvh" initialSort={{ key: 'r', desc: true }} />
          </Card>
        </div>
      )}
    </ToolShell>
  );
}

/** Advance / decline of one index over time, and today's breadth of every index. */
export function BreadthTool({ tool }: { tool: Tool }) {
  const p = useToolParams();
  const index = p.get('index') ?? 'NIFTY 50';
  const [days, setDays] = useState(250);
  const [list, setList] = useState<string[]>([]);
  useEffect(() => { fetchMarketIndices().then((r) => setList(r.breadth), () => setList([])); }, []);
  const b = useLoad(`${index}|${days}`, (s) => fetchBreadth(index, days, s));
  const all = useLoad('all', (s) => fetchAllBreadth(s));
  const d = b.data;
  const today = d?.days.at(-1);
  const series = useMemo<TimeSeries[]>(() => !d ? [] : [
    { title: d.index, type: 'line', color: SERIES.blue, data: d.level.map((l) => ({ time: l.date, value: l.close })) },
    { title: 'Advances − declines', type: 'histogram', color: SERIES.pe, pane: 1, data: d.days.map((x) => ({ time: x.date, value: x.advances - x.declines, color: x.advances >= x.declines ? SERIES.pe : SERIES.ce })), format: (v) => v.toFixed(0) },
    { title: 'Cumulative A − D', type: 'line', color: SERIES.accent, pane: 2, data: d.days.map((x) => ({ time: x.date, value: x.cumulative })), format: (v) => v.toFixed(0) },
  ], [d]);
  const share = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(0)}%` : '—');
  const allCols: Column<BreadthRow>[] = [
    { key: 'i', label: 'Index', align: 'left', render: (r) => <button type="button" onClick={() => p.set({ index: r.index })} className={`text-left font-semibold hover:text-accent-deep ${r.index === index ? 'text-accent-deep' : ''}`}>{r.index}</button>, value: (r) => r.index },
    { key: 'c', label: 'Change', render: (r) => pct(r.changePct, 2, true), value: (r) => r.changePct, className: (r) => tone(r.changePct) },
    { key: 'a', label: 'Adv', render: (r) => String(r.advances), value: (r) => r.advances, className: () => 'text-up' },
    { key: 'd', label: 'Dec', render: (r) => String(r.declines), value: (r) => r.declines, className: () => 'text-down' },
    { key: 'ad', label: 'A/D', render: (r) => ratio(r.declines ? r.advances / r.declines : null), value: (r) => (r.declines ? r.advances / r.declines : null) },
    { key: '50', label: '> 50-DMA', render: (r) => share(r.aboveSma50, r.traded), value: (r) => (r.traded ? r.aboveSma50 / r.traded : null), wide: true },
    { key: '200', label: '> 200-DMA', render: (r) => share(r.aboveSma200, r.withSma200), value: (r) => (r.withSma200 ? r.aboveSma200 / r.withSma200 : null), wide: true },
    { key: 'h', label: '52w highs', render: (r) => String(r.newHighs), value: (r) => r.newHighs, wide: true },
    { key: 'l', label: '52w lows', render: (r) => String(r.newLows), value: (r) => r.newLows, wide: true },
  ];
  return (
    <ToolShell tool={tool}
      controls={<>
        <select className={selectClass} value={index} onChange={(e) => p.set({ index: e.target.value })} aria-label="Index">
          {(list.length ? list : [index]).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <Segmented label="Period" value={days} onChange={setDays} options={[{ value: 60, label: '3M' }, { value: 125, label: '6M' }, { value: 250, label: '1Y' }, { value: 500, label: '2Y' }]} />
        {d && <span className="text-[12px] text-muted">Close of {day(d.asOf, true)} · {d.members} members (NSE list of {day(d.listFetched.slice(0, 10), true)})</span>}
      </>}
      about={<>
        <p>A member advances on a day when its close is above its previous close, using closes adjusted for splits and bonuses so corporate actions are not counted as moves. Members with no close that day, or the day before, are not counted. The cumulative line adds advances minus declines from the first day shown.</p>
        <p>Membership is NSE&rsquo;s current constituent list, applied to every past day shown; stocks that joined or left the index since are treated as members throughout. The moving-average and 52-week counts use each member&rsquo;s own closes: a 52-week high is a close above every close of the previous 252 sessions.</p>
      </>}>
      {!d ? <div className="panel grid min-h-[300px]"><Loading error={b.error} loading={b.loading} /></div> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label={`Advances · ${day(d.asOf)}`} value={String(today?.advances ?? '—')} className="text-up" />
            <Stat label="Declines" value={String(today?.declines ?? '—')} className="text-down" />
            <Stat label="Unchanged" value={String(today?.unchanged ?? '—')} />
            <Stat label="A/D ratio" value={ratio(today && today.declines ? today.advances / today.declines : null)} />
            <Stat label="Above 20-DMA" value={share(d.snapshot.aboveSma20, d.snapshot.traded)} />
            <Stat label="Above 50-DMA" value={share(d.snapshot.aboveSma50, d.snapshot.traded)} />
            <Stat label="Above 200-DMA" value={share(d.snapshot.aboveSma200, d.snapshot.withSma200)} />
            <Stat label="52w highs / lows" value={`${d.snapshot.newHighs} / ${d.snapshot.newLows}`} />
          </div>
          <Card title={`${d.index}: level, daily breadth and the advance-decline line`} right={<><Key color={SERIES.blue} label="Index" /><Key bar color={SERIES.pe} label="A − D" /><Key color={SERIES.accent} label="Cumulative" /></>}>
            <TimeChart series={series} height={520} paneHeight={130} />
          </Card>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title={`Members up most · ${day(d.asOf)}`}>
              <ul className="num divide-y divide-line text-[12.5px]">{d.moves.filter((m) => m.changePct > 0).slice(0, 8).map((m) => <li key={m.symbol} className="flex justify-between px-4 py-1.5"><Link href={`/chart/${m.symbol}`} className="font-sans font-semibold hover:text-accent-deep">{m.symbol}</Link><span className="text-up">{pct(m.changePct, 2, true)}</span></li>)}</ul>
            </Card>
            <Card title={`Members down most · ${day(d.asOf)}`}>
              <ul className="num divide-y divide-line text-[12.5px]">{[...d.moves].reverse().filter((m) => m.changePct < 0).slice(0, 8).map((m) => <li key={m.symbol} className="flex justify-between px-4 py-1.5"><Link href={`/chart/${m.symbol}`} className="font-sans font-semibold hover:text-accent-deep">{m.symbol}</Link><span className="text-down">{pct(m.changePct, 2, true)}</span></li>)}</ul>
            </Card>
          </div>
        </>
      )}
      <Card title={`Every index, latest session${all.data ? ` · ${day(all.data.asOf, true)}` : ''}`}>
        {all.data ? <DataTable rows={all.data.rows} columns={allCols} rowKey={(r) => r.index} csvName={`breadth-${all.data.asOf}.csv`} maxHeight="60dvh" />
          : <div className="grid min-h-[160px]"><Loading error={all.error} loading={all.loading} /></div>}
      </Card>
    </ToolShell>
  );
}
