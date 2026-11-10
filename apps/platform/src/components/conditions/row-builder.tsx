'use client';

// The basic condition builder: one row per condition, every part a dropdown, so anyone can read and change it.
//   [time] [indicator] [compare] [time] [indicator or Number] [× n]   [AND / OR / NOT]  on/off  ↑ ↓ ✕

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { AGOS, IND_GROUPS, INDICATORS, OPS, agoLabel, canGoBack, ROW_EXAMPLES, TFS, formulaToRows, indKey, newRow, rowsToFormula, type CondRow, type Operand } from '@/lib/rows';

const SEL = 'h-10 cursor-pointer rounded-[10px] border border-line-strong bg-panel pl-2.5 pr-7 text-[13.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40';
const TF_WORD: Record<string, string> = { '1m': '1 min', '3m': '3 min', '5m': '5 min', '15m': '15 min', '30m': '30 min', '1h': '1 hour', D: 'Daily', W: 'Weekly', M: 'Monthly' };


/** "× n": any positive number (2 = twice the average volume, 0.98 = within 2% below). Typing stays free; a blank or 0 is not sent. */
function MultInput({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={`${SEL} flex w-[86px] cursor-text items-center gap-1 pr-2`} title="Times the second value: 2 = twice it, 0.98 = 2% below it">
      <span className="text-muted">×</span>
      <input type="number" step="any" min="0" value={text} aria-label="Times the second value"
        onChange={(e) => { setText(e.target.value); const m = Number(e.target.value); if (e.target.value !== '' && m > 0) onChange(m); }}
        onBlur={() => { if (!(Number(text) > 0)) { setText('1'); onChange(1); } }}
        className="num w-full min-w-0 bg-transparent focus:outline-none" />
    </label>
  );
}

/**
 * Rows for `formula`; edits come back as a formula. Switched-off rows stay while editing (they are not in the formula,
 * so they are not saved). `mainTf` names the main timeframe in the time dropdowns.
 */
export function RowBuilder({ formula, onChange, mainTf, intraday, examples = false }: { formula: string; onChange: (f: string) => void; mainTf: string; intraday: boolean; examples?: boolean }) {
  const [rows, setRows] = useState<CondRow[]>(() => formulaToRows(formula) ?? []);
  const sent = useRef(formula);
  // A formula from outside (a template, Magic filters, undo) replaces the rows.
  useEffect(() => {
    if (formula === sent.current) return;
    sent.current = formula;
    const r = formulaToRows(formula);
    if (r) setRows(r);
  }, [formula]);
  const commit = (next: CondRow[]) => { setRows(next); const f = rowsToFormula(next); sent.current = f; onChange(f); };
  const set = (i: number, patch: Partial<CondRow>) => commit(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; commit(n); };
  const main = TF_WORD[mainTf] ?? 'main';

  const tfSelect = (o: Operand, on: (tf: string) => void, label: string) => (
    <select value={o.ind === 'num' ? '' : o.tf} disabled={o.ind === 'num'} onChange={(e) => on(e.target.value)} aria-label={label} className={`${SEL} w-[118px]`}>
      <option value="">{o.ind === 'num' ? '—' : `${main} (main)`}</option>
      {TFS.filter(([v]) => v !== mainTf && (intraday || !/m$|h$/.test(v))).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const indSelect = (o: Operand, on: (o: Operand) => void, label: string, allowNumber: boolean) => {
    const key = indKey(o);
    const known = INDICATORS.some((i) => i.presets.some((p) => `${i.id}:${p.join(',')}` === key));
    return (
      <select value={key} aria-label={label} className={`${SEL} min-w-[150px] font-semibold`}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'num') return on({ tf: '', ind: 'num', p: [], num: o.num ?? 50 });
          const [id, ps] = v.split(':');
          const next: Operand = { tf: o.ind === 'num' ? '' : o.tf, ind: id, p: ps ? ps.split(',').map(Number) : [], mult: o.mult };
          if (o.ago && canGoBack(next)) next.ago = o.ago;
          on(next);
        }}>
        {allowNumber && <option value="num">Number</option>}
        {!known && o.ind !== 'num' && <option value={key}>{INDICATORS.find((i) => i.id === o.ind)?.label(o.p) ?? key}</option>}
        {IND_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {INDICATORS.filter((i) => i.group === g && (intraday || !i.intraday)).flatMap((i) => i.presets.map((p) => <option key={`${i.id}:${p.join(',')}`} value={`${i.id}:${p.join(',')}`}>{i.label(p)}</option>))}
          </optgroup>
        ))}
      </select>
    );
  };

  const agoSelect = (o: Operand, on: (o: Operand) => void, label: string) => {
    if (!canGoBack(o)) return null;
    const ago = o.ago ?? 0;
    return (
      <select value={ago} onChange={(e) => on({ ...o, ago: Number(e.target.value) || undefined })} aria-label={label}
        title="The value now, or as it was some candles back (e.g. RSI 1 candle ago was below 30)" className={`${SEL} w-[124px] ${ago ? 'border-accent text-accent-deep' : 'text-ink-2'}`}>
        {(AGOS.includes(ago) ? AGOS : [...AGOS, ago]).map((n) => <option key={n} value={n}>{agoLabel(n)}</option>)}
      </select>
    );
  };

  return (
    <div className="grid gap-2">
      <p className="text-[12.5px] text-muted">Each row compares two values. The dropdown after a row says how the next row joins: <b>AND</b> (both must be true), <b>OR</b> (either one), <b>NOT</b> (and the next one must not be true).</p>
      {rows.map((r, i) => (
        <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel p-2 ${r.on ? '' : 'opacity-45'}`}>
          <span className="num w-5 shrink-0 text-center text-[12.5px] font-bold text-muted">{i + 1}</span>
          {tfSelect(r.left, (tf) => set(i, { left: { ...r.left, tf } }), 'Time of the first value')}
          {indSelect(r.left, (left) => set(i, { left }), 'First value', false)}
          {agoSelect(r.left, (left) => set(i, { left }), 'When: first value')}
          <select value={r.op} onChange={(e) => set(i, { op: e.target.value as CondRow['op'] })} aria-label="Compare" className={`${SEL} w-[150px] border-accent/50 bg-accent-soft font-bold text-accent-deep`}>
            {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {tfSelect(r.right, (tf) => set(i, { right: { ...r.right, tf } }), 'Time of the second value')}
          {indSelect(r.right, (right) => set(i, { right }), 'Second value', true)}
          {agoSelect(r.right, (right) => set(i, { right }), 'When: second value')}
          {r.right.ind === 'num'
            ? <input type="number" step="any" value={r.right.num ?? 0} onChange={(e) => set(i, { right: { ...r.right, num: Number(e.target.value) } })} aria-label="Number" className={`${SEL} num w-[90px] pr-2`} />
            : <MultInput value={r.right.mult ?? 1} onChange={(m) => set(i, { right: { ...r.right, mult: m === 1 ? undefined : m } })} />}
          {i < rows.length - 1
            ? (
              <select value={r.join} onChange={(e) => set(i, { join: e.target.value as CondRow['join'] })} aria-label="How the next row joins" className={`${SEL} w-[86px] font-bold ${r.join === 'AND' ? '' : 'border-accent text-accent-deep'}`}>
                <option value="AND">AND</option><option value="OR">OR</option><option value="NOT">NOT</option>
              </select>
            ) : <span className="w-[86px] shrink-0" />}
          <span className="ml-auto flex items-center gap-0.5">
            <button type="button" role="switch" aria-checked={r.on} onClick={() => set(i, { on: !r.on })} title={r.on ? 'On: click to switch off without deleting' : 'Off: not used. Click to switch on'}
              className={`relative mx-1 h-6 w-11 shrink-0 rounded-full transition-colors ${r.on ? 'bg-up' : 'bg-line-strong'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.on ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="grid h-9 w-9 place-items-center rounded-[8px] text-ink-2 hover:bg-raised disabled:opacity-30"><ArrowUp size={16} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="grid h-9 w-9 place-items-center rounded-[8px] text-ink-2 hover:bg-raised disabled:opacity-30"><ArrowDown size={16} /></button>
            <button type="button" onClick={() => commit(rows.filter((_, k) => k !== i))} aria-label="Delete this row" className="grid h-9 w-9 place-items-center rounded-[8px] text-ink-2 hover:bg-down-soft hover:text-down"><X size={17} /></button>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => commit([...rows, newRow()])} className="inline-flex h-10 items-center gap-1.5 rounded-[12px] bg-inverse px-4 text-[14px] font-bold text-on-inverse hover:bg-inverse-hover"><Plus size={16} /> Add condition</button>
        {examples && (
          <select value="" onChange={(e) => { const x = ROW_EXAMPLES.find((y) => y.label === e.target.value); if (x) { const r = formulaToRows(x.formula); if (r) commit(r); } }} aria-label="Start from an example" className={`${SEL} text-ink-2`}>
            <option value="">Start from an example…</option>
            {ROW_EXAMPLES.filter((x) => intraday || !x.intraday).map((x) => <option key={x.label} value={x.label}>{x.label}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
