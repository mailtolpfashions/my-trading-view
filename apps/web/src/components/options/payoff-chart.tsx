'use client';

import { useMemo, useState } from 'react';
import { payoff, pnlAt, type ModelLeg } from '@mtv/options';
import { formatRupees } from '@mtv/paper';
import { fmt } from '@/lib/format';

const W = 760, H = 300, PAD = { l: 64, r: 16, t: 14, b: 28 };

/** Round axis values (1, 2, 2.5 or 5 × 10ⁿ) inside [min, max], always including 0 when it is in range. */
function niceTicks(min: number, max: number, target: number): number[] {
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/**
 * Payoff diagram: P&L at the first expiry (solid; exact when every leg expires then, otherwise later legs are valued
 * with Black-76) and a model estimate for today (dashed). x = underlying price, y = P&L in rupees.
 */
export function PayoffChart({ legs, spotPaise, rate, carry, atYears, exact, atLabel, breakevens }: {
  legs: ModelLeg[];
  spotPaise: number;
  rate: number;
  /** Annual rate at which the forward exceeds spot (from the market's forward). */
  carry: number;
  /** Years from now to the first expiry. */
  atYears: number;
  /** Every leg expires at the first expiry, so the solid curve is the exact payoff. */
  exact: boolean;
  atLabel: string;
  breakevens: number[];
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);

  const data = useMemo(() => {
    const strikes = legs.map((l) => l.strikePaise);
    const span = Math.max(spotPaise * 0.06, ...strikes.map((k) => Math.abs(k - spotPaise) * 1.4), ...breakevens.map((b) => Math.abs(b - spotPaise) * 1.2));
    const lo = Math.max(1, spotPaise - span), hi = spotPaise + span;
    const xs = Array.from({ length: 241 }, (_, i) => lo + ((hi - lo) * i) / 240);
    const pts = [...new Set([...xs, ...strikes.filter((k) => k > lo && k < hi)])].sort((a, b) => a - b);
    const curve = (t: number) => {
      const out: number[] = [];
      for (const S of pts) { const v = pnlAt(legs, S, t, rate, carry); if (v == null) return null; out.push(v / 100); }
      return out;
    };
    const expiry = exact ? pts.map((S) => payoff(legs, S) / 100) : curve(atYears) ?? pts.map(() => 0);
    const today = atYears > 0 ? curve(0) : null;
    const all = [...expiry, ...(today ?? [])];
    let yMin = Math.min(0, ...all), yMax = Math.max(0, ...all);
    const padY = (yMax - yMin) * 0.08 || 1;
    yMin -= padY; yMax += padY;
    return { lo, hi, pts, expiry, today, yMin, yMax };
  }, [legs, spotPaise, rate, carry, atYears, exact, breakevens]);

  const { lo, hi, pts, expiry, today, yMin, yMax } = data;
  const x = (S: number) => PAD.l + ((S - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(pts[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line(expiry)}L${x(pts.at(-1)!).toFixed(1)},${y(0).toFixed(1)}L${x(pts[0]).toFixed(1)},${y(0).toFixed(1)}Z`;
  const yTicks = niceTicks(yMin, yMax, 5);
  const xTicks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);

  const hoverS = hoverX == null ? null : lo + ((hoverX - PAD.l) / (W - PAD.l - PAD.r)) * (hi - lo);
  const hoverIdx = hoverS == null ? -1 : pts.findIndex((p) => p >= hoverS);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Payoff diagram"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHoverX(px >= PAD.l && px <= W - PAD.r ? px : null); }}
        onMouseLeave={() => setHoverX(null)}>
        <defs>
          <clipPath id="profit"><rect x={0} y={0} width={W} height={y(0)} /></clipPath>
          <clipPath id="loss"><rect x={0} y={y(0)} width={W} height={H} /></clipPath>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#f0efea" />
            <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" className="num fill-[#8b8a83] text-[10px]">{Math.round(v).toLocaleString('en-IN')}</text>
          </g>
        ))}
        {xTicks.map((S) => (
          <text key={S} x={x(S)} y={H - 8} textAnchor="middle" className="num fill-[#8b8a83] text-[10px]">{Math.round(S / 100).toLocaleString('en-IN')}</text>
        ))}
        <path d={area} fill="rgba(8,153,129,0.16)" clipPath="url(#profit)" />
        <path d={area} fill="rgba(242,54,69,0.14)" clipPath="url(#loss)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#b9b8b0" />
        {today && <path d={line(today)} fill="none" stroke="#2962ff" strokeWidth={1.5} strokeDasharray="5 4" />}
        <path d={line(expiry)} fill="none" stroke="#121212" strokeWidth={2} />
        <line x1={x(spotPaise)} x2={x(spotPaise)} y1={PAD.t} y2={H - PAD.b} stroke="#ffc21a" strokeWidth={1.5} />
        <text x={x(spotPaise) + 4} y={PAD.t + 10} className="num fill-[#3d2c00] text-[10px] font-semibold">Spot {fmt(spotPaise / 100)}</text>
        {breakevens.filter((b) => b > lo && b < hi).map((b) => (
          <g key={b}>
            <circle cx={x(b)} cy={y(0)} r={3.5} fill="#fff" stroke="#121212" strokeWidth={1.5} />
            <text x={x(b)} y={y(0) + 14} textAnchor="middle" className="num fill-[#45453f] text-[10px]">{fmt(b / 100)}</text>
          </g>
        ))}
        {hoverIdx >= 0 && (
          <line x1={x(pts[hoverIdx])} x2={x(pts[hoverIdx])} y1={PAD.t} y2={H - PAD.b} stroke="#9598a1" strokeDasharray="2 3" />
        )}
      </svg>
      {hoverIdx >= 0 && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-[10px] bg-ink px-3 py-1.5 text-[11.5px] text-white shadow-[var(--shadow-pop)]">
          <p className="num">At {fmt(pts[hoverIdx] / 100)} ({(((pts[hoverIdx] - spotPaise) / spotPaise) * 100).toFixed(2)}%)</p>
          <p className="num">{exact ? 'Expiry' : `At ${atLabel} (est.)`}: <b className={expiry[hoverIdx] >= 0 ? 'text-[#4ade80]' : 'text-[#ff8a8a]'}>{formatRupees(Math.round(expiry[hoverIdx] * 100))}</b></p>
          {today && <p className="num">Today (est.): <b>{formatRupees(Math.round(today[hoverIdx] * 100))}</b></p>}
        </div>
      )}
      <div className="mt-1 flex gap-4 text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-ink align-middle" />{exact ? 'At expiry (exact)' : `At first expiry, ${atLabel} (later legs: Black-76 estimate)`}</span>
        {today ? <span><span className="mr-1 inline-block h-0 w-4 border-t-2 border-dashed border-blue align-middle" />Today (model estimate, Black-76)</span> : <span>Today&rsquo;s curve needs IV for every leg</span>}
      </div>
    </div>
  );
}
