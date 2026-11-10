'use client';

// The strategy editor's choices as dropdowns: common values first, "Custom…" for anything else (which shows a number
// box). Each dropdown reads the current setting back: a value that is not one of its choices shows as Custom.

import { useState } from 'react';
import type { EquityStrategy, IntradayRules } from '@/lib/strategy';
import { inputCls } from '../ui';

/** A choice inside a sentence or a settings row: looks like a highlighted word, works like a select. */
export const WORD = 'h-10 max-w-full cursor-pointer rounded-[12px] border-0 bg-accent-soft py-0 pl-3 pr-8 text-[inherit] font-semibold text-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const SMALL = 'h-9 cursor-pointer rounded-[10px] border border-line-strong bg-panel pl-2.5 pr-7 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const NUM = `${inputCls} num h-9 w-[92px] text-[13px]`;

type Choice<T> = { key: string; label: string; value: T };

/** A dropdown of preset values plus Custom…; `custom` draws the editor shown when the value is not a preset. */
function Pick<T>({ label, value, choices, onChange, same, custom, makeCustom }: {
  label: string; value: T; choices: Choice<T>[]; onChange: (v: T) => void; same: (a: T, b: T) => boolean;
  custom: () => React.ReactNode; makeCustom: () => T;
}) {
  // Once Custom… is picked it stays, even when the custom value happens to equal a preset (custom "% below entry" starts
  // at 2%, which is also the "2% below entry" choice): otherwise the dropdown would jump back to that preset.
  const [customMode, setCustomMode] = useState(false);
  const hit = customMode ? undefined : choices.find((c) => same(c.value, value));
  return (
    <label className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
      <span>{label}</span>
      <select value={hit?.key ?? 'custom'} aria-label={label} className={SMALL}
        onChange={(e) => { const c = choices.find((x) => x.key === e.target.value); setCustomMode(!c); onChange(c ? c.value : makeCustom()); }}>
        {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {!hit && custom()}
    </label>
  );
}

const num = (v: string) => (v === '' ? 0 : Number(v));
const eq = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

export function StopPick({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const intraday = ['1m', '3m', '5m', '15m', '30m', '1h'].includes(s.tf);
  const choices: Choice<EquityStrategy['stop']>[] = [
    { key: 'none', label: 'No stop', value: { kind: 'none' } },
    ...[0.5, 1, 2, 3, 5].map((v) => ({ key: `pct${v}`, label: `${v}% below entry`, value: { kind: 'pct' as const, value: v } })),
    { key: 'atr2', label: '2 × ATR (14)', value: { kind: 'atr', mult: 2, length: 14 } },
    { key: 'st', label: 'Supertrend (10, 3) line', value: { kind: 'formula', formula: 'SUPERTREND(10, 3)' } },
    { key: 'low5', label: 'Low of last 5 candles', value: { kind: 'formula', formula: 'LOWEST(LOW, 5)[1]' } },
    ...(intraday ? [
      { key: 'vwap', label: 'VWAP', value: { kind: 'formula' as const, formula: 'VWAP' } },
      { key: 'orl', label: 'Opening range low (15 min)', value: { kind: 'formula' as const, formula: 'OR_LOW(15)' } },
    ] : []),
  ];
  const st = s.stop;
  return (
    <Pick label="Stop" value={st} choices={choices} same={eq} onChange={(stop) => set({ stop })} makeCustom={() => ({ kind: 'points', value: 10 }) as EquityStrategy['stop']}
      custom={() => (
        <>
          <select value={st.kind} aria-label="Stop type" className={SMALL} onChange={(e) => {
            const k = e.target.value;
            set({ stop: k === 'pct' ? { kind: 'pct', value: 2 } : k === 'points' ? { kind: 'points', value: 10 } : k === 'atr' ? { kind: 'atr', mult: 2, length: 14 } : { kind: 'formula', formula: 'EMA(CLOSE, 20)' } });
          }}>
            <option value="pct">% below entry</option><option value="points">₹ below entry</option><option value="atr">× ATR</option><option value="formula">Indicator level</option>
          </select>
          {(st.kind === 'pct' || st.kind === 'points') && <input type="number" step="any" min={0} value={st.value} onChange={(e) => set({ stop: { kind: st.kind, value: num(e.target.value) } })} className={NUM} aria-label="Stop size" />}
          {st.kind === 'atr' && <input type="number" step="any" min={0} value={st.mult} onChange={(e) => set({ stop: { ...st, mult: num(e.target.value) } })} className={NUM} aria-label="ATR multiple" />}
          {st.kind === 'formula' && <input value={st.formula} onChange={(e) => set({ stop: { kind: 'formula', formula: e.target.value } })} spellCheck={false} className={`${inputCls} h-9 w-[200px] font-mono text-[12.5px]`} aria-label="Stop level formula" title="A price level, read at every close, e.g. EMA(CLOSE, 20)" />}
        </>
      )} />
  );
}

export function TargetPick({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const choices: Choice<EquityStrategy['target']>[] = [
    { key: 'none', label: 'No target', value: { kind: 'none' } },
    ...[1, 2, 3, 5, 10].map((v) => ({ key: `pct${v}`, label: `${v}% above entry`, value: { kind: 'pct' as const, value: v } })),
    ...[1.5, 2, 3].map((v) => ({ key: `rr${v}`, label: `${v} × the risk`, value: { kind: 'rr' as const, value: v } })),
  ];
  const t = s.target;
  return (
    <Pick label="Target" value={t} choices={choices} same={eq} onChange={(target) => set({ target })} makeCustom={() => ({ kind: 'points', value: 20 }) as EquityStrategy['target']}
      custom={() => t.kind === 'none' ? null : (
        <>
          <select value={t.kind} aria-label="Target type" className={SMALL} onChange={(e) => set({ target: { kind: e.target.value as 'pct' | 'points' | 'rr', value: t.value } })}>
            <option value="pct">% above entry</option><option value="points">₹ above entry</option><option value="rr">× the risk</option>
          </select>
          <input type="number" step="any" min={0} value={t.value} onChange={(e) => set({ target: { kind: t.kind, value: num(e.target.value) } })} className={NUM} aria-label="Target size" />
        </>
      )} />
  );
}

export function TrailPick({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const choices: Choice<EquityStrategy['trail']>[] = [
    { key: 'none', label: 'No trailing stop', value: { kind: 'none' } },
    ...[3, 5, 8, 10].map((v) => ({ key: `pct${v}`, label: `${v}% below the high`, value: { kind: 'pct' as const, value: v } })),
    { key: 'atr3', label: '3 × ATR below the high', value: { kind: 'atr', mult: 3, length: 14 } },
  ];
  const t = s.trail;
  return (
    <Pick label="Trailing" value={t} choices={choices} same={eq} onChange={(trail) => set({ trail })} makeCustom={() => ({ kind: 'points', value: 20 }) as EquityStrategy['trail']}
      custom={() => t.kind === 'none' ? null : (
        <>
          <select value={t.kind} aria-label="Trailing type" className={SMALL} onChange={(e) => { const k = e.target.value; set({ trail: k === 'atr' ? { kind: 'atr', mult: 3, length: 14 } : { kind: k as 'pct' | 'points', value: k === 'pct' ? 8 : 20 } }); }}>
            <option value="pct">% below the high</option><option value="points">₹ below the high</option><option value="atr">× ATR below the high</option>
          </select>
          {(t.kind === 'pct' || t.kind === 'points') && <input type="number" step="any" min={0} value={t.value} onChange={(e) => set({ trail: { kind: t.kind, value: num(e.target.value) } })} className={NUM} aria-label="Trailing distance" />}
          {t.kind === 'atr' && <input type="number" step="any" min={0} value={t.mult} onChange={(e) => set({ trail: { ...t, mult: num(e.target.value) } })} className={NUM} aria-label="ATR multiple" />}
        </>
      )} />
  );
}

const lakh = (r: number) => (r >= 1e7 ? `₹${r / 1e7} Cr` : `₹${r / 1e5} L`);
export function CapitalPick({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const choices = [100000, 500000, 1000000, 2500000, 5000000, 10000000].map((v) => ({ key: String(v), label: lakh(v), value: v }));
  return (
    <Pick label="Capital" value={s.capitalRupees} choices={choices} same={(a, b) => a === b} onChange={(capitalRupees) => set({ capitalRupees })} makeCustom={() => 300000}
      custom={() => <input type="number" min={0} step={10000} value={s.capitalRupees} onChange={(e) => set({ capitalRupees: num(e.target.value) })} className={`${NUM} w-[120px]`} aria-label="Capital in rupees" />} />
  );
}

export function SizePick({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const choices: Choice<EquityStrategy['sizing']>[] = [
    ...[5, 10, 20, 25, 50, 100].map((v) => ({ key: `p${v}`, label: `${v}% of capital`, value: { mode: 'percent' as const, pct: v } })),
    ...[0.5, 1, 2].map((v) => ({ key: `r${v}`, label: `Risk ${v}% (needs a stop)`, value: { mode: 'risk' as const, pct: v } })),
    { key: 'a1L', label: '₹1 L a trade', value: { mode: 'amount', rupees: 100000 } },
  ];
  const z = s.sizing;
  return (
    <Pick label="Per trade" value={z} choices={choices} same={eq} onChange={(sizing) => set({ sizing })} makeCustom={() => ({ mode: 'qty', qty: 10 }) as EquityStrategy['sizing']}
      custom={() => (
        <>
          <select value={z.mode} aria-label="Sizing" className={SMALL} onChange={(e) => { const m = e.target.value; set({ sizing: m === 'qty' ? { mode: 'qty', qty: 10 } : m === 'amount' ? { mode: 'amount', rupees: 100000 } : m === 'percent' ? { mode: 'percent', pct: 10 } : { mode: 'risk', pct: 1 } }); }}>
            <option value="qty">Fixed shares</option><option value="amount">Fixed ₹</option><option value="percent">% of capital</option><option value="risk">Risk %</option>
          </select>
          {z.mode === 'qty' && <input type="number" min={1} step={1} value={z.qty} onChange={(e) => set({ sizing: { mode: 'qty', qty: Math.round(num(e.target.value)) } })} className={NUM} aria-label="Shares" />}
          {z.mode === 'amount' && <input type="number" min={0} step={1000} value={z.rupees} onChange={(e) => set({ sizing: { mode: 'amount', rupees: num(e.target.value) } })} className={`${NUM} w-[120px]`} aria-label="Rupees a trade" />}
          {(z.mode === 'percent' || z.mode === 'risk') && <input type="number" min={0} step="any" value={z.pct} onChange={(e) => set({ sizing: { mode: z.mode, pct: num(e.target.value) } })} className={NUM} aria-label="Percent" />}
        </>
      )} />
  );
}

export function MaxOpenPick({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const choices = [1, 3, 5, 10, 20].map((v) => ({ key: String(v), label: String(v), value: v }));
  return (
    <Pick label="Max open" value={s.maxOpen} choices={choices} same={(a, b) => a === b} onChange={(maxOpen) => set({ maxOpen })} makeCustom={() => 2}
      custom={() => <input type="number" min={1} step={1} value={s.maxOpen} onChange={(e) => set({ maxOpen: Math.max(1, Math.round(num(e.target.value))) })} className={NUM} aria-label="Positions open at once" />} />
  );
}

/** Intraday session: from when, the last entry, and when everything is closed. */
export function SessionPicks({ rules, onChange }: { rules: IntradayRules; onChange: (r: IntradayRules) => void }) {
  const time = (label: string, value: string, list: string[], k: keyof IntradayRules) => (
    <Pick label={label} value={value} same={(a, b) => a === b} onChange={(v) => onChange({ ...rules, [k]: v })} makeCustom={() => value}
      choices={list.map((t) => ({ key: t, label: t, value: t }))}
      custom={() => <input type="time" min="09:15" max="15:30" value={value} onChange={(e) => onChange({ ...rules, [k]: e.target.value })} className={`${NUM} w-[110px]`} aria-label={label} />} />
  );
  return (
    <>
      {time('From', rules.firstEntry ?? '09:15', ['09:15', '09:20', '09:30', '09:45', '10:00'], 'firstEntry')}
      {time('Last entry', rules.lastEntry, ['13:00', '14:00', '14:30', '14:45', '15:00'], 'lastEntry')}
      {time('Close all', rules.squareOff, ['14:30', '14:45', '15:00', '15:15', '15:20'], 'squareOff')}
    </>
  );
}

const TODAY = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const YEARS_AGO = (y: number) => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
/** Test period: the last 1 / 3 / 5 years, all data, or two dates. */
export function PeriodPick({ s, set, className }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void; className?: string }) {
  const PERIODS: [string, string, number][] = [['1y', 'the last year', 1], ['3y', 'the last 3 years', 3], ['5y', 'the last 5 years', 5], ['all', 'all data', 20]];
  const [own, setOwn] = useState(false); // "dates I choose" picked while the dates still match a preset
  const hit = own ? undefined : s.to === TODAY() ? PERIODS.find(([, , y]) => s.from === YEARS_AGO(y)) : undefined;
  return (
    <>
      <select value={hit?.[0] ?? 'custom'} aria-label="Test period" className={className}
        onChange={(e) => { const p = PERIODS.find(([k]) => k === e.target.value); setOwn(!p); if (p) set({ from: YEARS_AGO(p[2]), to: TODAY() }); }}>
        {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        <option value="custom">dates I choose…</option>
      </select>
      {!hit && (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-normal">
          <input type="date" value={s.from} onChange={(e) => set({ from: e.target.value })} className={`${inputCls} num h-10`} aria-label="From" />
          to
          <input type="date" value={s.to} onChange={(e) => set({ to: e.target.value })} className={`${inputCls} num h-10`} aria-label="To" />
        </span>
      )}
    </>
  );
}
