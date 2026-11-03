'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { AreaSeries, createChart, type UTCTimestamp } from 'lightweight-charts';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { OptionLegSpec, OptionsStrategy, OptionsTrade } from '@mtv/backtest';
import { formatRupees } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { CHART_COLORS, useTheme } from '@/lib/theme';
import { fmtDate, fmtStrike } from '@/lib/options';
import { EXPIRY_LABEL, OPTION_PRESETS, fetchFnoCoverage, runOptionsBacktestApi, type FnoCoverage, type OptionsBacktestResponse } from '@/lib/options-backtest';
import { Rules } from './strategy-builder';
import { InfoTip } from '@/components/info-tip';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri']];
const REASON: Record<string, string> = { expiry: 'Expiry', stop: 'Stop loss', target: 'Target', time: 'Max days', signal: 'Exit signal', 'end-of-data': 'End of data' };
const input = 'num h-8 rounded-[10px] border border-line bg-panel px-2 text-[12.5px] outline-none focus:border-ink';
const select = 'h-8 rounded-[10px] border border-line bg-panel px-1.5 text-[12.5px] outline-none focus:border-ink';
const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'text-up' : 'text-down');

function strikeValue(s: OptionLegSpec['strike']): string {
  return s.by === 'premium' ? 'premium' : s.moneyness === 'ATM' ? 'ATM' : `${s.moneyness}${s.steps}`;
}
function parseStrike(v: string, prev: OptionLegSpec['strike']): OptionLegSpec['strike'] {
  if (v === 'premium') return { by: 'premium', premium: prev.by === 'premium' ? prev.premium : 50 };
  if (v === 'ATM') return { by: 'moneyness', moneyness: 'ATM', steps: 0 };
  return { by: 'moneyness', moneyness: v.slice(0, 3) as 'OTM' | 'ITM', steps: Number(v.slice(3)) };
}

function LegRow({ leg, onChange, onRemove }: { leg: OptionLegSpec; onChange: (l: OptionLegSpec) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-[10px] bg-panel p-1.5">
      <button type="button" onClick={() => onChange({ ...leg, side: leg.side === 'BUY' ? 'SELL' : 'BUY' })}
        className={`h-8 w-9 rounded-md text-[12px] font-bold text-white ${leg.side === 'BUY' ? 'bg-blue' : 'bg-down'}`} aria-label="Buy or sell">{leg.side === 'BUY' ? 'B' : 'S'}</button>
      <select className={select} value={leg.kind} onChange={(e) => onChange({ ...leg, kind: e.target.value as 'CE' | 'PE' })} aria-label="Call or put"><option>CE</option><option>PE</option></select>
      <select className={select} value={strikeValue(leg.strike)} onChange={(e) => onChange({ ...leg, strike: parseStrike(e.target.value, leg.strike) })} aria-label="Strike">
        {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => <option key={`ITM${n}`} value={`ITM${n}`}>ITM {n}</option>)}
        <option value="ATM">ATM</option>
        {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => <option key={`OTM${n}`} value={`OTM${n}`}>OTM {n}</option>)}
        <option value="premium">Premium ≈</option>
      </select>
      {leg.strike.by === 'premium' && (
        <input className={`${input} w-16`} type="number" min="0.05" step="0.05" value={leg.strike.premium} aria-label="Target premium" onChange={(e) => onChange({ ...leg, strike: { by: 'premium', premium: Number(e.target.value) } })} />
      )}
      <select className={select} value={leg.expiry} onChange={(e) => onChange({ ...leg, expiry: e.target.value as OptionLegSpec['expiry'] })} aria-label="Expiry">
        {Object.entries(EXPIRY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input className={`${input} w-12`} type="number" min="1" step="1" value={leg.lots} aria-label="Lots" title="Lots" onChange={(e) => onChange({ ...leg, lots: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
      <span className="text-[11px] text-muted">lots</span>
      <button type="button" onClick={onRemove} className="ml-auto rounded-full p-1.5 text-muted hover:bg-down-soft hover:text-down" aria-label="Remove leg"><Trash2 size={14} /></button>
    </div>
  );
}

export function OptionsBacktest() {
  const [s, setS] = useState<OptionsStrategy>(() => structuredClone(OPTION_PRESETS[0]));
  const [coverage, setCoverage] = useState<FnoCoverage | null>(null);
  const [data, setData] = useState<OptionsBacktestResponse | null>(null);
  // The exit rules the shown result was run with (the form may have changed since).
  const [ranExit, setRanExit] = useState<OptionsStrategy['exit'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchFnoCoverage().then(setCoverage); }, []);
  useEffect(() => {
    try { const raw = localStorage.getItem('mtv.obt.strategy'); if (raw) setS(JSON.parse(raw)); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { try { localStorage.setItem('mtv.obt.strategy', JSON.stringify(s)); } catch { /* storage unavailable */ } }, [s]);

  async function run() {
    setBusy(true); setError(null);
    try { const exit = structuredClone(s.exit); setData(await runOptionsBacktestApi(s)); setRanExit(exit); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const e = s.entry;
  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <div className="grid grid-cols-1 gap-2 lg:min-h-0 lg:grid-cols-[440px_1fr]">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(ev) => { ev.preventDefault(); void run(); }}>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            <select className={`${select} w-full`} value={OPTION_PRESETS.findIndex((p) => JSON.stringify(p) === JSON.stringify(s))} aria-label="Load a preset" onChange={(ev) => { const p = OPTION_PRESETS[Number(ev.target.value)]; if (p) setS(structuredClone(p)); }}>
              <option value={-1}>Load a preset…</option>
              {OPTION_PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name} · {p.underlying}</option>)}
            </select>
            <input className={`${input} w-full font-sans font-bold`} value={s.name} onChange={(ev) => setS({ ...s, name: ev.target.value })} aria-label="Strategy name" />
            <div className="grid grid-cols-3 gap-2">
              <select className={select} value={s.underlying} onChange={(ev) => setS({ ...s, underlying: ev.target.value as 'NIFTY' | 'BANKNIFTY' })} aria-label="Underlying"><option>NIFTY</option><option>BANKNIFTY</option></select>
              <input className={input} type="date" value={s.from ?? coverage?.from ?? ''} min={coverage?.from ?? undefined} max={coverage?.to ?? undefined} onChange={(ev) => setS({ ...s, from: ev.target.value || undefined })} aria-label="From date" />
              <input className={input} type="date" value={s.to ?? coverage?.to ?? ''} min={coverage?.from ?? undefined} max={coverage?.to ?? undefined} onChange={(ev) => setS({ ...s, to: ev.target.value || undefined })} aria-label="To date" />
            </div>
            {coverage && <p className="text-[11px] text-muted">NSE official F&amp;O history available: {coverage.from ? fmtDate(coverage.from) : '—'} → {coverage.to ? fmtDate(coverage.to) : '—'} ({coverage.savedDays} days){coverage.running ? ' · still downloading older years' : ''}.</p>}
            {s.underlying === 'BANKNIFTY' && s.legs.some((l) => l.expiry.startsWith('week')) && <p className="text-[11px] font-semibold text-down">BANKNIFTY has had only monthly expiries since Nov 2024; &ldquo;week&rdquo; picks the nearest listed expiry.</p>}

            <div className="space-y-1.5 rounded-[12px] bg-raised p-2.5">
              <div className="flex items-center justify-between"><p className="flex items-center gap-1.5 text-[13px] font-extrabold">Legs
                <InfoTip label="How strikes are picked">OTM n = n strikes away from ATM (NIFTY 50 points, BANKNIFTY 100). &ldquo;Premium ≈&rdquo; picks the traded strike whose premium is closest to that price.</InfoTip></p>
                <button type="button" onClick={() => setS({ ...s, legs: [...s.legs, { kind: 'CE', side: 'SELL', lots: 1, strike: { by: 'moneyness', moneyness: 'ATM', steps: 0 }, expiry: 'week0' }] })}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-ink-2 hover:bg-panel"><Plus size={14} /> Add leg</button>
              </div>
              {s.legs.map((l, i) => <LegRow key={i} leg={l} onChange={(leg) => setS({ ...s, legs: s.legs.map((x, j) => (j === i ? leg : x)) })} onRemove={() => setS({ ...s, legs: s.legs.filter((_, j) => j !== i) })} />)}
            </div>

            <div className="space-y-2 rounded-[12px] bg-raised p-2.5">
              <p className="text-[13px] font-extrabold">Entry at the day&rsquo;s close</p>
              <select className={`${select} w-full`} value={e.when} aria-label="Entry rule" onChange={(ev) => {
                const w = ev.target.value;
                setS({ ...s, entry: w === 'weekdays' ? { when: 'weekdays', days: [5] } : w === 'daysToExpiry' ? { when: 'daysToExpiry', days: 1 } : w === 'signal' ? { when: 'signal', rules: { match: 'all', conditions: [] } } : { when: 'daily' } });
              }}>
                <option value="daily">Every trading day</option><option value="weekdays">On chosen weekdays</option><option value="daysToExpiry">N trading days before expiry</option><option value="signal">On an indicator signal (underlying, daily)</option>
              </select>
              {e.when === 'weekdays' && (
                <div className="flex gap-1">
                  {WEEKDAYS.map(([d, label]) => (
                    <button key={d} type="button" onClick={() => setS({ ...s, entry: { when: 'weekdays', days: e.days.includes(d) ? e.days.filter((x) => x !== d) : [...e.days, d].sort() } })}
                      className={`flex-1 rounded-full py-1 text-[12px] font-semibold ${e.days.includes(d) ? 'bg-inverse text-on-inverse' : 'bg-panel text-ink-2'}`}>{label}</button>
                  ))}
                </div>
              )}
              {e.when === 'daysToExpiry' && <label className="flex items-center gap-2 text-[12.5px]"><input className={`${input} w-16`} type="number" min="1" value={e.days} onChange={(ev) => setS({ ...s, entry: { when: 'daysToExpiry', days: Math.max(1, Math.floor(Number(ev.target.value) || 1)) } })} /> trading days before the first leg&rsquo;s expiry</label>}
              {e.when === 'signal' && <Rules title="Signal" rules={e.rules} onChange={(rules) => setS({ ...s, entry: { when: 'signal', rules } })} />}
              {e.when === 'signal' && <p className="text-[11px] text-muted">A signal at a day&rsquo;s close enters at the next day&rsquo;s close (no look-ahead).</p>}
            </div>

            <div className="space-y-2 rounded-[12px] bg-raised p-2.5">
              <p className="flex items-center gap-1.5 text-[13px] font-extrabold">Exit (always by expiry)
                <InfoTip label="How exits are checked">Stops and targets are checked at each day&rsquo;s close, not during the day, so a trade can lose more than the stop (for example on a big move on expiry day). Intraday stops need minute data.</InfoTip></p>
              <div className="grid grid-cols-2 gap-2 text-[12px] font-semibold text-ink-2">
                <label>Stop loss ₹<input className={`${input} mt-1 w-full`} type="number" min="0" placeholder="Off" value={s.exit.stopLossRupees ?? ''} onChange={(ev) => setS({ ...s, exit: { ...s.exit, stopLossRupees: num(ev.target.value) } })} /></label>
                <label>Target ₹<input className={`${input} mt-1 w-full`} type="number" min="0" placeholder="Off" value={s.exit.targetRupees ?? ''} onChange={(ev) => setS({ ...s, exit: { ...s.exit, targetRupees: num(ev.target.value) } })} /></label>
                <label>Stop loss % of premium<input className={`${input} mt-1 w-full`} type="number" min="0" placeholder="Off" value={s.exit.stopLossPct ?? ''} onChange={(ev) => setS({ ...s, exit: { ...s.exit, stopLossPct: num(ev.target.value) } })} /></label>
                <label>Target % of premium<input className={`${input} mt-1 w-full`} type="number" min="0" placeholder="Off" value={s.exit.targetPct ?? ''} onChange={(ev) => setS({ ...s, exit: { ...s.exit, targetPct: num(ev.target.value) } })} /></label>
                <label>Max trading days held<input className={`${input} mt-1 w-full`} type="number" min="1" placeholder="Off" value={s.exit.holdDays ?? ''} onChange={(ev) => setS({ ...s, exit: { ...s.exit, holdDays: num(ev.target.value) } })} /></label>
              </div>
              <Rules title="Exit signal" optional rules={s.exit.signal ?? { match: 'any', conditions: [] }} onChange={(signal) => setS({ ...s, exit: { ...s.exit, signal: signal.conditions.length ? signal : undefined } })} />
            </div>
          </div>
          <div className="border-t border-line p-3">
            <button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-inverse font-bold text-on-inverse disabled:opacity-50">{busy ? 'Running…' : 'Run options backtest'}</button>
          </div>
        </form>
      </section>

      <section className="panel flex min-h-0 flex-col overflow-hidden">
        {error && <p role="alert" className="m-3 rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}
        {data ? <OptionsResults data={data} exit={ranExit} /> : !error && (
          <p className="m-auto max-w-[380px] px-4 text-center text-[13px] leading-relaxed text-ink-2">
            Add legs, choose when to enter (by day or on an indicator signal) and test on NSE&rsquo;s end-of-day option prices.
          </p>
        )}
      </section>
    </div>
  );
}

function OptionsResults({ data, exit }: { data: OptionsBacktestResponse; exit: OptionsStrategy['exit'] | null }) {
  const { result } = data;
  const m = result.metrics;
  // The loss at which the engine's stop fires for a trade (gross, before charges), as it computes it: the ₹ stop or
  // the % of the net premium, whichever is hit first. Stops are checked at each day's close, so a trade can close
  // further down than this (a gap, or a big move on the only day held, e.g. entry the day before expiry).
  const stopAt = (t: OptionsTrade): number | null => {
    const basis = Math.abs(t.legs.reduce((sum, l) => sum + (l.side === 'SELL' ? 1 : -1) * l.qty * l.entryPaise, 0));
    const limits = [exit?.stopLossRupees ? exit.stopLossRupees * 100 : null, exit?.stopLossPct ? (basis * exit.stopLossPct) / 100 : null].filter((v): v is number => v != null);
    return limits.length ? Math.min(...limits) : null;
  };
  const beyond = (t: OptionsTrade) => { const lim = stopAt(t); return lim != null && t.grossPaise < -lim; };
  const beyondCount = result.trades.filter(beyond).length;
  const chartEl = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const C = CHART_COLORS[useTheme()];

  useEffect(() => {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-outfit').trim() || 'system-ui';
    const chart = createChart(chartEl.current!, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: `${font}, system-ui, sans-serif` },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line }, timeScale: { borderColor: C.line, minBarSpacing: 0.05 },
      localization: { priceFormatter: (v: number) => fmt(v) },
    });
    const area = chart.addSeries(AreaSeries, { lineColor: C.ink, topColor: 'rgba(245,154,11,0.32)', bottomColor: 'rgba(245,154,11,0.02)', lineWidth: 2, priceLineVisible: false });
    area.setData(result.equity.map((e) => ({ time: (Date.parse(e.date + 'T00:00:00Z') / 1000) as UTCTimestamp, value: e.equityPaise / 100 })));
    area.createPriceLine({ price: 0, color: C.zero, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: '' });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => chart.timeScale().fitContent()));
    return () => { cancelAnimationFrame(raf); chart.remove(); };
  }, [result, C]);

  const years = [...new Set(Object.keys(m.monthly).map((k) => k.slice(0, 4)))].sort();
  const maxAbs = Math.max(1, ...Object.values(m.monthly).map(Math.abs));
  const card = (label: string, value: string, cls = '', sub?: string) => (
    <div className="min-w-0 rounded-[12px] bg-raised px-3 py-2"><p className="truncate text-[11px] font-semibold text-muted">{label}</p><p className={`num truncate text-[16px] font-semibold ${cls}`}>{value}</p>{sub && <p className="num truncate text-[11px] text-muted">{sub}</p>}</div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-[-0.02em]">Options backtest
          <InfoTip label="About this backtest">
            <p>Simulated on NSE&rsquo;s official daily closing prices: real fills differ (spreads, slippage, intraday moves). Stops are checked at the daily close. Expiry settles at intrinsic value against the index&rsquo;s official close.</p>
            <p>Past performance does not guarantee future results. Not investment advice.</p>
          </InfoTip></p>
        <p className="num text-[12px] text-muted">{m.from ? fmtDate(m.from) : ''} → {m.to ? fmtDate(m.to) : ''} · {m.days} trading days · NSE official end-of-day data</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {card('Net P&L', formatRupees(m.netPaise), tone(m.netPaise), `Gross ${formatRupees(m.grossPaise)}`)}
        {card('Trades', String(m.trades), '', `${m.wins} won · ${m.losses} lost`)}
        {card('Win rate', m.winRatePct == null ? '—' : `${m.winRatePct.toFixed(1)}%`, '', m.profitFactor == null ? undefined : `Profit factor ${m.profitFactor.toFixed(2)}`)}
        {card('Max drawdown', formatRupees(-m.maxDrawdownPaise), m.maxDrawdownPaise ? 'text-down' : '', `Losing streak ${m.maxConsecutiveLosses}`)}
        {card('Avg win', m.avgWinPaise == null ? '—' : formatRupees(m.avgWinPaise), 'text-up')}
        {card('Avg loss', m.avgLossPaise == null ? '—' : formatRupees(m.avgLossPaise), 'text-down')}
        {card('Largest loss', m.largestLossPaise == null ? '—' : formatRupees(m.largestLossPaise), 'text-down')}
        {card('Charges paid', formatRupees(m.chargesPaise), '', 'Brokerage, STT, exchange, SEBI, stamp, GST')}
      </div>
      {beyondCount > 0 && (
        <p className="rounded-[12px] bg-accent-soft px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          <b className="text-ink">{beyondCount} trade{beyondCount > 1 ? 's' : ''} lost more than the stop loss.</b> Stops are checked once a day, at NSE&rsquo;s closing
          prices: a position is not closed during the day. When the market moves sharply before a close (or the only close is on expiry day), the loss at that close is
          the loss taken. These trades are marked <span className="font-semibold text-down">past stop</span> below. Intraday stops need minute data.
        </p>
      )}

      <div className="relative h-[220px] overflow-hidden rounded-[12px] border border-line">
        <p className="absolute top-2 left-3 z-10 text-[12px] font-bold">Cumulative P&amp;L (₹, after charges)</p>
        <div ref={chartEl} className="absolute inset-0" />
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_220px]">
        <div className="rounded-[12px] border border-line p-2">
          <p className="mb-1 px-1 text-[12px] font-bold">Monthly P&amp;L<span className="font-normal text-muted md:hidden"> · by quarter</span></p>
          <table className="num hidden w-full text-[11px] md:table">
            <thead><tr className="text-muted"><th className="text-left">Year</th>{MONTHS.map((mo) => <th key={mo} className="px-0.5 font-semibold">{mo}</th>)}<th className="pl-1 text-right font-semibold">Total</th></tr></thead>
            <tbody>
              {years.map((y) => {
                const total = MONTHS.reduce((s, _, i) => s + (m.monthly[`${y}-${String(i + 1).padStart(2, '0')}`] ?? 0), 0);
                return (
                  <tr key={y}>
                    <td className="font-semibold">{y}</td>
                    {MONTHS.map((_, i) => {
                      const v = m.monthly[`${y}-${String(i + 1).padStart(2, '0')}`];
                      const a = v == null ? 0 : 0.12 + 0.55 * (Math.abs(v) / maxAbs);
                      return (
                        <td key={i} className="p-0.5">
                          <div className="rounded px-1 py-1 text-center" title={v == null ? 'No trades' : formatRupees(v)}
                            style={{ background: v == null ? 'var(--color-raised)' : v >= 0 ? `rgba(10,155,118,${a})` : `rgba(229,72,77,${a})` }}>
                            {v == null ? '' : Math.round(v / 100 / 1000) === 0 ? (v / 100).toFixed(0) : `${(v / 100 / 1000).toFixed(1)}k`}
                          </div>
                        </td>
                      );
                    })}
                    <td className={`pl-1 text-right font-semibold ${tone(total)}`}>{(total / 100 / 1000).toFixed(1)}k</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Phones: the same P&L by quarter, so the grid fits the screen. */}
          <table className="num w-full text-[11px] md:hidden">
            <thead><tr className="text-muted"><th className="text-left">Year</th>{['Q1', 'Q2', 'Q3', 'Q4'].map((q) => <th key={q} className="px-0.5 font-semibold">{q}</th>)}<th className="pl-1 text-right font-semibold">Total</th></tr></thead>
            <tbody>
              {years.map((y) => {
                const month = (i: number) => m.monthly[`${y}-${String(i + 1).padStart(2, '0')}`];
                const quarters = [0, 1, 2, 3].map((q) => { const vs = [0, 1, 2].map((k) => month(q * 3 + k)).filter((v): v is number => v != null); return vs.length ? vs.reduce((a, b) => a + b, 0) : null; });
                const total = quarters.reduce<number>((a, v) => a + (v ?? 0), 0);
                const qMax = Math.max(1, ...years.flatMap((yy) => [0, 1, 2, 3].map((q) => Math.abs([0, 1, 2].reduce((a, k) => a + (m.monthly[`${yy}-${String(q * 3 + k + 1).padStart(2, '0')}`] ?? 0), 0)))));
                return (
                  <tr key={y}>
                    <td className="font-semibold">{y}</td>
                    {quarters.map((v, q) => {
                      const a = v == null ? 0 : 0.12 + 0.55 * (Math.abs(v) / qMax);
                      return (
                        <td key={q} className="p-0.5">
                          <div className="rounded px-1 py-1 text-center" title={v == null ? 'No trades' : formatRupees(v)}
                            style={{ background: v == null ? 'var(--color-raised)' : v >= 0 ? `rgba(10,155,118,${a})` : `rgba(229,72,77,${a})` }}>
                            {v == null ? '' : Math.round(v / 100 / 1000) === 0 ? (v / 100).toFixed(0) : `${(v / 100 / 1000).toFixed(1)}k`}
                          </div>
                        </td>
                      );
                    })}
                    <td className={`pl-1 text-right font-semibold ${tone(total)}`}>{(total / 100 / 1000).toFixed(1)}k</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-[12px] border border-line p-2">
          <p className="mb-1 text-[12px] font-bold">By entry weekday</p>
          {WEEKDAYS.map(([, d]) => {
            const v = m.byWeekday[d];
            return <div key={d} className="flex justify-between py-0.5 text-[12px]"><span className="text-muted">{d}</span><span className={`num font-semibold ${tone(v ?? 0)}`}>{v == null ? '—' : formatRupees(v)}</span></div>;
          })}
          {(result.skipped.length > 0 || m.settledLegDays > 0) && (
            <div className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
              {result.skipped.length > 0 && <p><b className="text-ink">{result.skipped.length}</b> entries skipped (e.g. {result.skipped[0].reason} on {fmtDate(result.skipped[0].date)}).</p>}
              {m.settledLegDays > 0 && <p className="mt-1"><b className="text-ink">{m.settledLegDays}</b> leg-days valued at NSE settlement price (no trades that day).</p>}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[12px] border border-line">
        <p className="px-3 py-2 text-[13px] font-extrabold">Trades</p>
        <div className="max-lg:max-h-[70dvh] max-lg:overflow-auto"><table className="num w-full text-[12px]">
          <thead><tr className="text-[10.5px] font-bold tracking-[0.05em] text-muted uppercase">{['', 'Entry', 'Exit', 'Spot', 'Exit reason', 'Gross', 'Charges', 'Net'].map((h) => <th key={h} className={`px-2 py-1 text-right first:text-left ${['Spot', 'Exit reason', 'Gross', 'Charges'].includes(h) ? 'hidden md:table-cell' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {[...result.trades].reverse().map((t, i) => (
              <Fragment key={t.entryDate + i}>
                <tr className="cursor-pointer border-t border-line text-right hover:bg-raised" onClick={() => setOpen(open === i ? null : i)}>
                  <td className="px-2 py-1.5 text-left text-muted">{open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                  <td className="px-2 whitespace-nowrap">{fmtDate(t.entryDate)}</td>
                  <td className="px-2 whitespace-nowrap">{fmtDate(t.exitDate)}</td>
                  <td className="hidden md:table-cell px-2">{fmt(t.spotEntryPaise / 100)} → {fmt(t.spotExitPaise / 100)}</td>
                  <td className="hidden md:table-cell px-2 font-sans">{REASON[t.exitReason]}</td>
                  <td className={`hidden md:table-cell px-2 ${tone(t.grossPaise)}`}>{formatRupees(t.grossPaise)}</td>
                  <td className="hidden md:table-cell px-2">{formatRupees(t.chargesPaise)}</td>
                  <td className={`px-2 font-semibold whitespace-nowrap ${tone(t.netPaise)}`}>
                    {beyond(t) && <span className="mr-1.5 rounded bg-down-soft px-1 py-0.5 font-sans text-[10px] font-bold text-down" title={`Lost more than the ${formatRupees(stopAt(t)!)} stop: stops are checked at the day’s close only`}>past stop</span>}
                    {formatRupees(t.netPaise)}
                  </td>
                </tr>
                {open === i && t.legs.map((l, j) => (
                  <tr key={j} className="bg-raised text-right text-[11.5px] text-ink-2">
                    <td />
                    <td colSpan={2} className={`px-2 text-left font-sans font-semibold ${l.side === 'BUY' ? 'text-blue' : 'text-down'}`}>{l.side} {l.qty} × {fmtStrike(l.strikePaise)} {l.kind} · {fmtDate(l.expiry).slice(0, 6)}</td>
                    <td className="px-2 whitespace-nowrap">{fmt(l.entryPaise / 100)} → {fmt(l.exitPaise / 100)}</td>
                    <td colSpan={4} className="hidden px-2 text-muted md:table-cell">{l.settledDays ? `${l.settledDays} day(s) at settlement price` : ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table></div>
        {!result.trades.length && <p className="px-3 pb-4 text-[13px] text-muted">No trades: the entry rules never fired, or every entry was skipped (see notes).</p>}
      </div>
    </div>
  );
}
