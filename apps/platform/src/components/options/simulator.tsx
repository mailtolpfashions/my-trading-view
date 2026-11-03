'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from 'lucide-react';
import { formatRupees } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { fmtDate, fmtStrike, runSimulation, type BuilderLeg, type SimResult } from '@/lib/options';
import { niceTicks } from './payoff-chart';
import { firstExit, type Exit, type ExitRules } from '@/lib/sim-exit';
import { InfoTip } from '@/components/info-tip';

const W = 760, H = 220, PAD = { l: 64, r: 16, t: 12, b: 26 };
const SOURCE: Record<string, string> = { close: '', settle: '*', expired: ' (settled)', missing: ' (no data)' };

/** The simulated day shown, for the payoff chart: that day's close and the P&L before charges at it. */
export type SimDayLink = { date: string; daysSinceEntry: number; spotPaise: number; grossPaise: number };

/**
 * Options simulator: the position built on a past day, followed on NSE's official closes day by day to expiry.
 * Each day shows what squaring off that day would have returned after every charge; on expiry, legs settle against
 * the index's official close.
 */
export function Simulator({ underlying, entryDate, legs, brokerId, brokerName, onDay, payoff }: { underlying: string; entryDate: string; legs: BuilderLeg[]; brokerId: string; brokerName: string; onDay?: (d: SimDayLink | null) => void; payoff?: React.ReactNode }) {
  const inputKey = JSON.stringify([underlying, entryDate, brokerId, legs.map((l) => [l.kind, l.side, l.strikePaise, l.expiry, l.lots, l.pricePaise])]);
  const [run, setRun] = useState<{ key: string; result: SimResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const [rules, setRules] = useState<ExitRules>({ stopLoss: null, target: null, exitDate: null });
  const result = run?.key === inputKey ? run.result : null; // a changed position needs a new run
  // Tell the builder which day is shown, so the payoff chart can follow it.
  const shown = result ? result.days[Math.min(dayIdx, result.days.length - 1)] : null;
  useEffect(() => {
    if (!onDay) return;
    onDay(shown && shown.spotPaise != null ? {
      date: shown.date, spotPaise: shown.spotPaise, grossPaise: shown.grossPaise,
      daysSinceEntry: Math.round((Date.parse(`${shown.date}T00:00:00Z`) - Date.parse(`${entryDate}T00:00:00Z`)) / 86400_000),
    } : null);
  }, [shown, entryDate, onDay]);
  useEffect(() => () => onDay?.(null), [onDay]);

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
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-extrabold tracking-[-0.02em]">Simulate to expiry
          <InfoTip label="About the simulation">
            <p>Follows this position from {fmtDate(entryDate)} on NSE&rsquo;s official closes, day by day, to expiry.</p>
            <p>Prices are NSE&rsquo;s official daily close; * = the contract did not trade that day, so NSE&rsquo;s settlement price is used. On its expiry day a leg settles at intrinsic value against the index&rsquo;s official close, NSE&rsquo;s final settlement rule.</p>
            <p>&ldquo;If squared off&rdquo; pays entry charges plus {brokerName} brokerage and statutory charges at the rates in force on each date; held to expiry, long in-the-money legs pay exercise STT instead.</p>
            <p>Daily closes only: what happened during the day is not known. IV and Greeks are Black-76 estimates. A record of the past, not a forecast or advice.</p>
            <p>The payoff chart below follows the day shown here: its what-if moves to that day&rsquo;s close and the days passed, and a blue marker shows the actual P&amp;L (before charges) from NSE&rsquo;s closes that day.</p>
          </InfoTip>
        </h3>
        <button type="button" onClick={() => void start()} disabled={busy || !legs.length}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-full bg-inverse px-3.5 text-[12.5px] font-bold text-on-inverse hover:bg-inverse-hover disabled:opacity-50">
          <Play size={13} aria-hidden="true" /> {busy ? 'Running…' : result ? 'Run again' : 'Run day by day'}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 rounded-[10px] bg-down-soft px-2.5 py-1.5 text-[12px] font-semibold text-down">{error}</p>}
      {result && <SimView r={result} dayIdx={Math.min(dayIdx, result.days.length - 1)} setDayIdx={setDayIdx} underlying={underlying} brokerName={brokerName} rules={rules} setRules={setRules} payoff={payoff} />}
    </section>
  );
}

const SPEEDS = [{ ms: 400, label: 'Fast' }, { ms: 900, label: 'Normal' }, { ms: 1800, label: 'Slow' }];

function SimView({ r, dayIdx, setDayIdx, underlying, brokerName, rules, setRules, payoff }: { r: SimResult; dayIdx: number; setDayIdx: (i: number) => void; underlying: string; brokerName: string; rules: ExitRules; setRules: (x: ExitRules) => void; payoff?: React.ReactNode }) {
  const days = r.days;
  const [chart, setChart] = useState<'payoff' | 'days'>(payoff ? 'payoff' : 'days');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(900);
  // Autoplay: one trading day per tick, stopping on the last day.
  useEffect(() => {
    if (!playing) return;
    if (dayIdx >= days.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setDayIdx(dayIdx + 1), speed);
    return () => clearTimeout(t);
  }, [playing, dayIdx, speed, days.length, setDayIdx]);
  const go = (i: number) => { setPlaying(false); setDayIdx(Math.max(0, Math.min(days.length - 1, i))); };
  const exit = useMemo(() => firstExit(r, rules), [r, rules]);
  const num = (v: string) => { const n = Number(v.replace(/[^\d.]/g, '')); return v.trim() && n > 0 ? n : null; };
  const d = days[dayIdx];
  const spot0 = days[0].spotPaise;
  const best = days.reduce((a, x) => (x.netIfExitPaise > a.netIfExitPaise ? x : a), days[0]);
  const worst = days.reduce((a, x) => (x.netIfExitPaise < a.netIfExitPaise ? x : a), days[0]);
  const last = days.at(-1)!;
  const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : '');
  const pct = (a: number | null, b: number | null) => (a != null && b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(2)}%` : '');

  return (
    <div className="mt-2.5 space-y-2.5">
      {/* day controls: one trading day per step (NSE end-of-day data has no intraday steps) */}
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(150px,2fr)_repeat(3,minmax(0,1fr))] overflow-hidden rounded-[10px] border border-line text-[12px] font-semibold">
        {([['Entry', 0, <ChevronsLeft key="a" size={14} />], ['−5d', dayIdx - 5, null], ['−1d', dayIdx - 1, <ChevronLeft key="b" size={14} />]] as const).map(([label, to, icon]) => (
          <button key={label} type="button" onClick={() => go(to)} disabled={dayIdx === 0} className="flex h-9 items-center justify-center gap-1 border-r border-line hover:bg-raised disabled:opacity-40">{icon}{label}</button>
        ))}
        <select value={dayIdx} onChange={(e) => go(Number(e.target.value))} aria-label="Simulation day" className="num h-9 border-r border-line bg-panel px-2 text-center font-bold">
          {days.map((x, i) => <option key={x.date} value={i}>{fmtDate(x.date)} · day {i + 1}/{days.length}</option>)}
        </select>
        {([['+1d', dayIdx + 1, <ChevronRight key="c" size={14} />], ['+5d', dayIdx + 5, null], [r.end === 'expired' ? 'Expiry' : 'Last day', days.length - 1, <ChevronsRight key="d" size={14} />]] as const).map(([label, to, icon]) => (
          <button key={label} type="button" onClick={() => go(to)} disabled={dayIdx === days.length - 1} className="flex h-9 items-center justify-center gap-1 border-r border-line last:border-r-0 hover:bg-raised disabled:opacity-40">{label}{icon}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <button type="button" onClick={() => { if (!playing && dayIdx >= days.length - 1) setDayIdx(0); setPlaying(!playing); }}
          className="flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 font-bold text-accent-deep hover:bg-accent hover:text-accent-ink">
          {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? 'Pause' : 'Autoplay'}
        </button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Autoplay speed" className="h-8 rounded-full bg-raised px-2.5 font-semibold">
          {SPEEDS.map((x) => <option key={x.ms} value={x.ms}>{x.label} · {(x.ms / 1000).toFixed(1)}s a day</option>)}
        </select>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <span className="flex items-center gap-1 font-semibold text-ink-2">Exit rules
          <InfoTip label="About exit rules">
            <p>Checked at each day&rsquo;s close after the entry day, on the P&amp;L after charges if squared off that day. The first rule to fire is the exit: on its day the exit date counts first, then the stop loss, then the target.</p>
            <p>Only daily closes are known, so a stop or target touched during a day but not at its close does not fire, and the exit is at the close, not at the rule&rsquo;s level.</p>
          </InfoTip>
        </span>
        <label className="flex items-center gap-1 text-ink-2">Stop loss ₹<input inputMode="numeric" placeholder="Off" defaultValue={rules.stopLoss ?? ''} onBlur={(e) => setRules({ ...rules, stopLoss: num(e.target.value) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="num h-8 w-[84px] rounded-full bg-raised px-2.5 font-semibold text-ink outline-none focus:ring-2 focus:ring-accent" /></label>
        <label className="flex items-center gap-1 text-ink-2">Target ₹<input inputMode="numeric" placeholder="Off" defaultValue={rules.target ?? ''} onBlur={(e) => setRules({ ...rules, target: num(e.target.value) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="num h-8 w-[84px] rounded-full bg-raised px-2.5 font-semibold text-ink outline-none focus:ring-2 focus:ring-accent" /></label>
        <label className="flex items-center gap-1 text-ink-2">Exit on
          <select value={rules.exitDate ?? ''} onChange={(e) => setRules({ ...rules, exitDate: e.target.value || null })} className="h-8 rounded-full bg-raised px-2.5 font-semibold text-ink">
            <option value="">Off</option>
            {days.slice(1).map((x) => <option key={x.date} value={x.date}>{fmtDate(x.date)}</option>)}
          </select>
        </label>
      </div>
      {(rules.stopLoss != null || rules.target != null || rules.exitDate) && (
        <button type="button" onClick={() => exit && go(exit.idx)} disabled={!exit}
          className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[12.5px] ${exit ? (days[exit.idx].netIfExitPaise >= 0 ? 'bg-up-soft' : 'bg-down-soft') : 'bg-raised'}`}>
          {exit ? (
            <>
              <b>{exit.reason}</b>
              <span className="text-ink-2">exit at the close of {fmtDate(days[exit.idx].date)} (day {exit.idx + 1})</span>
              <span className={`num ml-auto font-bold ${tone(days[exit.idx].netIfExitPaise)}`}>{formatRupees(days[exit.idx].netIfExitPaise)} after charges</span>
            </>
          ) : <span className="text-ink-2">No rule fired: the position runs to {r.end === 'expired' ? 'expiry' : 'the last day of data'}.</span>}
        </button>
      )}

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

      <div className="space-y-1.5">
        {payoff && (
          <div className="flex w-fit rounded-full bg-raised p-[3px]" role="tablist" aria-label="Chart">
            {([['payoff', 'Payoff'], ['days', 'P&L by day']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={chart === k} onClick={() => setChart(k)}
                className={`rounded-full px-3 py-1 text-[12px] font-bold ${chart === k ? 'bg-inverse text-on-inverse' : 'text-ink-2'}`}>{label}</button>
            ))}
          </div>
        )}
        {chart === 'payoff' && payoff ? payoff : <SimChart r={r} dayIdx={dayIdx} onPick={go} exit={exit} />}
      </div>

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
              <tr><th className="py-1 text-left">DATE</th><th className="text-right">{underlying}</th><th className="text-right">CHG</th><th className="hidden sm:table-cell text-right">GROSS</th><th className="hidden sm:table-cell text-right">CHARGES</th><th className="text-right">NET IF EXIT</th><th className="hidden sm:table-cell text-right">Δ</th><th className="hidden sm:table-cell text-right">Θ/DAY</th></tr>
            </thead>
            <tbody>
              {days.map((x, i) => (
                <tr key={x.date} onClick={() => setDayIdx(i)} className={`cursor-pointer border-t border-line hover:bg-raised ${i === dayIdx ? 'bg-accent-soft' : ''}`}>
                  <td className="py-1 font-sans whitespace-nowrap">{fmtDate(x.date)}</td>
                  <td className="text-right">{x.spotPaise == null ? '—' : fmt(x.spotPaise / 100)}</td>
                  <td className="text-right text-muted">{i ? pct(x.spotPaise, days[i - 1].spotPaise) : ''}</td>
                  <td className={`hidden sm:table-cell text-right ${tone(x.grossPaise)}`}>{formatRupees(x.grossPaise)}</td>
                  <td className="hidden sm:table-cell text-right text-muted">{formatRupees(x.chargesIfExitPaise)}</td>
                  <td className={`text-right font-semibold ${tone(x.netIfExitPaise)}`}>{formatRupees(x.netIfExitPaise)}</td>
                  <td className="hidden sm:table-cell text-right">{x.openLegs ? x.delta.toFixed(1) : '—'}</td>
                  <td className="hidden sm:table-cell text-right">{x.openLegs ? fmt(x.theta) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {r.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-down">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="text-[11px] leading-snug text-muted">
        Lot size {r.lotSize} (NSE, {fmtDate(r.entryDate)}).
        {r.end === 'end-of-data' && <> NSE data ends before the last expiry, so the run stops at {fmtDate(last.date)}.</>}
      </p>
    </div>
  );
}

/** Net P&L if squared off each day: one series, one axis; hover for the day, click to select it. */
function SimChart({ r, dayIdx, onPick, exit }: { r: SimResult; dayIdx: number; onPick: (i: number) => void; exit: Exit | null }) {
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
        {exit && (
          <g>
            <line x1={x(exit.idx)} x2={x(exit.idx)} y1={PAD.t} y2={H - PAD.b} stroke={vals[exit.idx] >= 0 ? 'var(--color-up)' : 'var(--color-down)'} strokeDasharray="4 3" strokeWidth={1.5} />
            <text x={x(exit.idx) + (x(exit.idx) > W * 0.8 ? -4 : 4)} y={PAD.t + 10} textAnchor={x(exit.idx) > W * 0.8 ? 'end' : 'start'} className="text-[10.5px] font-semibold" fill={vals[exit.idx] >= 0 ? 'var(--color-up)' : 'var(--color-down)'}>{exit.reason}</text>
          </g>
        )}
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
    </div>
  );
}
