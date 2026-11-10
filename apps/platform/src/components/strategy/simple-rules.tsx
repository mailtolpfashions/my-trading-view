'use client';

// The rule builder: each condition is one line that reads as a sentence ("Pivot levels (daily) — price crosses above
// R1"), joined by "all of these" or "any one of these". Conditions are added from a picker grouped by kind, each with a
// plain explanation. The choices and the formulas they make are in lib/simple-rules.ts.

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { CATALOGUE, GROUPS, ROW_TFS, STARTERS, find, fromHHMM, hasOwnTf, rowsFormula, rowsText, toHHMM, type Group, type Mode, type Row } from '@/lib/simple-rules';
import { inputCls } from '../ui';

const small = `${inputCls} num h-9 w-[70px] px-2 text-[13px]`;
const MAIN_WORD: Record<string, string> = { '1m': '1 min', '5m': '5 min', '15m': '15 min', '1h': '1 hour', D: 'daily', W: 'weekly', M: 'monthly' };
const sel = `${inputCls} h-9 pr-8 text-[13px]`;

export function SimpleRules({ rows, mode, onChange, intraday, lead, starters = false, mainTf }: {
  rows: Row[]; mode: Mode; onChange: (rows: Row[], mode: Mode) => void; intraday: boolean; lead: string; starters?: boolean;
  /** The strategy's main timeframe: a condition without its own reads these candles. */
  mainTf?: string;
}) {
  const mainWord = MAIN_WORD[mainTf ?? ''] ?? 'main';
  const [picker, setPicker] = useState(false);
  const items = CATALOGUE.filter((i) => intraday || !i.intraday);
  const set = (n: number, r: Row) => onChange(rows.map((x, i) => (i === n ? r : x)), mode);
  const addItem = (id: string) => { const it = CATALOGUE.find((i) => i.id === id)!; onChange([...rows, { item: it.id, cond: it.conds[0].id, p: {} }], mode); setPicker(false); };

  return (
    <div className="grid gap-2">
      {/* Quick starts for an empty rule */}
      {starters && !rows.length && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] bg-raised px-3 py-2.5">
          <span className="mr-1 text-[12.5px] font-semibold text-ink-2">Quick start:</span>
          {STARTERS.filter((s) => intraday || !s.intraday).map((s) => (
            <button key={s.label} type="button" title={s.about} onClick={() => onChange(s.rows.map((r) => ({ ...r, p: { ...r.p } })), s.mode)}
              className="h-8 rounded-full border border-line-strong bg-panel px-3 text-[12.5px] font-semibold text-ink-2 hover:border-accent hover:text-ink">{s.label}</button>
          ))}
        </div>
      )}

      {rows.length > 1 && (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          {lead}
          <select value={mode} onChange={(e) => onChange(rows, e.target.value as Mode)} aria-label="All or any" className={`${sel} h-8`}>
            <option value="all">all of these</option>
            <option value="any">any one of these</option>
          </select>
          hold:
        </p>
      )}

      {rows.map((r, n) => {
        const { item, cond } = find(r);
        return (
          <div key={n} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-panel px-3 py-2">
            <span className="w-[56px] shrink-0 text-[12.5px] font-semibold text-muted">{n === 0 ? (rows.length > 1 ? '' : lead) : mode === 'any' ? 'or' : 'and'}</span>
            {hasOwnTf(r.item) ? (
              <select aria-label="Timeframe of this condition" value={r.tf ?? ''} onChange={(e) => set(n, { ...r, tf: e.target.value || undefined })}
                title="Read this condition on another timeframe (e.g. a daily trend filter on a 5-minute strategy)"
                className={`${sel} w-[118px] ${r.tf ? 'border-accent font-semibold text-accent-deep' : 'text-ink-2'}`}>
                <option value="">on {mainWord} (main)</option>
                {ROW_TFS.filter(([v]) => v !== mainTf).map(([v, l]) => <option key={v} value={v}>on {l}</option>)}
              </select>
            ) : <span className="w-[118px] shrink-0 text-[11.5px] text-muted" title="This condition reads its own levels (daily pivots, yesterday, the session)">own levels</span>}
            <select aria-label="What to check" value={r.item} title={item.about} onChange={(e) => { const it = CATALOGUE.find((i) => i.id === e.target.value)!; set(n, { item: it.id, cond: it.conds[0].id, p: {} }); }} className={`${sel} font-semibold`}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>{items.filter((i) => i.group === g).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</optgroup>
              ))}
            </select>
            {item.params.map((p) => (
              <label key={p.key} className="flex items-center gap-1 text-[12px] text-muted">{p.label}
                <input type="number" min={1} step="any" value={r.p[p.key] ?? p.def} onChange={(e) => set(n, { ...r, p: { ...r.p, [p.key]: Number(e.target.value) } })} className={small} />
              </label>
            ))}
            <select aria-label="Condition" value={cond.id} onChange={(e) => set(n, { ...r, cond: e.target.value, v: undefined })} className={sel}>
              {item.conds.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {cond.value && (cond.value.time
              ? <input type="time" aria-label="Time" min="09:15" max="15:30" value={toHHMM(r.v ?? cond.value.def)} onChange={(e) => set(n, { ...r, v: fromHHMM(e.target.value) })} className={`${inputCls} num h-9 w-[110px]`} />
              : <label className="flex items-center gap-1 text-[12px] text-muted"><input type="number" step="any" aria-label={cond.value.label} value={r.v ?? cond.value.def} onChange={(e) => set(n, { ...r, v: Number(e.target.value) })} className={small} />{cond.value.label === 'level' ? '' : cond.value.label}</label>)}
            <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== n), mode)} aria-label="Remove this condition" className="ml-auto grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:bg-raised hover:text-down"><X size={15} /></button>
          </div>
        );
      })}

      <div className="relative">
        <button type="button" onClick={() => setPicker((p) => !p)} aria-expanded={picker}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-semibold text-accent-deep hover:bg-accent-soft"><Plus size={15} /> Add a condition</button>
        {picker && <ConditionPicker intraday={intraday} onPick={addItem} onClose={() => setPicker(false)} />}
      </div>

      {rows.length > 0 && (
        <p className="text-[12px] text-muted"><b className="text-ink-2">Reads:</b> {lead.toLowerCase()} {rowsText(rows, mode)}. <span className="font-mono">{rowsFormula(rows, mode).length > 160 ? '' : `(${rowsFormula(rows, mode)})`}</span></p>
      )}
    </div>
  );
}

/** Every condition, grouped by kind, each with a plain explanation. */
function ConditionPicker({ intraday, onPick, onClose }: { intraday: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const [group, setGroup] = useState<Group>('Price action');
  const list = CATALOGUE.filter((i) => i.group === group && (intraday || !i.intraday));
  return (
    <div className="absolute left-0 top-10 z-30 w-[min(560px,90vw)] rounded-[14px] bg-panel p-3 shadow-[var(--shadow-pop)]" role="dialog" aria-label="Add a condition">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {GROUPS.map((g) => (
          <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
            className={`h-8 rounded-full px-3 text-[12.5px] font-semibold ${group === g ? 'bg-inverse text-on-inverse' : 'border border-line-strong text-ink-2 hover:text-ink'}`}>{g}</button>
        ))}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-full p-1 text-muted hover:bg-raised"><X size={15} /></button>
      </div>
      <ul className="grid max-h-[300px] gap-1 overflow-y-auto">
        {list.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onPick(i.id)} className="w-full rounded-[10px] px-3 py-2 text-left hover:bg-raised">
              <span className="block text-[13.5px] font-semibold text-ink">{i.label}</span>
              <span className="block text-[12px] text-muted">{i.about}</span>
            </button>
          </li>
        ))}
        {!list.length && <li className="px-3 py-2 text-[12.5px] text-muted">These need minute candles (intraday).</li>}
      </ul>
    </div>
  );
}
