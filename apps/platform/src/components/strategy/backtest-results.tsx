'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download } from 'lucide-react';
import { AreaSeries, LineSeries, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { CHART_COLORS, chartThemeOptions, useTheme } from '@/lib/theme';
import { rupees, type BacktestResult, type Trade } from '@/lib/strategy';
import { InfoTip } from '../info-tip';
import { Button, Card } from '../ui';

const IST = 5.5 * 3600;
const toChart = (t: number) => (t + IST) as UTCTimestamp;
const pct = (v: number | null | undefined, d = 2, sign = true) => (v == null ? '–' : `${sign && v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null ? '–' : v.toFixed(d));
const date = (t: number | null) => (t == null ? '–' : new Date((t + IST) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : '');
const REASON: Record<string, string> = { signal: 'Exit signal', stop: 'Stop loss', trail: 'Trailing stop', target: 'Target', time: 'Time exit', 'end-of-test': 'Open at end', 'data-ended': 'Stock stopped trading' };

export function BacktestResults({ r }: { r: BacktestResult }) {
  const m = r.metrics;
  const b = r.benchmark;
  return (
    <div className="grid gap-5">
      {r.warnings.length > 0 && (
        <div className="grid gap-1.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[13px] text-ink-2">
          {r.warnings.map((w) => <p key={w} className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-accent-deep" />{w}</p>)}
        </div>
      )}
      <p className="text-[13.5px] text-ink-2">
        {r.stocks.toLocaleString('en-IN')} stocks, {date(m.from)} to {date(m.to)}, {(r.ms / 1000).toFixed(1)} s. {m.signals.toLocaleString('en-IN')} entry signals became {m.trades.toLocaleString('en-IN')} trades
        <InfoTip label="Signals that did not become trades">
          <p>No free position slot: {m.skippedSlots.toLocaleString('en-IN')}</p>
          <p>Below the traded-value minimum: {m.illiquid.toLocaleString('en-IN')}</p>
          <p>Not enough cash, or size rounded to zero shares: {m.skippedCash.toLocaleString('en-IN')}</p>
          <p>Limit or stop order not reached: {m.unfilled.toLocaleString('en-IN')}</p>
          <p>Signals while already holding the stock are not counted as missed.</p>
        </InfoTip>
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Net P&L" value={rupees(m.netPaise)} cls={tone(m.netPaise)} sub={pct(m.returnPct)} />
        <Kpi label="CAGR" value={pct(m.cagrPct)} cls={tone(m.cagrPct)} sub={b ? `NIFTY ${pct(b.cagrPct)}` : undefined} />
        <Kpi label="Max drawdown" value={pct(-m.maxDrawdownPct)} cls="text-down" sub={`${rupees(m.maxDrawdownPaise)}${b ? ` · NIFTY ${pct(-b.maxDrawdownPct)}` : ''}`} />
        <Kpi label="Win rate" value={pct(m.winRatePct, 1, false)} sub={`${m.wins} won · ${m.losses} lost`} />
        <Kpi label="Profit factor" value={num(m.profitFactor)} tip="Gross profit of winning trades ÷ gross loss of losing trades, after charges. Above 1 makes money." />
        <Kpi label="Sharpe" value={num(m.sharpe)} sub={`Sortino ${num(m.sortino)}`} tip="Annualised return above the risk-free rate per unit of volatility, from bar-to-bar equity changes. Sortino counts only downside volatility." />
        <Kpi label="Trades" value={m.trades.toLocaleString('en-IN')} sub={`Avg hold ${num(m.avgHoldingDays, 1)} days`} />
        <Kpi label="Expectancy" value={rupees(m.expectancyPaise)} cls={tone(m.expectancyPaise)} sub={`${pct(m.avgTradeReturnPct)} a trade`} tip="Average net P&L per trade." />
        <Kpi label="Average win" value={rupees(m.avgWinPaise)} cls="text-up" sub={`Largest ${rupees(m.largestWinPaise)}`} />
        <Kpi label="Average loss" value={rupees(m.avgLossPaise)} cls="text-down" sub={`Largest ${rupees(m.largestLossPaise)}`} />
        <Kpi label="Recovery factor" value={num(m.recoveryFactor)} tip="Net profit ÷ the largest drawdown." />
        <Kpi label="Charges paid" value={rupees(m.chargesPaise)} sub={`P&L before charges ${rupees(m.grossPaise)}`} />
        <Kpi label="Time in market" value={pct(m.exposurePct, 0, false)} tip="Share of bars with at least one open position." />
        <Kpi label="Streaks" value={`${m.maxConsecutiveWins} / ${m.maxConsecutiveLosses}`} sub="most wins / losses in a row" />
        <Kpi label="Avg MAE / MFE" value={`${pct(m.avgMaePct, 1)} / ${pct(m.avgMfePct, 1)}`} tip="Worst and best move against / for the trade while it was open, on average, from bar lows and highs." />
        {b && <Kpi label="NIFTY buy and hold" value={pct(b.returnPct)} cls={tone(b.returnPct)} sub="same dates" />}
      </div>

      <Card title="Equity and drawdown" actions={<span className="flex items-center gap-3 text-[12px] text-ink-2"><Dot c="var(--color-accent)" /> Strategy {b && <><Dot c="var(--color-blue)" /> NIFTY, same capital</>}</span>}>
        <EquityChart r={r} />
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Monthly returns"><MonthTable r={r} /></Card>
        <Card title="Trade returns"><Distribution trades={r.trades} /></Card>
        <Card title="By entry weekday">
          <SmallTable head={['Day', 'Trades', 'Win rate', 'Net']} rows={r.weekdays.map((w) => [w.day, w.trades.toLocaleString('en-IN'), pct(w.winRatePct, 1, false), <span key="n" className={tone(w.netPaise)}>{rupees(w.netPaise)}</span>])} />
        </Card>
        <Card title="By exit reason">
          <SmallTable head={['Exit', 'Trades', 'Net']} rows={r.byReason.map((x) => [REASON[x.reason] ?? x.reason, x.trades.toLocaleString('en-IN'), <span key="n" className={tone(x.netPaise)}>{rupees(x.netPaise)}</span>])} />
        </Card>
      </div>

      <Card title={`Trades (${r.trades.length.toLocaleString('en-IN')}${r.tradesTruncated ? ', first 20,000' : ''})`}><TradeTable trades={r.trades} /></Card>
    </div>
  );
}

function Dot({ c }: { c: string }) { return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />; }

function Kpi({ label, value, sub, cls = '', tip }: { label: string; value: string; sub?: string; cls?: string; tip?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="flex items-center gap-1 text-[12px] text-muted">{label}{tip && <InfoTip label={label}>{tip}</InfoTip>}</p>
      <p className={`num mt-0.5 text-[19px] font-bold tracking-[-0.01em] ${cls}`}>{value}</p>
      {sub && <p className="num text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function EquityChart({ r }: { r: BacktestResult }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const theme = useTheme();
  useEffect(() => {
    const colors = CHART_COLORS[theme];
    const c = createChart(host.current!, { autoSize: true, ...chartThemeOptions(colors), timeScale: { ...chartThemeOptions(colors).timeScale, timeVisible: false }, rightPriceScale: { minimumWidth: 80 } });
    chart.current = c;
    const eq = c.addSeries(LineSeries, { color: '#f59a0b', lineWidth: 2, priceLineVisible: false, title: 'Strategy', priceFormat: { type: 'custom', formatter: (v: number) => `₹${(v / 1e5).toFixed(2)} L` } });
    eq.setData(r.equity.map((e) => ({ time: toChart(e.time), value: e.equityPaise / 100 })));
    if (r.benchmark) {
      const bm = c.addSeries(LineSeries, { color: theme === 'dark' ? '#6f8dff' : '#2f5bff', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'NIFTY', priceFormat: { type: 'custom', formatter: (v: number) => `₹${(v / 1e5).toFixed(2)} L` } });
      bm.setData(r.benchmark.curve.map((e) => ({ time: toChart(e.time), value: e.equityPaise / 100 })));
    }
    let peak = r.metrics.initialCapitalPaise;
    const dd = c.addSeries(AreaSeries, { lineColor: '#e5484d', topColor: 'rgba(229,72,77,0.05)', bottomColor: 'rgba(229,72,77,0.35)', lineWidth: 1, priceLineVisible: false, priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` } }, 1);
    dd.setData(r.equity.map((e) => { peak = Math.max(peak, e.equityPaise); return { time: toChart(e.time), value: -((peak - e.equityPaise) / peak) * 100 }; }));
    c.panes()[1]?.setHeight(110);
    c.timeScale().fitContent();
    return () => { c.remove(); chart.current = null; };
  }, [r, theme]);
  return <div ref={host} className="h-[420px] w-full" />;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function MonthTable({ r }: { r: BacktestResult }) {
  const byYear = useMemo(() => {
    const m = new Map<string, (number | null)[]>();
    for (const x of r.months) {
      const [y, mo] = x.month.split('-');
      if (!m.has(y)) m.set(y, new Array(12).fill(null));
      m.get(y)![Number(mo) - 1] = x.returnPct;
    }
    return [...m];
  }, [r.months]);
  const cell = (v: number | null) => {
    if (v == null) return <td className="px-1.5 py-1.5" />;
    const a = Math.min(1, Math.abs(v) / 8);
    return <td className="num px-1.5 py-1.5 text-right text-[12px]" style={{ background: v >= 0 ? `rgba(10,155,118,${0.08 + a * 0.4})` : `rgba(229,72,77,${0.08 + a * 0.4})` }}>{v.toFixed(1)}</td>;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5">
        <thead><tr className="text-[11.5px] text-muted"><th className="text-left font-semibold">Year</th>{MONTHS.map((m) => <th key={m} className="font-semibold">{m}</th>)}<th className="font-semibold">Year %</th></tr></thead>
        <tbody>
          {byYear.map(([y, ms]) => (
            <tr key={y}>
              <td className="pr-2 text-[12.5px] font-semibold">{y}</td>
              {ms.map((v, i) => <Fragment key={i}>{cell(v)}</Fragment>)}
              <td className={`num px-1.5 text-right text-[12.5px] font-bold ${tone(r.years.find((x) => x.year === y)?.returnPct)}`}>{num(r.years.find((x) => x.year === y)?.returnPct, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-muted">Change in the account value each month, %.</p>
    </div>
  );
}

function Distribution({ trades }: { trades: Trade[] }) {
  const bins = useMemo(() => {
    const edges = [-Infinity, -10, -6, -4, -2, 0, 2, 4, 6, 10, Infinity];
    return edges.slice(0, -1).map((lo, i) => {
      const hi = edges[i + 1];
      const n = trades.filter((t) => t.returnPct >= lo && t.returnPct < hi).length;
      const label = lo === -Infinity ? `< ${hi}%` : hi === Infinity ? `≥ ${lo}%` : `${lo} to ${hi}%`;
      return { label, n, positive: lo >= 0 };
    });
  }, [trades]);
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (
    <div className="grid gap-1.5">
      {bins.map((b) => (
        <div key={b.label} className="grid grid-cols-[88px_1fr_48px] items-center gap-2 text-[12.5px]">
          <span className="text-right text-muted">{b.label}</span>
          <span className="h-4 rounded-[4px]" style={{ width: `${(b.n / max) * 100}%`, minWidth: b.n ? 3 : 0, background: b.positive ? 'var(--color-up)' : 'var(--color-down)', opacity: 0.75 }} />
          <span className="num text-ink-2">{b.n}</span>
        </div>
      ))}
      <p className="mt-1 text-[12px] text-muted">Net return of each trade after charges.</p>
    </div>
  );
}

function SmallTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full text-[13px]">
      <thead><tr className="text-[12px] text-muted">{head.map((h, i) => <th key={h} className={`py-1.5 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, k) => <tr key={k} className="border-t border-line">{r.map((c, i) => <td key={i} className={`num py-1.5 ${i ? 'text-right' : ''}`}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

type Key = 'symbol' | 'entryTime' | 'exitTime' | 'netPaise' | 'returnPct' | 'bars';
function TradeTable({ trades }: { trades: Trade[] }) {
  const [sort, setSort] = useState<{ k: Key; d: 1 | -1 }>({ k: 'entryTime', d: 1 });
  const [limit, setLimit] = useState(300);
  const rows = useMemo(() => [...trades].sort((a, b) => (sort.k === 'symbol' ? a.symbol.localeCompare(b.symbol) : a[sort.k] - b[sort.k]) * sort.d), [trades, sort]);
  const th = (k: Key, label: string, right = true) => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold text-muted ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setSort((s) => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : 1 }))} className="hover:text-ink">{label}{sort.k === k ? (sort.d === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );
  const csv = () => {
    const head = 'Symbol,Qty,Entry date,Entry price,Exit date,Exit price,Exit reason,Gross,Charges,Net,Return %,Bars,MAE %,MFE %,Data break';
    const d = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
    const lines = trades.map((t) => [t.symbol, t.qty, d(t.entryTime), t.entryPricePaise / 100, d(t.exitTime), t.exitPricePaise / 100, REASON[t.exitReason], t.grossPaise / 100, t.chargesPaise / 100, t.netPaise / 100, t.returnPct.toFixed(2), t.bars, t.maePct.toFixed(2), t.mfePct.toFixed(2), t.dataBreak ? 'yes' : ''].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'backtest-trades.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="grid gap-3">
      <div className="flex justify-end"><Button onClick={csv} disabled={!trades.length}><Download size={15} /> CSV</Button></div>
      <div className="max-h-[60vh] overflow-auto rounded-[14px] border border-line">
        <table className="w-full text-[13px]">
          <thead><tr>{th('symbol', 'Stock', false)}{th('entryTime', 'Entry')}<th className="px-3 text-right text-[12px] font-semibold text-muted">Price</th>{th('exitTime', 'Exit')}<th className="px-3 text-right text-[12px] font-semibold text-muted">Price</th><th className="px-3 text-left text-[12px] font-semibold text-muted">Why</th><th className="px-3 text-right text-[12px] font-semibold text-muted">Qty</th>{th('netPaise', 'Net')}{th('returnPct', 'Return')}{th('bars', 'Bars')}</tr></thead>
          <tbody>
            {rows.slice(0, limit).map((t, i) => (
              <tr key={i} className="border-t border-line hover:bg-raised">
                <td className="px-3 py-1.5 font-semibold"><Link href={`/chart/${encodeURIComponent(t.symbol)}`} className="hover:text-accent-deep">{t.symbol}</Link>{t.dataBreak && <span title="A corporate action that could not be adjusted falls inside this trade" className="ml-1 text-accent-deep">⚠</span>}</td>
                <td className="num whitespace-nowrap px-3 text-right">{date(t.entryTime)}</td>
                <td className="num px-3 text-right">{(t.entryPricePaise / 100).toFixed(2)}</td>
                <td className="num whitespace-nowrap px-3 text-right">{date(t.exitTime)}</td>
                <td className="num px-3 text-right">{(t.exitPricePaise / 100).toFixed(2)}</td>
                <td className="px-3 text-ink-2">{REASON[t.exitReason]}</td>
                <td className="num px-3 text-right">{t.qty.toLocaleString('en-IN')}</td>
                <td className={`num whitespace-nowrap px-3 text-right font-semibold ${tone(t.netPaise)}`}>{rupees(t.netPaise)}</td>
                <td className={`num px-3 text-right ${tone(t.returnPct)}`}>{pct(t.returnPct)}</td>
                <td className="num px-3 text-right">{t.bars}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <Button variant="ghost" onClick={() => setLimit((l) => l + 500)}>Show more ({(rows.length - limit).toLocaleString('en-IN')} left)</Button>}
    </div>
  );
}
