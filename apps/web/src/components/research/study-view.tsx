'use client';

import { useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { RuleSet } from '@mtv/backtest';
import { EOD_TIMEFRAMES, type EodTimeframe } from '@mtv/shared';
import { Rules } from '@/components/backtest/strategy-builder';
import { fmt, tfLabel } from '@/lib/format';
import { STUDY_PRESETS, runStudy, type PeriodStats, type StudyResult } from '@/lib/study';

const GROUPS = [{ id: 'covid', label: 'COVID 2020' }, { id: 'election', label: 'Election results' }, { id: 'budget', label: 'Budget days' }];
const pct = (n: number, d = 2) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`;
const share = (a: number, n: number) => (n ? `${Math.round((a / n) * 100)}%` : '—');

/** Research engine: every time a condition held, what happened next; counted by year and month against all days. */
export function StudyView() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [allStocks, setAllStocks] = useState(false);
  const [tf, setTf] = useState<EodTimeframe>('D');
  const [rules, setRules] = useState<RuleSet>(structuredClone(STUDY_PRESETS[0].rules));
  const [excluded, setExcluded] = useState<string[]>([]);
  const [tab, setTab] = useState<'Years' | 'Months' | 'Events' | 'Data breaks'>('Years');
  const [h, setH] = useState(0); // which horizon the tables show
  const [result, setResult] = useState<StudyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const run = async () => {
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setBusy(true); setError(null);
    try {
      setResult(await runStudy({ symbol: allStocks ? 'ALL' : symbol.trim().toUpperCase(), tf, rules, excludeEvents: excluded }, ctrl.current.signal));
      setH(0);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const totals = useMemo(() => {
    if (!result) return null;
    const sum = (k: number) => result.years.reduce((a, y) => ({ up: a.up + y.outcomes[k].up, down: a.down + y.outcomes[k].down, n: a.n + y.outcomes[k].up + y.outcomes[k].down + y.outcomes[k].flat, bUp: a.bUp + y.baseline[k].up, bN: a.bN + y.baseline[k].total }), { up: 0, down: 0, n: 0, bUp: 0, bN: 0 });
    return result.horizons.map((_, k) => sum(k));
  }, [result]);

  const table = (list: PeriodStats[], label: string) => result && (
    <table className="num w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-panel text-[10.5px] font-bold tracking-[0.04em] text-muted">
        <tr className="border-b border-line">
          <th className="py-1.5 text-left">{label}</th><th className="text-right">EVENTS</th>
          <th className="text-right">UP / DOWN AFTER {result.horizons[h]} BAR{result.horizons[h] > 1 ? 'S' : ''}</th><th className="text-right">UP SHARE</th>
          <th className="text-right" title="Every bar in the same period, for comparison">ANY DAY UP SHARE</th>
          <th className="text-right">BEST</th><th className="text-right">WORST</th>
          <th className="text-right" title="Events whose window crossed a data break (unrecorded split, unadjustable action, extreme gap): not counted">SKIPPED</th>
        </tr>
      </thead>
      <tbody>
        {[...list].reverse().map((p) => {
          const o = p.outcomes[h], b = p.baseline[h], n = o.up + o.down + o.flat;
          return (
            <tr key={p.period} className="border-b border-line hover:bg-raised">
              <td className="py-1.5 font-sans font-bold">{p.period}</td>
              <td className="text-right">{p.events}</td>
              <td className="text-right"><span className="text-up">{o.up}</span> / <span className="text-down">{o.down}</span>{o.flat ? <span className="text-muted"> / {o.flat} flat</span> : ''}</td>
              <td className="text-right font-semibold">{share(o.up, n)}</td>
              <td className="text-right text-muted">{share(b.up, b.total)}</td>
              <td className="text-right">{o.best ? <><span className="text-up">{pct(o.best.pct)}</span> <span className="text-[10.5px] text-muted">{o.best.date.slice(5)}{allStocks ? ` ${o.best.symbol}` : ''}</span></> : '—'}</td>
              <td className="text-right">{o.worst ? <><span className="text-down">{pct(o.worst.pct)}</span> <span className="text-[10.5px] text-muted">{o.worst.date.slice(5)}{allStocks ? ` ${o.worst.symbol}` : ''}</span></> : '—'}</td>
              <td className="text-right text-muted">{p.skipped[h] || ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[400px_1fr]">
      <section className="panel flex min-h-0 flex-col gap-3 overflow-auto p-3">
        <h2 className="text-[14px] font-extrabold tracking-[-0.02em]">Condition study</h2>
        <p className="text-[12px] leading-snug text-ink-2">Finds every day the condition was true and shows what happened next, year by year, compared with all days.</p>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <input aria-label="Symbol" disabled={allStocks} value={symbol} onChange={(e) => setSymbol(e.target.value)} className="num h-9 w-32 rounded-[10px] border border-line px-2.5 font-semibold uppercase disabled:opacity-40" />
          <label className="flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={allStocks} onChange={(e) => setAllStocks(e.target.checked)} /> All NSE stocks</label>
          <div className="ml-auto flex rounded-full bg-raised p-[3px]">
            {EOD_TIMEFRAMES.map((t) => <button key={t} type="button" onClick={() => setTf(t)} className={`num rounded-full px-2.5 py-0.5 text-[12px] font-bold ${t === tf ? 'bg-inverse text-on-inverse' : ''}`}>{tfLabel(t)}</button>)}
          </div>
        </div>
        <select aria-label="Example condition" className="h-9 rounded-[10px] border border-line bg-panel px-2 text-[13px]" value={STUDY_PRESETS.find((p) => JSON.stringify(p.rules) === JSON.stringify(rules))?.id ?? ''} onChange={(e) => { const p = STUDY_PRESETS.find((x) => x.id === e.target.value); if (p) setRules(structuredClone(p.rules)); }}>
          <option value="">Load an example…</option>
          {STUDY_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Rules title="Condition" rules={rules} onChange={setRules} />
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="font-semibold">Leave out</span>
          {GROUPS.map((g) => {
            const on = excluded.includes(g.id);
            return <button key={g.id} type="button" aria-pressed={on} onClick={() => setExcluded(on ? excluded.filter((x) => x !== g.id) : [...excluded, g.id])} className={`rounded-full px-2.5 py-0.5 font-semibold ${on ? 'bg-inverse text-on-inverse' : 'bg-raised text-ink-2'}`}>{g.label}</button>;
          })}
        </div>
        <button type="button" onClick={() => void run()} disabled={busy || !rules.conditions.length} className="flex items-center justify-center gap-2 rounded-full bg-inverse py-2.5 text-[13px] font-bold text-on-inverse hover:bg-inverse-hover disabled:opacity-50">
          <Play size={14} aria-hidden="true" /> {busy ? (allStocks ? 'Studying every NSE stock…' : 'Studying…') : 'Run study'}
        </button>
        {error && <p className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] font-semibold text-down">{error}</p>}
      </section>

      <section className="panel flex min-h-0 flex-col overflow-hidden">
        {!result ? <p className="m-auto max-w-sm text-center text-[13px] text-muted">Choose a condition and click Run study.</p> : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 text-[12px]">
              <div className="flex rounded-full bg-raised p-[3px]">
                {(['Years', 'Months', 'Events', 'Data breaks'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 font-bold ${t === tab ? 'bg-inverse text-on-inverse' : 'text-ink-2'}`}>{t}</button>)}
              </div>
              <span className="font-semibold">After</span>
              <div className="flex rounded-full bg-raised p-[3px]">
                {result.horizons.map((x, k) => <button key={x} type="button" onClick={() => setH(k)} className={`num rounded-full px-2.5 py-0.5 font-bold ${k === h ? 'bg-inverse text-on-inverse' : ''}`}>{x} bar{x > 1 ? 's' : ''}</button>)}
              </div>
              <span className="ml-auto text-muted">
                {result.totalEvents.toLocaleString('en-IN')} events in {result.symbols.toLocaleString('en-IN')} symbol{result.symbols > 1 ? 's' : ''} · {tfLabel(result.tf)}
                {result.excluded.length ? ` · ${result.excluded.length} event periods left out` : ''}
                {totals && ` · overall up after ${result.horizons[h]}: ${share(totals[h].up, totals[h].n)} (any day ${share(totals[h].bUp, totals[h].bN)})`}
              </span>
            </div>
            <div className="max-lg:max-h-[75dvh] min-h-0 flex-1 overflow-auto px-3 pb-3">
              {tab === 'Years' && table(result.years, 'YEAR')}
              {tab === 'Months' && table(result.months, 'MONTH')}
              {tab === 'Data breaks' && (
                <>
                  <p className="py-2 text-[12px] text-ink-2">
                    Days where a stock&rsquo;s price history is not continuous: an ISIN change with no split or bonus in NSE&rsquo;s corporate-action file, a
                    corporate action that can&rsquo;t be adjusted exactly, or an opening gap over 50%. No outcome is measured across them.
                    {' '}{result.dataBreaks.count.toLocaleString('en-IN')} in this study{result.dataBreaks.count > result.dataBreaks.latest.length ? `; latest ${result.dataBreaks.latest.length} shown` : ''}.
                  </p>
                  <table className="w-full text-[12px]">
                    <thead className="text-[10.5px] font-bold tracking-[0.04em] text-muted"><tr className="border-b border-line"><th className="py-1.5 text-left">DATE</th><th className="text-left">SYMBOL</th><th className="text-left">WHY</th></tr></thead>
                    <tbody>{result.dataBreaks.latest.map((x) => <tr key={x.symbol + x.date} className="border-b border-line"><td className="num py-1 font-semibold">{x.date}</td><td>{x.symbol}</td><td className="text-ink-2">{x.reason}</td></tr>)}</tbody>
                  </table>
                </>
              )}
              {tab === 'Events' && (
                <table className="num w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-panel text-[10.5px] font-bold tracking-[0.04em] text-muted">
                    <tr className="border-b border-line">
                      <th className="py-1.5 text-left">DATE</th><th className="text-left">SYMBOL</th><th className="text-right">CLOSE</th>
                      {result.horizons.map((x) => <th key={x} className="text-right">AFTER {x}</th>)}
                      <th className="text-right" title={`Biggest rise and fall within ${result.horizons[h]} bars`}>MAX UP / DOWN ({result.horizons[h]})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.events.map((e) => (
                      <tr key={`${e.symbol}${e.date}`} className="border-b border-line hover:bg-raised">
                        <td className="py-1 font-semibold">{e.date}</td><td className="font-sans">{e.symbol}</td><td className="text-right">{fmt(e.close)}</td>
                        {e.out.map((o, k) => <td key={k} className={`text-right ${o ? (o.pct > 0 ? 'text-up' : o.pct < 0 ? 'text-down' : '') : 'text-muted'}`}>{o ? pct(o.pct) : e.broken[k] ? 'break' : 'not yet'}</td>)}
                        <td className="text-right">{e.out[h] ? <><span className="text-up">{pct(e.out[h]!.maxUpPct)}</span> / <span className="text-down">{pct(e.out[h]!.maxDownPct)}</span></> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="pt-2 text-[11px] text-muted">
                Up share = events whose close {result.horizons[h]} bar(s) later was higher ÷ events with that many bars after them. Events close together have overlapping windows and are all counted.
                {result.totalEvents > result.events.length ? ` Event list shows the latest ${result.events.length.toLocaleString('en-IN')}.` : ''} Research data, not investment advice.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
