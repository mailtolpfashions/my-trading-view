'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { LibIndicator, LibInput } from '@/lib/chart/library';

const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];
const field = 'h-9 w-full rounded-[10px] border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-ink';
/** Inputs a settings form can edit; time, session and symbol inputs keep their defaults. */
const editable = (i: LibInput) => ['int', 'float', 'bool', 'string', 'source', 'color'].includes(i.type);

/** Settings for one library indicator, laid out by its Pine `group`s, like TradingView's Inputs tab. */
export function LibSettings({ ind, inputs, onSave, onClose }: { ind: LibIndicator; inputs: Record<string, unknown>; onSave: (inputs: Record<string, unknown>) => void; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, unknown>>(() => Object.fromEntries(ind.inputConfig.map((i) => [i.id, inputs[i.id] ?? i.defval])));
  const set = (id: string, v: unknown) => setVals((s) => ({ ...s, [id]: v }));
  const groups = [...new Set(ind.inputConfig.filter(editable).map((i) => i.group ?? ''))];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${ind.name} settings`}>
      <form className="panel flex max-h-[85dvh] w-full max-w-[440px] flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSave(vals); onClose(); }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="truncate text-[16px] font-extrabold tracking-[-0.02em]">{ind.name}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-raised" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!groups.length && <p className="text-[13px] text-muted">This indicator has no settings.</p>}
          {groups.map((g) => (
            <div key={g || 'main'} className="space-y-2.5">
              {g && <p className="eyebrow">{g}</p>}
              {ind.inputConfig.filter((i) => editable(i) && (i.group ?? '') === g).map((i) => {
                const v = vals[i.id];
                const id = `lib-${ind.id}-${i.id}`;
                const label = i.title ?? i.id;
                if (i.type === 'bool') return (
                  <label key={i.id} htmlFor={id} className="flex items-center gap-2 text-[13px]" title={i.tooltip}>
                    <input id={id} type="checkbox" checked={!!v} onChange={(e) => set(i.id, e.target.checked)} /> {label}
                  </label>
                );
                return (
                  <label key={i.id} htmlFor={id} className="grid grid-cols-[1fr_160px] items-center gap-3 text-[13px]" title={i.tooltip}>
                    <span className="text-ink-2">{label}</span>
                    {i.type === 'source' ? (
                      <select id={id} className={field} value={String(v)} onChange={(e) => set(i.id, e.target.value)}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
                    ) : i.options?.length ? (
                      <select id={id} className={field} value={String(v)} onChange={(e) => set(i.id, e.target.value)}>{i.options.map((o) => <option key={o}>{o}</option>)}</select>
                    ) : i.type === 'color' ? (
                      <input id={id} type="color" className="h-9 w-full rounded-[10px]" value={String(v).slice(0, 7)} onChange={(e) => set(i.id, e.target.value)} />
                    ) : i.type === 'string' ? (
                      <input id={id} className={field} value={String(v ?? '')} onChange={(e) => set(i.id, e.target.value)} />
                    ) : (
                      <input id={id} className={`${field} num`} type="number" value={Number(v)} min={i.min} max={i.max} step={i.step ?? (i.type === 'int' ? 1 : 'any')}
                        onChange={(e) => set(i.id, i.type === 'int' ? Math.round(Number(e.target.value)) : Number(e.target.value))} />
                    )}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={() => setVals(Object.fromEntries(ind.inputConfig.map((i) => [i.id, i.defval])))} className="rounded-full px-4 py-2 text-[13px] font-semibold text-ink-2 hover:bg-raised">Reset to defaults</button>
          <button type="submit" className="rounded-full bg-ink px-5 py-2 text-[13px] font-bold text-white hover:bg-black">Apply</button>
        </div>
      </form>
    </div>
  );
}
