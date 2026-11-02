'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchFnoCalendar } from '@/lib/fno';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const POP_W = 300;

/**
 * Date picker for NSE end-of-day data: only trading days held for the underlying can be picked (weekends, holidays
 * and days without data are greyed out), and the underlying's expiry days are marked. `value` null = latest day.
 * Until the trading-day list loads, weekdays within [min, max] are allowed.
 */
export function TradingDatePicker({ underlying, value, onChange, min, max, className = '' }: {
  underlying: string; value: string | null; onChange: (d: string | null) => void; min?: string; max?: string; className?: string;
}) {
  const [cal, setCal] = useState<{ dates: string[]; expiries: string[] } | null>(null);
  useEffect(() => { let on = true; setCal(null); fetchFnoCalendar(underlying).then((c) => on && setCal(c), () => on && setCal({ dates: [], expiries: [] })); return () => { on = false; }; }, [underlying]);
  const trading = useMemo(() => new Set(cal?.dates ?? []), [cal]);
  const expiries = useMemo(() => new Set(cal?.expiries ?? []), [cal]);
  const first = cal?.dates[0] ?? min ?? '2011-01-01';
  const latest = cal?.dates.at(-1) ?? max ?? new Date().toISOString().slice(0, 10);
  const current = value ?? latest;

  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [view, setView] = useState({ y: Number(current.slice(0, 4)), m: Number(current.slice(5, 7)) - 1 });
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    const opened = Date.now();
    const onScroll = (e: Event) => { if (Date.now() - opened > 300 && !pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [at]);

  const open = () => {
    if (at) return setAt(null);
    setView({ y: Number(current.slice(0, 4)), m: Number(current.slice(5, 7)) - 1 });
    const r = btn.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
    const top = r.bottom + 360 > window.innerHeight && r.top > 360 ? r.top - 6 - 352 : r.bottom + 6;
    setAt({ top, left });
  };

  /** Pickable: a trading day held for the underlying (or, before the list loads, a weekday in range). */
  const pickable = (d: string, weekday: number) => {
    if (d < first || d > latest) return false;
    return cal?.dates.length ? trading.has(d) : weekday < 5;
  };
  const why = (d: string, weekday: number) => (d > latest ? 'No data yet' : d < first ? 'Before the data starts' : weekday >= 5 ? 'Weekend: market closed' : 'No NSE F&O session (holiday)');

  const days = useMemo(() => {
    const start = new Date(Date.UTC(view.y, view.m, 1));
    const lead = (start.getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    return { lead, count };
  }, [view]);
  const years = useMemo(() => { const out: number[] = []; for (let y = Number(first.slice(0, 4)); y <= Number(latest.slice(0, 4)); y++) out.push(y); return out; }, [first, latest]);
  const step = (dm: number) => setView((v) => { const m = v.m + dm; return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });
  const canPrev = iso(view.y, view.m, 1).slice(0, 7) > first.slice(0, 7);
  const canNext = iso(view.y, view.m, 1).slice(0, 7) < latest.slice(0, 7);
  const pick = (d: string) => { onChange(d === latest ? null : d); setAt(null); btn.current?.focus(); };
  const nextExpiry = cal?.expiries.find((e) => e >= current);

  return (
    <>
      <button ref={btn} type="button" onClick={open} aria-haspopup="dialog" aria-expanded={!!at}
        className={`flex h-9 items-center gap-2 rounded-full bg-panel px-3 text-[12.5px] font-semibold shadow-[var(--shadow-panel)] hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${className}`}
        title={nextExpiry ? `Next expiry on or after this day: ${label(nextExpiry)}` : undefined}>
        <CalendarDays size={15} className="text-muted" aria-hidden="true" />
        <span className="num">{label(current)}</span>
        {expiries.has(current) && <span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] font-bold text-accent-deep">Expiry</span>}
      </button>
      {at && createPortal(
        <div ref={pop} role="dialog" aria-label="Choose a trading day" className="fixed z-[60] rounded-[16px] bg-panel p-3 shadow-[var(--shadow-pop)]" style={{ top: at.top, left: at.left, width: POP_W }}>
          <div className="mb-2 flex items-center gap-1">
            <button type="button" onClick={() => step(-1)} disabled={!canPrev} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-raised disabled:opacity-30"><ChevronLeft size={16} /></button>
            <select value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })} aria-label="Month" className="h-8 flex-1 rounded-full bg-raised px-2 text-[12.5px] font-semibold">
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })} aria-label="Year" className="num h-8 rounded-full bg-raised px-2 text-[12.5px] font-semibold">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" onClick={() => step(1)} disabled={!canNext} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-raised disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEK.map((w, i) => <span key={w} className={`pb-1 text-[10.5px] font-bold ${i >= 5 ? 'text-muted/60' : 'text-muted'}`}>{w}</span>)}
            {Array.from({ length: days.lead }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: days.count }, (_, i) => {
              const d = iso(view.y, view.m, i + 1);
              const weekday = (days.lead + i) % 7;
              const ok = pickable(d, weekday);
              const sel = d === current, exp = expiries.has(d);
              return (
                <button key={d} type="button" disabled={!ok} onClick={() => pick(d)}
                  aria-label={`${label(d)}${exp ? ', expiry day' : ''}${ok ? '' : `, ${why(d, weekday)}`}`} aria-current={sel ? 'date' : undefined}
                  title={ok ? (exp ? 'Expiry day' : undefined) : why(d, weekday)}
                  className={`num relative grid h-9 place-items-center rounded-[10px] text-[12.5px] ${
                    sel ? 'bg-inverse font-bold text-on-inverse'
                      : !ok ? 'cursor-not-allowed text-muted/40'
                        : exp ? 'bg-accent-soft font-bold text-accent-deep hover:ring-2 hover:ring-accent'
                          : 'font-semibold text-ink hover:bg-raised'} ${d === latest && !sel ? 'ring-1 ring-line-strong' : ''}`}>
                  {i + 1}
                  {exp && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${sel ? 'bg-on-inverse' : 'bg-accent'}`} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center gap-3 border-t border-line pt-2 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-[4px] bg-accent-soft ring-1 ring-accent" />Expiry</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-[4px] ring-1 ring-line-strong" />Latest</span>
            <span className="text-muted/70">Grey = closed</span>
            {cal && !cal.dates.length && <span className="text-down" title="The data service did not return trading days and expiries, so only weekends are greyed out. Restarting the data service (feed) fixes this.">No holiday/expiry data</span>}
            <button type="button" onClick={() => pick(latest)} className="ml-auto rounded-full px-2 py-0.5 font-semibold text-accent-deep hover:bg-accent-soft">Latest</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
