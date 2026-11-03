'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, FilePlus2, Play, Save, Trash2 } from 'lucide-react';
import { parseFormula } from '@mtv/rules';
import { FeedError, feed } from '@/lib/feed';
import type { Meta, UniverseSpec } from '@/lib/screener';
import { DEFAULT_STRATEGY, NEW_DOC, TEMPLATES, fromSaved, strategyApi, type BacktestResult, type EquityStrategy, type SavedStrategy, type StrategyDoc } from '@/lib/strategy';
import { ago, userApi, type SavedScreen, type Watchlist } from '@/lib/user';
import { InfoTip } from '../info-tip';
import { ConditionEditor } from '../screener/condition-editor';
import { Button, Card, Segmented, inputCls } from '../ui';
import { BacktestResults } from './backtest-results';

const STEPS = ['Basics', 'Stocks', 'Entry', 'Exit', 'Risk', 'Backtest'] as const;
type Step = (typeof STEPS)[number];
const DRAFT_KEY = 'platform.strategy.draft';
const MAIN_INDICES = ['NIFTY 50', 'NIFTY 100', 'NIFTY 200', 'NIFTY 500', 'NIFTY MIDCAP 150', 'NIFTY SMALLCAP 250'];
const BROKERS = [['zerodha', 'Zerodha'], ['upstox', 'Upstox'], ['fyers', 'FYERS'], ['angelone', 'Angel One'], ['dhan', 'Dhan']] as const;

export function StrategyWorkspace() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [doc, setDoc] = useState<StrategyDoc>(NEW_DOC);
  const [saved, setSaved] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('Basics');
  const [list, setList] = useState<SavedStrategy[] | null>(null);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => { strategyApi.list().then(setList, (e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as StrategyDoc | null;
      if (d?.strategy) setDoc({ ...NEW_DOC, ...d, strategy: { ...DEFAULT_STRATEGY, ...d.strategy } });
    } catch { /* a broken draft is ignored */ }
    feed<Meta>('screener/meta').then(setMeta, (e: Error) => setError(e.message));
    userApi.screens().then(setScreens, () => {});
    userApi.watchlists().then(setWatchlists, () => {});
    refresh();
  }, [refresh]);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(doc)); } catch { /* storage blocked */ } }, [doc]);
  useEffect(() => {
    if (saved == null && doc.id && list) { const s = list.find((x) => x.id === doc.id); if (s) setSaved(JSON.stringify(fromSaved(s))); }
  }, [list, doc.id, saved]);

  const s = doc.strategy;
  const set = (p: Partial<EquityStrategy>) => setDoc((d) => ({ ...d, strategy: { ...d.strategy, ...p } }));
  const dirty = saved == null ? !!doc.id || !!s.entry : JSON.stringify(doc) !== saved;
  const confirmLeave = () => !dirty || window.confirm('Your changes to this strategy are not saved. Continue anyway?');
  const open = (d: StrategyDoc, savedVersion: string | null) => { setDoc(d); setSaved(savedVersion); setResult(null); setError(null); setStep('Entry'); };

  const entryOk = (() => { const p = s.entry.trim() ? parseFormula(s.entry) : null; return !!p?.ok && p.type === 'bool'; })();
  const exitOk = (() => { if (!s.exit?.trim()) return true; const p = parseFormula(s.exit); return p.ok && p.type === 'bool'; })();

  const save = async (asNew = false) => {
    setError(null);
    try {
      const r = await strategyApi.save({ ...doc, id: asNew ? undefined : doc.id, name: asNew && doc.id ? `${doc.name} (copy)` : doc.name });
      const d = fromSaved(r);
      setDoc(d);
      setSaved(JSON.stringify(d));
      setNotice('Saved');
      setTimeout(() => setNotice(null), 2000);
      refresh();
    } catch (e) { setError(e instanceof FeedError ? e.message : 'Could not save'); }
  };
  const run = async () => {
    setStep('Backtest');
    setRunning(true);
    setError(null);
    try {
      setResult(await strategyApi.backtest(doc));
      if (doc.id) refresh();
    } catch (e) { setError(e instanceof FeedError ? e.message : 'The backtest could not run. Is the data service running?'); }
    finally { setRunning(false); }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <Library list={list} activeId={doc.id}
        onTemplate={(t) => confirmLeave() && open({ ...NEW_DOC, name: t.name, description: t.about, style: t.style, strategy: { ...DEFAULT_STRATEGY, ...t.patch }, universe: doc.universe }, null)}
        onOpen={(x) => confirmLeave() && open(fromSaved(x), JSON.stringify(fromSaved(x)))}
        onDelete={(x) => { if (window.confirm(`Delete "${x.name}"?`)) strategyApi.remove(x.id).then(() => { if (doc.id === x.id) { setDoc((d) => ({ ...d, id: undefined })); setSaved(null); } refresh(); }, (e: Error) => setError(e.message)); }} />

      <div className="grid min-w-0 gap-5">
        <Card title={
          <span className="flex min-w-0 items-center gap-3">
            <input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} aria-label="Strategy name" className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold tracking-[-0.01em] focus:outline-none" />
            {dirty && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-deep">Unsaved changes</span>}
            {notice && <span className="text-[12.5px] font-semibold text-up" role="status">{notice}</span>}
          </span>
        } actions={
          <>
            <Button onClick={() => save(false)} disabled={!dirty && !!doc.id}><Save size={15} /> Save</Button>
            {doc.id && <Button variant="ghost" onClick={() => save(true)}>Save as new</Button>}
            {doc.id && <Link href={`/alerts?strategy=${doc.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><Bell size={15} /> Alert</Link>}
            <Button variant="ghost" onClick={() => confirmLeave() && open({ ...NEW_DOC }, null)}><FilePlus2 size={15} /> New</Button>
          </>
        }>
          <nav aria-label="Steps" className="mb-5 flex flex-wrap gap-1.5">
            {STEPS.map((st, i) => {
              const flag = (st === 'Entry' && !entryOk) || (st === 'Exit' && !exitOk);
              return (
                <button key={st} type="button" onClick={() => setStep(st)} aria-current={step === st ? 'step' : undefined}
                  className={`flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13.5px] font-semibold ${step === st ? 'bg-inverse text-on-inverse' : 'border border-line-strong text-ink-2 hover:text-ink'}`}>
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${step === st ? 'bg-on-inverse/15' : 'bg-raised'}`}>{i + 1}</span>{st}
                  {flag && <span className="h-1.5 w-1.5 rounded-full bg-down" aria-label="needs attention" />}
                </button>
              );
            })}
          </nav>

          {step === 'Basics' && <Basics doc={doc} setDoc={setDoc} />}
          {step === 'Stocks' && <Stocks universe={doc.universe} meta={meta} watchlists={watchlists} onChange={(universe) => setDoc({ ...doc, universe })} />}
          {step === 'Entry' && (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow">Signal timeframe</span>
                <Segmented label="Timeframe" value={s.tf} onChange={(tf) => set({ tf })} options={[{ value: 'D', label: 'Daily' }, { value: 'W', label: 'Weekly' }, { value: 'M', label: 'Monthly' }]} />
                <InfoTip label="Timeframes">Signals are read at the close of these bars and traded at the next bar&apos;s open. Any condition can be put on another timeframe (for example a weekly trend filter on a daily strategy) from the picker beside it.</InfoTip>
                {screens.length > 0 && (
                  <select value="" onChange={(e) => { const sc = screens.find((x) => x.id === e.target.value); if (sc) set({ entry: sc.formula, tf: sc.tf as EquityStrategy['tf'] }); }} aria-label="Use a saved screen" className={`${inputCls} ml-auto pr-8`}>
                    <option value="">Use a saved screen as the entry…</option>
                    {screens.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                )}
              </div>
              <ConditionEditor value={s.entry} onChange={(entry) => set({ entry })} meta={meta} screenTf={s.tf} rootLabel="Buy when" emptyText="Add the conditions that open a trade." />
            </div>
          )}
          {step === 'Exit' && <Exit s={s} set={set} meta={meta} />}
          {step === 'Risk' && <Risk s={s} set={set} />}
          {step === 'Backtest' && (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="From"><input type="date" value={s.from} onChange={(e) => set({ from: e.target.value })} className={`${inputCls} num`} /></Field>
                <Field label="To"><input type="date" value={s.to} onChange={(e) => set({ to: e.target.value })} className={`${inputCls} num`} /></Field>
                <Field label="Risk-free rate % a year" tip="Used for Sharpe and Sortino. Set it to the current 91-day T-bill yield."><NumIn v={s.riskFreePct} on={(v) => set({ riskFreePct: v ?? 0 })} /></Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">Quick period</span>
                {([['1 year', 1], ['3 years', 3], ['5 years', 5], ['All data', 20]] as const).map(([label, years]) => (
                  <button key={label} type="button" onClick={() => set({ from: yearsAgo(years), to: todayIst() })}
                    className="h-8 rounded-[9px] border border-line-strong px-3 text-[13px] font-semibold text-ink-2 hover:text-ink">{label}</button>
                ))}
              </div>
              {daysBetween(s.from, s.to) < 365 && (
                <p className="rounded-[12px] bg-down-soft px-3 py-2 text-[13px] text-down">
                  This test covers {Math.max(0, daysBetween(s.from, s.to))} day{daysBetween(s.from, s.to) === 1 ? '' : 's'}. A signal at one bar&apos;s close trades at the next bar&apos;s open, so short tests show few or no trades. Pick at least a year (use Quick period).
                </p>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-dashed border-line-strong pt-4">
            <Button variant="primary" onClick={run} disabled={running || !entryOk || !exitOk} className="min-w-[160px]"><Play size={16} /> {running ? 'Testing…' : 'Run backtest'}</Button>
            {step !== 'Backtest' && <Button variant="ghost" onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1])}>Next: {STEPS[STEPS.indexOf(step) + 1]} <ArrowRight size={15} /></Button>}
            {!entryOk && <span className="text-[13px] text-down">Add a valid entry condition (step 3).</span>}
            {entryOk && !exitOk && <span className="text-[13px] text-down">Fix the exit condition (step 4).</span>}
          </div>
          {error && <p role="alert" className="mt-3 rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
        </Card>
        {running && <Card><p className="text-[14px] text-ink-2">Testing on every stock in the list, bar by bar…</p></Card>}
        {result && !running && <BacktestResults r={result} />}
      </div>
    </div>
  );
}

function Library({ list, activeId, onTemplate, onOpen, onDelete }: { list: SavedStrategy[] | null; activeId?: string; onTemplate: (t: (typeof TEMPLATES)[number]) => void; onOpen: (s: SavedStrategy) => void; onDelete: (s: SavedStrategy) => void }) {
  return (
    <div className="grid h-fit gap-5 xl:sticky xl:top-24">
      <Card title="My strategies">
        <ul className="grid max-h-[40vh] gap-1 overflow-y-auto">
          {!list && <li className="text-[13px] text-muted">Loading…</li>}
          {list?.length === 0 && <li className="text-[13px] text-muted">None saved yet. Start from a template below, or build one.</li>}
          {list?.map((x) => {
            const b = x.backtests[0];
            return (
              <li key={x.id} className={`group flex items-start rounded-[10px] ${x.id === activeId ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
                <button type="button" onClick={() => onOpen(x)} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <span className="block truncate text-[14px] font-medium">{x.name}</span>
                  <span className="block text-[12px] text-muted">{b ? `Tested ${ago(b.at)}: ${b.returnPct >= 0 ? '+' : ''}${b.returnPct.toFixed(1)}%, max DD ${b.maxDrawdownPct.toFixed(1)}%` : 'Not tested yet'}</span>
                </button>
                <button type="button" onClick={() => onDelete(x)} aria-label={`Delete ${x.name}`} className="m-1.5 grid h-7 w-7 place-items-center rounded-[8px] text-muted opacity-0 hover:text-down group-hover:opacity-100 focus:opacity-100"><Trash2 size={14} /></button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Templates">
        <ul className="grid gap-1">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={t.needsIntraday} onClick={() => onTemplate(t)} className="w-full rounded-[10px] px-2.5 py-2 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent">
                <span className="flex items-center gap-2 text-[14px] font-medium">{t.name}{t.needsIntraday && <span className="rounded-full bg-raised px-1.5 text-[10.5px] font-semibold text-muted">needs intraday data</span>}</span>
                <span className="line-clamp-2 block text-[12px] text-muted">{t.about}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const yearsAgo = (y: number) => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);

function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return <label className="grid gap-1"><span className="eyebrow flex items-center gap-1">{label}{tip && <InfoTip label={label}>{tip}</InfoTip>}</span>{children}</label>;
}
function NumIn({ v, on, step = 'any', w = 'w-[120px]' }: { v: number | undefined; on: (v: number | undefined) => void; step?: string; w?: string }) {
  return <input type="number" step={step} min={0} value={v ?? ''} onChange={(e) => on(e.target.value === '' ? undefined : Number(e.target.value))} className={`${inputCls} num ${w}`} />;
}

function Basics({ doc, setDoc }: { doc: StrategyDoc; setDoc: (d: StrategyDoc) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="Description"><textarea value={doc.description} onChange={(e) => setDoc({ ...doc, description: e.target.value })} rows={3} className={`${inputCls} h-auto py-2`} placeholder="What the strategy tries to catch, and why" /></Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Market"><span className="flex h-10 items-center text-[14px]">NSE</span></Field>
        <Field label="Instrument"><span className="flex h-10 items-center text-[14px]">Equity (cash)</span></Field>
        <Field label="Style">
          <Segmented label="Style" value={doc.style} onChange={(style) => setDoc({ ...doc, style })} options={[{ value: 'swing', label: 'Swing' }, { value: 'positional', label: 'Positional' }]} />
        </Field>
        <Field label="Direction"><span className="flex h-10 items-center text-[14px]">Long (buy)</span></Field>
      </div>
      <p className="text-[12.5px] text-muted">Intraday strategies need live and intraday data (a later step). Short selling overnight isn&apos;t allowed in the cash market, so short strategies come with futures backtests.</p>
    </div>
  );
}

function Stocks({ universe, meta, watchlists, onChange }: { universe: UniverseSpec; meta: Meta | null; watchlists: Watchlist[]; onChange: (u: UniverseSpec) => void }) {
  const key = universe.kind === 'index' ? `index:${universe.name}` : universe.kind === 'watchlist' ? `watchlist:${universe.id}` : universe.kind;
  const [text, setText] = useState(universe.kind === 'symbols' ? universe.symbols.join(', ') : '');
  const pick = (k: string) => {
    if (k === 'all' || k === 'fno') onChange({ kind: k });
    else if (k.startsWith('index:')) onChange({ kind: 'index', name: k.slice(6) });
    else if (k.startsWith('watchlist:')) onChange({ kind: 'watchlist', id: k.slice(10) });
    else onChange({ kind: 'symbols', symbols: text.split(/[\s,]+/).filter(Boolean) });
  };
  return (
    <div className="grid gap-4">
      <Field label="Test on">
        <select value={key} onChange={(e) => pick(e.target.value)} className={`${inputCls} w-[320px] pr-8`}>
          <option value="all">All NSE stocks (delisted ones included)</option>
          <option value="fno">F&amp;O stocks</option>
          <optgroup label="Index">{MAIN_INDICES.map((i) => <option key={i} value={`index:${i}`}>{i}</option>)}</optgroup>
          {meta && <optgroup label="Sector and theme indices">{meta.indices.filter((i) => !MAIN_INDICES.includes(i)).map((i) => <option key={i} value={`index:${i}`}>{i}</option>)}</optgroup>}
          {watchlists.length > 0 && <optgroup label="My watchlists">{watchlists.map((w) => <option key={w.id} value={`watchlist:${w.id}`}>{w.name} ({w.symbols.length})</option>)}</optgroup>}
          <option value="symbols">Type a list…</option>
        </select>
      </Field>
      {universe.kind === 'symbols' && (
        <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange({ kind: 'symbols', symbols: text.split(/[\s,]+/).map((x) => x.toUpperCase()).filter(Boolean) })} rows={2} placeholder="RELIANCE, TCS, INFY" className={`${inputCls} h-auto py-2 font-mono`} />
      )}
      <div className="grid gap-1.5 text-[12.5px] text-muted">
        <p>Each stock is traded only on days it traded: newly listed stocks join when their history starts, and delisted ones leave on their last day.</p>
        {(universe.kind === 'index' || universe.kind === 'fno') && <p className="text-accent-deep">An index list is today&apos;s members. Stocks that left it in the past are missing, which makes results look better than they were (survivorship bias). &quot;All NSE stocks&quot; avoids this.</p>}
        <p>Liquidity is checked on each signal day (Risk step), not from today&apos;s values, so the past is never filtered with information from the future.</p>
      </div>
    </div>
  );
}

function Exit({ s, set, meta }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void; meta: Meta | null }) {
  const stopKind = s.stop.kind, tgKind = s.target.kind, trKind = s.trail.kind;
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <h3 className="text-[15px] font-semibold">Stop loss</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <select value={stopKind} onChange={(e) => {
              const k = e.target.value;
              set({ stop: k === 'none' ? { kind: 'none' } : k === 'pct' ? { kind: 'pct', value: 2 } : k === 'points' ? { kind: 'points', value: 10 } : k === 'atr' ? { kind: 'atr', mult: 2, length: 14 } : { kind: 'formula', formula: 'SUPERTREND(10, 3)' } });
            }} className={`${inputCls} pr-8`}>
              <option value="none">No stop loss</option><option value="pct">% below entry</option><option value="points">₹ below entry</option><option value="atr">ATR multiple below entry</option><option value="formula">Indicator level</option>
            </select>
          </Field>
          {s.stop.kind === 'pct' && <Field label="%"><NumIn v={s.stop.value} on={(v) => set({ stop: { kind: 'pct', value: v ?? 0 } })} /></Field>}
          {s.stop.kind === 'points' && <Field label="₹"><NumIn v={s.stop.value} on={(v) => set({ stop: { kind: 'points', value: v ?? 0 } })} /></Field>}
          {s.stop.kind === 'atr' && <><Field label="× ATR"><NumIn v={s.stop.mult} on={(v) => set({ stop: { ...(s.stop as { kind: 'atr'; mult: number; length: number }), mult: v ?? 0 } })} /></Field><Field label="ATR length"><NumIn step="1" v={s.stop.length} on={(v) => set({ stop: { ...(s.stop as { kind: 'atr'; mult: number; length: number }), length: v ?? 14 } })} /></Field></>}
          {s.stop.kind === 'formula' && (
            <Field label="Level formula" tip="A price level, re-read at every close and used from the next bar, e.g. SUPERTREND(10, 3), LOWEST(LOW, 10)[1] or EMA(CLOSE, 20).">
              <input value={s.stop.formula} onChange={(e) => set({ stop: { kind: 'formula', formula: e.target.value } })} spellCheck={false} className={`${inputCls} w-[280px] font-mono`} />
            </Field>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="text-[15px] font-semibold">Target</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <select value={tgKind} onChange={(e) => { const k = e.target.value; set({ target: k === 'none' ? { kind: 'none' } : { kind: k as 'pct' | 'points' | 'rr', value: k === 'rr' ? 2 : k === 'pct' ? 5 : 20 } }); }} className={`${inputCls} pr-8`}>
              <option value="none">No target</option><option value="pct">% above entry</option><option value="points">₹ above entry</option><option value="rr">Multiple of the risk (R:R)</option>
            </select>
          </Field>
          {s.target.kind !== 'none' && <Field label={s.target.kind === 'pct' ? '%' : s.target.kind === 'points' ? '₹' : '× risk'}><NumIn v={s.target.value} on={(v) => set({ target: { ...(s.target as { kind: 'pct'; value: number }), value: v ?? 0 } })} /></Field>}
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">Trailing stop <InfoTip label="Trailing stop">Follows the highest high since entry at this distance. It moves only at a bar&apos;s close and is used from the next bar, so it never reacts to prices inside the bar that moved it.</InfoTip></h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <select value={trKind} onChange={(e) => { const k = e.target.value; set({ trail: k === 'none' ? { kind: 'none' } : k === 'atr' ? { kind: 'atr', mult: 3, length: 14 } : { kind: k as 'pct' | 'points', value: k === 'pct' ? 8 : 20 } }); }} className={`${inputCls} pr-8`}>
              <option value="none">No trailing stop</option><option value="pct">% below the high</option><option value="points">₹ below the high</option><option value="atr">ATR multiple below the high</option>
            </select>
          </Field>
          {(s.trail.kind === 'pct' || s.trail.kind === 'points') && <Field label={s.trail.kind === 'pct' ? '%' : '₹'}><NumIn v={s.trail.value} on={(v) => set({ trail: { ...(s.trail as { kind: 'pct'; value: number }), value: v ?? 0 } })} /></Field>}
          {s.trail.kind === 'atr' && <><Field label="× ATR"><NumIn v={s.trail.mult} on={(v) => set({ trail: { ...(s.trail as { kind: 'atr'; mult: number; length: number }), mult: v ?? 0 } })} /></Field><Field label="ATR length"><NumIn step="1" v={s.trail.length} on={(v) => set({ trail: { ...(s.trail as { kind: 'atr'; mult: number; length: number }), length: v ?? 14 } })} /></Field></>}
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="text-[15px] font-semibold">Time exit</h3>
        <Field label="Leave after (bars, empty = no limit)"><NumIn step="1" v={s.maxBars} on={(v) => set({ maxBars: v ? Math.round(v) : undefined })} /></Field>
      </div>

      <div className="grid gap-3">
        <h3 className="text-[15px] font-semibold">Exit signal <span className="text-[13px] font-normal text-muted">(optional)</span></h3>
        <ConditionEditor value={s.exit ?? ''} onChange={(exit) => set({ exit })} meta={meta} screenTf={s.tf} rootLabel="Sell when" emptyText="Without an exit signal, trades end at the stop, target, trailing stop or time exit." />
      </div>
    </div>
  );
}

function Risk({ s, set }: { s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  const sz = s.sizing;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Starting capital ₹"><NumIn v={s.capitalRupees} on={(v) => set({ capitalRupees: v ?? 0 })} w="w-[160px]" /></Field>
        <Field label="Position size">
          <select value={sz.mode} onChange={(e) => { const m = e.target.value; set({ sizing: m === 'qty' ? { mode: 'qty', qty: 10 } : m === 'amount' ? { mode: 'amount', rupees: 100000 } : m === 'percent' ? { mode: 'percent', pct: 10 } : { mode: 'risk', pct: 1 } }); }} className={`${inputCls} pr-8`}>
            <option value="percent">% of capital</option><option value="amount">Fixed ₹ amount</option><option value="qty">Fixed quantity</option><option value="risk">Risk % of capital (needs a stop)</option>
          </select>
        </Field>
        {sz.mode === 'percent' && <Field label="% per trade"><NumIn v={sz.pct} on={(v) => set({ sizing: { mode: 'percent', pct: v ?? 0 } })} /></Field>}
        {sz.mode === 'amount' && <Field label="₹ per trade"><NumIn v={sz.rupees} on={(v) => set({ sizing: { mode: 'amount', rupees: v ?? 0 } })} w="w-[150px]" /></Field>}
        {sz.mode === 'qty' && <Field label="Shares"><NumIn step="1" v={sz.qty} on={(v) => set({ sizing: { mode: 'qty', qty: Math.round(v ?? 0) } })} /></Field>}
        {sz.mode === 'risk' && <Field label="% risked per trade" tip="Shares = capital × risk % ÷ (signal close − stop). Losing at the stop then costs about this share of capital."><NumIn v={sz.pct} on={(v) => set({ sizing: { mode: 'risk', pct: v ?? 0 } })} /></Field>}
        <label className="flex h-10 items-center gap-2 text-[13.5px]"><input type="checkbox" checked={s.reinvest} onChange={(e) => set({ reinvest: e.target.checked })} className="accent-[var(--color-accent)]" /> Size from current equity (compounding)</label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Open positions at once"><NumIn step="1" v={s.maxOpen} on={(v) => set({ maxOpen: Math.round(v ?? 1) })} /></Field>
        <Field label="Entries per stock" tip="Above 1 allows adding to a stock that is already held (pyramiding)."><NumIn step="1" v={s.pyramid} on={(v) => set({ pyramid: Math.round(v ?? 1) })} /></Field>
        <Field label="Wait after an exit (bars)"><NumIn step="1" v={s.cooldownBars} on={(v) => set({ cooldownBars: Math.round(v ?? 0) })} /></Field>
        <Field label="New entries per bar"><NumIn step="1" v={s.maxEntriesPerBar} on={(v) => set({ maxEntriesPerBar: Math.round(v ?? 1) })} /></Field>
        <Field label="Min traded value ₹ cr/day" tip="The stock's 20-day average traded value on the signal day. Thinly traded stocks fill worse than any backtest assumes."><NumIn v={s.minAvgValueCr} on={(v) => set({ minAvgValueCr: v ?? 0 })} /></Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Order">
          <select value={s.order.type} onChange={(e) => { const t = e.target.value; set({ order: t === 'market' ? { type: 'market' } : { type: t as 'limit' | 'stop', offsetPct: t === 'limit' ? 0.5 : 0.1 } }); }} className={`${inputCls} pr-8`}>
            <option value="market">Market at the next open</option><option value="limit">Limit below the signal close</option><option value="stop">Stop above the signal bar&apos;s high</option>
          </select>
        </Field>
        {s.order.type !== 'market' && <Field label="Offset %"><NumIn v={s.order.offsetPct} on={(v) => set({ order: { ...(s.order as { type: 'limit'; offsetPct: number }), offsetPct: v ?? 0 } })} /></Field>}
        <Field label="When signals exceed free slots, prefer the highest" tip="Any value formula. AVG_TURNOVER(20) prefers the most traded stocks; RSI(CLOSE, 14) the strongest; -ATR_PCT(14) the calmest.">
          <input value={s.rank} onChange={(e) => set({ rank: e.target.value })} spellCheck={false} className={`${inputCls} w-[240px] font-mono`} />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Broker charges">
          <select value={s.broker} onChange={(e) => set({ broker: e.target.value })} className={`${inputCls} pr-8`}>{BROKERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        </Field>
        <label className="flex h-10 items-center gap-2 text-[13.5px]"><input type="checkbox" checked={s.charges} onChange={(e) => set({ charges: e.target.checked })} className="accent-[var(--color-accent)]" /> Include brokerage, STT, exchange fees, stamp duty, GST and DP charges</label>
        <Field label="Slippage % a side" tip="Taken off every fill, against you. 0.05% is mild for liquid large caps; use more for small caps."><NumIn v={s.slippagePct} on={(v) => set({ slippagePct: v ?? 0 })} /></Field>
      </div>
    </div>
  );
}
