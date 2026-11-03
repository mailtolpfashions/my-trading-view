'use client';

import { useMemo, useRef, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { parseFormula } from '@mtv/rules';
import type { Meta, Param } from '@/lib/screener';
import { inputCls } from '../ui';

const INSERTS = [
  { label: 'AND', text: ' AND ' }, { label: 'OR', text: ' OR ' }, { label: 'NOT', text: 'NOT ' },
  { label: '>', text: ' > ' }, { label: '<', text: ' < ' }, { label: '>=', text: ' >= ' }, { label: '<=', text: ' <= ' }, { label: '=', text: ' = ' },
  { label: '[1]', text: '[1]', title: 'Previous bar: HIGH[1]' },
  { label: '[W]', text: '[W] ', title: 'Weekly bars: [W] HIGH[1] is last week\'s high' },
  { label: '[M]', text: '[M] ', title: 'Monthly bars' },
];
const signature = (name: string, params: Param[]) => (params.length ? `${name}(${params.map((p) => p.name).join(', ')})` : name);
const callText = (name: string, params: Param[]) => (params.length ? `${name}(${params.map((p) => (p.def ?? p.name)).join(', ')})` : name);

/** The formula as typed, with the part an error points at underlined. */
export function ErrorText({ text, span }: { text: string; span?: [number, number] }) {
  if (!span) return null;
  const [s, e] = [Math.min(span[0], text.length), Math.max(Math.min(span[1], text.length), span[0] + 1)];
  return (
    <code className="block overflow-x-auto whitespace-pre rounded-[10px] bg-raised px-3 py-2 text-[13px] text-ink-2">
      {text.slice(0, s)}
      <mark className="rounded bg-down-soft px-0.5 text-down underline decoration-wavy underline-offset-4">{text.slice(s, e) || ' '}</mark>
      {text.slice(e)}
    </code>
  );
}

/** Checks a formula as it is typed (the same parser the data service uses) and explains any mistake. */
export function useFormula(text: string) {
  return useMemo(() => (text.trim() ? parseFormula(text) : null), [text]);
}

export function FormulaEditor({ value, onChange, meta }: { value: string; onChange: (v: string) => void; meta: Meta | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const parsed = useFormula(value);
  const [showRef, setShowRef] = useState(false);

  const insert = (text: string) => {
    const el = ref.current;
    if (!el) return onChange(value + text);
    const s = el.selectionStart, e = el.selectionEnd;
    const next = value.slice(0, s) + text + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + text.length, s + text.length); });
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
      <div className="grid gap-2">
        <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} rows={5}
          aria-label="Formula" aria-invalid={parsed?.ok === false}
          placeholder="CLOSE > EMA(CLOSE, 50) AND RSI(CLOSE, 14) > 55"
          className={`${inputCls} h-auto min-h-[120px] resize-y py-2.5 font-mono text-[14px] leading-relaxed`} />
        {parsed && !parsed.ok && (
          <div className="grid gap-1.5" role="alert">
            <p className="text-[13px] font-medium text-down">{parsed.error}</p>
            <ErrorText text={value} span={parsed.span} />
          </div>
        )}
        {parsed?.ok && parsed.type === 'num' && <p className="text-[13px] font-medium text-down">This is a value, not a condition. Compare it, for example {parsed.formula} &gt; 50.</p>}
        {parsed?.ok && parsed.type === 'bool' && (
          <p className="text-[13px] text-ink-2"><span className="font-semibold text-up">Valid.</span> Reads as: <code className="text-ink">{parsed.formula}</code></p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {INSERTS.map((t) => (
            <button key={t.label} type="button" onClick={() => insert(t.text)} title={t.title}
              className="h-7 rounded-[8px] border border-line px-2 font-mono text-[12px] text-ink-2 hover:border-line-strong hover:text-ink">{t.label}</button>
          ))}
          <button type="button" onClick={() => setShowRef((v) => !v)} aria-expanded={showRef}
            className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-semibold text-accent-deep hover:bg-accent-soft lg:hidden">
            <BookOpen size={14} /> Functions
          </button>
        </div>
      </div>
      <div className={`${showRef ? 'block' : 'hidden'} lg:block`}>
        <FunctionReference meta={meta} onInsert={insert} />
      </div>
    </div>
  );
}

function FunctionReference({ meta, onInsert }: { meta: Meta | null; onInsert: (t: string) => void }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    if (!meta) return [];
    const needle = q.trim().toUpperCase();
    const fields = meta.fields.map((f) => ({ name: f.name, group: 'Price', sig: f.name, text: f.name, summary: f.summary }));
    const fns = meta.functions.map((f) => ({ name: f.name, group: f.group, sig: signature(f.name, f.params), text: callText(f.name, f.params), summary: f.summary }));
    const all = [...fields, ...fns].filter((f) => !needle || f.name.includes(needle.replace(/ /g, '_')) || f.summary.toUpperCase().includes(needle));
    const by = new Map<string, typeof all>();
    for (const f of all) by.set(f.group, [...(by.get(f.group) ?? []), f]);
    return [...by];
  }, [meta, q]);

  return (
    <div className="flex h-full max-h-[340px] w-full flex-col rounded-[14px] border border-line bg-raised lg:w-[320px]">
      <label className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search size={14} className="text-muted" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a function (rsi, breakout, engulfing…)"
          className="w-full bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none" aria-label="Find a function" />
      </label>
      <div className="overflow-y-auto px-2 py-2">
        {!meta && <p className="px-2 py-1 text-[13px] text-muted">Loading…</p>}
        {groups.map(([g, items]) => (
          <div key={g} className="mb-2">
            <p className="eyebrow px-2 py-1">{g}</p>
            {items.map((f) => (
              <button key={f.name} type="button" onClick={() => onInsert(f.text)} title={f.summary}
                className="block w-full rounded-[8px] px-2 py-1.5 text-left hover:bg-panel">
                <span className="block font-mono text-[12.5px] text-ink">{f.sig}</span>
                <span className="line-clamp-2 block text-[12px] text-muted">{f.summary}</span>
              </button>
            ))}
          </div>
        ))}
        {meta && !groups.length && <p className="px-2 py-1 text-[13px] text-muted">Nothing matches.</p>}
      </div>
    </div>
  );
}
