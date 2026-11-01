'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmt } from '@/lib/format';
import { MOVE_BUCKETS, fetchNiftyDays, filterRows, patternTable, periodTable, type NiftyDaysResponse, type PeriodRow } from '@/lib/research';

type Tab = 'Years' | 'Months' | 'Patterns' | 'Days' | 'Events';
const TABS: Tab[] = ['Years', 'Months', 'Patterns', 'Days', 'Events'];
const EVENT_GROUPS = [
  { id: 'covid', label: 'COVID 2020', match: (id: string) => id.startsWith('covid') },
  { id: 'election', label: 'Election results', match: (id: string) => id.startsWith('election') },
  { id: 'budget', label: 'Budget days', match: (id: string) => id.startsWith('budget') },
  { id: 'other', label: 'Other events', match: (id: string) => !/^(covid|election|budget)/.test(id) },
];

const pct = (x: number | null | undefined, digits = 2) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}%`);
const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'text-up' : x < 0 ? 'text-down' : '');
const of = (n: number, total: number) => (total ? <>{n} <span className="text-muted">/ {total}</span></> : '—');

/** NIFTY day by day from NSE's official closes: counts, buckets and extreme days per year, month and pattern. */
export function NiftyResearch() {
  const [data, setData] = useState<NiftyDaysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Years');
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [monthYear, setMonthYear] = useState('');

  useEffect(() => { fetchNiftyDays().then(setData, (e: Error) => setError(e.message)); }, []);

  const years = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.date.slice(0, 4)))], [data]);
  const excludeIds = useMemo(() => (data?.events ?? []).filter((e) => EVENT_GROUPS.some((g) => excluded.includes(g.id) && g.match(e.id))).map((e) => e.id), [data, excluded]);
  const rows = useMemo(() => (data ? filterRows(data.rows, { fromYear, toYear, excludeEvents: excludeIds }) : []), [data, fromYear, toYear, excludeIds]);
  const byYear = useMemo(() => periodTable(rows, 'year'), [rows]);
  const byMonth = useMemo(() => periodTable(rows, 'month').filter((m) => !monthYear || m.period.startsWith(monthYear)), [rows, monthYear]);
  const patterns = useMemo(() => patternTable(rows), [rows]);
  const removed = (data?.rows.length ?? 0) - rows.length;

  if (error) return <div className="panel p-6 text-[13px] font-semibold text-down">{error}</div>;
  if (!data) return <div className="panel p-6 text-[13px] text-muted">Loading NIFTY history…</div>;

  const periodTableView = (list: PeriodRow[], label: string) => (
    <table className="num w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-panel text-[10.5px] font-bold tracking-[0.04em] text-muted">
        <tr className="border-b border-line">
          <th className="py-1.5 text-left">{label}</th><th className="text-right">DAYS</th><th className="text-right">UP</th><th className="text-right">DOWN</th>
          <th className="text-right">GAP UP</th><th className="text-right">GAP DOWN</th><th className="text-right">GAP ≥1%</th>
          {MOVE_BUCKETS.map((b) => <th key={b.id} className="text-right">MOVE {b.label}</th>)}
          <th className="text-right">BEST DAY</th><th className="text-right">WORST DAY</th><th className="text-right">VIX LOW → HIGH</th><th className="text-right">EXPIRY DAYS</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.period} className="border-b border-line hover:bg-raised">
            <td className="py-1.5 font-sans font-bold">{r.period}{r.eventDays > 0 && <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent-ink" title="Days in this period carry an event tag">{r.eventDays} event</span>}</td>
            <td className="text-right">{r.days}</td>
            <td className="text-right text-up">{of(r.up, r.days)}</td>
            <td className="text-right text-down">{of(r.down, r.days)}</td>
            <td className="text-right">{r.gapUp}</td>
            <td className="text-right">{r.gapDown}</td>
            <td className="text-right">{r.bigGaps}</td>
            {MOVE_BUCKETS.map((b) => <td key={b.id} className="text-right">{r.moves[b.id]}</td>)}
            <td className="text-right"><span className="text-up">{pct(r.bestDay?.pct)}</span> <span className="text-[10.5px] text-muted">{r.bestDay?.date.slice(5)}</span></td>
            <td className="text-right"><span className="text-down">{pct(r.worstDay?.pct)}</span> <span className="text-[10.5px] text-muted">{r.worstDay?.date.slice(5)}</span></td>
            <td className="text-right">{r.vixLow ? `${fmt(r.vixLow.value)} → ${fmt(r.vixHigh!.value)}` : '—'}</td>
            <td className="text-right">{r.expiryDays || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <h2 className="text-[14px] font-extrabold tracking-[-0.02em]">NIFTY day by day</h2>
        <div className="flex rounded-full bg-raised p-[3px]">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-[12px] font-bold ${t === tab ? 'bg-inverse text-on-inverse' : 'text-ink-2'}`}>{t}</button>
          ))}
        </div>
        <span className="ml-auto text-[11.5px] text-muted">{data.source} · {data.from} → {data.to} · {data.rows.length} trading days</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
        <span className="font-semibold">Years</span>
        <select aria-label="From year" className="h-7 rounded-full bg-raised px-2 font-semibold" value={fromYear} onChange={(e) => setFromYear(e.target.value)}>
          <option value="">first</option>{years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <span className="text-muted">to</span>
        <select aria-label="To year" className="h-7 rounded-full bg-raised px-2 font-semibold" value={toYear} onChange={(e) => setToYear(e.target.value)}>
          <option value="">last</option>{years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <span className="ml-3 font-semibold">Leave out</span>
        {EVENT_GROUPS.map((g) => {
          const on = excluded.includes(g.id);
          return (
            <button key={g.id} type="button" aria-pressed={on} onClick={() => setExcluded(on ? excluded.filter((x) => x !== g.id) : [...excluded, g.id])}
              className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${on ? 'bg-inverse text-on-inverse' : 'bg-raised text-ink-2'}`}>{g.label}</button>
          );
        })}
        {removed > 0 && <span className="text-[11.5px] text-muted">{removed} days left out</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {tab === 'Years' && periodTableView(byYear, 'YEAR')}
        {tab === 'Months' && (
          <>
            <div className="py-2 text-[12px]">
              <select aria-label="Months of year" className="h-7 rounded-full bg-raised px-2 font-semibold" value={monthYear} onChange={(e) => setMonthYear(e.target.value)}>
                <option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
              </select>
            </div>
            {periodTableView(byMonth, 'MONTH')}
          </>
        )}
        {tab === 'Patterns' && (
          <>
            <p className="py-2 text-[12px] text-ink-2">Counted separately for every year, so a pattern that changed over time shows as a change. A gap under ±{0.1}% counts as flat.</p>
            <table className="num w-full text-[12px]">
              <thead className="text-[10.5px] font-bold tracking-[0.04em] text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left">YEAR</th>
                  <th className="text-right" colSpan={3}>AFTER AN UP CLOSE, NEXT OPEN: UP / DOWN / FLAT</th>
                  <th className="text-right" colSpan={3}>AFTER A DOWN CLOSE, NEXT OPEN: UP / DOWN / FLAT</th>
                  <th className="text-right" colSpan={2}>GAP-UP DAYS CLOSED ABOVE / BELOW OPEN</th>
                  <th className="text-right" colSpan={2}>GAP-DOWN DAYS CLOSED ABOVE / BELOW OPEN</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map((p) => (
                  <tr key={p.year} className="border-b border-line">
                    <td className="py-1.5 font-sans font-bold">{p.year}</td>
                    <td className="text-right text-up">{p.afterUp.gapUp}</td><td className="text-right text-down">{p.afterUp.gapDown}</td><td className="text-right text-muted">{p.afterUp.gapFlat}</td>
                    <td className="text-right text-up">{p.afterDown.gapUp}</td><td className="text-right text-down">{p.afterDown.gapDown}</td><td className="text-right text-muted">{p.afterDown.gapFlat}</td>
                    <td className="text-right text-up">{p.gapUpClose.aboveOpen}</td><td className="text-right text-down">{p.gapUpClose.belowOpen}</td>
                    <td className="text-right text-up">{p.gapDownClose.aboveOpen}</td><td className="text-right text-down">{p.gapDownClose.belowOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {tab === 'Days' && (
          <table className="num w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-panel text-[10.5px] font-bold tracking-[0.04em] text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left">DATE</th><th className="text-left">DAY</th><th className="text-right">PREV CLOSE</th><th className="text-right">OPEN</th><th className="text-right">GAP</th>
                <th className="text-right">HIGH</th><th className="text-right">LOW</th><th className="text-right">CLOSE</th><th className="text-right">CHANGE</th><th className="text-right">RANGE</th><th className="text-right">VIX</th><th className="text-left">EXPIRY</th><th className="text-left">EVENT</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.date} className="border-b border-line hover:bg-raised">
                  <td className="py-1 font-semibold">{r.date}</td><td className="font-sans text-muted">{r.weekday}</td>
                  <td className="text-right">{r.prevClose == null ? '—' : fmt(r.prevClose)}</td>
                  <td className="text-right">{fmt(r.open)}</td>
                  <td className={`text-right ${tone(r.gapPct)}`}>{r.gapPts == null ? '—' : `${r.gapPts >= 0 ? '+' : '−'}${fmt(Math.abs(r.gapPts))} (${pct(r.gapPct)})`}</td>
                  <td className="text-right">{fmt(r.high)}</td><td className="text-right">{fmt(r.low)}</td><td className="text-right font-semibold">{fmt(r.close)}</td>
                  <td className={`text-right font-semibold ${tone(r.changePct)}`}>{pct(r.changePct)}</td>
                  <td className="text-right text-muted">{r.rangePct == null ? '—' : `${r.rangePct.toFixed(2)}%`}</td>
                  <td className="text-right">{r.vixClose == null ? '—' : fmt(r.vixClose)}</td>
                  <td className="font-sans text-[11px]">{r.expiryDay == null ? <span className="text-muted">no F&amp;O data</span> : r.expiryDay ? 'expiry' : ''}</td>
                  <td className="font-sans text-[11px]">{r.events.map((id) => data.events.find((e) => e.id === id)?.name ?? id).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Events' && (
          <table className="w-full text-[12px]">
            <thead className="text-[10.5px] font-bold tracking-[0.04em] text-muted"><tr className="border-b border-line"><th className="py-1.5 text-left">EVENT</th><th className="text-left">FROM</th><th className="text-left">TO</th><th className="text-left">SOURCE</th></tr></thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} className="border-b border-line"><td className="py-1 font-semibold">{e.name}</td><td className="num">{e.from}</td><td className="num">{e.to}</td><td className="text-muted">{e.source}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pt-2 text-[11px] text-muted">
          Counts and the actual best and worst days, never averages. History grows as the NSE archive download continues back to 2011. Research data, not investment advice.
        </p>
      </div>
    </div>
  );
}
