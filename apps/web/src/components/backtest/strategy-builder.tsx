'use client';

import { Plus, Trash2 } from 'lucide-react';
import { INDICATOR_DEFAULTS, type Comparator, type Condition, type IndicatorName, type Operand, type RuleSet, type Strategy } from '@mtv/backtest';
import type { Timeframe } from '@mtv/shared';
import { INDICATOR_LABELS, PARAM_LABELS, PRESETS } from '@/lib/backtest';
import { tfLabel } from '@/lib/format';

const COMPARATORS: [Comparator, string][] = [['crossesAbove', 'crosses above'], ['crossesBelow', 'crosses below'], ['>', 'is above'], ['<', 'is below'], ['>=', 'is at or above'], ['<=', 'is at or below']];
const PRICE_FIELDS = ['close', 'open', 'high', 'low', 'volume'] as const;
const TFS: Timeframe[] = ['5', '15', '30', '60', 'D', 'W'];
const input = 'num h-9 rounded-[10px] border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-ink';
const select = 'h-9 rounded-[10px] border border-line bg-panel px-2 text-[13px] outline-none focus:border-ink';

/** Operand picker: a price field, a number, or an indicator with its parameters. */
function OperandInput({ value, onChange }: { value: Operand; onChange: (o: Operand) => void }) {
  const key = value.kind === 'price' ? `price:${value.field}` : value.kind === 'number' ? 'number' : `ind:${value.name}`;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select className={select} value={key} aria-label="Value" onChange={(e) => {
        const v = e.target.value;
        if (v === 'number') onChange({ kind: 'number', value: 0 });
        else if (v.startsWith('price:')) onChange({ kind: 'price', field: v.slice(6) as (typeof PRICE_FIELDS)[number] });
        else { const name = v.slice(4) as IndicatorName; onChange({ kind: 'indicator', name, params: [...INDICATOR_DEFAULTS[name]] }); }
      }}>
        <optgroup label="Price">{PRICE_FIELDS.map((f) => <option key={f} value={`price:${f}`}>{f[0].toUpperCase() + f.slice(1)}</option>)}</optgroup>
        <optgroup label="Indicator">{(Object.keys(INDICATOR_LABELS) as IndicatorName[]).map((n) => <option key={n} value={`ind:${n}`}>{INDICATOR_LABELS[n]}</option>)}</optgroup>
        <optgroup label="Value"><option value="number">Number</option></optgroup>
      </select>
      {value.kind === 'number' && (
        <input className={`${input} w-20`} type="number" step="any" value={value.value} aria-label="Number" onChange={(e) => onChange({ kind: 'number', value: Number(e.target.value) })} />
      )}
      {value.kind === 'indicator' && PARAM_LABELS[value.name].map((label, i) => (
        <input key={label} className={`${input} w-16`} type="number" step="any" min="0" title={label} aria-label={label} value={value.params[i]}
          onChange={(e) => { const params = [...value.params]; params[i] = Number(e.target.value); onChange({ ...value, params }); }} />
      ))}
    </div>
  );
}

export function Rules({ title, rules, onChange, optional }: { title: string; rules: RuleSet; onChange: (r: RuleSet) => void; optional?: boolean }) {
  const set = (i: number, c: Condition) => onChange({ ...rules, conditions: rules.conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <div className="rounded-[12px] bg-raised p-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-extrabold">{title}</p>
        {rules.conditions.length > 1 && (
          <select className="h-7 rounded-full bg-panel px-2 text-[12px] font-semibold" value={rules.match} aria-label={`${title} match`} onChange={(e) => onChange({ ...rules, match: e.target.value as 'all' | 'any' })}>
            <option value="all">All conditions</option><option value="any">Any condition</option>
          </select>
        )}
      </div>
      {!rules.conditions.length && <p className="mt-1.5 text-[12px] text-muted">{optional ? 'None: exits only on stop loss, target or square-off.' : 'Add a condition.'}</p>}
      {rules.conditions.map((c, i) => (
        <div key={i} className="mt-2 space-y-1.5 rounded-[10px] bg-panel p-2">
          <div className="flex items-start justify-between gap-1">
            <OperandInput value={c.left} onChange={(left) => set(i, { ...c, left })} />
            <button type="button" onClick={() => onChange({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })} className="rounded-full p-1.5 text-muted hover:bg-down-soft hover:text-down" aria-label="Remove condition"><Trash2 size={14} /></button>
          </div>
          <select className={`${select} w-full`} value={c.op} aria-label="Comparison" onChange={(e) => set(i, { ...c, op: e.target.value as Comparator })}>
            {COMPARATORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <OperandInput value={c.right} onChange={(right) => set(i, { ...c, right })} />
        </div>
      ))}
      <button type="button" className="mt-2 flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-ink-2 hover:bg-panel"
        onClick={() => onChange({ ...rules, conditions: [...rules.conditions, { left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'indicator', name: 'EMA', params: [20] } }] })}>
        <Plus size={14} /> Add condition
      </button>
    </div>
  );
}

export function StrategyBuilder({ strategy, tf, symbol, busy, onChange, onTf, onPickSymbol, onRun }: {
  strategy: Strategy;
  tf: Timeframe;
  symbol: string;
  busy: boolean;
  onChange: (s: Strategy) => void;
  onTf: (tf: Timeframe) => void;
  onPickSymbol: () => void;
  onRun: () => void;
}) {
  const s = strategy;
  const intraday = tf !== 'D' && tf !== 'W';
  const pctField = (label: string, v: number | undefined, set: (v: number | undefined) => void) => (
    <label className="text-[12px] font-semibold text-ink-2">{label}
      <input className={`${input} mt-1 w-full`} type="number" step="any" min="0" placeholder="Off" value={v ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  );

  return (
    <form className="flex min-h-0 flex-col" onSubmit={(e) => { e.preventDefault(); onRun(); }}>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <div className="flex items-center gap-2">
          <select className={`${select} flex-1`} value="" aria-label="Load a preset" onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            if (p) { onChange(structuredClone(p.strategy)); onTf(p.tf); }
          }}>
            <option value="">Load a preset…</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.strategy.name} · {tfLabel(p.tf)}</option>)}
          </select>
        </div>
        <input className={`${input} w-full font-sans font-bold`} value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} aria-label="Strategy name" />

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onPickSymbol} className="h-9 rounded-[10px] border border-line bg-panel px-3 text-left text-[13px] font-bold hover:border-ink">{symbol}</button>
          <select className={select} value={tf} onChange={(e) => onTf(e.target.value as Timeframe)} aria-label="Timeframe">
            {TFS.map((t) => <option key={t} value={t}>{tfLabel(t)}</option>)}
          </select>
          <select className={select} value={s.direction} onChange={(e) => onChange({ ...s, direction: e.target.value as Strategy['direction'] })} aria-label="Direction">
            <option value="LONG">Long (buy first)</option><option value="SHORT">Short (sell first)</option>
          </select>
          <select className={select} value={s.product} onChange={(e) => onChange({ ...s, product: e.target.value as Strategy['product'] })} aria-label="Product">
            <option value="MIS">Intraday (MIS)</option><option value="CNC">Delivery (CNC)</option>
          </select>
        </div>
        {s.product === 'MIS' && !intraday && <p className="text-[12px] font-semibold text-down">Intraday strategies need an intraday timeframe (5m–1h).</p>}
        {s.product === 'CNC' && s.direction === 'SHORT' && <p className="text-[12px] font-semibold text-down">Delivery cannot short. Choose Long or Intraday.</p>}

        <Rules title="Entry when" rules={s.entry} onChange={(entry) => onChange({ ...s, entry })} />
        <Rules title="Exit when" optional rules={s.exit ?? { match: 'any', conditions: [] }} onChange={(exit) => onChange({ ...s, exit })} />

        <div className="grid grid-cols-2 gap-2">
          {pctField('Stop loss %', s.stopLossPct, (v) => onChange({ ...s, stopLossPct: v }))}
          {pctField('Target %', s.targetPct, (v) => onChange({ ...s, targetPct: v }))}
          <label className="text-[12px] font-semibold text-ink-2">Size per trade
            <div className="mt-1 flex gap-1">
              <input className={`${input} w-full`} type="number" min="1" step="any" value={s.sizing.mode === 'qty' ? s.sizing.qty : s.sizing.pct}
                onChange={(e) => onChange({ ...s, sizing: s.sizing.mode === 'qty' ? { mode: 'qty', qty: Math.floor(Number(e.target.value)) } : { mode: 'capital', pct: Number(e.target.value) } })} />
              <select className={select} value={s.sizing.mode} aria-label="Sizing"
                onChange={(e) => onChange({ ...s, sizing: e.target.value === 'qty' ? { mode: 'qty', qty: 10 } : { mode: 'capital', pct: 100 } })}>
                <option value="capital">% capital</option><option value="qty">shares</option>
              </select>
            </div>
          </label>
          <label className="text-[12px] font-semibold text-ink-2">Starting capital (₹)
            <input className={`${input} mt-1 w-full`} inputMode="numeric" value={s.initialCapitalPaise / 100}
              onChange={(e) => onChange({ ...s, initialCapitalPaise: Math.max(0, Math.floor(Number(e.target.value.replace(/[^\d]/g, '')) || 0)) * 100 })} />
          </label>
        </div>
        <p className="text-[11px] leading-snug text-muted">
          Rules are checked when a bar closes and trades happen at the next bar&rsquo;s open. If a bar touches both stop and target, the stop counts first. Intraday:
          no entries from 15:15, exit by 15:20 IST. Every trade pays brokerage, STT, exchange, SEBI, stamp duty and GST.
        </p>
      </div>
      <div className="border-t border-line p-3">
        <button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-ink font-bold text-white disabled:opacity-50">{busy ? 'Running backtest…' : 'Run backtest'}</button>
      </div>
    </form>
  );
}
