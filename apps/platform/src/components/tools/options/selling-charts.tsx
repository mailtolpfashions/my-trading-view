'use client';

import { useState } from 'react';

// Shared by the option selling report and its comparison screen.
export const inr = (v: number | null | undefined) => (v == null ? '–' : `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`);
export const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : '');
export const th = 'px-3 py-2 text-left text-[11px] font-semibold text-muted whitespace-nowrap';
export const td = 'px-3 py-2 text-[13px] whitespace-nowrap tabular-nums';
export const Money = ({ v }: { v: number | null | undefined }) => <span className={tone(v)}>{inr(v)}</span>;

export function Table({ head, rows, tall }: { head: string[]; rows: React.ReactNode[][]; tall?: boolean }) {
  return (
    <div className={`overflow-x-auto ${tall ? 'max-h-[520px] overflow-y-auto' : ''}`}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-panel"><tr className="border-b border-line">{head.map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const W = 1320, H = 340, P = { l: 84, r: 24, t: 14, b: 30 };
/** Running total of each rule over time. Hover to read any date. */
export function Lines({ series }: { series: { name: string; pts: [string, number][]; color?: string }[] }) {
  const all = series.flatMap((s) => s.pts), times = all.map((p) => Date.parse(p[0])), t0 = Math.min(...times), t1 = Math.max(...times);
  const lo = Math.min(0, ...all.map((p) => p[1])), hi = Math.max(0, ...all.map((p) => p[1]));
  const x = (d: string) => P.l + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - P.l - P.r), y = (v: number) => P.t + ((hi - v) / (hi - lo || 1)) * (H - P.t - P.b);
  const [hover, setHover] = useState<number | null>(null);
  const near = (s: { pts: [string, number][] }, t: number) => s.pts.reduce((b, p) => (Math.abs(Date.parse(p[0]) - t) < Math.abs(Date.parse(b[0]) - t) ? p : b));
  const ticks = [...new Set([lo, 0, hi, (hi + lo) / 2])].sort((a, b) => a - b);
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[12px] text-ink-2">
        {series.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: s.color ?? `var(--chart-${i + 1})` }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label="Running total of profit for each rule"
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(t0 + Math.max(0, Math.min(1, (((e.clientX - r.left) / r.width) * W - P.l) / (W - P.l - P.r))) * (t1 - t0)); }} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)">{inr(v)}</text></g>)}
        {Array.from({ length: 6 }, (_, i) => t0 + (i / 5) * (t1 - t0)).map((t) => <text key={t} x={P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{new Date(t).getUTCFullYear()}</text>)}
        {series.map((s, i) => <polyline key={s.name} fill="none" stroke={s.color ?? `var(--chart-${i + 1})`} strokeWidth="2" strokeLinejoin="round" points={s.pts.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} />)}
        {hover != null && series.map((s, i) => { const p = near(s, hover); return <circle key={s.name} cx={x(p[0])} cy={y(p[1])} r="4" fill={s.color ?? `var(--chart-${i + 1})`} stroke="var(--color-panel)" strokeWidth="2" />; })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute left-20 top-9 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[var(--shadow-panel)]">
          <p className="font-semibold">{near(series[0], hover)[0]}</p>
          {series.map((s) => <p key={s.name} className="tabular-nums text-ink-2">{s.name}: {inr(near(s, hover)[1])}</p>)}
        </div>
      )}
    </div>
  );
}
