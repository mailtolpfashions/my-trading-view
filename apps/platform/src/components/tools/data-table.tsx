'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { downloadCsv } from '@/lib/fno';

export type Column<T> = {
  key: string;
  label: string;
  /** Cell content. */
  render: (row: T) => React.ReactNode;
  /** Value for sorting and CSV; omit for a column that doesn't sort. */
  value?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  className?: (row: T) => string;
  title?: string;
  /** Hide below the sm breakpoint. */
  wide?: boolean;
};

/** A table with a sticky header, click-to-sort columns and a CSV download. */
export function DataTable<T>({ rows, columns, rowKey, csvName, initialSort, maxHeight = '70dvh', empty }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; csvName?: string; initialSort?: { key: string; desc: boolean }; maxHeight?: string; empty?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const v = col.value;
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // blanks last either way
      if (y == null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort!.desc ? -c : c;
    });
  }, [rows, columns, sort]);

  return (
    <div className="flex min-h-0 flex-col">
      {csvName && (
        <div className="flex justify-end border-b border-line px-3 py-1.5">
          <button type="button" className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"
            onClick={() => downloadCsv(csvName, columns.filter((c) => c.value).map((c) => c.label), sorted.map((r) => columns.filter((c) => c.value).map((c) => c.value!(r))))}>
            <Download size={14} /> CSV
          </button>
        </div>
      )}
      <div className="min-h-0 overflow-auto" style={{ maxHeight }}>
        <table className="num w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-panel text-[10.5px] text-muted shadow-[0_1px_0_var(--color-line)]">
            <tr>
              {columns.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} title={c.title} className={`px-2 py-2 font-semibold whitespace-nowrap first:pl-3 last:pr-3 ${c.align === 'left' ? 'text-left' : 'text-right'} ${c.wide ? 'hidden sm:table-cell' : ''}`}
                    aria-sort={on ? (sort!.desc ? 'descending' : 'ascending') : undefined}>
                    {c.value ? (
                      <button type="button" className={`inline-flex items-center gap-0.5 hover:text-ink ${on ? 'text-ink' : ''}`}
                        onClick={() => setSort(on ? { key: c.key, desc: !sort!.desc } : { key: c.key, desc: c.align !== 'left' })}>
                        {c.label}{on && (sort!.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={rowKey(r)} className="border-t border-line hover:bg-raised/60">
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 whitespace-nowrap first:pl-3 last:pr-3 ${c.align === 'left' ? 'text-left font-sans' : 'text-right'} ${c.wide ? 'hidden sm:table-cell' : ''} ${c.className?.(r) ?? ''}`}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-[13px] text-muted">{empty ?? 'No rows.'}</p>}
      </div>
    </div>
  );
}
