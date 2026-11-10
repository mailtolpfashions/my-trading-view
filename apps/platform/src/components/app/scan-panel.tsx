'use client';

// The Scanner tab of the right-hand panel: the same scans as the Scanner page (ready-made, My scans, and the one open
// on the Scanner page), the same stock lists, run in one click; a result opens its chart.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Play } from 'lucide-react';
import { chartHref } from '@/components/app/shell-context';
import { UniverseSelect } from '@/components/screener/universe-picker';
import { FeedError, feed } from '@/lib/feed';
import { fmt } from '@/lib/format';
import { DEFAULT_COLUMNS, DEFAULT_UNIVERSE, SCAN_DRAFT_KEY, TF_LABEL, type Meta, type Screen, type ScreenResult, type UniverseSpec } from '@/lib/screener';
import { userApi, type SavedScreen, type Watchlist } from '@/lib/user';

const HORIZONS = [['intraday', 'Intraday'], ['swing', 'Swing'], ['positional', 'Positional']] as const;
const field = 'h-9 w-full rounded-[10px] border border-line bg-panel px-2 text-[13px] outline-none focus:border-ink';
type Pick = { name: string; formula: string; tf: Screen['tf']; candle: Screen['candle'] };

/** The last run, kept while the app is open: opening a chart from the results must not empty the panel. */
let memory: { key: string; universe: UniverseSpec; result: ScreenResult | null } | null = null;

export function ScanPanel({ watch, onOpen }: { watch: string[]; onOpen?: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [draft, setDraft] = useState<Screen | null>(null);
  const [key, setKey] = useState(memory?.key ?? 'draft');
  const [universe, setUniverse] = useState<UniverseSpec>(memory?.universe ?? DEFAULT_UNIVERSE);
  const [result, setResult] = useState<ScreenResult | null>(memory?.result ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    feed<Meta>('screener/meta').then(setMeta, (e: Error) => setError(e.message));
    userApi.screens().then(setScreens, () => {});
    userApi.watchlists().then(setWatchlists, () => {});
    try { const d = JSON.parse(localStorage.getItem(SCAN_DRAFT_KEY) ?? 'null') as Screen | null; if (d?.formula) setDraft(d); } catch { /* no draft */ }
  }, []);
  useEffect(() => { memory = { key, universe, result }; }, [key, universe, result]);

  const presets = meta?.presets ?? [];
  const chosen = (): Pick | null => {
    if (key === 'draft') return draft ? { name: draft.name, formula: draft.formula, tf: draft.tf, candle: draft.candle } : null;
    if (key.startsWith('p:')) { const p = presets.find((x) => x.id === key.slice(2)); return p ? { name: p.name, formula: p.formula, tf: p.tf, candle: 'closed' } : null; }
    if (key.startsWith('s:')) { const s = screens.find((x) => x.id === key.slice(2)); return s ? { name: s.name, formula: s.formula, tf: s.tf, candle: s.candle } : null; }
    return null;
  };
  const pick = chosen();
  // With no draft yet, start on the first ready-made scan.
  useEffect(() => { if (key === 'draft' && !draft && presets.length) setKey(`p:${presets[0].id}`); }, [draft, presets, key]);

  const run = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await feed<ScreenResult>('screener/run', { formula: pick.formula, tf: pick.tf, candle: pick.candle, universe, filters: {}, columns: DEFAULT_COLUMNS, name: pick.name }));
      if (list.current) list.current.scrollTop = 0;
    } catch (e) {
      setError(e instanceof FeedError ? e.message : 'The scan could not run');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid gap-2 border-b border-dashed border-line-strong px-3 py-3">
        <select className={field} value={key} onChange={(e) => { setKey(e.target.value); setResult(null); }} aria-label="Which scan">
          {draft && <option value="draft">Current scan: {draft.name}</option>}
          {HORIZONS.map(([h, label]) => presets.some((p) => p.horizon === h) && (
            <optgroup key={h} label={label}>
              {presets.filter((p) => p.horizon === h).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
            </optgroup>
          ))}
          {screens.length > 0 && <optgroup label="My scans">{screens.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>}
        </select>
        <div className="flex gap-2">
          <UniverseSelect universe={universe} filters={{}} meta={meta} watchlists={watchlists} watch={watch} className={`${field} min-w-0 flex-1`}
            onChange={(u) => { setUniverse(u.kind === 'symbols' ? { ...u, symbols: watch } : u); setResult(null); }} />
          <button type="button" onClick={run} disabled={!pick || busy} title={pick ? `Run on ${TF_LABEL[pick.tf] ?? pick.tf} bars` : undefined}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-inverse px-3 text-[13px] font-bold text-on-inverse hover:bg-inverse-hover disabled:opacity-50"><Play size={14} /> {busy ? 'Running' : 'Run'}</button>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          {pick && <span className="truncate">{TF_LABEL[pick.tf] ?? pick.tf} bars</span>}
          <Link href="/scanner" className="ml-auto inline-flex items-center gap-1 font-semibold text-accent-deep hover:underline">Open Scanner <ExternalLink size={11} /></Link>
        </div>
      </div>
      {error && <p className="m-3 rounded-[10px] bg-down-soft px-2.5 py-1.5 text-[12px] text-down">{error}</p>}
      {result && <p className="px-4 pt-2 text-[12px] text-muted"><b className="text-ink">{result.matches}</b> of {result.scanned.toLocaleString('en-IN')} match</p>}
      <ul ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {result?.rows.map((r) => (
          <li key={r.symbol}>
            <Link href={chartHref(r.symbol)} onClick={onOpen} className="flex items-center gap-2 rounded-[10px] px-2 py-2 hover:bg-raised">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{r.symbol}</span>
              <span className="num text-right leading-tight">
                <span className="block text-[13px] font-semibold">{fmt(r.close)}</span>
                <span className={`block text-[11.5px] font-semibold ${r.changePct == null ? 'text-ink-2' : r.changePct >= 0 ? 'text-up' : 'text-down'}`}>{r.changePct == null ? '' : `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(2)}%`}</span>
              </span>
            </Link>
          </li>
        ))}
        {result && !result.rows.length && <li className="px-2 py-6 text-center text-[13px] text-muted">No stock matches right now.</li>}
        {!result && !error && <li className="px-2 py-6 text-center text-[13px] text-muted">Pick a scan and press Run.</li>}
      </ul>
    </div>
  );
}
