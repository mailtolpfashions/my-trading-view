'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { chartHref } from '@/components/app/shell-context';
import { feed } from '@/lib/feed';
import { fmt } from '@/lib/format';
import type { Tool } from '@/lib/tools';
import { InfoTip } from '../../info-tip';
import { Segmented } from '../controls';
import { DataTable, type Column } from '../data-table';
import { Card, ToolShell } from '../tool-shell';

type Pick = { symbol: string; p930: number; p300: number | null; last: number | null; lastAt: string | null; best: number | null; worst: number | null };
type Day = { date: string; kind: 'live' | 'replay'; savedAt: string; picks: Pick[] };
type Log = { formula: string; days: Day[]; filling: { done: number; total: number } | null };
type Row = Pick & { date: string; kind: Day['kind'] };

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
const signed = (v: number, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'text-up' : 'text-down');
/** The result in points: at 3:00 once the day is done, otherwise the latest price so far. */
const pts = (r: Pick) => (r.p300 ?? r.last) == null ? null : (r.p300 ?? r.last)! - r.p930;
const pct = (r: Pick) => { const p = pts(r); return p == null ? null : (p / r.p930) * 100; };

/** Totals for a set of finished picks: how many, in profit, average % and points. */
function totals(rows: Row[]) {
  const done = rows.filter((r) => r.p300 != null);
  const p = done.map((r) => pct(r)!), q = done.map((r) => pts(r)!);
  return { n: done.length, up: p.filter((x) => x > 0).length, avgPct: p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0, avgPts: q.length ? q.reduce((a, b) => a + b, 0) / q.length : 0 };
}

/** The blind-buy scan, run at 9:30 every trading day and closed at 3:00 pm, on paper. */
export function PaperLogTool({ tool }: { tool: Tool }) {
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'live' | 'replay' | 'all'>('all');
  useEffect(() => {
    let stop = false;
    const load = () => feed<Log>('paperlog/blind-buy').then((l) => { if (!stop) { setLog(l); setError(null); } }, (e: Error) => !stop && setError(e.message));
    load();
    const t = setInterval(load, 60_000); // today's picks move during the day; earlier days fill in the background
    return () => { stop = true; clearInterval(t); };
  }, []);

  const rows: Row[] = useMemo(() => (log?.days ?? []).filter((d) => show === 'all' || d.kind === show).flatMap((d) => d.picks.map((p) => ({ ...p, date: d.date, kind: d.kind }))), [log, show]);
  const live = useMemo(() => totals((log?.days ?? []).filter((d) => d.kind === 'live').flatMap((d) => d.picks.map((p) => ({ ...p, date: d.date, kind: d.kind })))), [log]);
  const replay = useMemo(() => totals((log?.days ?? []).filter((d) => d.kind === 'replay').flatMap((d) => d.picks.map((p) => ({ ...p, date: d.date, kind: d.kind })))), [log]);
  const days = (log?.days ?? []).filter((d) => show === 'all' || d.kind === show);
  const emptyDays = days.filter((d) => !d.picks.length).length;

  const columns: Column<Row>[] = [
    { key: 'd', label: 'Day', align: 'left', render: (r) => <span className="whitespace-nowrap">{dayLabel(r.date)}{r.kind === 'live' && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-bold text-accent-deep">LIVE</span>}</span>, value: (r) => r.date },
    { key: 's', label: 'Stock', align: 'left', render: (r) => <Link href={chartHref(r.symbol)} className="font-semibold hover:text-accent-deep">{r.symbol}</Link>, value: (r) => r.symbol },
    { key: 'b', label: 'Bought 9:30 ₹', render: (r) => fmt(r.p930), value: (r) => r.p930 },
    { key: 'c', label: 'At 3:00 ₹', render: (r) => (r.p300 != null ? fmt(r.p300) : r.last != null ? <span className="text-muted" title="The day is still running">{fmt(r.last)} <span className="text-[11px]">at {r.lastAt}</span></span> : '—'), value: (r) => r.p300 ?? r.last },
    { key: 'p', label: 'Profit / loss pts', render: (r) => { const v = pts(r); return <b className={tone(v)}>{v == null ? '—' : signed(v)}</b>; }, value: (r) => pts(r) },
    { key: 'pc', label: '%', render: (r) => { const v = pct(r); return <span className={tone(v)}>{v == null ? '—' : `${signed(v)}%`}</span>; }, value: (r) => pct(r) },
    { key: 'hi', label: 'Best pts', title: 'Highest point from 9:30 to 3:00, against the 9:30 price', render: (r) => (r.best == null ? '—' : `+${r.best.toFixed(2)}`), value: (r) => r.best },
    { key: 'lo', label: 'Worst pts', title: 'Lowest point from 9:30 to 3:00, against the 9:30 price', render: (r) => (r.worst == null ? '—' : `−${r.worst.toFixed(2)}`), value: (r) => r.worst },
  ];

  const Summary = ({ title, t, note }: { title: string; t: ReturnType<typeof totals>; note: string }) => (
    <div className="panel grid gap-1 p-4">
      <p className="eyebrow">{title}</p>
      {t.n ? (
        <>
          <p className="text-[22px] font-bold leading-tight"><span className="num">{t.up}</span> <span className="text-[14px] font-semibold text-ink-2">of {t.n} in profit at 3:00</span></p>
          <p className="text-[13px] text-ink-2">Average <b className={tone(t.avgPct)}>{signed(t.avgPct)}%</b> · <b className={tone(t.avgPts)}>{signed(t.avgPts)} pts</b> a trade, before costs</p>
        </>
      ) : <p className="text-[13px] text-muted">{note}</p>}
    </div>
  );

  return (
    <ToolShell tool={tool}
      controls={<>
        <Segmented label="Show" value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'replay', label: 'Past year (replay)' }]} />
        {log?.filling && <span className="text-[12px] text-muted">Working out earlier days: {log.filling.done} of {log.filling.total}</span>}
      </>}
      about={<>
        <p>Every trading day at 9:30 the &ldquo;blind buy&rdquo; scan runs once on the daily candle as it stands then: the close crosses above the Ichimoku cloud top (9, 26, 52) and Supertrend (7, 3) turns bullish. Each stock it lists is bought on paper at the 9:30 price and closed at 3:00 pm, profit or loss. Nothing is ordered.</p>
        <p><b>Live</b> days are saved at 9:30 and never changed afterwards, so they are an honest forward record. <b>Past year (replay)</b> days are worked out afterwards from the same minute data (NIFTY 500 and F&amp;O stocks).</p>
        <p>Costs are not included: brokerage, STT and exchange charges come to roughly 0.04% a trade in cash intraday.</p>
      </>}>
      {error && <p className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Summary title="Live, from 9:30 each day" t={live} note="Starts on the next trading day: the list is taken at 9:30 while the app is running and Kite is connected." />
        <Summary title="Past year (replay)" t={replay} note={log?.filling ? 'Being worked out…' : 'Earlier days are worked out after market hours.'} />
      </div>
      <Card title="Every pick" right={<span>{days.length} days{emptyDays ? `, ${emptyDays} with no stock` : ''} <InfoTip label="About the result">{'Profit / loss is the 3:00 pm price minus the 9:30 price, for one share. A day still running shows the latest price.'}</InfoTip></span>}>
        <DataTable rows={rows} columns={columns} rowKey={(r) => `${r.date}-${r.symbol}`} csvName="paper-log-blind-buy" initialSort={{ key: 'd', desc: true }}
          empty={log ? 'No picks yet.' : 'Loading…'} />
      </Card>
    </ToolShell>
  );
}
