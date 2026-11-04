'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import type { Tool } from '@/lib/tools';
import { Card, ToolShell } from '../tool-shell';
import { SellingDecay } from './selling-decay';

type Period = { period: string; netPaise: number; trades: number; wins: number };
type Today = { expiry: string; marginPaise: number | null; creditPaise: number; legs: { side: string; strike: number; kind: string; price: number }[]; gaps: { gapPct: number; pnlPaise: number }[] } | null;
type Leader = {
  id: string; leader: string; name: string; putPct: number | null; trades: number; skipped: number; wonPct: number; avgWinPaise: number; avgLossPaise: number; perYearPaise: number; netPaise: number;
  sameTradesNoPutPaise: number; worstTradePaise: number; worstYearPaise: number; worstYear: string; maxDrawdownPaise: number; longestUnderwaterDays: number; since2023Paise: number; upTo2022Paise: number;
  losingYears: number; yearCount: number; years: Period[]; crisis: { id: string; label: string; netPaise: number }[]; stress: { gapPct: number; worstPaise: number; medianPaise: number }[];
  latePerYearPaise: number; lateWorstPaise: number; dearPerYearPaise: number; equity: [string, number][]; today: Today;
};
type Stats = { trades: number; skipped: number; won: number; avgWin: number; avgLoss: number; worst: number; perYear: number; loseYears: number; years: number; since2023: number; adjustments: number | null; stops: number | null };
type Ironed = Stats & { ce: number; days: number; manage: string; filter: boolean; late: boolean };
type Shape = Stats & { name: string; paper: boolean; away: number | null; mult: number | null; final: boolean | null; highIv: boolean; noEvents: boolean };
type Adj = Stats & { sold: number | null; entry: string; exit: string; kind: string; cross: boolean; stop: number | null; late: boolean; highIv: boolean; overlap: boolean };
type RuleSide = { from: string; to: string; variants: { name: string; trades: number; skipped: number; wonPct: number; avgWinPaise: number; avgLossPaise: number; perYearPaise: number; worstTradePaise: number; worstYearPaise: number; maxDrawdownPaise: number; since2023Paise: number; losingYears: number; yearCount: number }[] };
type Report = {
  leaders: { from: string; to: string; yearsCovered: number; todayLot: number; rows: Leader[] }; nifty: RuleSide; banknifty: RuleSide;
  overlap: { name: string; months: number; correlation: number; niftyLost: number; bankLost: number; bothLost: number; worstBoth: number }[];
  ironed: Ironed[]; shape: Shape[]; premium: Adj[]; delta: Adj[];
  moves: { rows: (string | number)[][]; years: number[][] };
  earlier: { weeklyHedge: (string | number)[][]; weeklyMargin: (string | number)[][]; lossLimit: (string | number | null)[][]; calendars: (string | number)[][] };
};

const inr = (v: number | null | undefined) => (v == null ? '–' : `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`);
const inrP = (p: number | null | undefined) => (p == null ? '–' : inr(p / 100));
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : '');
const th = 'px-3 py-2 text-left text-[11px] font-semibold text-muted whitespace-nowrap';
const td = 'px-3 py-2 text-[13px] whitespace-nowrap tabular-nums';
const BASE_PCT = 7.5;

function Table({ head, rows, tall }: { head: string[]; rows: React.ReactNode[][]; tall?: boolean }) {
  return (
    <div className={`overflow-x-auto ${tall ? 'max-h-[520px] overflow-y-auto' : ''}`}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-panel"><tr className="border-b border-line">{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
const Money = ({ v }: { v: number | null | undefined }) => <span className={tone(v)}>{inr(v)}</span>;
const MoneyP = ({ p }: { p: number | null | undefined }) => <span className={tone(p)}>{inrP(p)}</span>;

/** The answer first, in one plain sentence. */
function Answer({ children }: { children: React.ReactNode }) {
  return <p className="panel px-4 py-3 text-[15px] font-semibold leading-relaxed">{children}</p>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-2">{children}</p>;
}

/** Bars from a zero line, so a loss visibly points the other way. The value is always written beside the bar. */
function Bars({ rows, plain }: { rows: { label: string; value: number }[]; plain?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value))), hasNeg = rows.some((r) => r.value < 0);
  return (
    <div className="flex flex-col gap-2 p-4">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * (hasNeg ? 50 : 100);
        return (
          <div key={r.label} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_84px] items-center gap-3 text-[13px]" title={`${r.label}: ${inr(r.value)}`}>
            <span className="truncate text-ink-2">{r.label}</span>
            <div className="relative h-3">
              {hasNeg && <span className="absolute left-1/2 top-0 h-3 w-px bg-line-strong" />}
              <span className="absolute top-0 h-3 rounded-[4px]" style={{ width: `${Math.max(w, 0.5)}%`, left: hasNeg ? (r.value >= 0 ? '50%' : `${50 - w}%`) : 0, background: plain ? 'var(--chart-1)' : r.value >= 0 ? 'var(--color-up)' : 'var(--color-down)' }} />
            </div>
            <span className="text-right font-semibold tabular-nums">{inr(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

const W = 1320, H = 340, P = { l: 84, r: 24, t: 14, b: 30 };
/** Running total of each rule over time. Hover to read any date. */
function Lines({ series }: { series: { name: string; pts: [string, number][] }[] }) {
  const all = series.flatMap((s) => s.pts), times = all.map((p) => Date.parse(p[0])), t0 = Math.min(...times), t1 = Math.max(...times);
  const lo = Math.min(0, ...all.map((p) => p[1])), hi = Math.max(0, ...all.map((p) => p[1]));
  const x = (d: string) => P.l + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - P.l - P.r), y = (v: number) => P.t + ((hi - v) / (hi - lo || 1)) * (H - P.t - P.b);
  const [hover, setHover] = useState<number | null>(null);
  const near = (s: { pts: [string, number][] }, t: number) => s.pts.reduce((b, p) => (Math.abs(Date.parse(p[0]) - t) < Math.abs(Date.parse(b[0]) - t) ? p : b));
  const ticks = [...new Set([lo, 0, hi, (hi + lo) / 2])].sort((a, b) => a - b);
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[12px] text-ink-2">
        {series.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: `var(--chart-${i + 1})` }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label="Running total of profit for each rule"
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(t0 + Math.max(0, Math.min(1, (((e.clientX - r.left) / r.width) * W - P.l) / (W - P.l - P.r))) * (t1 - t0)); }} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)">{inr(v)}</text></g>)}
        {Array.from({ length: 6 }, (_, i) => t0 + (i / 5) * (t1 - t0)).map((t) => <text key={t} x={P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{new Date(t).getUTCFullYear()}</text>)}
        {series.map((s, i) => <polyline key={s.name} fill="none" stroke={`var(--chart-${i + 1})`} strokeWidth="2" strokeLinejoin="round" points={s.pts.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} />)}
        {hover != null && series.map((s, i) => { const p = near(s, hover); return <circle key={s.name} cx={x(p[0])} cy={y(p[1])} r="4" fill={`var(--chart-${i + 1})`} stroke="var(--color-panel)" strokeWidth="2" />; })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute left-20 top-9 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[var(--shadow-panel)]">
          <p className="font-semibold">{near(series[0], hover)[0]}</p>
          {series.map((s) => <p key={s.name} className="tabular-nums text-ink-2">{s.name}: {inr(near(s, hover)[1])}</p>)}
        </div>
      )}
    </div>
  );
}

function money<T>(rows: T[], get: (r: T) => number) { return rows.length ? Math.max(...rows.map(get)) : 0; }

function Summary({ r }: { r: Report }) {
  const by = (id: string) => r.leaders.rows.find((x) => x.id === id)!;
  const picks = [['0.25 delta, 21 days', by('d25-21-none')], ['0.25 delta, 21 days, crash put', by('d25-21-15')], ['0.16 delta, 21 days', by('d16-21-none')], ['0.16 delta, 21 days, crash put', by('d16-21-15')], ['0.10 delta, to expiry', by('d10-hold-none')]] as [string, Leader][];
  const goal = picks.map(([name, l]) => {
    const margin = (l.today?.marginPaise ?? 0) / 100, full = (l.perYearPaise / 100) * ((l.trades + l.skipped) / l.trades);
    const size = (cap: number) => { const lots = margin ? Math.floor((cap * 0.6) / margin) : 0; return { lots, pct: BASE_PCT + (lots * full / cap) * 100 }; };
    return { name, margin, full, l, s5: size(500000), s10: size(1000000), gap: l.today?.gaps.find((g) => g.gapPct === -13)?.pnlPaise ?? 0 };
  });
  const premiumAdj = r.premium.filter((x) => x.kind !== 'none'), deltaAdj = r.delta.filter((x) => x.kind !== 'none');
  const found: [string, string][] = [
    ['Does selling win most of the time?', 'Yes, about 75 to 89% of trades in the best rules. But a win rate alone proves nothing: some rules won 85% and still lost money.'],
    ['When should we sell?', 'Only when IV is high compared with its own past year. This was the strongest edge in every test.'],
    ['Where is the sweet spot?', 'Enter about 45 days before monthly expiry and exit at 21 days left.'],
    ['NIFTY or Bank Nifty?', 'NIFTY. Bank Nifty won less often and its worst loss was about three times bigger.'],
    ['Skip Budget and election months?', 'No. Skipping them lowered profit in nearly every test.'],
    ['Do adjustments help?', `They cut the worst losses but remove most of the profit. Premium-based: ${premiumAdj.filter((x) => x.perYear > 0).length} of ${premiumAdj.length} versions made money. Delta-based: ${deltaAdj.filter((x) => x.perYear > 0).length} of ${deltaAdj.length}. Not adjusting still earned more.`],
    ['Does a hedge help?', 'Most hedges cost more than they saved. A cheap put 15% below the index was the best balance: it keeps about half to two-thirds of the profit and cuts a 13% crash loss by about 70%.'],
    ['Ironed Collar?', 'It is a bearish spread, not a range trade. Most versions lost money.'],
    ['Can we reach 30% a year?', 'Not supported so far. About 15 to 20% a year looks realistic with the base return, using 60% of capital.'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <Answer>The best rule found: sell a NIFTY call and put about 45 days before monthly expiry, only when IV is high, and exit at 21 days left. It is a practice rule until paper trading proves it.</Answer>
      <Card title="What we found"><Table head={['Question', 'Answer']} rows={found.map(([q, a]) => [<b key={q}>{q}</b>, <span key={a} className="whitespace-normal">{a}</span>])} /></Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Profit a year, one lot"><Bars rows={goal.map((g) => ({ label: g.name, value: g.l.perYearPaise / 100 }))} /></Card>
        <Card title="Worst single trade, one lot"><Bars rows={goal.map((g) => ({ label: g.name, value: g.l.worstTradePaise / 100 }))} /></Card>
      </div>
      <Card title={<span className="flex items-center gap-1.5">Your 30% goal<InfoTip label="About this table"><p>Lots use 60% of capital for margin, keeping 40% free. Return adds a {BASE_PCT}% base from parked money. Crash put rows are scaled up for entries where no put traded in older years, so they are estimates. Margin is today’s estimate.</p></InfoTip></span>}>
        <Table head={['Rule', 'Margin a lot', '₹5 lakh: lots', 'Return a year', '₹10 lakh: lots', 'Return a year', '13% gap down, one lot']} rows={goal.map((g) => [g.name, inr(g.margin), g.s5.lots, `${g.s5.pct.toFixed(1)}%`, g.s10.lots, `${g.s10.pct.toFixed(1)}%`, <MoneyP key="g" p={g.gap} />])} />
      </Card>
    </div>
  );
}

function Best({ r }: { r: Report }) {
  const [put, setPut] = useState<'15' | 'none'>('15');
  const [pick, setPick] = useState('d25-21');
  const rows = r.leaders.rows, shown = rows.filter((x) => String(x.putPct ?? 'none') === put), sel = shown.find((x) => x.leader === pick) ?? shown[0];
  const maxY = money(sel.years, (y) => Math.abs(y.netPaise)) || 1;
  return (
    <div className="flex flex-col gap-3">
      <Answer>0.25 delta exiting at 21 days earned the most. The crash put costs about 40% of the profit, but it cuts a 13% gap loss by about 70%.</Answer>
      <Card title="All the final rules" right={<span>High IV only, one lot of {r.leaders.todayLot}, {r.leaders.from.slice(0, 4)} to {r.leaders.to.slice(0, 4)}</span>}>
        <Table head={['Rule', 'Crash put', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Profit a year', 'Worst trade', 'Worst year', 'Deepest fall', 'Losing years', 'To 2022', 'Since 2023', 'A day late']}
          rows={rows.map((l) => [l.name, l.putPct ? `${l.putPct}% below` : 'None', `${l.trades}${l.skipped ? ` (+${l.skipped} no put)` : ''}`, `${l.wonPct.toFixed(0)}%`, inrP(l.avgWinPaise), inrP(Math.abs(l.avgLossPaise)), <MoneyP key="y" p={l.perYearPaise} />, <MoneyP key="w" p={l.worstTradePaise} />, <MoneyP key="wy" p={l.worstYearPaise} />, inrP(l.maxDrawdownPaise), `${l.losingYears} of ${l.yearCount}`, <MoneyP key="a" p={l.upTo2022Paise} />, <MoneyP key="b" p={l.since2023Paise} />, <MoneyP key="c" p={l.latePerYearPaise} />])} />
        <Note>“No put” means no far put traded at that entry in older years, so the trade was skipped. These are compared with the same trades in the next table.</Note>
      </Card>
      <Card title="What the crash put costs" right={<span>Same trades, with and without the put</span>}>
        <Table head={['Rule', 'Put', 'Trades', 'Without put', 'With put', 'Profit kept', '13% gap down, worst entry']} rows={rows.filter((l) => l.putPct).map((l) => [l.name, `${l.putPct}% below`, l.trades, <MoneyP key="a" p={l.sameTradesNoPutPaise} />, <MoneyP key="b" p={l.netPaise} />, `${Math.round((l.netPaise / l.sameTradesNoPutPaise) * 100)}%`, <MoneyP key="c" p={l.stress.find((g) => g.gapPct === -13)?.worstPaise} />])} />
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Crash put" value={put} onChange={setPut} options={[{ value: '15', label: 'With 15% crash put' }, { value: 'none', label: 'No crash put' }]} />
        <Segmented label="Rule" value={pick} onChange={setPick} options={[{ value: 'd25-21', label: '0.25 delta' }, { value: 'd16-21', label: '0.16 delta' }, { value: 'd10-hold', label: '0.10 delta' }]} />
      </div>
      <Card title="Running total of profit" right={<span>{put === '15' ? 'With 15% crash put' : 'No crash put'}</span>}><Lines series={shown.map((l) => ({ name: l.name, pts: l.equity }))} /></Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={`Year by year: ${sel.name}`}>
          <div className="flex flex-col gap-1.5 p-4">
            {sel.years.map((y) => (
              <div key={y.period} className="grid grid-cols-[44px_minmax(0,1fr)_84px] items-center gap-3 text-[13px] tabular-nums" title={`${y.period}: ${y.trades} trades, ${y.wins} won`}>
                <span className="text-muted">{y.period}</span>
                <div className="relative h-3"><span className="absolute left-1/2 top-0 h-3 w-px bg-line-strong" /><span className="absolute top-0 h-3 rounded-[4px]" style={{ width: `${(Math.abs(y.netPaise) / maxY) * 50}%`, left: y.netPaise >= 0 ? '50%' : `${50 - (Math.abs(y.netPaise) / maxY) * 50}%`, background: y.netPaise >= 0 ? 'var(--color-up)' : 'var(--color-down)' }} /></div>
                <span className="text-right font-semibold">{inrP(y.netPaise)}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <Card title="If the index gapped overnight" right={<span>Model estimate, one lot</span>}>
            <Table head={['Gap', 'On today’s prices', 'Worst past entry']} rows={sel.stress.map((g) => [`${g.gapPct > 0 ? '+' : '−'}${Math.abs(g.gapPct)}%`, <MoneyP key="a" p={sel.today?.gaps.find((x) => x.gapPct === g.gapPct)?.pnlPaise} />, <MoneyP key="b" p={g.worstPaise} />])} />
          </Card>
          <Card title="Shock periods"><Table head={['Period', 'Result']} rows={sel.crisis.map((c) => [<span key={c.id} className="whitespace-normal">{c.label}</span>, <MoneyP key="v" p={c.netPaise} />])} /></Card>
        </div>
      </div>
      {sel.today && <Card title="On today’s prices" right={<span>Expiry {sel.today.expiry}</span>}>
        <Table head={['Leg', 'Strike', 'Price']} rows={sel.today.legs.map((l) => [l.side === 'SELL' ? 'Sell' : 'Buy', `${l.strike} ${l.kind}`, `₹${l.price.toFixed(2)}`])} />
        <Note>Credit {inrP(sel.today.creditPaise)}. Margin about {inrP(sel.today.marginPaise)}. If held to expiry the 0.10 delta rule overlaps the next month’s entry, so one position at a time trades about every second month.</Note>
      </Card>}
    </div>
  );
}

function Moves({ r }: { r: Report }) {
  const m = r.moves;
  return (
    <div className="flex flex-col gap-3">
      <Answer>In 9 of 10 windows, NIFTY stayed within about 8% over 24 days. The extreme was −33.8% in 2020, so a far strike is not a safe strike.</Answer>
      <SellingDecay />
      <Card title="How far NIFTY moves in 24 days" right={<span>June 2011 to now</span>}>
        <Table head={['Period', 'Windows', 'Typical end', '8 in 10', '9 in 10', '99 in 100', 'Typical furthest', '8 in 10', '9 in 10', '99 in 100', 'Biggest up', 'Biggest down']} rows={m.rows.map((x) => x.map((v, i) => (i < 2 ? (i === 1 ? Number(v).toLocaleString('en-IN') : v) : `${Number(v) < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(1)}%`)))} />
        <Note>“End” is where the index finished after 24 days. “Furthest” is the furthest it reached at any time during those days, up or down.</Note>
      </Card>
      <Card title="Biggest 24-day move in each year"><Table head={['Year', 'Typical furthest', 'Biggest up', 'Biggest down']} rows={m.years.map((y) => [y[0], `${y[1].toFixed(1)}%`, `+${y[2].toFixed(1)}%`, `−${Math.abs(y[3]).toFixed(1)}%`])} /></Card>
    </div>
  );
}

function Bank({ r }: { r: Report }) {
  const pick = (s: RuleSide, n: string) => s.variants.find((v) => v.name === n)!;
  const names = ['Without the crash put', 'The rule, with crash put'];
  return (
    <div className="flex flex-col gap-3">
      <Answer>NIFTY is better. Bank Nifty pays more premium, but its losses are bigger, and its far puts often do not trade.</Answer>
      {names.map((n) => {
        const a = pick(r.nifty, n), b = pick(r.banknifty, n), row = (label: string, f: (v: typeof a) => React.ReactNode) => [label, f(a), f(b)];
        return <Card key={n} title={n === names[0] ? 'Without the crash put' : 'With the crash put'}><Table head={['One lot, high IV, 45 to 21 days', 'NIFTY', 'Bank Nifty']} rows={[row('Trades', (v) => `${v.trades}${v.skipped ? ` (${v.skipped} skipped)` : ''}`), row('Won', (v) => `${v.wonPct.toFixed(0)}%`), row('Average win', (v) => inrP(v.avgWinPaise)), row('Average loss', (v) => inrP(Math.abs(v.avgLossPaise))), row('Profit a year', (v) => <MoneyP p={v.perYearPaise} />), row('Worst trade', (v) => <MoneyP p={v.worstTradePaise} />), row('Worst year', (v) => <MoneyP p={v.worstYearPaise} />), row('Deepest fall', (v) => inrP(v.maxDrawdownPaise)), row('Since 2023', (v) => <MoneyP p={v.since2023Paise} />), row('Losing years', (v) => `${v.losingYears} of ${v.yearCount}`)]} /></Card>;
      })}
      <Card title="If you traded both" right={<span>Months when both traded</span>}>
        <Table head={['Version', 'Months', 'Move together (0 to 1)', 'NIFTY lost', 'Bank Nifty lost', 'Both lost', 'Worst month, both']} rows={r.overlap.map((o) => [o.name, o.months, o.correlation.toFixed(2), o.niftyLost, o.bankLost, o.bothLost, <Money key="w" v={o.worstBoth} />])} />
      </Card>
    </div>
  );
}

const MANAGE: Record<string, string> = { hold: 'Hold to expiry', book50: 'Book 50% profit', 'adj-roll': 'Adjust: roll put', 'adj-hedge': 'Adjust: buy put' };
function Collar({ r }: { r: Report }) {
  const made = r.ironed.filter((x) => x.perYear > 0).length;
  const rows = [...r.ironed].sort((a, b) => b.perYear - a.perYear);
  return (
    <div className="flex flex-col gap-3">
      <Answer>Not recommended. The three legs make a bearish spread that earns if the market falls and loses if it rises. {made} of {r.ironed.length} versions made money, and none beat the NIFTY rule.</Answer>
      <Card title="What the trade really is" right={<span>The note’s example, per unit</span>}>
        <Table head={['Bank Nifty at expiry', 'Result']} rows={[['Below 51,900', <Money key="a" v={200} />], ['52,000', <Money key="b" v={100} />], ['52,100', '₹0, breakeven'], ['Above 52,400', <Money key="c" v={-300} />]]} />
        <Note>The note says the downside is unlimited. It is not: below the put, the short future gains what the short put loses. Scenario B closes the long call, and that does leave a rise with no limit.</Note>
      </Card>
      <Card title={`All ${r.ironed.length} versions`} right={<span>Best first, one lot of 30</span>}>
        <Table tall head={['Call strike', 'Entry', 'Management', 'Filters', 'Timing', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Profit a year', 'Worst trade', 'Losing years', 'Since 2023']} rows={rows.map((x) => [`+${x.ce}`, `${x.days} days before`, MANAGE[x.manage] ?? x.manage, x.filter ? 'VIX, PCR, events' : 'None', x.late ? 'A day late' : 'Same day', x.trades, `${x.won}%`, inr(x.avgWin), inr(x.avgLoss), <Money key="y" v={x.perYear} />, <Money key="w" v={x.worst} />, `${x.loseYears} of ${x.years}`, <Money key="s" v={x.since2023} />])} />
      </Card>
    </div>
  );
}

function ShapeTab({ r }: { r: Report }) {
  const [iv, setIv] = useState<'all' | 'high'>('high');
  const rows = r.shape.filter((x) => x.highIv === (iv === 'high'));
  const table = (list: Shape[]) => {
    const main = list.filter((x) => !x.noEvents), other = (m: Shape) => list.find((x) => x.noEvents && x.away === m.away && x.mult === m.mult && x.final === m.final && x.paper === m.paper);
    return <Table head={['Sold', 'Far sell', 'Final hedge', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Profit a year', 'Worst trade', 'Losing years', 'Since 2023', 'Profit a year, no Budget or election']} rows={main.map((x) => [x.paper ? 'Paper rule' : x.away === 0 ? 'At the money' : `${x.away}% out`, x.paper ? '–' : `${x.mult}×`, x.paper ? '15% put' : x.final ? 'Yes' : 'No', x.trades, `${x.won}%`, inr(x.avgWin), inr(x.avgLoss), <Money key="y" v={x.perYear} />, <Money key="w" v={x.worst} />, `${x.loseYears} of ${x.years}`, <Money key="s" v={x.since2023} />, <Money key="n" v={other(x)?.perYear} />])} />;
  };
  return (
    <div className="flex flex-col gap-3">
      <Answer>Your shape makes money without the final hedge, and every version with it lost. The best reached 80% wins, but it has no loss limit and needs about twice the margin. Skipping Budget and election months lowered profit.</Answer>
      <div><Segmented label="IV filter" value={iv} onChange={setIv} options={[{ value: 'high', label: 'High IV only' }, { value: 'all', label: 'Every month' }]} /></div>
      <Card title="Straddle (sold at the money)" right={<span>45 to 21 days, one lot</span>}>{table(rows.filter((x) => x.away === 0))}</Card>
      <Card title="Strangle (sold further out)" right={<span>45 to 21 days, one lot</span>}>{table(rows.filter((x) => x.away != null && x.away > 0))}</Card>
      <Card title="Paper rule, for comparison">{table(rows.filter((x) => x.paper))}</Card>
    </div>
  );
}

const KIND: Record<string, string> = { none: 'No adjustment', pct30: 'Leg down 30%', pct50: 'Leg down 50%', bal40: 'Balance 40/60', bal35: 'Balance 35/65', bal30: 'Balance 30/70', 'd0.1': 'Delta 0.10', 'd0.15': 'Delta 0.15', 'd0.2': 'Delta 0.20' };
function Adjust({ r }: { r: Report }) {
  const [src, setSrc] = useState<'premium' | 'delta'>('delta');
  const [iv, setIv] = useState<'high' | 'all'>('high');
  const [exit, setExit] = useState<'21d' | 'expiry'>('21d');
  const [show, setShow] = useState(40);
  const list = useMemo(() => r[src].filter((x) => x.highIv === (iv === 'high') && x.exit === exit).sort((a, b) => b.perYear - a.perYear), [r, src, iv, exit]);
  const group = (rows: Adj[]) => [...new Set(rows.map((x) => x.kind))].map((k) => { const a = rows.filter((x) => x.kind === k), one = a.filter((x) => !x.overlap); return [KIND[k] ?? k, a.length, a.filter((x) => x.perYear > 0).length, <Money key="b" v={Math.max(...(one.length ? one : a).map((x) => x.perYear))} />]; });
  return (
    <div className="flex flex-col gap-3">
      <Answer>Adjusting cut the worst losses but gave away most of the profit. Delta adjusting worked far better than premium adjusting, yet not adjusting still earned more. Use it to lower risk, not to earn more.</Answer>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Premium method"><Table head={['Trigger', 'Versions', 'Made money', 'Best a year']} rows={group(r.premium)} /></Card>
        <Card title="Delta method"><Table head={['Trigger', 'Versions', 'Made money', 'Best a year']} rows={group(r.delta)} /></Card>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Method" value={src} onChange={(v) => { setSrc(v); setShow(40); }} options={[{ value: 'delta', label: 'Delta' }, { value: 'premium', label: 'Premium' }]} />
        <Segmented label="IV filter" value={iv} onChange={setIv} options={[{ value: 'high', label: 'High IV only' }, { value: 'all', label: 'Every month' }]} />
        <Segmented label="Exit" value={exit} onChange={setExit} options={[{ value: '21d', label: 'Exit at 21 days' }, { value: 'expiry', label: 'Hold to expiry' }]} />
      </div>
      <Card title={`${list.length} versions`} right={<span>Best first, one lot</span>}>
        <Table tall head={['Sold', 'Entry', 'Rebalance', 'Cross', 'Hard exit', 'Timing', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Profit a year', 'Worst trade', 'Losing years', 'Since 2023', 'Adjustments']}
          rows={list.slice(0, show).map((x) => [x.sold ? `${x.sold.toFixed(2)} delta` : '0.41% premium', `${x.entry === '45d' ? '45 days' : 'New series'}${x.overlap ? ' *' : ''}`, KIND[x.kind] ?? x.kind, x.kind === 'none' ? '–' : x.cross ? 'Yes' : 'No', x.stop ? inr(x.stop) : 'None', x.late ? 'A day late' : 'Same day', x.trades, `${x.won}%`, inr(x.avgWin), inr(x.avgLoss), <Money key="y" v={x.perYear} />, <Money key="w" v={x.worst} />, `${x.loseYears} of ${x.years}`, <Money key="s" v={x.since2023} />, x.adjustments ?? 0])} />
        {show < list.length && <button onClick={() => setShow((s) => s + 80)} className="w-full border-t border-line px-4 py-2.5 text-[13px] font-semibold text-accent-deep hover:bg-accent-soft">Show 80 more of {list.length - show} left</button>}
        {exit === 'expiry' && <Note>* Held to expiry from 45 days overlaps the next month’s entry, so these rows counted two positions at once at times. They need about twice the margin and overstate one-lot results. One position at a time is on the Best rules tab.</Note>}
      </Card>
    </div>
  );
}

function Older({ r }: { r: Report }) {
  const e = r.earlier;
  return (
    <div className="flex flex-col gap-3">
      <Answer>These earlier ideas did not beat the main rule. They used shorter history (2019 to 2026 unless noted), so compare them with care.</Answer>
      <Card title="Weekly hedge against monthly hedge" right={<span>92 trades each, net total</span>}>
        <Table head={['Setup', 'Monthly: cost a trade', 'Net', 'Worst', 'Weekly: cost a trade', 'Net', 'Worst']} rows={e.weeklyHedge.map((x) => [x[0], inr(x[1] as number), <Money key="a" v={x[2] as number} />, <Money key="b" v={x[3] as number} />, inr(x[4] as number), <Money key="c" v={x[5] as number} />, <Money key="d" v={x[6] as number} />])} />
        <Note>Each weekly hedge is cheaper, but you buy it again and again, so the total costs more.</Note>
      </Card>
      <Card title="Margin with a weekly hedge" right={<span>Strangle on the 23 Nov expiry</span>}><Bars plain rows={e.weeklyMargin.map((x) => ({ label: String(x[0]), value: x[1] as number }))} /></Card>
      <Card title="Staying within a ₹5,000 to ₹7,500 loss" right={<span>Monthly, 10 days, 92 trades</span>}>
        <Table head={['Version', 'Won', 'Net total', 'Worst trade', 'Trades over ₹7,500']} rows={e.lossLimit.map((x) => [x[0], `${x[1]}%`, <Money key="a" v={x[2] as number} />, x[3] == null ? 'See note' : <Money key="b" v={x[3] as number} />, x[4]])} />
        <Note>The narrow spreads cap the loss at entry, but they won under half their trades. Their one large loss in the raw test came from a stale NSE price on 12 Mar 2020, so it is not shown.</Note>
      </Card>
      <Card title="Double calendar spreads" right={<span>21 days before near expiry, 2014 to 2026</span>}>
        <Table head={['Strikes', 'Trades', 'Won', 'Profit a year', 'Worst trade', 'Losing years']} rows={e.calendars.map((x) => [x[0], x[1], `${x[2]}%`, <Money key="a" v={x[3] as number} />, <Money key="b" v={x[4] as number} />, `${x[5]} of ${x[6]}`])} />
      </Card>
    </div>
  );
}

const WORDS: [string, string][] = [
  ['Call (CE) and put (PE)', 'A call gains when the index rises. A put gains when it falls. Selling either earns the premium, and loses if the index moves through its strike.'],
  ['Strike', 'The index level an option is tied to.'],
  ['Premium', 'The price of an option.'],
  ['Straddle', 'Selling a call and a put at the same strike, near the index.'],
  ['Strangle', 'Selling a call above the index and a put below it.'],
  ['Delta', 'How much an option moves when the index moves 1 point. 0.16 delta is also roughly a 16% chance of finishing in the money.'],
  ['IV (implied volatility)', 'How much movement option prices expect. High IV means options are expensive, which suits sellers.'],
  ['High IV', 'IV above the middle value of its own past year, using earlier days only.'],
  ['Hedge or crash put', 'An option you buy so that a big move costs less.'],
  ['In the money', 'An option with real value at expiry, because the index went past its strike.'],
  ['Margin', 'Money the broker blocks while the trade is open.'],
  ['Slippage', 'The small amount lost on each trade to the buy and sell price gap. These tests use ₹1 per option.'],
  ['Adjustment', 'Changing the position after the market moves.'],
  ['Gap', 'A jump between one close and the next open. No stop loss can act inside it.'],
  ['Profit a year', 'Total profit divided by years tested, one lot, after charges and slippage.'],
  ['Today’s size', 'Old trades are scaled to today’s lot value, so old years compare fairly with new ones.'],
  ['Deepest fall', 'The largest drop from a high point of total profit to the low that followed.'],
  ['Losing years', 'Calendar years that ended with a total loss.'],
  ['A day late', 'Acting at the next day’s close. It shows how much timing matters.'],
  ['To 2022 and since 2023', 'Rules were found on all years, so the later period is an extra check, not proof.'],
];

const TABS = { summary: 'Summary', best: 'Best rules', moves: 'Market moves', bank: 'NIFTY vs Bank Nifty', collar: 'Ironed Collar', shape: 'Your 2× and 3× shape', adjust: 'Adjustments', older: 'Older tests', words: 'Word meanings' } as const;

export function SellingReportTool({ tool }: { tool: Tool }) {
  const { data, error } = useFeed<Report>('selling-report');
  const [tab, setTab] = useState<keyof typeof TABS>('summary');
  if (!data) return <ToolShell tool={tool}><Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card></ToolShell>;
  return (
    <ToolShell tool={tool} about={<>
      <p>Every number is a backtest on NSE’s official closing prices, 2011 to 2026, one lot at today’s size, after charges and ₹1 slippage per option, unless a table says otherwise.</p>
      <p>Daily closes cannot show moves during a day, so real losses can be larger. Many versions were tested, so the top rows look good partly by luck. Past results do not promise future ones.</p>
    </>}>
      <nav aria-label="Report sections" className="flex flex-wrap gap-1.5">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${tab === k ? 'bg-accent-soft text-accent-deep' : 'bg-panel text-ink-2 shadow-[var(--shadow-panel)] hover:text-ink'}`}>{TABS[k]}</button>
        ))}
      </nav>
      {tab === 'summary' && <Summary r={data} />}
      {tab === 'best' && <Best r={data} />}
      {tab === 'moves' && <Moves r={data} />}
      {tab === 'bank' && <Bank r={data} />}
      {tab === 'collar' && <Collar r={data} />}
      {tab === 'shape' && <ShapeTab r={data} />}
      {tab === 'adjust' && <Adjust r={data} />}
      {tab === 'older' && <Older r={data} />}
      {tab === 'words' && <Card title="What the words mean"><Table head={['Word', 'Meaning']} rows={WORDS.map(([w, m]) => [<b key={w}>{w}</b>, <span key={m} className="whitespace-normal">{m}</span>])} /></Card>}
    </ToolShell>
  );
}
