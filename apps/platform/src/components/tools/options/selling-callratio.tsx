'use client';

import { useMemo, useState } from 'react';
import { Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Lines, Money, Table, inr, tone } from './selling-charts';

// The user's call ratio (buy 1 ATM CE, sell 2 CE and 1 PE ~2,000 points away) on every expiry length, from
// apps/feed/scripts/selling-callratio.ts. Everything here is filtered in the browser from the saved trades.
type Row = { entry: string; expiry: string; spotIn: number; spotOut: number; legs: string[]; net: number; worstMtm: number; worstOn: string; events: string[]; model: number };
type Test = { base?: number; months: number; scaled: boolean; dist: number; up: boolean; down: 'D0' | 'D1' | 'D2'; skipped: Record<string, number>; rows: Row[] };
type Data = { ranAt: string; lot: number; spot: number; margins: Record<string, number | null>; tests: Test[] };

const FRAMES = [1, 2, 3, 6, 11] as const;
const BASES = ['8', '10', '12', '15'] as const;
type Base = (typeof BASES)[number];
const baseOf = (t: Test) => String(Math.round((t.base ?? 0.08) * 100)); // 11 = enter on the last Monday of January, hold to the December expiry
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--color-ink-2)'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const frameName = (n: number) => (n === 11 ? 'Yearly (Jan → Dec)' : `${n} month${n > 1 ? 's' : ''}`);
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const Pct = ({ v }: { v: number | null | undefined }) => <span className={tone(v)}>{pct(v)}</span>;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
type Adj = 'none' | 'up' | 'D1' | 'D2';
const ADJ: Record<Adj, { up: boolean; down: Test['down']; label: string; title: string }> = {
  none: { up: false, down: 'D0', label: 'None', title: 'No adjustment: hold all legs to expiry' },
  up: { up: true, down: 'D0', label: 'Upside', title: 'Your upside adjustments only' },
  D1: { up: true, down: 'D1', label: '+ Put buyback', title: 'Your upside adjustments, and buy back the sold put when NIFTY reaches it' },
  D2: { up: true, down: 'D2', label: '+ Put hedge', title: 'Your upside adjustments, and buy a put 1.5× the distance down when NIFTY falls half the distance (at 8%: a put 12% down when NIFTY falls 4%)' },
};

function statsOf(rows: Row[], margin: number | null, capital: number) {
  const n = rows.map((r) => r.net), wins = n.filter((v) => v > 0), losses = n.filter((v) => v <= 0), total = sum(n);
  const years = rows.length ? Math.max(0.25, (Date.parse(rows.at(-1)!.expiry) - Date.parse(rows[0].entry)) / (365.25 * 86400_000)) : 1;
  const byYear = new Map<string, number>(); for (const r of rows) byYear.set(r.expiry.slice(0, 4), (byYear.get(r.expiry.slice(0, 4)) ?? 0) + r.net);
  const yv = [...byYear.values()], perYear = total / years;
  let eq = 0; const curve: [string, number][] = rows.map((r) => [r.expiry, Math.round((eq += r.net))]);
  const deep = rows.reduce<Row | null>((b, r) => (!b || r.worstMtm < b.worstMtm ? r : b), null);
  const has = (code: string) => rows.filter((r) => r.events.some((e) => e.includes(` ${code} `))).length;
  return {
    trades: rows.length, won: rows.length ? (wins.length / rows.length) * 100 : 0, wins: wins.length, losses: losses.length, total, perYear, years,
    avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0,
    roiCapital: (perYear / capital) * 100, roiMargin: margin ? (perYear / margin) * 100 : null, margin,
    worst: n.length ? Math.min(...n) : 0, best: n.length ? Math.max(...n) : 0, worstMtm: deep?.worstMtm ?? 0, worstMtmOn: deep?.worstOn ?? null,
    losingYears: yv.filter((v) => v < 0).length, yearCount: yv.length, byYear, curve, since2023: sum(rows.filter((r) => r.entry >= '2023').map((r) => r.net)),
    model: rows.filter((r) => r.model > 0).length, u1: has('U1'), u2: has('U2'), d1: has('D1'), d2: has('D2'),
  };
}
type Stats = ReturnType<typeof statsOf>;

export function SellingCallRatio() {
  const { data, error } = useFeed<Data>('selling-research/callratio');
  const [adj, setAdj] = useState<Adj>('D1');
  const [base, setBase] = useState<Base>('8');
  const [gridShow, setGridShow] = useState<'perYear' | 'worstMtm' | 'since2023' | 'losing' | 'won'>('perYear');
  const [scaled, setScaled] = useState<'fixed' | 'scaled'>('fixed');
  const [prices, setPrices] = useState<'all' | 'traded'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [capital, setCapital] = useState(500000);
  const [frames, setFrames] = useState<number[]>([1, 2, 3, 6, 11]);
  const [pick, setPick] = useState(2);
  const [result, setResult] = useState<'all' | 'won' | 'lost' | 'adjusted'>('all');
  const [sort, setSort] = useState<'date' | 'net' | 'mtm'>('date');
  const [cell, setCell] = useState<'rupees' | 'margin'>('rupees');

  const allYears = useMemo(() => [...new Set((data?.tests ?? []).flatMap((t) => t.rows.map((r) => r.entry.slice(0, 4))))].sort(), [data]);
  const fromY = from || allYears[0] || '', toY = to || allYears.at(-1) || '';
  const per = useMemo(() => {
    if (!data) return [];
    const a = ADJ[adj];
    return FRAMES.filter((m) => frames.includes(m)).map((m) => {
      const test = data.tests.find((t) => baseOf(t) === base && t.months === m && t.scaled === (scaled === 'scaled' && m !== 11) && t.up === a.up && t.down === a.down);
      const rows = (test?.rows ?? []).filter((r) => r.entry.slice(0, 4) >= fromY && r.entry.slice(0, 4) <= toY && (prices === 'all' || r.model === 0));
      const margin = data.margins[`${m}${scaled === 'scaled' ? 's' : 'f'}-${base}`] ?? data.margins[`${m}${scaled === 'scaled' ? 's' : 'f'}`] ?? null;
      return { m, name: frameName(m), color: COLORS[FRAMES.indexOf(m)], test, rows, margin, dist: test?.dist ?? null, stats: statsOf(rows, margin, capital) };
    });
  }, [data, adj, base, scaled, prices, fromY, toY, frames, capital]);
  // Every distance against every expiry, on the same adjustment, prices and years.
  const grid = useMemo(() => {
    if (!data) return [];
    const a = ADJ[adj];
    return FRAMES.map((m) => ({ m, cells: BASES.map((b) => {
      const test = data.tests.find((t) => baseOf(t) === b && t.months === m && t.scaled === (scaled === 'scaled' && m !== 11) && t.up === a.up && t.down === a.down);
      const rows = (test?.rows ?? []).filter((r) => r.entry.slice(0, 4) >= fromY && r.entry.slice(0, 4) <= toY && (prices === 'all' || r.model === 0));
      return { b, test, s: rows.length ? statsOf(rows, null, capital) : null };
    }) }));
  }, [data, adj, scaled, prices, fromY, toY, capital]);

  if (!data) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const shownPer = per.filter((p) => p.rows.length), cap = inr(capital), sel = per.find((p) => p.m === pick) ?? shownPer[0];
  const selectCls = `${inputCls} h-8 !rounded-[9px] px-2 text-[13px]`;
  const best = (get: (s: Stats) => number) => (shownPer.length ? shownPer.reduce((b, p) => (get(p.stats) > get(b.stats) ? p : b)).name : '–');
  const reset = () => { setBase('8'); setAdj('D1'); setScaled('fixed'); setPrices('all'); setFrom(''); setTo(''); setCapital(500000); setFrames([1, 2, 3, 6, 11]); };

  type Metric = { label: string; tip?: string; show: (s: Stats) => React.ReactNode; score?: (s: Stats) => number };
  const metrics: { title: string; rows: Metric[] }[] = [
    { title: 'Return', rows: [
      { label: 'Profit a year', show: (s) => <Money v={s.perYear} />, score: (s) => s.perYear },
      { label: `ROI a year on ${cap}`, show: (s) => <Pct v={s.roiCapital} />, score: (s) => s.roiCapital },
      { label: 'ROI a year on margin', show: (s) => <Pct v={s.roiMargin} />, score: (s) => s.roiMargin ?? -1e9 },
      { label: 'Total profit', show: (s) => <Money v={s.total} />, score: (s) => s.total },
      { label: 'Profit since 2023', show: (s) => <Money v={s.since2023} />, score: (s) => s.since2023 },
    ] },
    { title: 'Trades', rows: [
      { label: 'Trades', show: (s) => s.trades },
      { label: 'Won', show: (s) => `${s.won.toFixed(0)}% (${s.wins} of ${s.trades})`, score: (s) => s.won },
      { label: 'Average win', show: (s) => <Money v={s.avgWin} />, score: (s) => s.avgWin },
      { label: 'Average loss', show: (s) => <Money v={s.avgLoss} />, score: (s) => s.avgLoss },
      { label: 'Best trade', show: (s) => <Money v={s.best} /> },
      { label: 'Priced from NSE settlement', tip: 'Far contracts often had no trade that day, so NSE\'s settlement price was used for at least one leg. Choose "Traded prices only" to leave these out.', show: (s) => (s.model ? <span className="text-down">{s.model}</span> : '0') },
    ] },
    { title: 'Risk', rows: [
      { label: 'Worst trade', show: (s) => <Money v={s.worst} />, score: (s) => s.worst },
      { label: 'Worst MTM', tip: 'Deepest open loss at any daily close. A move during the day can go deeper.', show: (s) => <Money v={s.worstMtm} />, score: (s) => s.worstMtm },
      { label: 'Worst MTM date', show: (s) => s.worstMtmOn ?? '–' },
      { label: 'Margin today', tip: `NSE SPAN margin on the latest day for the starting position (1 lot of ${data.lot}). Today's margin is used for every past trade, so it is an estimate.`, show: (s) => inr(s.margin), score: (s) => -(s.margin ?? 1e12) },
      { label: `Spare out of ${cap} at the worst moment`, show: (s) => <Money v={capital - (s.margin ?? 0) + s.worstMtm} />, score: (s) => capital - (s.margin ?? 0) + s.worstMtm },
      { label: 'Losing years', show: (s) => `${s.losingYears} of ${s.yearCount}`, score: (s) => -s.losingYears / Math.max(1, s.yearCount) },
    ] },
    { title: 'Adjustments made', rows: [
      { label: 'Bought back 1 sold call', show: (s) => s.u1 },
      { label: 'Moved the bought call up', show: (s) => s.u2 },
      { label: 'Bought back the sold put', show: (s) => s.d1 },
      { label: 'Bought a protective put', show: (s) => s.d2 },
    ] },
  ];
  const winner = (r: Metric) => { if (!r.score || shownPer.length < 2) return null; const top = Math.max(...shownPer.map((p) => r.score!(p.stats))); return new Set(shownPer.filter((p) => r.score!(p.stats) === top).map((p) => p.m)); };
  const years = [...new Set(shownPer.flatMap((p) => [...p.stats.byYear.keys()]))].sort().reverse();

  const listed = (sel?.rows ?? []).filter((r) => (result === 'all' ? true : result === 'won' ? r.net > 0 : result === 'lost' ? r.net <= 0 : r.events.length > 0));
  const shown = sort === 'date' ? [...listed].reverse() : [...listed].sort((a, b) => (sort === 'net' ? a.net - b.net : a.worstMtm - b.worstMtm));
  const monthRows = sel ? [...sel.stats.byYear.keys()].sort().reverse().map((y) => {
    const cells: (number | undefined)[] = Array(12).fill(undefined);
    for (const r of sel.rows) if (r.expiry.startsWith(y)) { const m = Number(r.expiry.slice(5, 7)) - 1; cells[m] = (cells[m] ?? 0) + r.net; }
    const show = (v: number | undefined) => (v == null ? '' : cell === 'rupees' ? <Money v={v} /> : <Pct v={sel.margin ? (v / sel.margin) * 100 : null} />);
    return [<b key="y">{y}</b>, ...cells.map((v, i) => <span key={i}>{show(v)}</span>), <b key="t">{show(sel.stats.byYear.get(y))}</b>];
  }) : [];
  const eventText = (e: string) => e.replace(/^(\S+) U1 bought back/, '$1: bought back').replace(/^(\S+) U2 /, '$1: ').replace(/^(\S+) D1 /, '$1: ').replace(/^(\S+) D2 /, '$1: ');

  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-2">Your call ratio<InfoTip label="About this test">Buy 1 ATM call, sell 2 calls and 1 put a set distance away: 8% (about 2,000 points at NIFTY 25,000), 10%, 12% or 15%, taken as a share of the index so 2011 and today get the same shape. Your upside adjustments: when NIFTY reaches the sold call, buy back one of the two; at 1.5× the distance (28,000 from 25,000 at 8%), sell the bought call and buy the one at half the distance (26,000). The adjustment levels move with the distance. The downside adjustment was my choice: buy back the sold put when NIFTY reaches it, or buy a put 1.5× the distance down when NIFTY falls half the distance. Entry at the close of the first trading day after a monthly expiry (Jan → Dec: the last Monday of January), one position at a time, held to expiry. Adjustments are checked at daily closes. NIFTY, 1 lot at today&apos;s index level and lot size, after charges and ₹1 slippage per leg.</InfoTip></span>}
        right={<button type="button" onClick={reset} className="text-[12px] font-semibold text-accent-deep">Reset</button>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Adjustment" value={adj} onChange={setAdj} options={(Object.keys(ADJ) as Adj[]).map((k) => ({ value: k, label: ADJ[k].label, title: ADJ[k].title }))} />
          <Segmented label="Distance" value={base} onChange={setBase} options={BASES.map((b) => ({ value: b, label: `${b}%`, title: b === '8' ? 'About 2,000 points at NIFTY 25,000' : `About ${(Number(b) * 250).toLocaleString('en-IN')} points at NIFTY 25,000` }))} />
          <Segmented label="Shorter expiries" value={scaled} onChange={setScaled} options={[{ value: 'fixed', label: 'Same distance' }, { value: 'scaled', label: 'Closer', title: 'Closer strikes for short expiries: distance × √(months ÷ 11). Jan → Dec always uses the full distance.' }]} />
          <Segmented label="Prices" value={prices} onChange={setPrices} options={[{ value: 'all', label: 'All trades' }, { value: 'traded', label: 'Traded prices only' }]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3 text-[13px] text-ink-2">
          <label className="flex items-center gap-1.5">From <select aria-label="From year" className={selectCls} value={fromY} onChange={(e) => setFrom(e.target.value)}>{allYears.map((y) => <option key={y} disabled={y > toY}>{y}</option>)}</select></label>
          <label className="flex items-center gap-1.5">To <select aria-label="To year" className={selectCls} value={toY} onChange={(e) => setTo(e.target.value)}>{allYears.map((y) => <option key={y} disabled={y < fromY}>{y}</option>)}</select></label>
          <label className="flex items-center gap-1.5">Capital <input aria-label="Capital" type="number" min={1} step={50000} className={`${selectCls} w-28 tabular-nums`} value={capital} onChange={(e) => setCapital(Math.max(1, Number(e.target.value) || 1))} /></label>
          <span className="ml-1 flex flex-wrap items-center gap-1" role="group" aria-label="Expiries to compare">
            {FRAMES.map((m) => { const on = frames.includes(m); return <button key={m} type="button" aria-pressed={on} onClick={() => setFrames(on ? frames.filter((x) => x !== m) : [...frames, m])} className={`h-8 rounded-[9px] px-2 text-[12px] font-semibold ${on ? 'bg-accent-soft text-accent-deep' : 'bg-raised text-muted line-through'}`}>{m === 11 ? 'Jan → Dec' : `${m} m`}</button>; })}
            <InfoTip label="About the expiry buttons">Tap an expiry to add or remove it from the comparison. 1 to 6 months enter on the first trading day after a monthly expiry. Jan → Dec enters at the close of the last Monday of January and holds to that year&apos;s December expiry; this year&apos;s trade is still open, so it is not counted.</InfoTip>
          </span>
        </div>
      </Card>

      {!shownPer.length ? <Card><p className="p-4 text-[13px] text-muted">No trades match these filters.</p></Card> : <>
        <div className="panel p-4 text-[14px] font-semibold">On these filters: most profit a year is {best((s) => s.perYear)}. Smallest worst MTM is {best((s) => s.worstMtm)}. Most profit since 2023 is {best((s) => s.since2023)}.</div>

        <Card title="Every distance and expiry" right={<Segmented label="Show in grid" value={gridShow} onChange={setGridShow} options={[{ value: 'perYear', label: 'Profit a year' }, { value: 'since2023', label: 'Since 2023' }, { value: 'worstMtm', label: 'Worst MTM' }, { value: 'won', label: 'Won' }, { value: 'losing', label: 'Losing years' }]} />}>
          <Table head={['Expiry', ...BASES.map((b) => `${b}%`)]} rows={grid.map((g) => [<b key="m">{frameName(g.m)}</b>, ...g.cells.map((c) => {
            const on = c.b === base && frames.includes(g.m);
            const v = !c.s ? '–' : gridShow === 'perYear' ? <Money v={c.s.perYear} /> : gridShow === 'since2023' ? <Money v={c.s.since2023} /> : gridShow === 'worstMtm' ? <Money v={c.s.worstMtm} /> : gridShow === 'won' ? `${c.s.won.toFixed(0)}% of ${c.s.trades}` : `${c.s.losingYears} of ${c.s.yearCount}`;
            return <button key={c.b} type="button" disabled={!c.s} onClick={() => { setBase(c.b); setPick(g.m); if (!frames.includes(g.m)) setFrames([...frames, g.m]); }} className={`rounded-[8px] px-2 py-1 text-left tabular-nums ${on ? 'bg-accent-soft font-semibold' : 'hover:bg-raised'}`} title="Show this distance below">{v}</button>;
          })])} />
        </Card>

        <div className="grid gap-3 md:grid-cols-3">
          {shownPer.map((p) => (
            <Card key={p.m} title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />{p.name}</span>} right={<span>{p.stats.trades} trades, {p.stats.won.toFixed(0)}% won</span>}>
              <div className="grid grid-cols-2 gap-3 p-4">
                <div><p className="text-[11px] font-semibold text-muted">Profit a year</p><p className="text-[22px] font-bold"><Money v={p.stats.perYear} /></p></div>
                <div><p className="text-[11px] font-semibold text-muted">ROI a year on margin</p><p className={`text-[22px] font-bold tabular-nums ${tone(p.stats.roiMargin)}`}>{pct(p.stats.roiMargin)}</p></div>
                <div><p className="text-[11px] font-semibold text-muted">Worst MTM</p><p className="text-[15px] font-bold"><Money v={p.stats.worstMtm} /></p></div>
                <div><p className="text-[11px] font-semibold text-muted">Since 2023</p><p className="text-[15px] font-bold"><Money v={p.stats.since2023} /></p></div>
              </div>
            </Card>
          ))}
        </div>

        <Card title="Running total profit"><Lines series={shownPer.map((p) => ({ name: p.name, pts: p.stats.curve, color: p.color }))} /></Card>

        <Card title="Full comparison" right={<span>Best in each row is marked.</span>}>
          <Table head={['', ...shownPer.map((p) => `${p.name}${p.dist != null ? `, ${p.dist}%` : ''}`)]} rows={metrics.flatMap((g) => [
            [<b key="g" className="text-[11px] uppercase tracking-wide text-muted">{g.title}</b>, ...shownPer.map(() => '')],
            ...g.rows.map((r) => { const w = winner(r); return [<span key="l" className="flex items-center gap-1 text-ink-2">{r.label}{r.tip && <InfoTip label={r.label}>{r.tip}</InfoTip>}</span>, ...shownPer.map((p) => <span key={p.m} className="inline-flex items-center gap-1.5">{r.show(p.stats)}{w?.has(p.m) && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent-deep">Best</span>}</span>)]; }),
          ])} />
        </Card>

        <Card title="Year by year" right={<span>By the year the trade ended</span>}>
          <Table head={['Year', ...shownPer.flatMap((p) => [p.name, 'ROI margin'])]} rows={years.map((y) => [<b key="y">{y}</b>, ...shownPer.flatMap((p) => { const v = p.stats.byYear.get(y); return [v == null ? '–' : <Money key="a" v={v} />, v == null ? '–' : <Pct key="b" v={p.margin ? (v / p.margin) * 100 : null} />]; })])} />
        </Card>

        {sel && <>
          <Card title={`Month by month: ${sel.name}`} right={<div className="flex flex-wrap gap-2">
            <Segmented label="Expiry" value={String(sel.m)} onChange={(v) => setPick(Number(v))} options={shownPer.map((p) => ({ value: String(p.m), label: p.m === 11 ? 'Jan → Dec' : `${p.m} m` }))} />
            <Segmented label="Show" value={cell} onChange={setCell} options={[{ value: 'rupees', label: '₹' }, { value: 'margin', label: '% of margin' }]} />
          </div>}>
            <Table head={['Year', ...MONTHS, 'Year total']} rows={monthRows} />
          </Card>

          <Card title={`${shown.length} trades: ${sel.name}`} right={<div className="flex flex-wrap gap-2">
            <Segmented label="Expiry" value={String(sel.m)} onChange={(v) => setPick(Number(v))} options={shownPer.map((p) => ({ value: String(p.m), label: p.m === 11 ? 'Jan → Dec' : `${p.m} m` }))} />
            <Segmented label="Result" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'adjusted', label: 'Adjusted' }]} />
            <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'date', label: 'Newest' }, { value: 'net', label: 'Biggest loss' }, { value: 'mtm', label: 'Worst MTM' }]} />
          </div>}>
            <Table tall head={['Entry', 'Expiry', 'NIFTY in', 'NIFTY out', 'Move', 'Position', 'Adjustments', 'Profit', `ROI ${cap}`, 'ROI margin', 'Worst MTM', 'MTM date', 'Prices']} rows={shown.map((r) => [
              r.entry, r.expiry, r.spotIn.toLocaleString('en-IN'), r.spotOut.toLocaleString('en-IN'), <Pct key="mv" v={(r.spotOut / r.spotIn - 1) * 100} />,
              <span key="l" className="whitespace-normal text-[12px]">{r.legs.join(', ')}</span>,
              <span key="e" className="whitespace-normal text-[12px]">{r.events.length ? r.events.map(eventText).join('; ') : '–'}</span>,
              <Money key="n" v={r.net} />, <Pct key="c" v={(r.net / capital) * 100} />, <Pct key="m" v={sel.margin ? (r.net / sel.margin) * 100 : null} />, <Money key="w" v={r.worstMtm} />, r.worstOn,
              r.model ? <span key="p" className="text-down">NSE settlement</span> : 'Traded',
            ])} />
          </Card>

          {sel.test && Object.keys(sel.test.skipped).length > 0 && (
            <Card title={`Entries that could not be tested: ${sel.name}`}>
              <Table head={['Why', 'Count']} rows={Object.entries(sel.test.skipped).map(([w, c]) => [w, c])} />
            </Card>
          )}
        </>}
      </>}
    </div>
  );
}
