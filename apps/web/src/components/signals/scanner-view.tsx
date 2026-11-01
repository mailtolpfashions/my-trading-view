'use client';

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { RuleSet } from '@mtv/backtest';
import { Rules } from '@/components/backtest/strategy-builder';
import { fmt } from '@/lib/format';
import { SCAN_PRESETS, runScanApi, valueLabel, type ScanResult } from '@/lib/signals';

const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const pctCell = (n: number | null) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`);
const cr = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(1));

/**
 * The last scan per layout, kept for this browser session: opening a stock from the results loads a new chart page,
 * and coming back must show the same results at the same scroll position instead of an empty scanner.
 */
const memory: Partial<Record<'compact' | 'full', { presetId: string; rules: RuleSet; result: ScanResult | null; scrollTop: number }>> = {};

/** Market scanner over every NSE stock at the latest official close. `compact` is the chart side-panel version; `active` is the symbol on screen. */
export function ScannerView({ compact, active, onOpenChart }: { compact?: boolean; active?: string; onOpenChart: (symbol: string) => void }) {
  const mode = compact ? 'compact' : 'full';
  const saved = memory[mode];
  const [presetId, setPresetId] = useState(saved?.presetId ?? SCAN_PRESETS[0].id);
  const [rules, setRules] = useState<RuleSet>(saved?.rules ?? SCAN_PRESETS[0].rules);
  const [result, setResult] = useState<ScanResult | null>(saved?.result ?? null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { memory[mode] = { presetId, rules, result, scrollTop: memory[mode]?.scrollTop ?? 0 }; }, [mode, presetId, rules, result]);
  // Restore the list position once, after the saved results render.
  useEffect(() => { if (list.current && saved) list.current.scrollTop = saved.scrollTop; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keepScroll = () => { const m = memory[mode]; if (m && list.current) m.scrollTop = list.current.scrollTop; };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setPresetId(id);
    const p = SCAN_PRESETS.find((x) => x.id === id);
    if (p) setRules(structuredClone(p.rules));
  };
  const run = async (r = rules) => {
    setBusy(true);
    setError(null);
    try { setResult(await runScanApi(r)); if (list.current) list.current.scrollTop = 0; } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const valueKeys = result ? [...new Set(result.rows.flatMap((r) => Object.keys(r.values)))].filter((k) => !['close', 'volume', 'CHANGE_PCT()'].includes(k)) : [];
  const summary = result && (
    <div className="space-y-1">
      {!result.complete && (
        <p role="alert" className="rounded-[10px] bg-accent-soft px-2.5 py-1.5 text-[12px] font-semibold text-accent-ink">
          NSE history is still downloading, so indicators that need long history (e.g. 52-week highs, 200-day averages) can&rsquo;t be computed yet. These results are incomplete.
        </p>
      )}
      <p className="text-[12px] text-muted">
        {result.matches} of {result.scanned.toLocaleString('en-IN')} NSE stocks · close of {day(result.date)}{result.matches > result.rows.length ? ` · showing the ${result.rows.length} most traded` : ''}
      </p>
    </div>
  );
  const select = (
    <select className="h-9 w-full rounded-[10px] border border-line bg-panel px-2 text-[13px] outline-none focus:border-ink" value={presetId} aria-label="Scan"
      onChange={(e) => { pick(e.target.value); if (compact) void run(SCAN_PRESETS.find((x) => x.id === e.target.value)!.rules); }}>
      {SCAN_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      {!compact && <option value="custom">Custom rules</option>}
    </select>
  );

  if (compact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5">
        <div className="flex gap-1.5">
          {select}
          <button type="button" onClick={() => run()} disabled={busy} className="flex h-9 items-center gap-1 rounded-full bg-inverse px-3 text-[12.5px] font-bold text-on-inverse disabled:opacity-50"><Play size={13} />{busy ? '…' : 'Scan'}</button>
        </div>
        <div className="mt-1.5 px-1">{error ? <p className="text-[12px] font-semibold text-down">{error}</p> : summary}</div>
        <div ref={list} onScroll={keepScroll} className="mt-1 min-h-0 flex-1 overflow-y-auto">
          {!result && !busy && <p className="px-2 py-4 text-center text-[12.5px] text-muted">Choose a scan to run it on the latest NSE close.</p>}
          {result?.rows.map((r) => (
            <button key={r.symbol} type="button" onClick={() => onOpenChart(r.symbol)} aria-current={r.symbol === active ? 'true' : undefined}
              className={`num flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12.5px] ${r.symbol === active ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
              <span className="font-sans font-bold">{r.symbol}</span>
              <span className="ml-auto">{fmt(r.close)}</span>
              <span className={`w-16 text-right ${r.changePct != null && r.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pctCell(r.changePct)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[360px_1fr]">
      <section className="panel min-h-0 space-y-3 overflow-y-auto p-4">
        <div>
          <p className="eyebrow">Scanner</p>
          <p className="mt-0.5 text-[12px] text-muted">Every NSE stock, on NSE&rsquo;s official end-of-day data, adjusted for splits and bonuses.</p>
        </div>
        {select}
        <Rules title="Conditions" rules={rules} onChange={(r) => { setRules(r); setPresetId('custom'); }} />
        <button type="button" onClick={() => run()} disabled={busy} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-inverse font-bold text-on-inverse disabled:opacity-50">
          <Play size={15} /> {busy ? 'Scanning…' : 'Run scan'}
        </button>
        {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] font-semibold text-down">{error}</p>}
        <p className="text-[11.5px] text-muted">Scan results are not a recommendation to buy or sell.</p>
      </section>
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-line px-4 py-3">{summary ?? <p className="text-[13px] text-muted">Run a scan to see matching stocks.</p>}</div>
        <div ref={list} onScroll={keepScroll} className="max-lg:max-h-[75dvh] min-h-0 flex-1 overflow-auto">
          {result && (
            <table className="num w-full text-[12.5px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-left text-[11.5px] text-muted">
                  <th className="px-3 py-2 font-semibold sm:px-4">Stock</th><th className="text-right font-semibold">Close</th><th className="text-right font-semibold">Change</th>
                  <th className="hidden text-right font-semibold md:table-cell">Volume</th><th className="pr-3 text-right font-semibold">Value (₹ cr)</th>
                  {valueKeys.map((k) => <th key={k} className="hidden max-w-[160px] px-2 text-right font-semibold first-letter:uppercase md:table-cell">{valueLabel(k)}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.symbol} className="border-t border-line hover:bg-raised">
                    <td className="px-3 py-1.5 sm:px-4"><button type="button" className="font-sans font-bold hover:underline" onClick={() => onOpenChart(r.symbol)}>{r.symbol}</button></td>
                    <td className="text-right">{fmt(r.close)}</td>
                    <td className={`text-right ${r.changePct != null && r.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pctCell(r.changePct)}</td>
                    <td className="hidden text-right md:table-cell">{r.volume.toLocaleString('en-IN')}</td>
                    <td className="pr-3 text-right">{cr(r.valueCr)}</td>
                    {valueKeys.map((k) => <td key={k} className="hidden px-2 text-right md:table-cell">{r.values[k] == null ? '—' : k.startsWith('VOL_SMA') ? Math.round(r.values[k]!).toLocaleString('en-IN') : fmt(r.values[k]!)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
