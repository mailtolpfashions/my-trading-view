'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { formatRupees } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { fmtDate, fmtStrike, runSimulation, type BuilderLeg, type SimResult } from '@/lib/options';
import { niceTicks } from './payoff-chart';

const W = 760, H = 220, PAD = { l: 64, r: 16, t: 12, b: 26 };
const SOURCE: Record<string, string> = { close: '', settle: '*', expired: ' (settled)', missing: ' (no data)' };

/**
 * Options simulator: the position built on a past day, followed on NSE's official closes day by day to expiry.
 * Each day shows what squaring off that day would have returned after every charge; on expiry, legs settle against
 * the index's official close.
 */
export function Simulator({ underlying, entryDate, legs, brokerId, brokerName }: { underlying: string; entryDate: string; legs: BuilderLeg[]; brokerId: string; brokerName: string }) {
  const inputKey = JSON.stringify([underlying, entryDate, brokerId, legs.map((l) => [l.kind, l.side, l.strikePaise, l.expiry, l.lots, l.pricePaise])]);
  const [run, setRun] = useState<{ key: string; result: SimResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const result = run?.key === inputKey ? run.result : null; // a changed position needs a new run

  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await runSimulation({ underlying, entryDate, broker: brokerId, legs: legs.map((l) => ({ kind: l.kind, side: l.side, strikePaise: l.strikePaise, expiry: l.expiry, lots: l.lots, entryPaise: l.pricePaise })) });
      setRun({ key: inputKey, result: r });
      setDayIdx(r.days.length - 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[12px] border border-line p-2.5">
      <div className="flex items-center gap-2">
        <div>
          <h3 className="text-[13.5px] font-extrabold tracking-[-0.02em]">Simulate to expiry</h3>
          <p className="text-[11.5px] text-muted">Follow this position from {fmtDate(entryDate)} on NSE&rsquo;s official closes, day by day.</p>
        </div>
        <button type="button" onClick={() => void start()} disabled={busy || !legs.length}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-full bg-inverse px-3.5 text-[12.5px] font-bold text-on-inverse hover:bg-inverse-hover disabled:opacity-50">
          <Play size={13} aria-hidden="true" /> {busy ? 'Running…' : result ? 'Run again' : 'Run day by day'}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 rounded-[10px] bg-down-soft px-2.5 py-1.5 text-[12px] font-semibold text-down">{error}</p>}
      {result && <SimView r={result} dayIdx={Math.min(dayIdx, result.days.length - 1)} setDayIdx={setDayIdx} underlying={underlying} brokerName={brokerName} />}
    </section>
  );
}

function SimView({ r, dayIdx, setDayIdx, underlying, brokerName }: { r: SimResult; dayIdx: number; setDayIdx: (i: number) => void; underlying: string; brokerName: string }) {
  const days = r.days;
  const d = days[dayIdx];
  const spot0 = days[0].spotPaise;
  const best = days.reduce((a, x) => (x.netIfExitPaise > a.netIfExitPaise ? x : a), days[0]);
  const worst = days.reduce((a, x) => (x.netIfExitPaise < a.netIfExitPaise ? x : a), days[0]);
  const last = days.at(-1)!;
  const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : '');
  const pct = (a: number | null, b: number | null) => (a != null && b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(2)}%` : '');

  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous day" onClick={() => setDayIdx(Math.max(0, dayIdx - 1))} disabled={dayIdx === 0} className="rounded-full p-1 hover:bg-raised disabled:opacity-40"><ChevronLeft size={16} /></button>
        <input type="range" min={0} max={days.length - 1} value={dayIdx} onChange={(e) => setDayIdx(Number(e.target.value))} className="flex-1 accent-ink" aria-label="Simulation day" />
        <button type="button" aria-label="Next day" onClick={() => setDayIdx(Math.min(days.length - 1, dayIdx + 1))} disabled={dayIdx === days.length - 1} className="rounded-full p-1 hover:bg-raised disabled:opacity-40"><ChevronRight size={16} /></button>
        <span className="num w-[150px] text-right text-[12px] font-semibold">{fmtDate(d.date)} · day {dayIdx + 1}/{days.length}</span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {([
          [`${underlying} close`, d.spotPaise == null ? '—' : fmt(d.spotPaise / 100), '', `${pct(d.spotPaise, spot0)} since entry`],
          ['P&L before charges', formatRupees(d.grossPaise), tone(d.grossPaise), `${d.openLegs} of ${r.legs.length} legs open`],
          [d.openLegs ? 'If squared off this day' : 'Final, after settlement', formatRupees(d.netIfExitPaise), tone(d.netIfExitPaise), `after ${formatRupees(d.chargesIfExitPaise)} charges`],
          ['Greeks (est.)', d.openLegs ? `Δ ${d.delta.toFixed(1)}` : '—', '', d.openLegs ? `Θ ${fmt(d.theta)}/day · vega ${fmt(d.vega)}` : 'all legs settled'],
        ] as const).map(([k, v, c, sub]) => (
          <div key={k} className="rounded-[10px] bg-raised px-2.5 py-1.5">
            <p className="text-[11px] text-muted">{k}</p><p className={`num text-[14px] font-semibold ${c}`}>{v}</p>
            <p className="num text-[10.5px] text-muted">{sub}</p>
          </div>
        ))}
      </div>

      <SimChart r={r} dayIdx={dayIdx} onPick={setDayIdx} />

      <table className="num w-full text-[12px]">
        <thead className="text-[10.5px] font-bold tracking-[0.05em] text-muted">
          <tr><th className="py-1 text-left">LEG</th><th className="text-right">ENTRY</th><th className="text-right">{fmtDate(d.date).slice(0, 6).toUpperCase()}</th><th className="text-right">P&amp;L</th><th className="text-right">IV</th></tr>
        </thead>
        <tbody>
          {r.legs.map((l, i) => {
            const ld = d.legs[i];
            const pnl = ld.pricePaise == null ? null : (l.side === 'BUY' ? 1 : -1) * l.qty * (ld.pricePaise - l.entryPaise);
            return (
              <tr key={i} className="border-t border-line">
                <td className="py-1 font-sans font-semibold">
                  <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-bold text-white ${l.side === 'BUY' ? 'bg-blue' : 'bg-down'}`}>{l.side === 'BUY' ? 'B' : 'S'}</span>
                  {l.lots}× {fmtStrike(l.strikePaise)} {l.kind} {fmtDate(l.expiry).slice(0, 6)}
                </td>
                <td className="text-right">{fmt(l.entryPaise / 100)}{l.enteredUntraded ? '*' : ''}</td>
                <td className="text-right">{ld.pricePaise == null ? '—' : fmt(ld.pricePaise / 100)}<span className="text-muted">{SOURCE[ld.source]}</span></td>
                <td className={`text-right font-semibold ${tone(pnl ?? 0)}`}>{pnl == null ? '—' : formatRupees(pnl)}</td>
                <td className="text-right text-muted">{ld.iv == null ? '—' : (ld.iv * 100).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="grid grid-cols-3 gap-1.5 text-[12px]">
        {([
          ['Best day to square off', best], ['Worst day', worst], [r.end === 'expired' ? 'Held to expiry' : `Last day of data`, last],
        ] as const).map(([k, x]) => (
          <button key={k} type="button" onClick={() => setDayIdx(days.indexOf(x))} className="rounded-[10px] bg-raised px-2.5 py-1.5 text-left hover:bg-line">
            <p className="text-[11px] text-muted">{k}</p>
            <p className={`num font-semibold ${tone(x.netIfExitPaise)}`}>{formatRupees(x.netIfExitPaise)}</p>
            <p className="num text-[10.5px] text-muted">{fmtDate(x.date)}</p>
          </button>
        ))}
      </div>

      <details className="rounded-[10px] border border-line px-2.5 py-1.5 text-[12px]">
        <summary className="cursor-pointer font-semibold">Every day ({days.length})</summary>
        <div className="mt-1.5 max-h-[260px] overflow-auto">
          <table className="num w-full">
            <thead className="sticky top-0 bg-panel text-[10.5px] font-bold tracking-[0.05em] text-muted">
              <tr><th className="py-1 text-left">DATE</th><th className="text-right">{underlying}</th><th className="text-right">CHG</th><th className="text-right">GROSS</th><th className="text-right">CHARGES</th><th className="text-right">NET IF EXIT</th><th className="text-right">Δ</th><th className="text-right">Θ/DAY</th></tr>
            </thead>
            <tbody>
              {days.map((x, i) => (
                <tr key={x.date} onClick={() => setDayIdx(i)} className={`cursor-pointer border-t border-line hover:bg-raised ${i === dayIdx ? 'bg-accent-soft' : ''}`}>
                  <td className="py-1 font-sans">{fmtDate(x.date)}</td>
                  <td className="text-right">{x.spotPaise == null ? '—' : fmt(x.spotPaise / 100)}</td>
                  <td className="text-right text-muted">{i ? pct(x.spotPaise, days[i - 1].spotPaise) : ''}</td>
                  <td className={`text-right ${tone(x.grossPaise)}`}>{formatRupees(x.grossPaise)}</td>
                  <td className="text-right text-muted">{formatRupees(x.chargesIfExitPaise)}</td>
                  <td className={`text-right font-semibold ${tone(x.netIfExitPaise)}`}>{formatRupees(x.netIfExitPaise)}</td>
                  <td className="text-right">{x.openLegs ? x.delta.toFixed(1) : '—'}</td>
                  <td className="text-right">{x.openLegs ? fmt(x.theta) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {r.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-down">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="text-[11px] leading-snug text-muted">
        Prices are NSE&rsquo;s official daily close; * = the contract did not trade that day, so NSE&rsquo;s settlement price is used.
        On its expiry day a leg settles at intrinsic value against the index&rsquo;s official close, NSE&rsquo;s final settlement rule.
        &ldquo;If squared off&rdquo; pays entry charges plus {brokerName} brokerage and statutory charges at the rates in force on each date; held to expiry,
        long in-the-money legs pay exercise STT instead. Lot size is NSE&rsquo;s on {fmtDate(r.entryDate)} ({r.lotSize}).
        Daily closes only: what happened during the day is not known. IV and Greeks are Black-76 estimates.
        {r.end === 'end-of-data' && <> NSE data ends before the last expiry, so the run stops at {fmtDate(last.date)}.</>}
        {' '}A record of the past, not a forecast or advice.
      </p>
    </div>
  );
}

/** Net P&L if squared off each day: one series, one axis; hover for the day, click to select it. */
function SimChart({ r, dayIdx, onPick }: { r: SimResult; dayIdx: number; onPick: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = r.days;
  const vals = useMemo(() => days.map((x) => x.netIfExitPaise / 100), [days]);
  let yMin = Math.min(0, ...vals), yMax = Math.max(0, ...vals);
  const padY = (yMax - yMin) * 0.1 || 1;
  yMin -= padY; yMax += padY;
  const n = days.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const idxAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
  };
  const h = hover == null ? null : days[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full cursor-pointer select-none" role="img" aria-label="P&L if squared off, by day"
        onPointerMove={(e) => setHover(idxAt(e))} onPointerLeave={() => setHover(null)} onPointerDown={(e) => onPick(idxAt(e))}>
        {niceTicks(yMin, yMax, 4).map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-grid" />
            <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" className="num fill-muted text-[10px]">{(Math.round(v) || 0).toLocaleString('en-IN')}</text>
          </g>
        ))}
        {days.map((d, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" className="num fill-muted text-[10px]">{fmtDate(d.date).slice(0, 6)}</text>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-zero" />
        <path d={path} fill="none" className="stroke-ink" strokeWidth={2} strokeLinejoin="round" />
        <line x1={x(dayIdx)} x2={x(dayIdx)} y1={PAD.t} y2={H - PAD.b} stroke="#f59a0b" strokeWidth={1.5} />
        <circle cx={x(dayIdx)} cy={y(vals[dayIdx])} r={5} fill="#f59a0b" stroke="#2b1a00" strokeWidth={1.5} />
        {hover != null && hover !== dayIdx && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="stroke-cross" strokeDasharray="2 3" />
            <circle cx={x(hover)} cy={y(vals[hover])} r={4} className="fill-panel stroke-ink" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 right-3 rounded-[10px] bg-deep px-3 py-1.5 text-[11.5px] text-white shadow-[var(--shadow-pop)]">
          <p className="num font-semibold">{fmtDate(h.date)}</p>
          <p className="num">{r.underlying} {h.spotPaise == null ? '—' : fmt(h.spotPaise / 100)}</p>
          <p className="num">If squared off: <b className={h.netIfExitPaise >= 0 ? 'text-[#4ade80]' : 'text-[#ff8a8a]'}>{formatRupees(h.netIfExitPaise)}</b></p>
        </div>
      )}
      <p className="mt-0.5 text-[11px] text-muted">P&amp;L if squared off at each day&rsquo;s close, after all charges. Click a day to inspect it.</p>
    </div>
  );
}
