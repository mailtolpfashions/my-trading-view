'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import type { RuleSet } from '@mtv/backtest';
import { Rules } from '@/components/backtest/strategy-builder';
import { fmt } from '@/lib/format';
import { SCAN_PRESETS, runScanApi, valueLabel, type ScanResult } from '@/lib/signals';

const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const pctCell = (n: number | null) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`);
const cr = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(1));

/** Market scanner over every NSE stock at the latest official close. `compact` is the terminal side-panel version. */
export function ScannerView({ compact, onOpenChart }: { compact?: boolean; onOpenChart: (symbol: string) => void }) {
  const [presetId, setPresetId] = useState(SCAN_PRESETS[0].id);
  const [rules, setRules] = useState<RuleSet>(SCAN_PRESETS[0].rules);
  const [result, setResult] = useState<ScanResult | null>(null);
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
    try { setResult(await runScanApi(r)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
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
          <button type="button" onClick={() => run()} disabled={busy} className="flex h-9 items-center gap-1 rounded-full bg-ink px-3 text-[12.5px] font-bold text-white disabled:opacity-50"><Play size={13} />{busy ? '…' : 'Scan'}</button>
        </div>
        <div className="mt-1.5 px-1">{error ? <p className="text-[12px] font-semibold text-down">{error}</p> : summary}</div>
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
          {!result && !busy && <p className="px-2 py-4 text-center text-[12.5px] text-muted">Pick a scan to run it on NSE&rsquo;s latest official close.</p>}
          {result?.rows.map((r) => (
            <button key={r.symbol} type="button" onClick={() => onOpenChart(r.symbol)} className="num flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12.5px] hover:bg-raised">
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
    <main className="grid min-h-0 grid-cols-[360px_1fr] gap-2">
      <section className="panel min-h-0 space-y-3 overflow-y-auto p-4">
        <div>
          <p className="eyebrow">Scanner</p>
          <p className="mt-0.5 text-[12px] text-muted">Every NSE stock, on NSE&rsquo;s official end-of-day data, adjusted for splits and bonuses.</p>
        </div>
        {select}
        <Rules title="Conditions" rules={rules} onChange={(r) => { setRules(r); setPresetId('custom'); }} />
        <button type="button" onClick={() => run()} disabled={busy} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-ink font-bold text-white disabled:opacity-50">
          <Play size={15} /> {busy ? 'Scanning…' : 'Run scan'}
        </button>
        {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] font-semibold text-down">{error}</p>}
        <p className="text-[11.5px] text-muted">Results are research starting points, not recommendations. Not SEBI-registered advice.</p>
      </section>
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-line px-4 py-3">{summary ?? <p className="text-[13px] text-muted">Run a scan to see matching stocks.</p>}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          {result && (
            <table className="num w-full text-[12.5px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-left text-[11.5px] text-muted">
                  <th className="px-4 py-2 font-semibold">Stock</th><th className="text-right font-semibold">Close</th><th className="text-right font-semibold">Change</th>
                  <th className="text-right font-semibold">Volume</th><th className="text-right font-semibold">Traded value (₹ cr)</th>
                  {valueKeys.map((k) => <th key={k} className="max-w-[160px] px-2 text-right font-semibold">{valueLabel(k)}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.symbol} className="border-t border-line hover:bg-raised">
                    <td className="px-4 py-1.5"><button type="button" className="font-sans font-bold hover:underline" onClick={() => onOpenChart(r.symbol)}>{r.symbol}</button></td>
                    <td className="text-right">{fmt(r.close)}</td>
                    <td className={`text-right ${r.changePct != null && r.changePct >= 0 ? 'text-up' : 'text-down'}`}>{pctCell(r.changePct)}</td>
                    <td className="text-right">{r.volume.toLocaleString('en-IN')}</td>
                    <td className="text-right">{cr(r.valueCr)}</td>
                    {valueKeys.map((k) => <td key={k} className="px-2 text-right">{r.values[k] == null ? '—' : fmt(r.values[k]!)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
