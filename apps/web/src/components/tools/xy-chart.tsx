'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { niceTicks } from '@/components/options/payoff-chart';

/** Series colours (SVG and canvas). Calls red, puts green, as on most Indian option tools. */
export const SERIES = { ce: '#e5484d', pe: '#0a9b76', accent: '#f59a0b', blue: '#2f5bff', violet: '#8b5cf6', teal: '#0ea5b7', grey: '#8f877b', pink: '#db2777' } as const;
export const PALETTE = [SERIES.blue, SERIES.accent, SERIES.violet, SERIES.teal, SERIES.pink, SERIES.ce, SERIES.pe, SERIES.grey];

export type XYSeries = {
  name: string;
  kind: 'line' | 'bar';
  color: string;
  points: { x: number; y: number | null }[];
  dashed?: boolean;
  axis?: 'left' | 'right';
};
export type XYMarker = { x: number; label: string; color: string };

/**
 * A chart over a numeric x axis (strike, days to expiry), drawn as SVG: grouped bars and lines, vertical markers
 * (spot, max pain), and a hover read-out of every series at the nearest x.
 */
export function XYChart({ series, markers = [], height = 320, xFormat, yFormat, yRightFormat, xLabel, reverseX }: {
  series: XYSeries[]; markers?: XYMarker[]; height?: number;
  xFormat: (x: number) => string; yFormat: (y: number) => string; yRightFormat?: (y: number) => string; xLabel?: string;
  /** Larger x on the left (e.g. days to expiry counting down). */
  reverseX?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasRight = series.some((s) => s.axis === 'right');
  const pad = { l: 64, r: hasRight ? 64 : 16, t: 12, b: xLabel ? 40 : 28 };
  const geo = useMemo(() => {
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    if (!xs.length) return null;
    const ys = (axis: 'left' | 'right') => series.filter((s) => (s.axis ?? 'left') === axis).flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y != null && Number.isFinite(y)));
    const range = (v: number[], bars: boolean) => {
      let lo = v.length ? Math.min(...v) : 0, hi = v.length ? Math.max(...v) : 1;
      if (bars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (lo === hi) { lo -= 1; hi += 1; }
      const m = (hi - lo) * 0.06;
      return [bars && lo === 0 ? 0 : lo - m, hi + m] as const;
    };
    const barsLeft = series.some((s) => s.kind === 'bar' && (s.axis ?? 'left') === 'left');
    const [yl0, yl1] = range(ys('left'), barsLeft);
    const [yr0, yr1] = range(ys('right'), false);
    let x0 = xs[0], x1 = xs[xs.length - 1];
    const gap = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : 1;
    const bars = series.filter((s) => s.kind === 'bar');
    if (bars.length) { x0 -= gap / 2; x1 += gap / 2; }
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    return { xs, x0, x1, yl0, yl1, yr0, yr1, gap, nBars: bars.length };
  }, [series]);

  if (!geo) return <div ref={host} className="grid place-items-center text-[13px] text-muted" style={{ height }}>No data for this choice.</div>;
  const W = Math.max(width, 280), H = height;
  const X = (x: number) => pad.l + ((reverseX ? geo.x1 - x : x - geo.x0) / (geo.x1 - geo.x0)) * (W - pad.l - pad.r);
  const Y = (y: number, axis: 'left' | 'right' = 'left') => {
    const [a, b] = axis === 'left' ? [geo.yl0, geo.yl1] : [geo.yr0, geo.yr1];
    return pad.t + (1 - (y - a) / (b - a)) * (H - pad.t - pad.b);
  };
  const barW = geo.nBars ? Math.max(1, (((W - pad.l - pad.r) * geo.gap) / (geo.x1 - geo.x0)) * 0.8 / geo.nBars) : 0;
  const yTicks = niceTicks(geo.yl0, geo.yl1, 5);
  const yrTicks = hasRight ? niceTicks(geo.yr0, geo.yr1, 5) : [];
  const xTicks = niceTicks(geo.x0, geo.x1, Math.max(3, Math.floor(W / 90)));
  let barIndex = 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left - pad.l) / (W - pad.l - pad.r);
    const x = reverseX ? geo.x1 - f * (geo.x1 - geo.x0) : geo.x0 + f * (geo.x1 - geo.x0);
    setHover(geo.xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)));
  };

  return (
    <div ref={host} className="relative w-full select-none" style={{ height }}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--color-grid)" />
            <text x={pad.l - 6} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{yFormat(t)}</text>
          </g>
        ))}
        {yrTicks.map((t) => <text key={`yr${t}`} x={W - pad.r + 6} y={Y(t, 'right')} dy="0.32em" className="num fill-muted text-[10.5px]">{(yRightFormat ?? yFormat)(t)}</text>)}
        {geo.yl0 < 0 && geo.yl1 > 0 && <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--color-zero)" />}
        {xTicks.map((t) => <text key={`x${t}`} x={X(t)} y={H - pad.b + 16} textAnchor="middle" className="num fill-muted text-[10.5px]">{xFormat(t)}</text>)}
        {xLabel && <text x={(pad.l + W - pad.r) / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">{xLabel}</text>}
        {series.map((s) => {
          const axis = s.axis ?? 'left';
          if (s.kind === 'bar') {
            const i = barIndex++;
            const off = (i - (geo.nBars - 1) / 2) * barW;
            return (
              <g key={s.name}>
                {s.points.filter((p) => p.y != null).map((p) => {
                  const y0 = Y(0, axis), y1 = Y(p.y!, axis);
                  return <rect key={p.x} x={X(p.x) + off - barW / 2} width={barW} y={Math.min(y0, y1)} height={Math.max(0.5, Math.abs(y1 - y0))} fill={s.color} opacity={hover == null || hover === p.x ? 0.9 : 0.55} />;
                })}
              </g>
            );
          }
          const pts = s.points.filter((p) => p.y != null && Number.isFinite(p.y));
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y!, axis).toFixed(1)}`).join('');
          return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />;
        })}
        {markers.map((m, i) => m.x >= geo.x0 && m.x <= geo.x1 && (
          <g key={m.label}>
            <line x1={X(m.x)} x2={X(m.x)} y1={pad.t} y2={H - pad.b} stroke={m.color} strokeDasharray="4 3" strokeWidth={1.5} />
            {/* one label row per marker, so markers close together don't overprint; flipped left near the right edge */}
            <text x={X(m.x) + (X(m.x) > W * 0.8 ? -4 : 4)} y={pad.t + 10 + i * 13} textAnchor={X(m.x) > W * 0.8 ? 'end' : 'start'} className="text-[10.5px] font-semibold" fill={m.color}>{m.label}</text>
          </g>
        ))}
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-cross)" strokeWidth={1} />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-2 rounded-[10px] bg-panel px-3 py-2 text-[11.5px] shadow-[var(--shadow-pop)]"
          style={X(hover) > W / 2 ? { right: W - X(hover) + 10 } : { left: X(hover) + 10 }}>
          <p className="num mb-1 font-bold">{xFormat(hover)}</p>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hover);
            return p && p.y != null ? (
              <p key={s.name} className="num flex items-center gap-2 whitespace-nowrap"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}: <b>{(s.axis === 'right' ? yRightFormat ?? yFormat : yFormat)(p.y)}</b></p>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
