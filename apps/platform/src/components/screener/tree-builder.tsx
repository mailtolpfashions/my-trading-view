'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Copy, FolderPlus, Plus, Search, Type, X } from 'lucide-react';
import { parseFormula, type Tf } from '@mtv/rules';
import { OPS, addTo, duplicateItem, fromComparison, group, leaf, mapItem, moveItem, toComparison, type Comparison, type Group, type Item, type Leaf, type Op } from '@/lib/builder';
import { TF_LABEL, type Meta, type Param } from '@/lib/screener';
import { TimeframeOptions } from '../timeframe-select';
import { inputCls } from '../ui';
import { ErrorText } from './formula-editor';

const icon = 'grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-raised hover:text-ink disabled:opacity-30';

type Ctx = { meta: Meta | null; screenTf: Tf; change: (root: Group, key?: string) => void; root: Group; rootLabel: string };

/** Groups of conditions, nested as deep as needed. `change(next, key)`: edits with the same key merge into one undo step. */
export function TreeBuilder({ root, meta, screenTf, onChange, rootLabel = 'Stocks must match' }: { root: Group; meta: Meta | null; screenTf: Tf; onChange: (root: Group, key?: string) => void; rootLabel?: string }) {
  return <GroupView g={root} isRoot ctx={{ meta, screenTf, change: onChange, root, rootLabel }} />;
}

function GroupView({ g, isRoot, ctx, first, last }: { g: Group; isRoot?: boolean; ctx: Ctx; first?: boolean; last?: boolean }) {
  const edit = (fn: (x: Group) => Group) => ctx.change(mapItem(ctx.root, g.id, (x) => fn(x as Group)));
  return (
    <div className={isRoot ? 'grid gap-3' : 'grid gap-3 rounded-[14px] border border-line-strong bg-raised/60 p-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <NotToggle on={g.not} onChange={(not) => edit((x) => ({ ...x, not }))} />
        <span className="text-[13px] text-ink-2">{isRoot ? ctx.rootLabel : 'This group matches'}</span>
        <div role="radiogroup" aria-label="Match" className="inline-flex rounded-[10px] border border-line-strong bg-panel p-0.5">
          {(['AND', 'OR'] as const).map((op) => (
            <button key={op} type="button" role="radio" aria-checked={g.op === op} onClick={() => edit((x) => ({ ...x, op }))}
              className={`h-7 rounded-[8px] px-2.5 text-[12.5px] font-semibold ${g.op === op ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:text-ink'}`}>
              {op === 'AND' ? 'All of these' : 'Any of these'}
            </button>
          ))}
        </div>
        {!isRoot && (
          <div className="ml-auto flex items-center">
            <button type="button" className={icon} disabled={first} onClick={() => ctx.change(moveItem(ctx.root, g.id, -1))} aria-label="Move group up"><ArrowUp size={15} /></button>
            <button type="button" className={icon} disabled={last} onClick={() => ctx.change(moveItem(ctx.root, g.id, 1))} aria-label="Move group down"><ArrowDown size={15} /></button>
            <button type="button" className={icon} onClick={() => ctx.change(duplicateItem(ctx.root, g.id))} aria-label="Duplicate group"><Copy size={15} /></button>
            <button type="button" className={icon} onClick={() => ctx.change(mapItem(ctx.root, g.id, () => null))} aria-label="Remove group"><X size={16} /></button>
          </div>
        )}
      </div>
      <ol className="grid gap-2">
        {g.children.map((c, i) => (
          <li key={c.id} className="grid gap-2">
            {c.kind === 'group'
              ? <GroupView g={c} ctx={ctx} first={i === 0} last={i === g.children.length - 1} />
              : <LeafView l={c} ctx={ctx} first={i === 0} last={i === g.children.length - 1} />}
            {i < g.children.length - 1 && <span className="eyebrow pl-1">{g.op === 'AND' ? 'and' : 'or'}</span>}
          </li>
        ))}
      </ol>
      {!g.children.length && <p className="text-[13px] text-muted">{isRoot ? 'No conditions yet. Add one from the list, or type your own.' : 'Empty group: add conditions to it.'}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <AddCondition meta={ctx.meta} onAdd={(f) => ctx.change(addTo(ctx.root, g.id, leaf(f)))} />
        <button type="button" onClick={() => ctx.change(addTo(ctx.root, g.id, { ...group(g.op === 'AND' ? 'OR' : 'AND'), children: [leaf('')] }))}
          className="inline-flex h-10 items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-semibold text-ink-2 hover:bg-raised hover:text-ink">
          <FolderPlus size={16} /> Add group
        </button>
      </div>
    </div>
  );
}

function NotToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} title={on ? 'NOT: matches when this is false' : 'Turn on NOT to match when this is false'}
      className={`h-7 shrink-0 rounded-[8px] px-2 text-[11.5px] font-bold tracking-wide ${on ? 'bg-down-soft text-down' : 'border border-dashed border-line-strong text-muted hover:text-ink'}`}>
      NOT
    </button>
  );
}

function LeafView({ l, ctx, first, last }: { l: Leaf; ctx: Ctx; first: boolean; last: boolean }) {
  const set = (patch: Partial<Leaf>, key?: string) => ctx.change(mapItem(ctx.root, l.id, (x) => ({ ...(x as Leaf), ...patch })), key);
  const cmp = useMemo(() => (l.tf === 'mixed' ? null : toComparison(l.text)), [l.text, l.tf]);
  // The editing mode stays as chosen while typing (a half-typed comparison briefly doesn't parse as one).
  const [mode, setMode] = useState<'fields' | 'text'>(() => (cmp || !l.text.trim() ? 'fields' : 'text'));
  const structured = mode === 'fields';
  const mixed = l.tf === 'mixed';
  const p = l.text.trim() ? parseFormula(l.text) : null;
  const bad = p && (!p.ok || p.type !== 'bool');

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <NotToggle on={l.not} onChange={(not) => set({ not })} />
        <select value={mixed ? 'mixed' : l.tf ?? ''} disabled={mixed} aria-label="Timeframe of this condition"
          title={mixed ? 'This condition compares two timeframes; edit them in the text' : 'Timeframe for this condition'}
          onChange={(e) => set({ tf: (e.target.value || null) as Tf | null })}
          className={`${inputCls} w-[160px] shrink-0 pr-7 ${l.tf && !mixed ? 'border-accent font-semibold text-accent-deep' : ''}`}>
          <option value="">Screen ({TF_LABEL[ctx.screenTf]})</option>
          <TimeframeOptions />
          {mixed && <option value="mixed">Mixed</option>}
        </select>
        {structured
          ? <ComparisonEditor value={cmp} meta={ctx.meta} onChange={(c, part) => set({ text: fromComparison(c) }, `${l.id}:${part}`)} />
          : <LeafText value={l.text} bad={!!bad} onChange={(text) => set({ text }, `${l.id}:text`)} />}
        <div className="flex shrink-0 items-center">
          <button type="button" className={icon} onClick={() => setMode(structured ? 'text' : 'fields')} disabled={!structured && !cmp && !!l.text.trim()} aria-pressed={!structured}
            title={structured ? 'Edit as formula text' : cmp ? 'Edit as value, operator, value' : 'This condition is not a single comparison'} aria-label="Switch editing mode">
            <Type size={15} />
          </button>
          <button type="button" className={icon} disabled={first} onClick={() => ctx.change(moveItem(ctx.root, l.id, -1))} aria-label="Move up"><ArrowUp size={15} /></button>
          <button type="button" className={icon} disabled={last} onClick={() => ctx.change(moveItem(ctx.root, l.id, 1))} aria-label="Move down"><ArrowDown size={15} /></button>
          <button type="button" className={icon} onClick={() => ctx.change(duplicateItem(ctx.root, l.id))} aria-label="Duplicate"><Copy size={15} /></button>
          <button type="button" className={icon} onClick={() => ctx.change(mapItem(ctx.root, l.id, () => null))} aria-label="Remove"><X size={16} /></button>
        </div>
      </div>
      {p && !p.ok && !structured && <div className="grid gap-1 pl-[200px] max-lg:pl-0"><p className="text-[12.5px] text-down">{p.error}</p><ErrorText text={l.text} span={p.span} /></div>}
      {p?.ok && p.type !== 'bool' && <p className="text-[12.5px] text-down">A value on its own isn&apos;t a condition. Compare it, e.g. {p.formula} &gt; 50.</p>}
    </div>
  );
}

/** Free text, kept locally so typing is never reformatted mid-word. */
function LeafText({ value, bad, onChange }: { value: string; bad: boolean; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const sent = useRef(value);
  useEffect(() => { if (value !== sent.current) { setLocal(value); sent.current = value; } }, [value]);
  return (
    <input value={local} spellCheck={false} aria-label="Condition" aria-invalid={bad}
      onChange={(e) => { setLocal(e.target.value); sent.current = e.target.value; onChange(e.target.value); }}
      className={`${inputCls} min-w-0 flex-1 font-mono ${bad ? 'border-down' : ''}`} />
  );
}

/** "RSI(CLOSE, 14)  greater than  55": each side a value (an indicator, a price or a number). */
function ComparisonEditor({ value, meta, onChange }: { value: Comparison | null; meta: Meta | null; onChange: (c: Comparison, part: string) => void }) {
  const [c, setC] = useState<Comparison>(value ?? { left: '', op: '>', right: '' });
  const sent = useRef(value);
  // Follow outside changes (undo, a timeframe change) but not our own half-typed edits.
  useEffect(() => { if (value && JSON.stringify(value) !== JSON.stringify(sent.current)) { setC(value); sent.current = value; } }, [value]);
  const update = (patch: Partial<Comparison>, part: string) => {
    const n = { ...c, ...patch };
    setC(n);
    sent.current = toComparison(fromComparison(n)); // what the parent will hand back for this edit
    onChange(n, part);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex-nowrap">
      <Operand value={c.left} meta={meta} placeholder="Indicator or price, e.g. RSI(CLOSE, 14)" onChange={(left) => update({ left }, 'left')} />
      <select value={c.op} onChange={(e) => update({ op: e.target.value as Op }, 'op')} aria-label="Operator" className={`${inputCls} w-[150px] shrink-0 pr-7`}>
        {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Operand value={c.right} meta={meta} placeholder="Value, e.g. 55 or EMA(CLOSE, 50)" onChange={(right) => update({ right }, 'right')} />
    </div>
  );
}

const callText = (name: string, params: Param[]) => (params.length ? `${name}(${params.map((p) => (p.def ?? p.name)).join(', ')})` : name);

function Operand({ value, meta, placeholder, onChange }: { value: string; meta: Meta | null; placeholder: string; onChange: (v: string) => void }) {
  const p = value.trim() ? parseFormula(value) : null;
  const err = !value.trim() ? 'Fill this in' : p && !p.ok ? p.error : p?.ok && p.type !== 'num' ? 'This side must be a value, not a condition' : null;
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex min-w-[180px] flex-1 items-center">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} aria-label={placeholder} aria-invalid={!!err && !!value.trim()} title={err ?? undefined}
        className={`${inputCls} w-full pr-10 font-mono ${err && value.trim() ? 'border-down' : ''}`} />
      <button ref={btn} type="button" onClick={() => setOpen((v) => !v)} aria-label="Pick an indicator" title="Pick an indicator"
        className="absolute right-1.5 grid h-7 w-7 place-items-center rounded-[8px] font-serif text-[13px] italic text-accent-deep hover:bg-accent-soft">fx</button>
      {open && <IndicatorMenu anchor={btn.current} meta={meta} onClose={() => setOpen(false)} onPick={(t) => { onChange(t); setOpen(false); }} />}
    </div>
  );
}

/** Searchable list of prices and value functions (conditions are left out: a side of a comparison is a value). */
function IndicatorMenu({ anchor, meta, onPick, onClose }: { anchor: HTMLElement | null; meta: Meta | null; onPick: (t: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  const items = useMemo(() => {
    if (!meta) return [];
    const needle = q.trim().toUpperCase().replace(/ /g, '_');
    return [
      ...meta.fields.map((f) => ({ name: f.name, group: 'Price', text: f.name, summary: f.summary })),
      ...meta.functions.filter((f) => f.returns === 'num').map((f) => ({ name: f.name, group: f.group, text: callText(f.name, f.params), summary: f.summary })),
    ].filter((x) => !needle || x.name.includes(needle) || x.summary.toUpperCase().includes(q.trim().toUpperCase()));
  }, [meta, q]);
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.right - 320, window.innerWidth - 336);
  return createPortal(
    <div ref={box} role="dialog" aria-label="Pick an indicator" style={{ top: r.bottom + 6, left: Math.max(8, left) }}
      className="fixed z-[60] flex max-h-[360px] w-[320px] flex-col rounded-[14px] bg-panel shadow-[var(--shadow-pop)]">
      <label className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search size={14} className="text-muted" aria-hidden="true" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="RSI, EMA, ATR, volume…" aria-label="Search indicators" className="w-full bg-transparent text-[13px] focus:outline-none" />
      </label>
      <div className="overflow-y-auto p-1.5">
        {items.map((x) => (
          <button key={x.name} type="button" onClick={() => onPick(x.text)} className="block w-full rounded-[8px] px-2 py-1.5 text-left hover:bg-raised">
            <span className="flex items-baseline justify-between gap-2"><span className="font-mono text-[12.5px] text-ink">{x.text}</span><span className="text-[10.5px] text-muted">{x.group}</span></span>
            <span className="line-clamp-1 block text-[11.5px] text-muted">{x.summary}</span>
          </button>
        ))}
        {meta && !items.length && <p className="px-2 py-1 text-[13px] text-muted">Nothing matches.</p>}
      </div>
    </div>,
    document.body,
  );
}

function AddCondition({ meta, onAdd }: { meta: Meta | null; onAdd: (f: string) => void }) {
  const [grp, setGrp] = useState('');
  const items = meta?.library.find((g) => g.group === grp)?.items ?? [];
  return (
    <>
      <select value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="Condition group" className={`${inputCls} pr-8`}>
        <option value="">Add a condition…</option>
        {meta?.library.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
      </select>
      {grp && (
        <select value="" onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setGrp(''); } }} aria-label="Condition" className={`${inputCls} min-w-[240px] pr-8`} autoFocus>
          <option value="">Pick one…</option>
          {items.map((it) => <option key={it.label} value={it.formula}>{it.label}</option>)}
        </select>
      )}
      <button type="button" onClick={() => onAdd('')} className="inline-flex h-10 items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-semibold text-accent-deep hover:bg-accent-soft">
        <Plus size={16} /> Write my own
      </button>
    </>
  );
}

export type { Item };
