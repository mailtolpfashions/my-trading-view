'use client';

import { useMemo, useRef, useState } from 'react';
import { payoff, pnlAt, type ModelLeg, type Scenario } from '@mtv/options';
import { formatRupees } from '@mtv/paper';
import { fmt } from '@/lib/format';

const W = 760, H = 300, PAD = { l: 64, r: 16, t: 14, b: 28 };

/** Round axis values (1, 2, 2.5 or 5 × 10ⁿ) inside [min, max], always including 0 when it is in range. */
export function niceTicks(min: number, max: number, target: number): number[] {
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
export function PayoffChart({ legs, spotPaise, rate, carry, atYears, exact, atLabel, breakevens, scenario, onScenarioSpot, name = 'NIFTY', actual }: {
  legs: ModelLeg[];
  /** The underlying, as shown in labels. */
  name?: string;
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
  /** What-if: P&L curve `t` years ahead under an IV scenario, with a marker at the chosen underlying level. */
  scenario?: { spotPaise: number; t: number; sc: Scenario; label: string };
  /** Actual P&L before charges on a simulated day (NSE closes), drawn as a marker at that day's close. */
  actual?: { spotPaise: number; pnlPaise: number; label: string };
  /** Click or drag on the chart to move the what-if level. */
  onScenarioSpot?: (spotPaise: number) => void;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const dragging = useRef(false);

  const data = useMemo(() => {
    const strikes = legs.map((l) => l.strikePaise);
    const span = Math.max(spotPaise * 0.06, ...strikes.map((k) => Math.abs(k - spotPaise) * 1.4), ...breakevens.map((b) => Math.abs(b - spotPaise) * 1.2), scenario ? Math.abs(scenario.spotPaise - spotPaise) * 1.25 : 0, actual ? Math.abs(actual.spotPaise - spotPaise) * 1.25 : 0);
    const lo = Math.max(1, spotPaise - span), hi = spotPaise + span;
    const xs = Array.from({ length: 241 }, (_, i) => lo + ((hi - lo) * i) / 240);
    const pts = [...new Set([...xs, ...strikes.filter((k) => k > lo && k < hi)])].sort((a, b) => a - b);
    const curve = (t: number, sc?: Scenario) => {
      const out: number[] = [];
      for (const S of pts) { const v = pnlAt(legs, S, t, rate, carry, sc); if (v == null) return null; out.push(v / 100); }
      return out;
    };
    const expiry = exact ? pts.map((S) => payoff(legs, S) / 100) : curve(atYears) ?? pts.map(() => 0);
    const today = atYears > 0 ? curve(0) : null;
    const what = scenario ? curve(Math.min(scenario.t, atYears), scenario.sc) : null;
    const whatAt = scenario ? pnlAt(legs, scenario.spotPaise, Math.min(scenario.t, atYears), rate, carry, scenario.sc) : null;
    const all = [...expiry, ...(today ?? []), ...(what ?? []), ...(actual ? [actual.pnlPaise / 100] : [])];
    let yMin = Math.min(0, ...all), yMax = Math.max(0, ...all);
    const padY = (yMax - yMin) * 0.08 || 1;
    yMin -= padY; yMax += padY;
    return { lo, hi, pts, expiry, today, what, whatAt, yMin, yMax };
  }, [legs, spotPaise, rate, carry, atYears, exact, breakevens, scenario, actual]);

  const { lo, hi, pts, expiry, today, what, whatAt, yMin, yMax } = data;
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
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
          const inside = px >= PAD.l && px <= W - PAD.r;
          setHoverX(inside ? px : null);
          if (dragging.current && inside && onScenarioSpot) onScenarioSpot(Math.round((lo + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (hi - lo)) / 5) * 5);
        }}
        onPointerDown={(e) => {
          if (!onScenarioSpot) return;
          const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
          if (px < PAD.l || px > W - PAD.r) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onScenarioSpot(Math.round((lo + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (hi - lo)) / 5) * 5);
        }}
        onPointerUp={() => { dragging.current = false; }}
        onMouseLeave={() => setHoverX(null)} style={onScenarioSpot ? { cursor: 'crosshair', touchAction: 'none' } : undefined}>
        <defs>
          <clipPath id="profit"><rect x={0} y={0} width={W} height={y(0)} /></clipPath>
          <clipPath id="loss"><rect x={0} y={y(0)} width={W} height={H} /></clipPath>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-grid" />
            <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" className="num fill-muted text-[10px]">{(Math.round(v) || 0).toLocaleString('en-IN')}</text>
          </g>
        ))}
        {xTicks.map((S) => (
          <text key={S} x={x(S)} y={H - 8} textAnchor="middle" className="num fill-muted text-[10px]">{Math.round(S / 100).toLocaleString('en-IN')}</text>
        ))}
        <path d={area} className="fill-up/15" clipPath="url(#profit)" />
        <path d={area} className="fill-down/15" clipPath="url(#loss)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-zero" />
        {today && <path d={line(today)} fill="none" className="stroke-blue" strokeWidth={1.5} strokeDasharray="5 4" />}
        <path d={line(expiry)} fill="none" className="stroke-ink" strokeWidth={2} />
        {what && <path d={line(what)} fill="none" stroke="#a45f00" strokeWidth={2} />}
        {scenario && scenario.spotPaise > lo && scenario.spotPaise < hi && (
          <g>
            <line x1={x(scenario.spotPaise)} x2={x(scenario.spotPaise)} y1={PAD.t} y2={H - PAD.b} stroke="#a45f00" strokeDasharray="4 3" />
            {whatAt != null && <circle cx={x(scenario.spotPaise)} cy={y(whatAt / 100)} r={5} fill="#f59a0b" stroke="#2b1a00" strokeWidth={1.5} />}
            <text x={x(scenario.spotPaise) + 6} y={H - PAD.b - 6} className="num fill-accent-label text-[10px] font-semibold">What if {fmt(scenario.spotPaise / 100)}{whatAt != null ? ` · ${formatRupees(Math.round(whatAt))}` : ''}</text>
          </g>
        )}
        {actual && actual.spotPaise > lo && actual.spotPaise < hi && (
          <g>
            <rect x={x(actual.spotPaise) - 5} y={y(actual.pnlPaise / 100) - 5} width={10} height={10} transform={`rotate(45 ${x(actual.spotPaise)} ${y(actual.pnlPaise / 100)})`} className="fill-blue stroke-panel" strokeWidth={1.5} />
            <text x={x(actual.spotPaise) + (x(actual.spotPaise) > W * 0.7 ? -9 : 9)} y={y(actual.pnlPaise / 100) + (actual.pnlPaise >= 0 ? -8 : 14)} textAnchor={x(actual.spotPaise) > W * 0.7 ? 'end' : 'start'} className="num fill-blue text-[10px] font-semibold">
              Actual {actual.label} · {formatRupees(actual.pnlPaise)}
            </text>
          </g>
        )}
        <line x1={x(spotPaise)} x2={x(spotPaise)} y1={PAD.t} y2={H - PAD.b} stroke="#f59a0b" strokeWidth={1.5} />
        <text x={x(spotPaise) + 4} y={PAD.t + 10} className="num fill-accent-label text-[10px] font-semibold">Spot {fmt(spotPaise / 100)}</text>
        {breakevens.filter((b) => b > lo && b < hi).map((b) => (
          <g key={b}>
            <circle cx={x(b)} cy={y(0)} r={3.5} className="fill-panel stroke-ink" strokeWidth={1.5} />
            <text x={x(b)} y={y(0) + 14} textAnchor="middle" className="num fill-ink-2 text-[10px]">{fmt(b / 100)}</text>
          </g>
        ))}
        {hoverIdx >= 0 && (
          <line x1={x(pts[hoverIdx])} x2={x(pts[hoverIdx])} y1={PAD.t} y2={H - PAD.b} className="stroke-cross" strokeDasharray="2 3" />
        )}
      </svg>
      {hoverIdx >= 0 && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-[10px] bg-deep px-3 py-1.5 text-[11.5px] text-white shadow-[var(--shadow-pop)]">
          <p className="num">At {fmt(pts[hoverIdx] / 100)} ({(((pts[hoverIdx] - spotPaise) / spotPaise) * 100).toFixed(2)}%)</p>
          <p className="num">{exact ? 'Expiry' : `At ${atLabel} (est.)`}: <b className={expiry[hoverIdx] >= 0 ? 'text-[#4ade80]' : 'text-[#ff8a8a]'}>{formatRupees(Math.round(expiry[hoverIdx] * 100))}</b></p>
          {today && <p className="num">Today (est.): <b>{formatRupees(Math.round(today[hoverIdx] * 100))}</b></p>}
          {what && scenario && <p className="num">What if, {scenario.label}: <b>{formatRupees(Math.round(what[hoverIdx] * 100))}</b></p>}
        </div>
      )}
      <div className="mt-1 flex gap-4 text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-ink align-middle" />{exact ? 'At expiry (exact)' : `At first expiry, ${atLabel} (later legs: Black-76 estimate)`}</span>
        {what && scenario && <span><span className="mr-1 inline-block h-0.5 w-4 bg-accent-deep align-middle" />What if ({scenario.label}, chosen IV){onScenarioSpot ? ` · click or drag on the chart to move ${name}` : ''}</span>}
        {today ? <span><span className="mr-1 inline-block h-0 w-4 border-t-2 border-dashed border-blue align-middle" />Today (model estimate, Black-76)</span> : <span>Today&rsquo;s curve needs IV for every leg</span>}
        {actual && <span><span className="mr-1 inline-block h-2 w-2 rotate-45 bg-blue align-middle" />Actual on {actual.label} (NSE closes, before charges)</span>}
      </div>
    </div>
  );
}
