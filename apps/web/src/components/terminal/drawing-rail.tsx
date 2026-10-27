'use client';

import { useEffect, useState } from 'react';
import { BellPlus, Minus, MousePointer2, MoveUpRight, Ruler, Slash, Square, SeparatorVertical, Trash2, Type } from 'lucide-react';
import type { Tool } from '@/lib/chart/drawings/model';

const TOOLS: { tool: Tool; label: string; key: string; Icon: typeof Slash }[] = [
  { tool: 'cursor', label: 'Select and move', key: 'V', Icon: MousePointer2 },
  { tool: 'trend', label: 'Trend line', key: 'T', Icon: Slash },
  { tool: 'ray', label: 'Ray', key: 'R', Icon: MoveUpRight },
  { tool: 'hline', label: 'Horizontal line', key: 'H', Icon: Minus },
  { tool: 'vline', label: 'Vertical line', key: 'L', Icon: SeparatorVertical },
  { tool: 'rect', label: 'Rectangle (zone)', key: 'B', Icon: Square },
  { tool: 'text', label: 'Text note', key: 'N', Icon: Type },
  { tool: 'measure', label: 'Measure (price, %, bars, time)', key: 'M', Icon: Ruler },
  { tool: 'alert', label: 'Alert at a price: click the chart', key: 'A', Icon: BellPlus },
];

/** Drawing tools down the left edge of the chart. Single-letter shortcuts, like TradingView's Alt shortcuts. */
export function DrawingRail({ tool, onTool, count, onClearAll }: { tool: Tool; onTool: (t: Tool) => void; count: number; onClearAll: () => void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (!e.altKey || el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
      if (t) { e.preventDefault(); onTool(t.tool); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTool]);

  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r border-line py-1.5" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {TOOLS.map(({ tool: t, label, key, Icon }) => (
        <button key={t} type="button" onClick={() => onTool(t)} aria-pressed={tool === t} title={`${label} (Alt+${key})`} aria-label={label}
          className={`grid h-8 w-8 place-items-center rounded-[8px] ${tool === t ? 'bg-ink text-white' : 'text-ink-2 hover:bg-raised'}`}>
          <Icon size={16} />
        </button>
      ))}
      <span className="my-1 h-px w-6 bg-line" />
      <button type="button" disabled={!count} onClick={() => (confirm ? (onClearAll(), setConfirm(false)) : setConfirm(true))}
        title={confirm ? 'Click again to remove every drawing on this symbol' : 'Remove all drawings'} aria-label="Remove all drawings"
        className={`grid h-8 w-8 place-items-center rounded-[8px] disabled:opacity-30 ${confirm ? 'bg-down text-white' : 'text-ink-2 hover:bg-down-soft hover:text-down'}`}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}
