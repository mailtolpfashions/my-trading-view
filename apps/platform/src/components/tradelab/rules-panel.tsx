'use client';

// Trade lab's automatic rules: each rule (scan + stocks + what to trade), switched on or off, with its own record,
// an editor for new and changed rules, and the decision log (every check, trade and skip, with its reason).

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useShell } from '@/components/app/shell-context';
import { feed } from '@/lib/feed';
import { DEFAULT_UNIVERSE, SCAN_DRAFT_KEY, TF_LABEL, type Meta, type Screen } from '@/lib/screener';
import { autoApi, signedInr, type AutoEvent, type AutoRule, type RuleResult } from '@/lib/tradelab';
import { userApi, type SavedScreen, type Watchlist } from '@/lib/user';
import { confirmDialog } from '../dialog';
import { InfoTip } from '../info-tip';
import { UniverseSelect } from '../screener/universe-picker';
import { Button, Card, Segmented, inputCls } from '../ui';

const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const clock = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(11, 16);
const PCTS = [0.5, 1, 2, 3, 5, 10, 20, 30, 50];
const SEL = `${inputCls} h-9 pr-7 text-[13px]`;

/** A rule in plain words. */
export function ruleSentence(r: AutoRule) {
  const what = r.instrument === 'STOCK' ? (r.direction === 'BULLISH' ? 'buy the stock' : 'sell the stock short')
    : r.instrument === 'FUTURE' ? (r.direction === 'BULLISH' ? 'buy its future' : 'sell its future')
      : `buy a ${r.direction === 'BULLISH' ? 'call' : 'put'} ${r.optionStrikes === 0 ? 'at the money' : `${Math.abs(r.optionStrikes)} strike${Math.abs(r.optionStrikes) > 1 ? 's' : ''} ${r.optionStrikes > 0 ? 'out of' : 'in'} the money`}`;
  const u = r.universe.kind === 'index' ? r.universe.name : r.universe.kind === 'symbols' ? (r.universe.label ?? 'my list') : 'a watchlist';
  return `When ${r.scan.name} (${TF_LABEL[r.scan.tf] ?? r.scan.tf}) matches a ${u} stock: ${what}, ${r.size} ${r.instrument === 'STOCK' ? 'shares' : `lot${r.size > 1 ? 's' : ''}`}, ${r.product === 'MIS' ? 'intraday' : r.product === 'CNC' ? 'delivery' : 'overnight'}${r.stopPct ? `, stop ${r.stopPct}%` : ''}${r.targetPct ? `, target ${r.targetPct}%` : ''}; at most ${r.maxTradesPerDay} a day, ${r.maxOpen} open.`;
}

export function RulesPanel() {
  const { notify } = useShell();
  const [data, setData] = useState<{ rules: AutoRule[]; results: Record<string, RuleResult> } | null>(null);
  const [log, setLog] = useState<AutoEvent[]>([]);
  const [editing, setEditing] = useState<Partial<AutoRule> | null>(null);
  const [onlyTrades, setOnlyTrades] = useState(false);
  const load = useCallback(() => {
    autoApi.rules().then(setData, () => {});
    autoApi.log().then((l) => setLog(l.events), () => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const toggle = (r: AutoRule) => autoApi.save({ ...r, enabled: !r.enabled }).then(() => { notify(`${r.name} ${r.enabled ? 'switched off' : 'switched on'}`); load(); }, (e: Error) => notify(e.message));
  const remove = (r: AutoRule) => void confirmDialog({ title: `Delete "${r.name}"?`, message: 'Its trades stay in Trade lab; the rule stops.', confirmLabel: 'Delete', danger: true })
    .then((ok) => { if (ok) autoApi.remove(r.id).then(load, (e: Error) => notify(e.message)); });
  const shown = onlyTrades ? log.filter((e) => e.action === 'placed' || e.action === 'error') : log;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title={<span className="flex items-center gap-1.5">Automatic rules <InfoTip label="About automatic rules">
        <p>A rule watches a scan on a list of stocks. When a stock matches, it trades on paper: the stock, its future, or a call (bullish) / put (bearish) near the money, with your stop and target.</p>
        <p>Rules trade only inside your window (from 09:30, nothing new from 15:00). Intraday scans are checked when each candle closes; daily scans once a day at 09:30, on yesterday&rsquo;s close. A stock is traded at most once a day per rule. Every decision goes into the log with its reason.</p>
      </InfoTip></span>} actions={<Button variant="primary" className="h-9" onClick={() => setEditing({})}><Plus size={15} /> New rule</Button>}>
        {!data ? <p className="text-[13px] text-muted">Loading…</p> : !data.rules.length ? (
          <p className="py-4 text-center text-[13.5px] text-muted">No rules yet. A rule turns a scan into paper trades by itself, so a scan can prove itself before any real money.</p>
        ) : (
          <ul className="grid gap-2">
            {data.rules.map((r) => {
              const res = data.results[r.id];
              return (
                <li key={r.id} className={`rounded-[12px] border p-3 ${r.enabled ? 'border-accent bg-accent-soft/40' : 'border-line'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" role="switch" aria-checked={r.enabled} onClick={() => void toggle(r)} title={r.enabled ? 'Switch off' : 'Switch on'}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-up' : 'bg-line-strong'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                    <b className="text-[14.5px]">{r.name}</b>
                    <span className={`text-[12px] font-semibold ${r.enabled ? 'text-up' : 'text-muted'}`}>{r.enabled ? 'On' : 'Off'}</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`} className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-2 hover:bg-raised"><Pencil size={14} /></button>
                      <button type="button" onClick={() => remove(r)} aria-label={`Delete ${r.name}`} className="grid h-8 w-8 place-items-center rounded-[8px] text-ink-2 hover:bg-raised hover:text-down"><Trash2 size={14} /></button>
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ink-2">{ruleSentence(r)}</p>
                  <p className="num mt-1.5 flex flex-wrap gap-x-4 text-[12px] text-muted">
                    <span>Trades {res?.trades ?? 0} (today {res?.tradesToday ?? 0})</span>
                    <span>Open {res?.open ?? 0}</span>
                    <span>Net after charges <b className={tone(res?.netPaise ?? 0)}>{signedInr(res?.netPaise ?? 0)}</b></span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Decision log" actions={
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><input type="checkbox" checked={onlyTrades} onChange={(e) => setOnlyTrades(e.target.checked)} className="accent-[var(--color-accent)]" /> Trades only</label>
      }>
        {!shown.length ? <p className="py-4 text-center text-[13px] text-muted">Each check, trade and skip appears here, with its reason.</p> : (
          <ul className="grid max-h-[460px] gap-1 overflow-y-auto text-[12.5px]">
            {shown.slice(0, 200).map((e, k) => (
              <li key={`${e.at}-${k}`} className="flex gap-2 border-t border-line pt-1">
                <span className="num shrink-0 text-muted">{clock(e.at)}</span>
                <span className={`shrink-0 font-semibold ${e.action === 'placed' ? 'text-up' : e.action === 'error' ? 'text-down' : e.action === 'skipped' ? 'text-accent-deep' : 'text-muted'}`}>{e.action === 'placed' ? 'Trade' : e.action === 'error' ? 'Error' : e.action === 'skipped' ? 'Skip' : 'Check'}</span>
                <span className="min-w-0"><span className="text-muted">{e.ruleName}{e.symbol ? ` · ${e.symbol}` : ''}: </span>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <RuleEditor start={editing} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); notify(`${r.name} saved${r.enabled ? '' : ' (off: switch it on to start)'}`); load(); }} />}
    </div>
  );
}

/** New or changed rule, in a dialog. */
function RuleEditor({ start, onClose, onSaved }: { start: Partial<AutoRule>; onClose: () => void; onSaved: (r: AutoRule) => void }) {
  const { watch } = useShell();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [draft, setDraft] = useState<Screen | null>(null);
  const [r, setR] = useState<Partial<AutoRule>>(() => ({
    name: '', direction: 'BULLISH', instrument: 'STOCK', optionStrikes: 0, product: 'MIS', size: 1, stopPct: 1, targetPct: 2,
    maxTradesPerDay: 3, maxOpen: 3, universe: DEFAULT_UNIVERSE, enabled: false, ...start,
  }));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    feed<Meta>('screener/meta').then(setMeta, () => {});
    userApi.screens().then(setScreens, () => {});
    userApi.watchlists().then(setWatchlists, () => {});
    try { const d = JSON.parse(localStorage.getItem(SCAN_DRAFT_KEY) ?? 'null') as Screen | null; if (d?.formula) setDraft(d); } catch { /* none */ }
  }, []);
  const set = (p: Partial<AutoRule>) => setR((x) => ({ ...x, ...p }));
  const fno = r.instrument !== 'STOCK';
  // Scan choices: ready-made by style, My scans, and the scan open on the Scanner page.
  const scanKey = r.scan ? (meta?.presets.find((p) => p.formula === r.scan!.formula && p.tf === r.scan!.tf)?.id ? `p:${meta!.presets.find((p) => p.formula === r.scan!.formula && p.tf === r.scan!.tf)!.id}` : screens.find((x) => x.formula === r.scan!.formula && x.tf === r.scan!.tf) ? `s:${screens.find((x) => x.formula === r.scan!.formula && x.tf === r.scan!.tf)!.id}` : 'custom') : '';
  const pickScan = (k: string) => {
    if (k.startsWith('p:')) { const p = meta?.presets.find((x) => x.id === k.slice(2)); if (p) set({ scan: { name: p.name, formula: p.formula, tf: p.tf }, name: r.name || p.name }); }
    else if (k.startsWith('s:')) { const x = screens.find((y) => y.id === k.slice(2)); if (x) set({ scan: { name: x.name, formula: x.formula, tf: x.tf }, name: r.name || x.name }); }
    else if (k === 'draft' && draft) set({ scan: { name: draft.name, formula: draft.formula, tf: draft.tf }, name: r.name || draft.name });
  };
  const save = () => autoApi.save(r).then(onSaved, (e: Error) => setError(e.message));
  const pctSelect = (label: string, v: number | null | undefined, on: (x: number | null) => void) => (
    <label className="grid gap-1 text-[12.5px] text-ink-2">{label}
      <select value={v ?? ''} onChange={(e) => on(e.target.value === '' ? null : Number(e.target.value))} className={SEL}>
        <option value="">None</option>
        {PCTS.map((p) => <option key={p} value={p}>{p}%</option>)}
      </select>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="Automatic rule">
      <div className="panel flex max-h-[94dvh] w-full max-w-[640px] flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">{start.id ? 'Change rule' : 'New automatic rule'}</h2>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent-deep">PAPER</span>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-full p-1.5 text-muted hover:bg-raised"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px]">
          <label className="grid gap-1 text-[12.5px] text-ink-2">Name<input value={r.name ?? ''} onChange={(e) => set({ name: e.target.value })} className={`${inputCls} h-9`} placeholder="e.g. Opening-range breakout on NIFTY 50" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12.5px] text-ink-2">When this scan matches
              <select value={scanKey} onChange={(e) => pickScan(e.target.value)} className={SEL}>
                <option value="" disabled>Pick a scan…</option>
                {scanKey === 'custom' && <option value="custom">{r.scan?.name} (kept)</option>}
                {draft && <option value="draft">Current Scanner scan: {draft.name}</option>}
                {(['intraday', 'swing', 'positional'] as const).map((h) => meta?.presets.some((p) => p.horizon === h) && (
                  <optgroup key={h} label={h[0].toUpperCase() + h.slice(1)}>{meta.presets.filter((p) => p.horizon === h).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
                ))}
                {screens.length > 0 && <optgroup label="My scans">{screens.map((x) => <option key={x.id} value={`s:${x.id}`}>{x.name}</option>)}</optgroup>}
              </select>
            </label>
            <label className="grid gap-1 text-[12.5px] text-ink-2">On these stocks
              <UniverseSelect universe={r.universe ?? DEFAULT_UNIVERSE} filters={{}} meta={meta} watchlists={watchlists} watch={watch} onChange={(u) => set({ universe: u })} className={SEL} />
            </label>
          </div>
          {r.scan && <p className="text-[12px] text-muted">{TF_LABEL[r.scan.tf] ?? r.scan.tf} candles · <code className="font-mono">{r.scan.formula}</code></p>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1 text-[12.5px] text-ink-2">Direction<Segmented label="Direction" value={r.direction ?? 'BULLISH'} onChange={(direction) => set({ direction })} options={[{ value: 'BULLISH', label: 'Bullish' }, { value: 'BEARISH', label: 'Bearish' }]} /></div>
            <div className="grid gap-1 text-[12.5px] text-ink-2">Trade<Segmented label="Trade" value={r.instrument ?? 'STOCK'} onChange={(instrument) => set({ instrument, product: instrument === 'STOCK' ? (r.product === 'NRML' ? 'MIS' : r.product) : r.product === 'CNC' ? 'MIS' : r.product })} options={[{ value: 'STOCK', label: 'The stock' }, { value: 'FUTURE', label: 'Its future' }, { value: 'OPTION', label: r.direction === 'BEARISH' ? 'A put' : 'A call' }]} /></div>
            {r.instrument === 'OPTION' && (
              <label className="grid gap-1 text-[12.5px] text-ink-2">Strike
                <select value={r.optionStrikes ?? 0} onChange={(e) => set({ optionStrikes: Number(e.target.value) })} className={SEL}>
                  <option value={-1}>1 in the money</option><option value={0}>At the money</option><option value={1}>1 out of the money</option><option value={2}>2 out of the money</option>
                </select>
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-[12.5px] text-ink-2">Product
              <select value={r.product} onChange={(e) => set({ product: e.target.value as AutoRule['product'] })} className={SEL}>
                <option value="MIS">Intraday (closed 15:00)</option>
                {fno ? <option value="NRML">Overnight (to expiry)</option> : <option value="CNC" disabled={r.direction === 'BEARISH'}>Delivery</option>}
              </select>
            </label>
            <label className="grid gap-1 text-[12.5px] text-ink-2">{fno ? 'Lots' : 'Shares'}<input type="number" min={1} step={1} value={r.size ?? 1} onChange={(e) => set({ size: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className={`${inputCls} num h-9`} /></label>
            {pctSelect('Stop', r.stopPct, (stopPct) => set({ stopPct }))}
            {pctSelect('Target', r.targetPct, (targetPct) => set({ targetPct }))}
            <label className="grid gap-1 text-[12.5px] text-ink-2">Max trades a day
              <select value={r.maxTradesPerDay} onChange={(e) => set({ maxTradesPerDay: Number(e.target.value) })} className={SEL}>{[1, 2, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
            <label className="grid gap-1 text-[12.5px] text-ink-2">Max open at once
              <select value={r.maxOpen} onChange={(e) => set({ maxOpen: Number(e.target.value) })} className={SEL}>{[1, 2, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
          </div>
          <p className="text-[12px] text-muted">Stop and target are % of the entry price of what is traded (for an option, of its premium: 20–50% suits options better than 1–2%).</p>
          {r.name && r.scan && <p className="rounded-[10px] bg-raised px-3 py-2 text-[12.5px] text-ink-2">{ruleSentence(r as AutoRule)}</p>}
          {error && <p className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] text-down">{error}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-[12px] text-muted">{start.id ? '' : 'Saved switched off; switch it on in the list.'}</span>
          <Button variant="ghost" className="ml-auto h-9" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="h-9" onClick={() => void save()} disabled={!r.scan}>Save rule</Button>
        </div>
      </div>
    </div>
  );
}
