'use client';

// The simple rule rows on screen; the choices and the formula they make are in lib/simple-rules.ts.

import { Plus, X } from 'lucide-react';
import { CATALOGUE, find, fromHHMM, toHHMM, type Row } from '@/lib/simple-rules';
import { inputCls } from '../ui';

const small = `${inputCls} num h-9 w-[76px] px-2`;

export function SimpleRules({ rows, onChange, intraday, lead }: { rows: Row[]; onChange: (rows: Row[]) => void; intraday: boolean; lead: string }) {
  const items = CATALOGUE.filter((i) => intraday || !i.intraday);
  const set = (n: number, r: Row) => onChange(rows.map((x, i) => (i === n ? r : x)));
  const add = () => onChange([...rows, { item: 'supertrend', cond: 'bull', p: {} }]);
  return (
    <div className="grid gap-3">
      {rows.map((r, n) => {
        const { item, cond } = find(r);
        return (
          <div key={n} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel px-3 py-2.5">
            <span className="w-[72px] shrink-0 text-[13px] font-semibold text-muted">{n === 0 ? lead : 'and'}</span>
            <select aria-label="Indicator" value={r.item} onChange={(e) => { const it = CATALOGUE.find((i) => i.id === e.target.value)!; set(n, { item: it.id, cond: it.conds[0].id, p: {} }); }} className={`${inputCls} h-9 pr-8`}>
              {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
            {item.params.map((p) => (
              <label key={p.key} className="flex items-center gap-1 text-[12px] text-muted">{p.label}
                <input type="number" min={1} step="any" value={r.p[p.key] ?? p.def} onChange={(e) => set(n, { ...r, p: { ...r.p, [p.key]: Number(e.target.value) } })} className={small} />
              </label>
            ))}
            <select aria-label="Condition" value={cond.id} onChange={(e) => set(n, { ...r, cond: e.target.value, v: undefined })} className={`${inputCls} h-9 pr-8`}>
              {item.conds.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {cond.value && (cond.value.time
              ? <input type="time" aria-label="Time" min="09:15" max="15:30" value={toHHMM(r.v ?? cond.value.def)} onChange={(e) => set(n, { ...r, v: fromHHMM(e.target.value) })} className={`${inputCls} num h-9 w-[120px]`} />
              : <label className="flex items-center gap-1 text-[12px] text-muted"><input type="number" step="any" aria-label={cond.value.label} value={r.v ?? cond.value.def} onChange={(e) => set(n, { ...r, v: Number(e.target.value) })} className={small} />{cond.value.label === 'level' ? '' : cond.value.label}</label>)}
            <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== n))} aria-label="Remove this condition" className="ml-auto grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:bg-raised hover:text-down"><X size={15} /></button>
          </div>
        );
      })}
      <button type="button" onClick={add} className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-[10px] px-3 text-[13.5px] font-semibold text-accent-deep hover:bg-accent-soft"><Plus size={15} /> Add a condition</button>
    </div>
  );
}
