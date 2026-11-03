'use client';

import { useEffect, useRef, useState } from 'react';
import { Eraser, Redo2, Undo2 } from 'lucide-react';
import type { Tf } from '@mtv/rules';
import { fromTree, group, toTree, type Group } from '@/lib/builder';
import type { Meta } from '@/lib/screener';
import { Button, Segmented } from '../ui';
import { FormulaEditor } from './formula-editor';
import { TreeBuilder } from './tree-builder';

/**
 * A condition edited either visually (groups of conditions) or as a formula, with undo / redo. `value` is the
 * formula; a new value from outside (a template, a saved strategy) replaces the tree and its history.
 */
export function ConditionEditor({ value, onChange, meta, screenTf, emptyText, rootLabel }: { value: string; onChange: (f: string) => void; meta: Meta | null; screenTf: Tf; emptyText?: string; rootLabel?: string }) {
  const [view, setView] = useState<'builder' | 'formula'>(() => (toTree(value) ? 'builder' : 'formula'));
  const [tree, setTree] = useState<Group>(() => toTree(value) ?? group());
  const [hist, setHist] = useState<{ past: Group[]; future: Group[] }>({ past: [], future: [] });
  const sent = useRef(value);
  const lastEdit = useRef<{ key?: string; at: number }>({ at: 0 });

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    const t = toTree(value);
    setTree(t ?? group());
    if (!t) setView('formula');
    setHist({ past: [], future: [] });
  }, [value]);

  const emit = (f: string) => { sent.current = f; onChange(f); };
  const commit = (next: Group, key?: string) => {
    const now = Date.now();
    const merge = key && key === lastEdit.current.key && now - lastEdit.current.at < 1500;
    lastEdit.current = { key, at: now };
    if (!merge) setHist((h) => ({ past: [...h.past, tree].slice(-100), future: [] }));
    setTree(next);
    emit(fromTree(next));
  };
  const step = (dir: 'undo' | 'redo') => {
    const from = dir === 'undo' ? hist.past : hist.future;
    if (!from.length) return;
    const target = dir === 'undo' ? from[from.length - 1] : from[0];
    setHist(dir === 'undo' ? { past: hist.past.slice(0, -1), future: [tree, ...hist.future] } : { past: [...hist.past, tree], future: hist.future.slice(1) });
    setTree(target);
    emit(fromTree(target));
    lastEdit.current = { at: 0 };
  };
  const switchView = (v: 'builder' | 'formula') => {
    if (v === 'builder') {
      const t = toTree(value);
      if (!t) return;
      setTree(t);
    }
    setView(v);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Editor" value={view} onChange={switchView} options={[{ value: 'builder', label: 'Builder' }, { value: 'formula', label: 'Formula' }]} />
        {view === 'builder' && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" className="h-9 px-2.5" onClick={() => step('undo')} disabled={!hist.past.length} aria-label="Undo" title="Undo"><Undo2 size={16} /></Button>
            <Button variant="ghost" className="h-9 px-2.5" onClick={() => step('redo')} disabled={!hist.future.length} aria-label="Redo" title="Redo"><Redo2 size={16} /></Button>
            <Button variant="ghost" className="h-9 px-2.5" onClick={() => commit(group())} disabled={!tree.children.length} title="Remove every condition"><Eraser size={16} /> Clear all</Button>
          </div>
        )}
      </div>
      {view === 'builder'
        ? <TreeBuilder root={tree} meta={meta} screenTf={screenTf} onChange={commit} rootLabel={rootLabel} />
        : <FormulaEditor value={value} onChange={emit} meta={meta} />}
      {emptyText && !value.trim() && <p className="text-[12.5px] text-muted">{emptyText}</p>}
    </div>
  );
}
