'use client';

import { useMemo, useState } from 'react';
import { Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Lines, Money, Table, inr, tone } from './selling-charts';

// Strategies 4–12 from the workshop slides, from apps/feed/scripts/selling-workshop.ts. Filtered in the browser.
type Trade = { entry: string; exit: string; spotIn: number; spotOut: number; move: number; net: number; worstMtm: number; worstOn: string; legs: string[]; events: string[] };
type Test = { id: string; slide: number; name: string; months: number; dist: number; skipped: Record<string, number>; trades: Trade[] };
type Data = { lot: number; margins: Record<string, number | null>; tests: Test[] };

const GROUPS = [
  { key: 'cc', label: '4 Covered call', ids: ['cc', 'cc-roll'], tip: 'Buy the future, sell 1 call d above. Rolled: when NIFTY closes at or above the call, buy it back and sell a new one d above that close, same expiry.' },
  { key: 'collar', label: '5 Collar', ids: ['collar', 'collar-roll'], tip: 'Covered call plus a bought put 2d below. Rolled as above.' },
  { key: 'cal', label: '6–8 Calendars', ids: ['putcal', 'callcal', 'dblcal'], tip: 'Put calendar: sell the near ATM put, buy the next-month ATM put. Call calendar: sell the near ATM call, buy the next-month ATM call, sell a next-month call 2d above. Double calendar: put calendar at −d plus call calendar at +d. All closed at the near expiry; the next-month legs are sold at that close. Many months could not be tested because the next-month option at the same strike had no trade that day.' },
  { key: 'back', label: '9–11 Back spreads', ids: ['putback', 'callback', 'dblback'], tip: 'Sell 1 option d in the money, buy 2 options d out of the money. Puts, calls, or both.' },
  { key: 'fly', label: '12 Butterfly', ids: ['fly', 'fly-wide'], tip: 'Buy 1 call below, sell 2 ATM calls, buy 1 call above; wings at d or 2d. Margin is the same for every version because the bought wings cancel the SPAN margin, leaving only NSE\'s exposure margin on the 2 sold calls.' },
] as const;
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const Pct = ({ v }: { v: number | null | undefined }) => <span className={tone(v)}>{pct(v)}</span>;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function statsOf(rows: Trade[], margin: number | null, capital: number) {
  const n = rows.map((r) => r.net), w = n.filter((v) => v > 0), l = n.filter((v) => v <= 0), total = sum(n);
  const years = rows.length ? Math.max(0.25, (Date.parse(rows.at(-1)!.exit) - Date.parse(rows[0].entry)) / (365.25 * 86400_000)) : 1, perYear = total / years;
  const byYear = new Map<string, number>(); for (const r of rows) byYear.set(r.exit.slice(0, 4), (byYear.get(r.exit.slice(0, 4)) ?? 0) + r.net);
  const deep = rows.reduce<Trade | null>((b, r) => (!b || r.worstMtm < b.worstMtm ? r : b), null);
  let eq = 0; const curve: [string, number][] = rows.map((r) => [r.exit, (eq += r.net)]);
  return {
    trades: rows.length, won: rows.length ? (w.length / rows.length) * 100 : 0, wins: w.length, total, perYear, avgWin: w.length ? sum(w) / w.length : 0, avgLoss: l.length ? sum(l) / l.length : 0,
    roiCapital: (perYear / capital) * 100, roiMargin: margin ? (perYear / margin) * 100 : null, margin, worst: n.length ? Math.min(...n) : 0, best: n.length ? Math.max(...n) : 0,
    worstMtm: deep?.worstMtm ?? 0, worstMtmOn: deep?.worstOn ?? null, byYear, losingYears: [...byYear.values()].filter((v) => v < 0).length, yearCount: byYear.size,
    since2023: sum(rows.filter((r) => r.entry >= '2023').map((r) => r.net)), curve, rolls: rows.filter((r) => r.events.length).length,
  };
}
type Stats = ReturnType<typeof statsOf>;

export function SellingWorkshop() {
  const { data, error } = useFeed<Data>('selling-research/workshop');
  const [group, setGroup] = useState<(typeof GROUPS)[number]['key']>('back');
  const [months, setMonths] = useState<'1' | '2' | '3'>('1');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [capital, setCapital] = useState(500000);
  const [pick, setPick] = useState('');
  const [result, setResult] = useState<'all' | 'won' | 'lost'>('all');
  const [sort, setSort] = useState<'date' | 'net' | 'mtm'>('date');

  const g = GROUPS.find((x) => x.key === group)!, calendar = group === 'cal', m = calendar && months === '3' ? '2' : months;
  const years = useMemo(() => [...new Set((data?.tests ?? []).flatMap((t) => t.trades.map((r) => r.entry.slice(0, 4))))].sort(), [data]);
  const fromY = from || years[0] || '', toY = to || years.at(-1) || '';
  const per = useMemo(() => (data ? g.ids.map((id, i) => {
    const test = data.tests.find((t) => t.id === id && t.months === Number(m));
    const rows = (test?.trades ?? []).filter((r) => r.entry.slice(0, 4) >= fromY && r.entry.slice(0, 4) <= toY);
    const margin = data.margins[`${id}-${m}`] ?? null;
    return { id, name: test?.name ?? id, color: COLORS[i], test, rows, margin, stats: statsOf(rows, margin, capital) };
  }).filter((p) => p.test) : []), [data, g, m, fromY, toY, capital]);

  if (!data) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const cap = inr(capital), sel = per.find((p) => p.id === pick) ?? per[0], selectCls = `${inputCls} h-8 !rounded-[9px] px-2 text-[13px]`;
  type Row = { label: string; tip?: string; show: (s: Stats) => React.ReactNode; score?: (s: Stats) => number };
  const rows: Row[] = [
    { label: 'Profit a year', show: (s) => <Money v={s.perYear} />, score: (s) => s.perYear },
    { label: `ROI a year on ${cap}`, show: (s) => <Pct v={s.roiCapital} />, score: (s) => s.roiCapital },
    { label: 'ROI a year on margin', show: (s) => <Pct v={s.roiMargin} />, score: (s) => s.roiMargin ?? -1e9 },
    { label: 'Total profit', show: (s) => <Money v={s.total} />, score: (s) => s.total },
    { label: 'Profit since 2023', show: (s) => <Money v={s.since2023} />, score: (s) => s.since2023 },
    { label: 'Trades', show: (s) => s.trades },
    { label: 'Won', show: (s) => `${s.won.toFixed(0)}% (${s.wins} of ${s.trades})`, score: (s) => s.won },
    { label: 'Average win', show: (s) => <Money v={s.avgWin} /> },
    { label: 'Average loss', show: (s) => <Money v={s.avgLoss} />, score: (s) => s.avgLoss },
    { label: 'Best trade', show: (s) => <Money v={s.best} /> },
    { label: 'Worst trade', show: (s) => <Money v={s.worst} />, score: (s) => s.worst },
    { label: 'Worst MTM', tip: 'Deepest open loss at any daily close. A move during the day can go deeper.', show: (s) => <Money v={s.worstMtm} />, score: (s) => s.worstMtm },
    { label: 'Worst MTM date', show: (s) => s.worstMtmOn ?? '–' },
    { label: 'Margin today', tip: `NSE SPAN + exposure margin on the latest day for 1 lot of ${data.lot}. Today's margin is used for every past trade, so it is an estimate.`, show: (s) => inr(s.margin), score: (s) => -(s.margin ?? 1e12) },
    { label: `Spare out of ${cap} at the worst moment`, show: (s) => <Money v={capital - (s.margin ?? 0) + s.worstMtm} />, score: (s) => capital - (s.margin ?? 0) + s.worstMtm },
    { label: 'Losing years', show: (s) => `${s.losingYears} of ${s.yearCount}`, score: (s) => -s.losingYears / Math.max(1, s.yearCount) },
    { label: 'Trades with a roll', show: (s) => s.rolls },
  ];
  const winner = (r: Row) => { if (!r.score || per.length < 2) return null; const top = Math.max(...per.map((p) => r.score!(p.stats))); return new Set(per.filter((p) => r.score!(p.stats) === top).map((p) => p.id)); };
  const yearList = [...new Set(per.flatMap((p) => [...p.stats.byYear.keys()]))].sort().reverse();
  const listed = (sel?.rows ?? []).filter((r) => (result === 'all' ? true : result === 'won' ? r.net > 0 : r.net <= 0));
  const shown = sort === 'date' ? [...listed].reverse() : [...listed].sort((a, b) => (sort === 'net' ? a.net - b.net : a.worstMtm - b.worstMtm));
  const monthRows = sel ? [...sel.stats.byYear.keys()].sort().reverse().map((y) => {
    const cells: (number | undefined)[] = Array(12).fill(undefined);
    for (const r of sel.rows) if (r.exit.startsWith(y)) { const i = Number(r.exit.slice(5, 7)) - 1; cells[i] = (cells[i] ?? 0) + r.net; }
    return [<b key="y">{y}</b>, ...cells.map((v, i) => <span key={i}>{v == null ? '' : <Money v={v} />}</span>), <b key="t"><Money v={sel.stats.byYear.get(y)} /></b>];
  }) : [];
  const dist = per[0]?.test?.dist;

  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-2">Workshop strategies<InfoTip label="About this test">Strategies 4 to 12 from the workshop slides, with rules fixed before running. d = 2% of NIFTY for 1 month, widened by √months for 2 and 3 months. Entry at the close of the first trading day after a monthly expiry, one position at a time, held to expiry (calendars to the near expiry). Strikes are the nearest traded strike within 1% of the target, else the month is skipped. NIFTY, 1 lot at today&apos;s index level and lot size, after charges and ₹1 slippage per leg. The slides give ideas only, no exact rules, so these are my readings of them.</InfoTip></span>}
        right={<button type="button" onClick={() => { setMonths('1'); setFrom(''); setTo(''); setCapital(500000); }} className="text-[12px] font-semibold text-accent-deep">Reset</button>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Strategy" value={group} onChange={(v) => { setGroup(v); setPick(''); }} options={GROUPS.map((x) => ({ value: x.key, label: x.label }))} />
          <InfoTip label={g.label}>{g.tip}</InfoTip>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3 text-[13px] text-ink-2">
          <Segmented label="Expiry" value={m} onChange={setMonths} options={[{ value: '1', label: '1 month' }, { value: '2', label: '2 months' }, ...(calendar ? [] : [{ value: '3' as const, label: '3 months' }])]} />
          <label className="flex items-center gap-1.5">From <select aria-label="From year" className={selectCls} value={fromY} onChange={(e) => setFrom(e.target.value)}>{years.map((y) => <option key={y} disabled={y > toY}>{y}</option>)}</select></label>
          <label className="flex items-center gap-1.5">To <select aria-label="To year" className={selectCls} value={toY} onChange={(e) => setTo(e.target.value)}>{years.map((y) => <option key={y} disabled={y < fromY}>{y}</option>)}</select></label>
          <label className="flex items-center gap-1.5">Capital <input aria-label="Capital" type="number" min={1} step={50000} className={`${selectCls} w-28 tabular-nums`} value={capital} onChange={(e) => setCapital(Math.max(1, Number(e.target.value) || 1))} /></label>
          {dist != null && <span className="text-muted">d = {dist}%</span>}
        </div>
      </Card>

      {!per.some((p) => p.rows.length) ? <Card><p className="p-4 text-[13px] text-muted">No trades match these filters.</p></Card> : <>
        <div className="grid gap-3 md:grid-cols-3">
          {per.map((p) => (
            <Card key={p.id} title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />{p.name}</span>} right={<span>{p.stats.trades} trades, {p.stats.won.toFixed(0)}% won</span>}>
              <div className="grid grid-cols-2 gap-3 p-4">
                <div><p className="text-[11px] font-semibold text-muted">Profit a year</p><p className="text-[22px] font-bold"><Money v={p.stats.perYear} /></p></div>
                <div><p className="text-[11px] font-semibold text-muted">ROI a year on margin</p><p className={`text-[22px] font-bold tabular-nums ${tone(p.stats.roiMargin)}`}>{pct(p.stats.roiMargin)}</p></div>
                <div><p className="text-[11px] font-semibold text-muted">Worst MTM</p><p className="text-[15px] font-bold"><Money v={p.stats.worstMtm} /></p></div>
                <div><p className="text-[11px] font-semibold text-muted">Since 2023</p><p className="text-[15px] font-bold"><Money v={p.stats.since2023} /></p></div>
              </div>
            </Card>
          ))}
        </div>
        <Card title="Running total profit"><Lines series={per.filter((p) => p.stats.curve.length).map((p) => ({ name: p.name, pts: p.stats.curve, color: p.color }))} /></Card>
        <Card title="Comparison" right={<span>Best in each row is marked.</span>}>
          <Table head={['', ...per.map((p) => p.name)]} rows={rows.map((r) => { const w = winner(r); return [<span key="l" className="flex items-center gap-1 text-ink-2">{r.label}{r.tip && <InfoTip label={r.label}>{r.tip}</InfoTip>}</span>, ...per.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5">{r.show(p.stats)}{w?.has(p.id) && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent-deep">Best</span>}</span>)]; })} />
        </Card>
        <Card title="Year by year" right={<span>By the year the trade ended</span>}>
          <Table head={['Year', ...per.flatMap((p) => [p.name, 'ROI margin'])]} rows={yearList.map((y) => [<b key="y">{y}</b>, ...per.flatMap((p) => { const v = p.stats.byYear.get(y); return [v == null ? '–' : <Money key="a" v={v} />, v == null ? '–' : <Pct key="b" v={p.margin ? (v / p.margin) * 100 : null} />]; })])} />
        </Card>
        {sel && <>
          <Card title={`Month by month: ${sel.name}`} right={per.length > 1 && <Segmented label="Version" value={sel.id} onChange={setPick} options={per.map((p) => ({ value: p.id, label: p.name }))} />}>
            <Table head={['Year', ...MONTHS, 'Year total']} rows={monthRows} />
          </Card>
          <Card title={`${shown.length} trades: ${sel.name}`} right={<div className="flex flex-wrap gap-2">
            {per.length > 1 && <Segmented label="Version" value={sel.id} onChange={setPick} options={per.map((p) => ({ value: p.id, label: p.name }))} />}
            <Segmented label="Result" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />
            <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'date', label: 'Newest' }, { value: 'net', label: 'Biggest loss' }, { value: 'mtm', label: 'Worst MTM' }]} />
          </div>}>
            <Table tall head={['Entry', 'Exit', 'NIFTY in', 'NIFTY out', 'Move', 'Position', 'Rolls', 'Profit', `ROI ${cap}`, 'ROI margin', 'Worst MTM', 'MTM date']} rows={shown.map((r) => [
              r.entry, r.exit, r.spotIn.toLocaleString('en-IN'), r.spotOut.toLocaleString('en-IN'), <Pct key="m" v={r.move} />,
              <span key="l" className="whitespace-normal text-[12px]">{r.legs.join(', ')}</span>, <span key="e" className="whitespace-normal text-[12px]">{r.events.join('; ') || '–'}</span>,
              <Money key="n" v={r.net} />, <Pct key="c" v={(r.net / capital) * 100} />, <Pct key="g" v={sel.margin ? (r.net / sel.margin) * 100 : null} />, <Money key="w" v={r.worstMtm} />, r.worstOn,
            ])} />
          </Card>
          {sel.test && Object.keys(sel.test.skipped).length > 0 && <Card title={`Months that could not be tested: ${sel.name}`}><Table head={['Why', 'Count']} rows={Object.entries(sel.test.skipped).map(([w, c]) => [w, c])} /></Card>}
        </>}
      </>}
    </div>
  );
}
