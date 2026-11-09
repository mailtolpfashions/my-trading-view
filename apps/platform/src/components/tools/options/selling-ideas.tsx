'use client';

import { useMemo, useState } from 'react';
import { Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Lines, Money, Table, inr, tone } from './selling-charts';

// Three strategies the user brought from videos and articles, tested as written on NSE closes
// (apps/feed/scripts/selling-{combo,weekly-buy,yearly}.ts). Everything is filtered in the browser from the saved trades.
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const Pct = ({ v }: { v: number | null | undefined }) => <span className={tone(v)}>{pct(v)}</span>;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const selectCls = `${inputCls} h-8 !rounded-[9px] px-2 text-[13px]`;

function stats(nets: number[], from: string, to: string) {
  const w = nets.filter((v) => v > 0), l = nets.filter((v) => v <= 0), total = sum(nets);
  const years = from && to ? Math.max(0.25, (Date.parse(to) - Date.parse(from)) / (365.25 * 86400_000)) : 1;
  return { n: nets.length, won: nets.length ? (w.length / nets.length) * 100 : 0, total, perYear: total / years, avgWin: w.length ? sum(w) / w.length : 0, avgLoss: l.length ? sum(l) / l.length : 0, worst: nets.length ? Math.min(...nets) : 0, best: nets.length ? Math.max(...nets) : 0 };
}
type S = ReturnType<typeof stats>;
const statRows = (cols: { name: string; s: S }[], extra: [string, ...React.ReactNode[]][] = []) => [
  ['Trades', ...cols.map((c) => c.s.n)], ['Won', ...cols.map((c) => `${c.s.won.toFixed(0)}%`)], ['Total profit', ...cols.map((c) => <Money key={c.name} v={c.s.total} />)],
  ['Profit a year', ...cols.map((c) => <Money key={c.name} v={c.s.perYear} />)], ['Average win', ...cols.map((c) => <Money key={c.name} v={c.s.avgWin} />)], ['Average loss', ...cols.map((c) => <Money key={c.name} v={c.s.avgLoss} />)],
  ['Best trade', ...cols.map((c) => <Money key={c.name} v={c.s.best} />)], ['Worst trade', ...cols.map((c) => <Money key={c.name} v={c.s.worst} />)], ...extra,
];
function Years({ from, to, years, onFrom, onTo }: { from: string; to: string; years: string[]; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return <>
    <label className="flex items-center gap-1.5 text-[13px] text-ink-2">From <select aria-label="From year" className={selectCls} value={from} onChange={(e) => onFrom(e.target.value)}>{years.map((y) => <option key={y} disabled={y > to}>{y}</option>)}</select></label>
    <label className="flex items-center gap-1.5 text-[13px] text-ink-2">To <select aria-label="To year" className={selectCls} value={to} onChange={(e) => onTo(e.target.value)}>{years.map((y) => <option key={y} disabled={y < from}>{y}</option>)}</select></label>
  </>;
}
const Note = ({ children }: { children: React.ReactNode }) => <div className="panel p-4 text-[14px] font-semibold">{children}</div>;

// ---- 1. Volatile + range-bound -------------------------------------------------------------------------------
type ComboRow = { entry: string; expiry: string; spotIn: number; spotOut: number; move: number; synthetic: boolean; p1: { net: number; exit: string; early: boolean; worst: number }; p2: { net: number; exit: string; early: boolean; worst: number; credit: number }; net: number; legs: string[] };
type ComboTest = { index: string; months: number; wide: boolean; part1: 'target' | 'hold'; part2: 'hold' | 'book'; rows: ComboRow[]; skips: { target: string; why: string }[] };
type ComboData = { result: Record<string, { lot: number; margins: Record<string, number | null>; relabelled?: number; tests: ComboTest[] }> };
function Combo() {
  const { data, error } = useFeed<ComboData>('selling-research/combo');
  const [index, setIndex] = useState<'BANKNIFTY' | 'NIFTY'>('BANKNIFTY');
  const [months, setMonths] = useState<'1' | '2' | '3'>('1');
  const [wide, setWide] = useState<'no' | 'yes'>('no');
  const [p1, setP1] = useState<'target' | 'hold'>('target');
  const [p2, setP2] = useState<'hold' | 'book'>('hold');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [result, setResult] = useState<'all' | 'won' | 'lost' | 'both-lost'>('all');
  const test = data?.result[index]?.tests.find((t) => t.months === Number(months) && t.wide === (wide === 'yes' && months !== '1') && t.part1 === p1 && t.part2 === p2);
  const years = useMemo(() => [...new Set((test?.rows ?? []).map((r) => r.entry.slice(0, 4)))].sort(), [test]);
  if (!data) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const f = from && years.includes(from) ? from : years[0] ?? '', t = to && years.includes(to) ? to : years.at(-1) ?? '';
  const rows = (test?.rows ?? []).filter((r) => r.entry.slice(0, 4) >= f && r.entry.slice(0, 4) <= t);
  const span: [string, string] = [rows[0]?.entry ?? '', rows.at(-1)?.expiry ?? ''];
  const cols = [{ name: 'Part 1: future + 2 puts', s: stats(rows.map((r) => r.p1.net), ...span) }, { name: 'Part 2: iron condor', s: stats(rows.map((r) => r.p2.net), ...span) }, { name: 'Both together', s: stats(rows.map((r) => r.net), ...span) }];
  const byYear = new Map<string, [number, number, number]>(); for (const r of rows) { const y = r.expiry.slice(0, 4), v = byYear.get(y) ?? [0, 0, 0]; byYear.set(y, [v[0] + r.p1.net, v[1] + r.p2.net, v[2] + r.net]); }
  const dw = rows.filter((r) => r.p1.net > 0 && r.p2.net > 0).length, dl = rows.filter((r) => r.p1.net <= 0 && r.p2.net <= 0).length;
  const margin = data.result[index].margins[months];
  const list = rows.filter((r) => (result === 'all' ? true : result === 'won' ? r.net > 0 : result === 'lost' ? r.net <= 0 : r.p1.net <= 0 && r.p2.net <= 0)).reverse();
  let eq = 0; const curve: [string, number][] = rows.map((r) => [r.expiry, (eq += r.net)]);
  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-2">Volatile + range-bound<InfoTip label="About this test">Part 1: buy the future, a put about 1,000 points in the money and a put about 1,000 points out of the money (500 and 1,000 points are taken as a share of the index, as at Bank Nifty 49,200). Exit Part 1 at +₹5,000 or −₹5,000. Part 2: sell calls and puts about 500 points out, buy them about 1,000 points out; hold to expiry or book at half the credit. Future + put = call, so Part 1 is really a bought strangle. Entry at the close of the first trading day after a monthly expiry (the article used 9:30 AM). Checked at daily closes, so a ±₹5,000 exit can overshoot. 1 lot at today&apos;s index level and lot size, after charges and ₹1 slippage. &quot;Wider&quot; stretches the distances by √months.</InfoTip></span>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Index" value={index} onChange={setIndex} options={[{ value: 'BANKNIFTY', label: 'Bank Nifty' }, { value: 'NIFTY', label: 'NIFTY' }]} />
          <Segmented label="Expiry" value={months} onChange={setMonths} options={[{ value: '1', label: '1 month' }, { value: '2', label: '2 months' }, { value: '3', label: '3 months' }]} />
          <Segmented label="Distance" value={wide} onChange={setWide} options={[{ value: 'no', label: 'As written' }, { value: 'yes', label: 'Wider', title: 'Only for 2 and 3 months' }]} />
          <Segmented label="Part 1 exit" value={p1} onChange={setP1} options={[{ value: 'target', label: 'Part 1 at ±₹5,000' }, { value: 'hold', label: 'Part 1 to expiry' }]} />
          <Segmented label="Part 2 exit" value={p2} onChange={setP2} options={[{ value: 'hold', label: 'Part 2 to expiry' }, { value: 'book', label: 'Part 2 book half' }]} />
          <Years from={f} to={t} years={years} onFrom={setFrom} onTo={setTo} />
        </div>
      </Card>
      {!rows.length ? <Card><p className="p-4 text-[13px] text-muted">No trades for this choice. 6-month contracts never had the strikes traded, and wider 3-month Bank Nifty had none either.</p></Card> : <>
        <Note>Both parts made money in {dw} trades and both lost in {dl}, out of {rows.length}. Margin today for both parts: {inr(margin)}.</Note>
        <Card title="Running total, both parts"><Lines series={[{ name: 'Both together', pts: curve }]} /></Card>
        <Card title="Results"><Table head={['', ...cols.map((c) => c.name)]} rows={statRows(cols)} /></Card>
        <Card title="Year by year"><Table head={['Year', 'Part 1', 'Part 2', 'Both']} rows={[...byYear.entries()].reverse().map(([y, v]) => [<b key="y">{y}</b>, <Money key="a" v={v[0]} />, <Money key="b" v={v[1]} />, <Money key="c" v={v[2]} />])} /></Card>
        <Card title={`${list.length} trades`} right={<Segmented label="Result" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'both-lost', label: 'Both parts lost' }]} />}>
          <Table tall head={['Entry', 'Expiry', 'Index in', 'Index out', 'Move', 'Position', 'Part 1', 'Part 1 exit', 'Part 2', 'Part 2 exit', 'Both']} rows={list.map((r) => [
            r.entry, r.expiry, r.spotIn.toLocaleString('en-IN'), r.spotOut.toLocaleString('en-IN'), <Pct key="m" v={r.move} />,
            <span key="l" className="whitespace-normal text-[12px]">{r.legs.join(', ')}{r.synthetic && <b className="block text-down">Built with a call (no future listed)</b>}</span>,
            <Money key="1" v={r.p1.net} />, r.p1.early ? r.p1.exit : 'Expiry', <Money key="2" v={r.p2.net} />, r.p2.early ? r.p2.exit : 'Expiry', <Money key="b" v={r.net} />,
          ])} />
        </Card>
        {test && test.skips.length > 0 && <Card title={`${test.skips.length} months could not be tested`}><Table head={['Expiry', 'Why']} rows={test.skips.filter((s) => s.target.slice(0, 4) >= f && s.target.slice(0, 4) <= t).map((s) => [s.target, s.why])} /></Card>}
      </>}
    </div>
  );
}

// ---- 2. Weekly future + put --------------------------------------------------------------------------------------
type WeekRow = { entry: string; expiry: string; spotIn: number; spotOut: number; net: number; exit: string; timeValue: number; legs: string[] };
type WeekTest = { version: string; rule: 'hold' | 'pm5k' | 'trail' | 'day2'; rows: WeekRow[] };
type WeekData = { margins: Record<string, number | null>; tests: WeekTest[] };
function Weekly() {
  const { data, error } = useFeed<WeekData>('selling-research/weekly-buy');
  const [ver, setVer] = useState<'A' | 'B'>('A');
  const [rule, setRule] = useState<WeekTest['rule']>('hold');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [result, setResult] = useState<'all' | 'won' | 'lost'>('all');
  const test = data?.tests.find((t) => t.version.startsWith(ver) && t.rule === rule);
  const years = useMemo(() => [...new Set((test?.rows ?? []).map((r) => r.entry.slice(0, 4)))].sort(), [test]);
  if (!data || !test) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const f = from && years.includes(from) ? from : years[0], t = to && years.includes(to) ? to : years.at(-1)!;
  const rows = test.rows.filter((r) => r.entry.slice(0, 4) >= f && r.entry.slice(0, 4) <= t);
  const s = stats(rows.map((r) => r.net), rows[0]?.entry ?? '', rows.at(-1)?.expiry ?? '');
  const runs = rows.slice(11).map((_, i) => sum(rows.slice(i, i + 12).map((r) => r.net))).sort((a, b) => a - b);
  const margin = data.margins[ver], hit195 = runs.filter((x) => x >= 1.95 * 90000).length;
  const byYear = new Map<string, number>(); for (const r of rows) byYear.set(r.entry.slice(0, 4), (byYear.get(r.entry.slice(0, 4)) ?? 0) + r.net);
  const list = rows.filter((r) => (result === 'all' ? true : result === 'won' ? r.net > 0 : r.net <= 0)).reverse();
  let eq = 0; const curve: [string, number][] = rows.map((r) => [r.exit, (eq += r.net)]);
  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-2">Weekly future + put<InfoTip label="About this test">Each week buy 2 lots of the monthly NIFTY future and 2 lots of the ATM weekly put; version B also buys 2 lots of a put about 100 points in the money. Future + put = call, so A is two bought calls and B is close to a bought straddle. Stop at −₹5,000. The article&apos;s profit exit is vague, so four exits were fixed before running: hold to expiry; ±₹5,000; trail (once +₹5,000, exit if profit halves); exit after the 2nd day. Entry at the close of the first trading day of the week (the article used 9:30 AM), weekly options from Feb 2019. Checked at daily closes, so the stop can overshoot. 2 lots at today&apos;s index level and lot size, after charges and ₹1 slippage.</InfoTip></span>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Version" value={ver} onChange={setVer} options={[{ value: 'A', label: 'A: future + ATM put' }, { value: 'B', label: 'B: + ITM put' }]} />
          <Segmented label="Exit" value={rule} onChange={setRule} options={[{ value: 'hold', label: 'Hold to expiry' }, { value: 'pm5k', label: '±₹5,000' }, { value: 'trail', label: 'Trail' }, { value: 'day2', label: 'After 2nd day' }]} />
          <Years from={f} to={t} years={years} onFrom={setFrom} onTo={setTo} />
        </div>
      </Card>
      <Note>Funds needed today for 2 lots: {inr(margin)}. The article claimed 195% in 12 weeks on ₹90,000: {hit195} of {runs.length} 12-week runs here reached it. The typical run made {inr(runs[Math.floor(runs.length / 2)])}.</Note>
      <Card title="Running total"><Lines series={[{ name: 'Running total', pts: curve }]} /></Card>
      <Card title="Results"><Table head={['', 'This version']} rows={statRows([{ name: 'v', s }], [['Average time value paid', inr(sum(rows.map((r) => r.timeValue)) / Math.max(1, rows.length))], ['Best 12 weeks', <Money key="b" v={runs.at(-1)} />], ['Worst 12 weeks', <Money key="w" v={runs[0]} />]])} /></Card>
      <Card title="Year by year"><Table head={['Year', 'Profit']} rows={[...byYear.entries()].reverse().map(([y, v]) => [<b key="y">{y}</b>, <Money key="v" v={v} />])} /></Card>
      <Card title={`${list.length} weeks`} right={<Segmented label="Result" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />}>
        <Table tall head={['Entry', 'Exit', 'Expiry', 'NIFTY in', 'NIFTY out', 'Position', 'Time value paid', 'Profit']} rows={list.map((r) => [r.entry, r.exit, r.expiry, r.spotIn.toLocaleString('en-IN'), r.spotOut.toLocaleString('en-IN'), <span key="l" className="whitespace-normal text-[12px]">{r.legs.join(', ')}</span>, inr(r.timeValue), <Money key="n" v={r.net} />])} />
      </Card>
    </div>
  );
}

// ---- 3. Yearly 1 × 2 call ratio + put ----------------------------------------------------------------------------
type YRes = { net: number; status: string; worstMtm: number; worstOn: string };
type YRow = { year: number; entry: string; expiry?: string; spotIn?: number; spotOut?: number | null; move?: number | null; modelPriced?: number; credit?: number; maxProfit?: number; maxVix?: number; legs?: string[]; skipped?: string } & Partial<Record<'hold' | 'vix30' | 'stop50' | 'half', YRes>>;
type YData = { margins: Record<string, number | null>; years: YRow[] };
function Yearly() {
  const { data, error } = useFeed<YData>('selling-research/yearly');
  const [rule, setRule] = useState<'hold' | 'vix30' | 'stop50' | 'half'>('hold');
  const [prices, setPrices] = useState<'all' | 'traded'>('traded');
  if (!data) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const done = data.years.filter((y) => y[rule] && y.spotOut != null && (prices === 'all' || !y.modelPriced));
  const s = stats(done.map((y) => y[rule]!.net), done[0]?.entry ?? '', done.at(-1)?.expiry ?? '');
  const [mExp, margin] = Object.entries(data.margins)[0] ?? ['', null];
  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-2">Yearly ratio (Jan → Dec)<InfoTip label="About this test">From your strategy builder screenshot: buy 1 call about 3% in the money, sell 2 calls about 5.3% out of the money, sell 1 put about 11.6% out of the money, on the December expiry, entered at the close of the last Monday of January. December strikes are 500 to 1,000 points apart, so each leg takes the nearest traded strike. Where no strike traded that day, NSE&apos;s settlement price was used and the year is marked. 1 set at today&apos;s index level and lot size, after charges and ₹1 slippage. India VIX has a gap in 2013, so the VIX exit could not fire that year.</InfoTip></span>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Exit" value={rule} onChange={setRule} options={[{ value: 'hold', label: 'Hold to expiry' }, { value: 'half', label: 'Book at half max profit' }, { value: 'vix30', label: 'Exit if VIX ≥ 30' }, { value: 'stop50', label: 'Stop at −₹50,000' }]} />
          <Segmented label="Prices" value={prices} onChange={setPrices} options={[{ value: 'traded', label: 'Traded prices only' }, { value: 'all', label: 'Include NSE settlement years' }]} />
        </div>
      </Card>
      <Note>Margin today for the same shape on {mExp}: {inr(margin)}. Worst open loss in any year: {inr(Math.min(...done.map((y) => y[rule]!.worstMtm)))}.</Note>
      <Card title="Results"><Table head={['', 'This exit']} rows={statRows([{ name: 'y', s }], [['Losing years', `${done.filter((y) => y[rule]!.net < 0).length} of ${done.length}`]])} /></Card>
      <Card title="Every year">
        <Table tall head={['Year', 'Entry', 'NIFTY in', 'NIFTY out', 'Move', 'Position', 'Credit', 'Max profit', 'Result', 'How it ended', 'Worst MTM', 'MTM date', 'Highest VIX', 'Prices']} rows={[...data.years].reverse().map((y) => y.skipped ? [<b key="y">{y.year}</b>, y.entry, '', '', '', <span key="s" className="text-muted">{y.skipped}</span>, '', '', '', '', '', '', '', ''] : [
          <b key="y">{y.year}</b>, y.entry, y.spotIn!.toLocaleString('en-IN'), y.spotOut ? y.spotOut.toLocaleString('en-IN') : 'Open', <Pct key="m" v={y.move} />,
          <span key="l" className="whitespace-normal text-[12px]">{y.legs!.join(', ')}</span>, inr(y.credit), inr(y.maxProfit), <Money key="n" v={y[rule]!.net} />, y[rule]!.status, <Money key="w" v={y[rule]!.worstMtm} />, y[rule]!.worstOn, y.maxVix ? y.maxVix.toFixed(1) : '–',
          y.modelPriced ? <span key="p" className="text-down">NSE settlement ({y.modelPriced} legs)</span> : 'Traded',
        ])} />
      </Card>
    </div>
  );
}

export function SellingIdeas() {
  const [idea, setIdea] = useState<'combo' | 'weekly' | 'yearly'>('combo');
  return (
    <div className="flex flex-col gap-3">
      <Segmented label="Idea" value={idea} onChange={setIdea} options={[{ value: 'combo', label: 'Volatile + range-bound' }, { value: 'weekly', label: 'Weekly future + put' }, { value: 'yearly', label: 'Yearly ratio (Jan → Dec)' }]} />
      {idea === 'combo' ? <Combo /> : idea === 'weekly' ? <Weekly /> : <Yearly />}
    </div>
  );
}
