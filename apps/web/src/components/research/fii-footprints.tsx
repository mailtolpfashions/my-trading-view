'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmt } from '@/lib/format';
import { PARTICIPANTS, dayRows, fetchFii, nextDayRows, periodRows, type DayRow, type FiiResponse, type PeriodRow } from '@/lib/fii';

type Tab = 'Days' | 'Months' | 'Years' | 'FII vs next day';
const TABS: Tab[] = ['Days', 'Months', 'Years', 'FII vs next day'];

const int = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-IN')}`);
const crore = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr`);
const pct = (n: number | null | undefined, d = 1) => (n == null ? '—' : `${n.toFixed(d)}%`);
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'text-up' : n < 0 ? 'text-down' : '');

/** FII footprints: who holds what in index derivatives, what FIIs traded, and FPI cash flows, day by day. */
export function FiiFootprints() {
  const [data, setData] = useState<FiiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Days');
  const [fromYear, setFromYear] = useState('');
  useEffect(() => { fetchFii().then(setData, (e: Error) => setError(e.message)); }, []);

  const all = useMemo(() => (data ? dayRows(data.rows) : []), [data]);
  const years = useMemo(() => [...new Set(all.map((r) => r.date.slice(0, 4)))], [all]);
  const rows = useMemo(() => all.filter((r) => !fromYear || r.date.slice(0, 4) >= fromYear), [all, fromYear]);
  const coverage = useMemo(() => {
    const first = (pick: (r: DayRow) => unknown) => all.find((r) => pick(r) != null)?.date ?? '—';
    return { positions: first((r) => r.fii), stats: first((r) => r.fiiIndexFutNetCr), flows: first((r) => r.fpiEquityNetCr) };
  }, [all]);

  if (error) return <div className="panel p-6 text-[13px] font-semibold text-down">{error}</div>;
  if (!data) return <div className="panel p-6 text-[13px] text-muted">Loading FII data…</div>;

  const periodView = (list: PeriodRow[], label: string) => (
    <table className="num w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-panel text-[10.5px] font-bold tracking-[0.04em] text-muted">
        <tr className="border-b border-line">
          <th className="py-1.5 text-left">{label}</th><th className="text-right">DAYS</th>
          <th className="text-right">FII INDEX FUT NET: FIRST → LAST DAY</th><th className="text-right">FII LONG SHARE: LOW → HIGH</th>
          <th className="text-right">FII INDEX FUT BUY − SELL (TOTAL)</th><th className="text-right">FPI EQUITY NET (TOTAL, NSDL)</th><th className="text-right">NIFTY: FIRST → LAST CLOSE</th>
        </tr>
      </thead>
      <tbody>
        {[...list].reverse().map((r) => (
          <tr key={r.period} className="border-b border-line hover:bg-raised">
            <td className="py-1.5 font-sans font-bold">{r.period}</td>
            <td className="text-right">{r.days}</td>
            <td className="text-right"><span className={tone(r.fiiNetStart)}>{int(r.fiiNetStart)}</span> → <span className={`font-semibold ${tone(r.fiiNetEnd)}`}>{int(r.fiiNetEnd)}</span></td>
            <td className="text-right">{r.longPctLow ? <>{pct(r.longPctLow.pct)} <span className="text-[10.5px] text-muted">{r.longPctLow.date.slice(5)}</span> → {pct(r.longPctHigh!.pct)} <span className="text-[10.5px] text-muted">{r.longPctHigh!.date.slice(5)}</span></> : '—'}</td>
            <td className={`text-right ${tone(r.fiiIndexFutNetCrTotal)}`}>{crore(r.fiiIndexFutNetCrTotal)}</td>
            <td className={`text-right ${tone(r.fpiEquityNetCrTotal)}`}>{crore(r.fpiEquityNetCrTotal)}</td>
            <td className="text-right">{r.niftyStart == null ? '—' : `${fmt(r.niftyStart)} → ${fmt(r.niftyEnd!)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <h2 className="text-[14px] font-extrabold tracking-[-0.02em]">FII footprints</h2>
        <div className="flex rounded-full bg-raised p-[3px]">
          {TABS.map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-[12px] font-bold ${t === tab ? 'bg-inverse text-on-inverse' : 'text-ink-2'}`}>{t}</button>)}
        </div>
        <select aria-label="From year" className="h-7 rounded-full bg-raised px-2 text-[12px] font-semibold" value={fromYear} onChange={(e) => setFromYear(e.target.value)}>
          <option value="">All years</option>{years.map((y) => <option key={y} value={y}>From {y}</option>)}
        </select>
        <span className="ml-auto text-[11px] text-muted">Positions from {coverage.positions} · FII statistics from {coverage.stats} · NSDL flows from {coverage.flows} · history still downloading</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {tab === 'Days' && (
          <table className="num w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-panel text-[10.5px] font-bold tracking-[0.04em] text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left">DATE</th><th className="text-right">NIFTY</th><th className="text-right">CHG</th>
                <th className="text-right" title="Index futures: contracts long − short">FII FUT NET</th><th className="text-right">DAY CHG</th><th className="text-right" title="Long ÷ (long + short)">FII LONG %</th>
                <th className="text-right" title="Index calls bought − sold">FII CALLS NET</th><th className="text-right" title="Index puts bought − sold">FII PUTS NET</th>
                {PARTICIPANTS.filter((p) => p !== 'FII').map((p) => <th key={p} className="text-right">{p.toUpperCase()} FUT NET</th>)}
                <th className="text-right" title="NSE FII statistics: index futures bought − sold, ₹ crore">FII FUT BUY−SELL</th>
                <th className="text-right" title="NSDL: FPI equity net investment (reporting date)">FPI EQUITY NET</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.date} className="border-b border-line hover:bg-raised">
                  <td className="py-1 font-semibold">{r.date}</td>
                  <td className="text-right">{r.nifty ? fmt(r.nifty.close) : '—'}</td>
                  <td className={`text-right ${tone(r.nifty?.changePct)}`}>{r.nifty?.changePct == null ? '—' : `${r.nifty.changePct >= 0 ? '+' : ''}${r.nifty.changePct.toFixed(2)}%`}</td>
                  <td className={`text-right font-semibold ${tone(r.fii?.futNet)}`}>{int(r.fii?.futNet)}</td>
                  <td className={`text-right ${tone(r.fiiFutNetChange)}`}>{int(r.fiiFutNetChange)}</td>
                  <td className="text-right">{pct(r.fii?.longPct)}</td>
                  <td className={`text-right ${tone(r.fii?.callNet)}`}>{int(r.fii?.callNet)}</td>
                  <td className={`text-right ${tone(r.fii?.putNet)}`}>{int(r.fii?.putNet)}</td>
                  {(['DII', 'Pro', 'Client'] as const).map((p) => <td key={p} className={`text-right ${tone(r.others[p]?.futNet)}`}>{int(r.others[p]?.futNet)}</td>)}
                  <td className={`text-right ${tone(r.fiiIndexFutNetCr)}`}>{crore(r.fiiIndexFutNetCr)}</td>
                  <td className={`text-right ${tone(r.fpiEquityNetCr)}`}>{crore(r.fpiEquityNetCr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Months' && periodView(periodRows(rows, 'month'), 'MONTH')}
        {tab === 'Years' && periodView(periodRows(rows, 'year'), 'YEAR')}
        {tab === 'FII vs next day' && (
          <>
            <p className="py-2 text-[12px] text-ink-2">
              On days FIIs <b>raised</b> their index-futures net position, how often NIFTY rose or fell the <b>next</b> trading day, and the same for days
              they <b>cut</b> it. Counted per year.
            </p>
            <table className="num w-full text-[12px]">
              <thead className="text-[10.5px] font-bold tracking-[0.04em] text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left">YEAR</th>
                  <th className="text-right" colSpan={2}>FII RAISED NET → NEXT DAY UP / DOWN</th>
                  <th className="text-right" colSpan={2}>FII CUT NET → NEXT DAY UP / DOWN</th>
                  <th className="text-right">UNCHANGED</th>
                </tr>
              </thead>
              <tbody>
                {nextDayRows(rows).map((r) => (
                  <tr key={r.year} className="border-b border-line">
                    <td className="py-1.5 font-sans font-bold">{r.year}</td>
                    <td className="text-right text-up">{r.addedLongs.up}</td><td className="text-right text-down">{r.addedLongs.down}</td>
                    <td className="text-right text-up">{r.cutLongs.up}</td><td className="text-right text-down">{r.cutLongs.down}</td>
                    <td className="text-right text-muted">{r.unchanged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="pt-2 text-[11px] text-muted">
          Sources: {data.sources.positions}; {data.sources.stats}; {data.sources.flows}. Research data, not investment advice.
        </p>
      </div>
    </div>
  );
}
