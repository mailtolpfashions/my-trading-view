'use client';

import { useMemo, useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { Segmented } from '@/components/ui';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';

type Point = { dte: number; pctOfSpot: number | null; n: number };
type Cell = { shape: string; enter: number; exit: number; n: number; skip: number; wonPct: number; netTotal: number; perTrade: number; worst: number; losingYears: number; years: number; since2023: number };
type Decay = { from: string; to: string; curves: Record<string, Point[]>; results: Cell[] };

const W = 720, H = 280, PAD = { l: 44, r: 92, t: 14, b: 34 };
const MIN_N = 10; // a day needs this many expiries behind it to be drawn
const inr = (r: number) => `${r < 0 ? '−' : ''}₹${Math.abs(r).toLocaleString('en-IN')}`;

function DecayChart({ curves }: { curves: Decay['curves'] }) {
  const eras = Object.keys(curves);
  const series = eras.map((name, i) => ({ name, color: `var(--chart-${i + 1})`, pts: curves[name].filter((p) => p.pctOfSpot != null && p.n >= MIN_N && p.dte <= 60) }));
  const yMax = Math.ceil(Math.max(...series.flatMap((s) => s.pts.map((p) => p.pctOfSpot!))));
  const x = (d: number) => PAD.l + ((60 - d) / 60) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const [hover, setHover] = useState<number | null>(null);
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(60, Math.round(60 - ((px - PAD.l) / (W - PAD.l - PAD.r)) * 60))));
  };
  const at = (s: (typeof series)[number], d: number) => s.pts.reduce<Point | null>((b, p) => (!b || Math.abs(p.dte - d) < Math.abs(b.dte - d) ? p : b), null);
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[12px] text-ink-2">
        {series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label="ATM straddle value as a percentage of the index, by days to expiry" onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {Array.from({ length: yMax + 1 }, (_, v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{v}%</text>
          </g>
        ))}
        {[60, 45, 30, 21, 14, 7, 0].map((d) => <text key={d} x={x(d)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--color-muted)">{d === 0 ? 'Expiry' : `${d}d`}</text>)}
        {series.map((s) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={s.pts.map((p) => `${x(p.dte)},${y(p.pctOfSpot!)}`).join(' ')} />)}
        {series.map((s, i) => <text key={s.name} x={x(0) + 8} y={H - PAD.b - 12 - i * 15} fontSize="11" fill="var(--color-ink-2)">{s.name}</text>)}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-line-strong)" />
            {series.map((s) => { const p = at(s, hover); return p && <circle key={s.name} cx={x(p.dte)} cy={y(p.pctOfSpot!)} r="4" fill={s.color} stroke="var(--color-panel)" strokeWidth="2" />; })}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute right-4 top-3 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[var(--shadow-panel)]">
          <p className="font-semibold">{hover} days to expiry</p>
          {series.map((s) => { const p = at(s, hover); return <p key={s.name} className="tabular-nums text-ink-2">{s.name}: {p?.pctOfSpot?.toFixed(2)}%</p>; })}
        </div>
      )}
    </div>
  );
}

/** Where premium decays, and where a seller really kept it: every entry and exit, one trade per monthly expiry. */
export function SellingDecay() {
  const { data } = useFeed<Decay>('selling-decay');
  const shapes = useMemo(() => [...new Set(data?.results.map((r) => r.shape) ?? [])], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  if (!data) return null;
  const shape = picked ?? shapes[0];
  const cells = data.results.filter((r) => r.shape === shape);
  const entries = [...new Set(cells.map((c) => c.enter))].sort((a, b) => b - a), exits = [...new Set(cells.map((c) => c.exit))].sort((a, b) => b - a);
  const best = [...cells].sort((a, b) => b.netTotal - a.netTotal).find((c) => c.netTotal > 0);
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card title={<span className="flex items-center gap-1.5">How premium shrinks<InfoTip label="About this chart"><p>The ATM straddle of monthly NIFTY expiries as a percentage of the index, the middle value on each day to expiry. A day is shown only with at least {MIN_N} expiries behind it. This is the premium itself, not what a seller kept.</p></InfoTip></span>}>
        <DecayChart curves={data.curves} />
      </Card>
      <Card
        title={<span className="flex items-center gap-1.5">Where the seller kept it<InfoTip label="About this table"><p>One trade per monthly expiry from {data.from} to {data.to}, at today’s size, after charges and ₹1 slippage per option. No stops or adjustments. Every month, with no high-IV filter. Trades held past the next month’s entry overlap it, so those cells need more margin than one lot. Past results do not promise future ones.</p></InfoTip></span>}
        right={<Segmented label="Position" value={shape} onChange={setPicked} options={shapes.map((s) => ({ value: s, label: s }))} />}
      >
        <div className="overflow-x-auto p-3">
          <table className="w-full border-separate border-spacing-1 text-[12px] tabular-nums">
            <thead><tr><th className="text-left font-semibold text-muted">Enter ↓ Exit →</th>{exits.map((x) => <th key={x} className="font-semibold text-muted">{x === 0 ? 'Expiry' : `${x}d left`}</th>)}</tr></thead>
            <tbody>
              {entries.map((en) => (
                <tr key={en}>
                  <th className="text-left font-semibold text-muted">{en} days</th>
                  {exits.map((ex) => {
                    const c = cells.find((z) => z.enter === en && z.exit === ex);
                    if (!c) return <td key={ex} className="rounded-[8px] px-2 py-1.5 text-center text-muted">–</td>;
                    return (
                      <td key={ex} title={`${c.n} trades, losing years ${c.losingYears} of ${c.years}, since 2023 ${inr(c.since2023)}`} className={`rounded-[8px] px-2 py-1.5 text-center ${c.netTotal > 0 ? 'bg-up-soft' : 'bg-down-soft'} ${c === best ? 'ring-2 ring-accent' : ''}`}>
                        <p className={`font-semibold ${c.netTotal > 0 ? 'text-up' : 'text-down'}`}>{inr(c.netTotal)}</p>
                        <p className="text-[11px] text-ink-2">{c.wonPct}% · worst {inr(c.worst)}</p>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
