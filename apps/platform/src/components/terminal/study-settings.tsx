'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { studyById, studyParams, studyValues, type StudyValues } from '@/lib/chart/studies';

const field = 'h-9 w-full rounded-[10px] border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-ink';

/** Settings for one quick indicator (RSI length and levels, pivot type…), like TradingView's Inputs tab. */
export function StudySettings({ id, saved, onSave, onClose }: { id: string; saved?: StudyValues; onSave: (v: StudyValues) => void; onClose: () => void }) {
  const params = studyParams(id);
  const [vals, setVals] = useState<StudyValues>(() => studyValues(id, saved));
  const name = studyById(id, vals)?.name ?? id;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${name} settings`}>
      <form className="panel flex max-h-[85dvh] w-full max-w-[400px] flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSave(studyValues(id, vals)); onClose(); }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="truncate text-[16px] font-extrabold tracking-[-0.02em]">{name}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-raised" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {params.map((p) => (
            <label key={p.key} className="grid grid-cols-[1fr_150px] items-center gap-3 text-[13px]">
              <span className="text-ink-2">{p.label}</span>
              {p.options ? (
                <select className={field} value={String(vals[p.key])} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })}>
                  {p.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input className={`${field} num`} type="number" value={Number(vals[p.key])} min={p.min} max={p.max} step={p.step ?? 1}
                  onChange={(e) => setVals({ ...vals, [p.key]: e.target.value === '' ? p.def : Number(e.target.value) })} />
              )}
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={() => setVals(studyValues(id))} className="rounded-full px-4 py-2 text-[13px] font-semibold text-ink-2 hover:bg-raised">Reset to defaults</button>
          <button type="submit" className="rounded-full bg-inverse px-5 py-2 text-[13px] font-bold text-on-inverse hover:bg-inverse-hover">Apply</button>
        </div>
      </form>
    </div>
  );
}
