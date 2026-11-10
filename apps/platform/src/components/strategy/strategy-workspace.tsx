'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, ChevronDown, FilePlus2, Play, Save } from 'lucide-react';
import { parseFormula, type Tf } from '@mtv/rules';
import { FeedError, feed, showKept } from '@/lib/feed';
import type { Meta } from '@/lib/screener';
import { DEFAULT_INTRADAY, DEFAULT_STRATEGY, NEW_DOC, isIntradayTf, fromSaved, strategyApi, type BacktestResult, type EquityStrategy, type SavedStrategy, type StrategyDoc } from '@/lib/strategy';
import { userApi, type SavedScreen, type Watchlist } from '@/lib/user';
import { confirmDialog } from '../dialog';
import { InfoTip } from '../info-tip';
import { Button, Card, Segmented, inputCls } from '../ui';
import { CapitalPick, MaxOpenPick, PeriodPick, SessionPicks, SizePick, StopPick, TargetPick, TrailPick, WORD } from './strategy-form';
import { BacktestResults } from './backtest-results';
import { StrategyGallery } from './strategy-gallery';
import { SymbolPicker, TEST_INDICES } from './symbol-picker';
import { RowBuilder } from '../conditions/row-builder';
import { FormulaEditor } from '../screener/formula-editor';
import { formulaToRows, rowsWords } from '@/lib/rows';
import { useShell } from '../app/shell-context';
import { UniverseSelect, isMyWatchlist } from '../screener/universe-picker';

const DRAFT_KEY = 'platform.strategy.draft';
const BASE_KEY = 'platform.strategy.draftBase';
const BROKERS = [['zerodha', 'Zerodha'], ['upstox', 'Upstox'], ['fyers', 'FYERS'], ['angelone', 'Angel One'], ['dhan', 'Dhan']] as const;

export function StrategyWorkspace() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [doc, setDoc] = useState<StrategyDoc>(NEW_DOC);
  const [saved, setSaved] = useState<string | null>(null);
  const [list, setList] = useState<SavedStrategy[] | null>(null);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** An unsaved strategy as it was opened (a template or an empty one), kept with the draft across reloads. */
  const [base, setBase] = useState<string | null>(null);
  /** Which rule editor is open (entry or exit), and whether the extra settings show. */
  const [edit, setEdit] = useState<'entry' | 'exit' | null>(null);
  const [more, setMore] = useState(false);
  const { watch } = useShell(); // the side panel's watchlist, for "My watchlist"
  /** The strategy tiles under the editor: open until a backtest runs or one is opened. */
  const [galleryOpen, setGalleryOpen] = useState(true);
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const refresh = useCallback(() => { strategyApi.list().then(setList, (e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as StrategyDoc | null;
      if (d?.strategy) { setDoc({ ...NEW_DOC, ...d, strategy: { ...DEFAULT_STRATEGY, ...d.strategy } }); setBase(localStorage.getItem(BASE_KEY)); }
    } catch { /* a broken draft is ignored */ }
    showKept(['screener/meta', setMeta], ['user/strategies', setList], ['user/screens', setScreens], ['user/watchlists', setWatchlists]);
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
  const dirty = saved == null ? !!doc.id || (base == null ? !!s.entry : JSON.stringify(doc) !== base) : JSON.stringify(doc) !== saved;
  /** Runs `go` straight away, or after the owner agrees to drop unsaved changes. */
  const leaving = (go: () => void) => {
    if (!dirty) return go();
    void confirmDialog({ title: 'Discard unsaved changes?', message: 'Your changes to this strategy are not saved.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }).then((ok) => ok && go());
  };
  const open = (d: StrategyDoc, savedVersion: string | null) => {
    setDoc(d); setSaved(savedVersion); setResult(null); setError(null); setEdit(null);
    const b = JSON.stringify(d);
    setBase(b);
    try { localStorage.setItem(BASE_KEY, b); } catch { /* storage blocked */ }
  };

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
  const runKey = JSON.stringify({ strategy: doc.strategy, universe: doc.universe });
  const [resultKey, setResultKey] = useState<string | null>(null);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const key = runKey;
      setResult(await strategyApi.backtest(doc));
      setResultKey(key);
      setGalleryOpen(false);
      if (doc.id) refresh();
    } catch (e) { setError(e instanceof FeedError ? e.message : 'The backtest could not run. Is the data service running?'); }
    finally { setRunning(false); }
  };

  return (
    <div className="grid min-w-0 content-start gap-5">
        <section className="panel grid gap-4 p-5">
          {/* name and saving */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} aria-label="Strategy name" title={doc.name} className="min-w-[8rem] max-w-full bg-transparent text-[18px] font-semibold tracking-[-0.01em] [field-sizing:content] focus:outline-none" />
            {dirty && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-deep">Unsaved</span>}
            {notice && <span className="text-[12.5px] font-semibold text-up" role="status">{notice}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button className="h-9" onClick={() => save(false)} disabled={!dirty && !!doc.id}><Save size={15} /> Save</Button>
              {doc.id && <Button variant="ghost" className="h-9" onClick={() => save(true)}>Save as new</Button>}
              {doc.id && <Link href={`/alerts?strategy=${doc.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-semibold text-ink-2 hover:bg-raised hover:text-ink"><Bell size={15} /> Alert</Link>}
              <Button variant="ghost" className="h-9" onClick={() => leaving(() => open({ ...NEW_DOC }, null))}><FilePlus2 size={15} /> New</Button>
            </span>
          </div>

          {/* the sentence: which stocks, which candles, which period */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[clamp(16px,1.5vw,19px)] font-semibold text-ink">
            <span>Test on</span>
            <UniverseSelect universe={doc.universe} filters={{}} meta={meta} watchlists={watchlists} watch={watch} className={WORD}
              onChange={(universe) => setDoc({ ...doc, universe })} onPick={() => setDoc({ ...doc, universe: { kind: 'symbols', symbols: [] } })} />
            <span>checking every</span>
            <select value={s.tf} onChange={(e) => set({ tf: e.target.value as EquityStrategy['tf'] })} aria-label="Candles" className={WORD}>
              {([['1m', '1-minute'], ['5m', '5-minute'], ['15m', '15-minute'], ['1h', '1-hour'], ['D', 'daily'], ['W', 'weekly'], ['M', 'monthly']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span>candle over</span>
            <InfoTip label="Main timeframe">The main timeframe: signals are checked when each of these candles closes, and trades happen then. A condition can still read another timeframe (e.g. a daily trend filter) with its own &ldquo;on …&rdquo; choice below.</InfoTip>
            <PeriodPick s={s} set={set} className={WORD} />
            <Button variant="primary" onClick={run} disabled={running || !entryOk || !exitOk} className="ml-auto h-10 min-w-[150px] text-[15px]"><Play size={16} /> {running ? 'Testing…' : 'Run backtest'}</Button>
          </div>
          {doc.universe.kind === 'symbols' && !isMyWatchlist(doc.universe) && (
            <SymbolPicker symbols={doc.universe.symbols} onChange={(symbols) => setDoc({ ...doc, universe: { kind: 'symbols', symbols } })} />
          )}
          {isIntradayTf(s.tf) && s.from < yearsAgo(1) && <p className="text-[12.5px] text-muted">Minute candles go back about a year (stored Kite minutes), so the test starts where they do.</p>}

          <div className="grid gap-3 border-t border-dashed border-line-strong pt-3">
            {/* entry: always open, as sentences */}
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-bold text-ink">Buy when</h3>
                {!entryOk && s.entry.trim() && <span className="text-[12.5px] text-down">this rule needs fixing</span>}
                {screens.length > 0 && (
                  <select value="" onChange={(e) => { const sc = screens.find((x) => x.id === e.target.value); if (sc) set({ entry: sc.formula, tf: sc.tf as EquityStrategy['tf'] }); }} aria-label="Use a saved scan" className={`${inputCls} ml-auto h-9 pr-7 text-[13px]`}>
                    <option value="">Use one of my scans instead…</option>
                    {screens.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                )}
              </div>
              <RuleEditor value={s.entry} onChange={(entry) => set({ entry })} meta={meta} tf={s.tf} lead="Buy when" starters emptyText="Pick a quick start above, or add the conditions that open a trade." />
            </section>

            {/* exit */}
            <Row label="Exit">
              <StopPick s={s} set={set} />
              <TargetPick s={s} set={set} />
              <TrailPick s={s} set={set} />
            </Row>
            <section className="grid gap-2">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-ink">Sell when <span className="text-[12.5px] font-normal text-muted">optional: without it, the stop, target or trailing stop ends the trade</span></h3>
              <RuleEditor value={s.exit ?? ''} onChange={(exit) => set({ exit })} meta={meta} tf={s.tf} lead="Sell when" emptyText="" />
            </section>

            {/* money */}
            <Row label="Money">
              <CapitalPick s={s} set={set} />
              <SizePick s={s} set={set} />
              <MaxOpenPick s={s} set={set} />
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">Broker
                <select value={s.broker} onChange={(e) => set({ broker: e.target.value })} aria-label="Broker" className="h-9 cursor-pointer rounded-[10px] border border-line-strong bg-panel pl-2.5 pr-7 text-[13px] font-semibold">{BROKERS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
              </label>
            </Row>

            {/* the trading day, for minute candles */}
            {isIntradayTf(s.tf) && (
              <Row label="Day" tip="Trades start when a signal candle closes; nothing opens after the last entry; every position is closed at Close all. Keep it before your broker's own auto square-off.">
                <SessionPicks rules={s.intraday ?? DEFAULT_INTRADAY} onChange={(intraday) => set({ intraday })} />
              </Row>
            )}

            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold text-accent-deep hover:underline">
              {more ? 'Fewer settings' : 'More settings'} <ChevronDown size={13} className={more ? 'rotate-180' : ''} />
            </button>
            {more && <More doc={doc} setDoc={setDoc} s={s} set={set} />}
          </div>

          <StrategySentence doc={doc} />
          {!entryOk && <p className="text-[13px] text-down">Add a valid buy rule (Buy when → Edit).</p>}
          {entryOk && !exitOk && <p className="text-[13px] text-down">Fix the sell rule (Sell when → Edit).</p>}
          {daysBetween(s.from, s.to) < 365 && <p className="rounded-[12px] bg-down-soft px-3 py-2 text-[13px] text-down">This test covers {Math.max(0, daysBetween(s.from, s.to))} days. Short tests show few or no trades: pick at least a year.</p>}
          {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
        </section>
        {/* Every strategy as a tile: saved ones and templates; a click opens it in the editor above */}
        <StrategyGallery open={galleryOpen} onToggle={() => setGalleryOpen((o) => !o)} list={list} activeId={doc.id}
          onTemplate={(t) => leaving(() => { open({ ...NEW_DOC, name: t.name, description: t.about, style: t.style, strategy: { ...DEFAULT_STRATEGY, ...t.patch }, universe: doc.universe }, null); setGalleryOpen(false); scrollTop(); })}
          onOpen={(x) => leaving(() => { open(fromSaved(x), JSON.stringify(fromSaved(x))); setGalleryOpen(false); scrollTop(); })}
          onDelete={(x) => { void confirmDialog({ title: `Delete "${x.name}"?`, message: 'Its backtest history goes with it.', confirmLabel: 'Delete', danger: true }).then((ok) => void (ok && strategyApi.remove(x.id).then(() => { if (doc.id === x.id) { setDoc((d) => ({ ...d, id: undefined })); setSaved(null); } refresh(); }, (e: Error) => setError(e.message)))); }} />
        {running && <Card><p className="text-[14px] text-ink-2">Testing on every stock in the list, bar by bar…</p></Card>}
        {result && !running && resultKey !== runKey && (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-[12px] bg-accent-soft px-4 py-2.5 text-[13.5px] text-ink-2">
            <AlertTriangle size={15} className="text-accent-deep" aria-hidden="true" />
            These results are from before your latest changes (stocks, rules or risk).
            <button type="button" onClick={run} className="font-semibold text-accent-deep hover:underline">Run again</button>
          </p>
        )}
        {result && !running && <div className={resultKey !== runKey ? 'opacity-50' : undefined}><BacktestResults r={result} /></div>}
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

const STOP_PICKS: { label: string; formula: string; text: string; intraday?: boolean }[] = [
  { label: 'Supertrend (10, 3) line', formula: 'SUPERTREND(10, 3)', text: 'the Supertrend (10, 3) line' },
  { label: 'Lowest low of the last 5 candles', formula: 'LOWEST(LOW, 5)[1]', text: 'the lowest low of the previous 5 candles' },
  { label: 'EMA 20', formula: 'EMA(CLOSE, 20)', text: 'EMA 20' },
  { label: 'VWAP', formula: 'VWAP', text: 'VWAP', intraday: true },
  { label: 'Opening range low (15 min)', formula: 'OR_LOW(15)', text: 'the low of the first 15 minutes', intraday: true },
];

const TF_WORDS: Record<string, string> = { '1m': '1-minute', '3m': '3-minute', '5m': '5-minute', '15m': '15-minute', '30m': '30-minute', '1h': '1-hour', D: 'daily', W: 'weekly', M: 'monthly' };

/** The strategy read back in plain words, so the owner can check it says what they meant. */
function StrategySentence({ doc }: { doc: StrategyDoc }) {
  const s = doc.strategy, u = doc.universe;
  const on = u.kind === 'symbols' ? (u.symbols.map((x) => TEST_INDICES.find((i) => i.symbol === x)?.name ?? x).slice(0, 4).join(', ') + (u.symbols.length > 4 ? ` and ${u.symbols.length - 4} more` : '')) || 'no stocks picked yet'
    : u.kind === 'index' ? `the ${u.name} stocks` : u.kind === 'fno' ? 'F&O stocks' : u.kind === 'watchlist' ? 'a watchlist' : 'all NSE stocks';
  const rule = (f: string | undefined) => { const r = formulaToRows(f ?? ''); return r ? rowsWords(r) : (f ?? '').trim(); };
  const entry = rule(s.entry), exit = rule(s.exit);
  const stop = s.stop.kind === 'pct' ? `${s.stop.value}% below the entry` : s.stop.kind === 'points' ? `₹${s.stop.value} below the entry` : s.stop.kind === 'atr' ? `${s.stop.mult} × ATR (${s.stop.length}) below the entry`
    : s.stop.kind === 'formula' ? (STOP_PICKS.find((x) => x.formula === (s.stop as { formula: string }).formula)?.text ?? (s.stop as { formula: string }).formula) + ', moving with it' : null;
  const target = s.target.kind === 'pct' ? `${s.target.value}% above the entry` : s.target.kind === 'points' ? `₹${s.target.value} above the entry` : s.target.kind === 'rr' ? `${s.target.value} × the risk` : null;
  const day = isIntradayTf(s.tf) ? s.intraday ?? DEFAULT_INTRADAY : null;
  return (
    <p className="mb-2 rounded-[12px] bg-accent-soft px-4 py-2.5 text-[13.5px] leading-relaxed text-ink-2">
      <b className="text-ink">Reads as: </b>
      On {on}, {TF_WORDS[s.tf]} candles: {entry ? <>buy when {entry}</> : 'no entry rule yet'}.
      {stop && <> Stop at {stop}.</>}
      {target && <> Target {target}.</>}
      {exit && <> Sell when {exit}.</>}
      {day && <> Trades from {day.firstEntry ?? '09:15'}, none after {day.lastEntry}, everything closed at {day.squareOff}.</>}
    </p>
  );
}

/** Entry and exit rules: simple lists for common setups, or the full builder and formula editor. */
function RuleEditor({ value, onChange, meta, tf, lead, emptyText, starters = false }: { value: string; onChange: (f: string) => void; meta: Meta | null; tf: EquityStrategy['tf']; lead: string; emptyText: string; starters?: boolean }) {
  void lead;
  const fits = formulaToRows(value) != null;
  const [asFormula, setAsFormula] = useState(!fits);
  return (
    <div className="grid gap-2">
      {!asFormula && fits && <RowBuilder formula={value} onChange={onChange} mainTf={tf} intraday={isIntradayTf(tf)} examples={starters} />}
      {!asFormula && !fits && (
        <div className="grid gap-2 rounded-[12px] bg-raised px-4 py-3 text-[13.5px] text-ink-2">
          <p>This rule has parts the rows can&apos;t show (it was written as a formula).</p>
          <div className="flex gap-2">
            <Button variant="quiet" className="h-9" onClick={() => setAsFormula(true)}>Show the formula</Button>
            <Button variant="ghost" className="h-9" onClick={() => onChange('')}>Start again with rows</Button>
          </div>
        </div>
      )}
      {asFormula && <FormulaEditor value={value} onChange={onChange} meta={meta} />}
      {emptyText && !value.trim() && !asFormula && <p className="text-[12.5px] text-muted">{emptyText}</p>}
      <button type="button" onClick={() => setAsFormula((a) => !a)} disabled={asFormula && formulaToRows(value) == null}
        title={asFormula && formulaToRows(value) == null ? 'This formula has parts the rows cannot show' : undefined}
        className="justify-self-start text-[12px] font-semibold text-muted hover:text-accent-deep disabled:opacity-50">
        {asFormula ? '← Back to rows' : 'Formula (advanced)'}
      </button>
    </div>
  );
}

/** One settings row: a label and its dropdowns. */
function Row({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex w-[84px] shrink-0 items-center gap-1 text-[13.5px] font-semibold text-ink">{label}{tip && <InfoTip label={label}>{tip}</InfoTip>}</span>
      {children}
    </div>
  );
}


/** The settings most tests leave alone: description, style, time exit, order, ranking, costs. */
function More({ doc, setDoc, s, set }: { doc: StrategyDoc; setDoc: (d: StrategyDoc) => void; s: EquityStrategy; set: (p: Partial<EquityStrategy>) => void }) {
  return (
    <div className="grid gap-4 rounded-[12px] bg-raised p-4">
      <Field label="Description"><textarea value={doc.description} onChange={(e) => setDoc({ ...doc, description: e.target.value })} rows={2} className={`${inputCls} h-auto py-2`} placeholder="What the strategy tries to catch, and why" /></Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Style"><Segmented label="Style" value={doc.style} onChange={(style) => setDoc({ ...doc, style })} options={[{ value: 'intraday', label: 'Intraday' }, { value: 'swing', label: 'Swing' }, { value: 'positional', label: 'Positional' }]} /></Field>
        <Field label="Leave after (candles)" tip="Close the trade after this many candles. Empty = no limit."><NumIn step="1" v={s.maxBars} on={(v) => set({ maxBars: v ? Math.round(v) : undefined })} /></Field>
        <Field label="Entries per stock" tip="Above 1 allows adding to a stock that is already held (pyramiding)."><NumIn step="1" v={s.pyramid} on={(v) => set({ pyramid: Math.round(v ?? 1) })} /></Field>
        <Field label="Wait after an exit (candles)"><NumIn step="1" v={s.cooldownBars} on={(v) => set({ cooldownBars: Math.round(v ?? 0) })} /></Field>
        <Field label="New entries per candle"><NumIn step="1" v={s.maxEntriesPerBar} on={(v) => set({ maxEntriesPerBar: Math.round(v ?? 1) })} /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Order">
          <select value={s.order.type} onChange={(e) => { const t = e.target.value; set({ order: t === 'market' ? { type: 'market' } : { type: t as 'limit' | 'stop', offsetPct: t === 'limit' ? 0.5 : 0.1 } }); }} className={`${inputCls} pr-8`}>
            <option value="market">Market at the next open</option><option value="limit">Limit below the signal close</option><option value="stop">Stop above the signal candle&apos;s high</option>
          </select>
        </Field>
        {s.order.type !== 'market' && <Field label="Offset %"><NumIn v={s.order.offsetPct} on={(v) => set({ order: { ...(s.order as { type: 'limit'; offsetPct: number }), offsetPct: v ?? 0 } })} /></Field>}
        <Field label="Too many signals: prefer the highest" tip="Any value formula. AVG_TURNOVER(20) prefers the most traded stocks; RSI(CLOSE, 14) the strongest; -ATR_PCT(14) the calmest.">
          <input value={s.rank} onChange={(e) => set({ rank: e.target.value })} spellCheck={false} className={`${inputCls} w-[220px] font-mono`} />
        </Field>
        <Field label="Min traded value ₹ cr/day" tip="The stock's 20-day average traded value on the signal day. Thinly traded stocks fill worse than any backtest assumes."><NumIn v={s.minAvgValueCr} on={(v) => set({ minAvgValueCr: v ?? 0 })} /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Slippage % a side" tip="Taken off every fill, against you. 0.05% is mild for liquid large caps; use more for small caps."><NumIn v={s.slippagePct} on={(v) => set({ slippagePct: v ?? 0 })} /></Field>
        <Field label="Risk-free % a year" tip="Used for Sharpe and Sortino: the current 91-day T-bill yield."><NumIn v={s.riskFreePct} on={(v) => set({ riskFreePct: v ?? 0 })} /></Field>
        <label className="flex h-10 items-center gap-2 text-[13.5px]"><input type="checkbox" checked={s.charges} onChange={(e) => set({ charges: e.target.checked })} className="accent-[var(--color-accent)]" /> Include brokerage, STT and other charges</label>
        <label className="flex h-10 items-center gap-2 text-[13.5px]"><input type="checkbox" checked={s.reinvest} onChange={(e) => set({ reinvest: e.target.checked })} className="accent-[var(--color-accent)]" /> Size from current equity (compounding)</label>
      </div>
      <p className="text-[12px] text-muted">Every strategy buys first (short selling isn&apos;t in the backtest yet). Each stock trades only on days it traded, so new listings join late and delisted ones leave. An index list is today&apos;s members, which flatters results (survivorship bias).</p>
    </div>
  );
}
