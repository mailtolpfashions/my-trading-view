'use client';

import { useMemo, useState } from 'react';
import { Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import type { Tool } from '@/lib/tools';
import { Card, ToolShell } from '../tool-shell';
import { SellingDecay } from './selling-decay';
import { Lines, Money, Table, inr, td, th, tone } from './selling-charts';
import { SellingThree } from './selling-three';
import { SellingCallRatio } from './selling-callratio';
import { SellingIdeas } from './selling-ideas';
import { SellingWorkshop } from './selling-workshop';
import { SellingConclusion } from './selling-conclusion';
import { SellingCalendars } from './selling-calendars';
import { SellingSearch } from './selling-search';

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
type CurveRow = { days: number; months: number; samples: number; straddlePct: number | null; strangle16Pct: number | null; straddlePerMonth: number | null; stranglePerMonth: number | null; medianVolume: number | null };
type TodayLeg = { strikes: string; credit: number; margin: number | null; pctOfMargin: number | null; perMonth: number | null; volume: number } | null;
type SlideRow = { year: number; skipped?: string; entry?: string; exit?: string; reason?: string; strike?: number; creditPerUnit?: number; spotIn?: number; spotOut?: number; net?: number; days?: number };
type SlideSet = { name: string; rows: SlideRow[]; trades: number; won: number | null; perTrade: number | null; total: number; worst: number | null; best: number | null; vixExits: number; avgDays: number | null };
type LongData = { from: string; to: string; lot: number; curve: CurveRow[]; todayCurve: { expiry: string; days: number; straddle: TodayLeg; strangle: TodayLeg }[]; slide: SlideSet[]; straddleMarginToday: number | null };
type MRow = { s: string; x: number; y: number; iv: 'all' | 'high'; n: number; sk: number; won: number; win: number; loss: number; avg: number; pm: number; worst: number; held: number; ly: number; yc: number; s23: number; thin: number; m: number | null; pml: number | null };
type Matrix = { from: string; to: string; entries: number[]; exits: number[]; strategies: { id: string; name: string; group: string }[]; rows: MRow[] };
type LabRow = { label?: string; entry: number; exit: number; atm: string; filter: string; target: number | null; stop: number | null; protect: string; recentre: number | null; n: number; won: number; win: number; loss: number; avg: number; year: number; worst: number; dd: number; ly: number; yc: number; to22: number; s23: number; n23: number; won23: number; lateYear?: number; dearYear?: number; fiveYear?: number };
type Lab = { tested: number; factors: LabRow[]; finalists: LabRow[]; baseYears: Record<string, number>; today: { label: string; legs: string[]; credit: number; margin: number | null; gaps: { gapPct: number; pnl: number }[] }[] };
type CTrade = { worstMtm: number; worstMtmOn: string | null; bigDays: string[]; entry: string; exit: string; expiry: string; spotIn: number; spotOut: number; legs: string[]; credit: number; net: number };
type CRow = { worstMtm: number; worstMtmOn: string | null; worstMtmTradeNet: number; id: string; position: string; name: string; exit: number; filter: 'high' | 'all'; skipped: number; trades: number; won: number; avgWin: number; avgLoss: number; perTrade: number; perYear: number; total: number; worst: number; best: number; deepest: number; losingYears: number; yearCount: number; since2023: number; to2022: number; years: [string, number][]; curve: [string, number][]; perLakh: number | null; latePerYear: number; dearPerYear: number; today: { legs: string[]; credit: number; margin: number | null; gaps: { gapPct: number; pnl: number }[] } | null; tradeRows: CTrade[] };
type Report = {
  compare: { from: string; to: string; lot: number; rows: CRow[] };
  straddleLab: Lab;
  matrix: Matrix;
  long: LongData;
  leaders: { from: string; to: string; yearsCovered: number; todayLot: number; rows: Leader[] }; nifty: RuleSide; banknifty: RuleSide;
  overlap: { name: string; months: number; correlation: number; niftyLost: number; bankLost: number; bothLost: number; worstBoth: number }[];
  ironed: Ironed[]; shape: Shape[]; premium: Adj[]; delta: Adj[];
  moves: { rows: (string | number)[][]; years: number[][] };
  earlier: { weeklyHedge: (string | number)[][]; weeklyMargin: (string | number)[][]; lossLimit: (string | number | null)[][]; calendars: (string | number)[][] };
};

const inrP = (p: number | null | undefined) => (p == null ? '–' : inr(p / 100));
const BASE_PCT = 7.5;

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
      <Answer>These earlier ideas did not beat the main rule. They use 2019 to 2026 unless noted, so compare them with care.</Answer>
      <Card title="Weekly hedge against monthly hedge" right={<span>92 trades each, net total</span>}>
        <Table head={['Setup', 'Monthly: cost a trade', 'Net', 'Worst', 'Weekly: cost a trade', 'Net', 'Worst']} rows={e.weeklyHedge.map((x) => [x[0], inr(x[1] as number), <Money key="a" v={x[2] as number} />, <Money key="b" v={x[3] as number} />, inr(x[4] as number), <Money key="c" v={x[5] as number} />, <Money key="d" v={x[6] as number} />])} />
        <Note>Each weekly hedge is cheaper, but you buy it again and again, so the total costs more.</Note>
      </Card>
      <Card title="Margin with a weekly hedge" right={<span>Strangle on the 23 Nov expiry</span>}><Bars plain rows={e.weeklyMargin.map((x) => ({ label: String(x[0]), value: x[1] as number }))} /></Card>
      <Card title="Staying within a ₹5,000 to ₹7,500 loss" right={<span>Monthly, 10 days, 92 trades</span>}>
        <Table head={['Version', 'Won', 'Net total', 'Worst trade', 'Trades over ₹7,500']} rows={e.lossLimit.map((x) => [x[0], `${x[1]}%`, <Money key="a" v={x[2] as number} />, <Money key="b" v={x[3] as number} />, x[4]])} />
        <Note>The narrow spreads cap the loss at entry, but they won under half their trades.</Note>
      </Card>
      <Card title="Double calendar spreads" right={<span>21 days before near expiry, 2011 to 2026</span>}>
        <Table head={['Strikes', 'Trades', 'Won', 'Profit a year', 'Worst trade', 'Losing years']} rows={e.calendars.map((x) => [x[0], x[1], `${x[2]}%`, <Money key="a" v={x[3] as number} />, <Money key="b" v={x[4] as number} />, `${x[5]} of ${x[6]}`])} />
      </Card>
    </div>
  );
}

/** A measure against time to expiry, one line per position. Hover to read any point. */
function Curve({ rows, series, unit }: { rows: CurveRow[]; series: { name: string; get: (r: CurveRow) => number | null }[]; unit: string }) {
  const CW = 660, CH = 280, L = 48, R2 = 18, T = 14, B = 34;
  const max = Math.ceil(Math.max(...rows.flatMap((r) => series.map((s) => s.get(r) ?? 0))));
  const x = (i: number) => L + (i / (rows.length - 1)) * (CW - L - R2), y = (v: number) => T + (1 - v / max) * (CH - T - B);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[12px] text-ink-2">{series.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: `var(--chart-${i + 1})` }} />{s.name}</span>)}</div>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full touch-none" role="img" aria-label={unit}
        onPointerMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(rows.length - 1, Math.round((((e.clientX - b.left) / b.width) * CW - L) / ((CW - L - R2) / (rows.length - 1)))))); }} onPointerLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={L} x2={CW - R2} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-line)" /><text x={L - 6} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{(max * t).toFixed(1)}%</text></g>)}
        {rows.map((r, i) => <text key={r.days} x={x(i)} y={CH - 12} textAnchor="middle" fontSize="11" fill="var(--color-muted)">{r.months < 3 ? `${r.days}d` : `${Math.round(r.months)}m`}</text>)}
        {series.map((s, i) => <polyline key={s.name} fill="none" stroke={`var(--chart-${i + 1})`} strokeWidth="2" strokeLinejoin="round" points={rows.map((r, j) => `${x(j)},${y(s.get(r) ?? 0)}`).join(' ')} />)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={CH - B} stroke="var(--color-line-strong)" />}
        {hover != null && series.map((s, i) => <circle key={s.name} cx={x(hover)} cy={y(s.get(rows[hover]) ?? 0)} r="4" fill={`var(--chart-${i + 1})`} stroke="var(--color-panel)" strokeWidth="2" />)}
      </svg>
      {hover != null && <div className="pointer-events-none absolute right-4 top-9 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[var(--shadow-panel)]"><p className="font-semibold">{rows[hover].days} days</p>{series.map((s) => <p key={s.name} className="tabular-nums text-ink-2">{s.name}: {s.get(rows[hover])?.toFixed(2)}%</p>)}</div>}
    </div>
  );
}

function LongTab({ r }: { r: Report }) {
  const l = r.long;
  const [shape, setShape] = useState('n25');
  const [iv, setIv] = useState<'all' | 'high'>('all');
  const rows = r.matrix.rows.filter((f) => f.s === shape && f.iv === iv && (f.y === 21 || f.y === 0));
  return (
    <div className="flex flex-col gap-3">
      <Answer>Longer contracts pay more in total but much less per month. The best proven window is still 45 to 21 days. Beyond about 15 months there were too few trades to test.</Answer>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Total premium by time to expiry" right={<span>% of the index, middle value</span>}><Curve unit="Total premium by time to expiry" rows={l.curve} series={[{ name: 'Straddle', get: (x) => x.straddlePct }, { name: '0.16 delta strangle', get: (x) => x.strangle16Pct }]} /></Card>
        <Card title="Premium per month" right={<span>% of the index a month</span>}><Curve unit="Premium per month by time to expiry" rows={l.curve} series={[{ name: 'Straddle', get: (x) => x.straddlePerMonth }, { name: '0.16 delta strangle', get: (x) => x.stranglePerMonth }]} /></Card>
      </div>
      <Card title="Premium by time frame" right={<span>{l.from.slice(0, 4)} to {l.to.slice(0, 4)}, first day of each month</span>}>
        <Table head={['Time to expiry', 'Months seen', 'Straddle', 'Per month', '0.16 strangle', 'Per month', 'Typical volume']} rows={l.curve.map((c) => [`${c.days} days`, c.samples, `${c.straddlePct?.toFixed(2)}%`, `${c.straddlePerMonth?.toFixed(2)}%`, `${c.strangle16Pct?.toFixed(2)}%`, `${c.stranglePerMonth?.toFixed(2)}%`, (c.medianVolume ?? 0).toLocaleString('en-IN')])} />
        <Note>Volume is contracts traded that day at the straddle strike. Far expiries trade very little, so real buy and sell prices can be much worse.</Note>
      </Card>
      <Card title="On today’s prices" right={<span>One lot of {l.lot}, 3 Nov 2026 close. “–” means those strikes did not trade.</span>}>
        <Table head={['Expiry', 'Days', 'Straddle collects', 'Margin', '% of margin', 'Per month', '0.16 strangle collects', 'Margin', '% of margin', 'Per month']} rows={l.todayCurve.map((c) => [c.expiry, c.days, inr(c.straddle?.credit), inr(c.straddle?.margin), c.straddle?.pctOfMargin == null ? '–' : `${c.straddle.pctOfMargin.toFixed(1)}%`, c.straddle?.perMonth == null ? '–' : `${c.straddle.perMonth.toFixed(1)}%`, inr(c.strangle?.credit), inr(c.strangle?.margin), c.strangle?.pctOfMargin == null ? '–' : `${c.strangle.pctOfMargin.toFixed(1)}%`, c.strangle?.perMonth == null ? '–' : `${c.strangle.perMonth.toFixed(1)}%`])} />
        <Note>These are the most you could collect, before charges, only if the options expire worthless.</Note>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Position" value={shape} onChange={setShape} options={[{ value: 'n10', label: '0.10 delta' }, { value: 'n16', label: '0.16 delta' }, { value: 'n25', label: '0.25 delta' }, { value: 'atm', label: 'Straddle' }]} />
        <Segmented label="IV filter" value={iv} onChange={setIv} options={[{ value: 'all', label: 'Every month' }, { value: 'high', label: 'High IV only' }]} />
      </div>
      <Card title="What sellers really kept" right={<span>One trade per monthly expiry, one lot, ₹1 slippage</span>}>
        <Table head={['Sold', 'Exit', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Per trade', 'Per month held', 'Worst trade', 'Avg days held']} rows={rows.map((f) => [`${f.x} days out`, f.y ? '21 days left' : 'Expiry', f.n < 30 ? `${f.n} (few)` : f.n, `${f.won}%`, inr(f.win), inr(f.loss), <Money key="a" v={f.avg} />, <Money key="b" v={f.pm} />, <Money key="c" v={f.worst} />, f.held])} />
        <Note>Rows marked “few” have under 30 trades and can be luck: far contracts rarely traded in older years. Rows with no trades are left out. “Worst trade” is at the close, so a real one can be worse. No stops or adjustments.</Note>
      </Card>
    </div>
  );
}

function SlideTab({ r }: { r: Report }) {
  const sets = r.long.slide, [a, , , none] = sets;
  const hold = new Map(none.rows.map((x) => [x.year, x]));
  const done = a.rows.filter((x) => x.net != null);
  return (
    <div className="flex flex-col gap-3">
      <Answer>The rule made a small profit on 12 trades, with a win rate of {a.won?.toFixed(0)}% and a worst year of {inr(a.worst)}. The VIX exit helped a lot, but a steady rise, like 2023, never triggers it.</Answer>
      <Card title="The rule tested" right={<span>From the slide</span>}>
        <Table head={['Step', 'What the test does']} rows={[['Sell', 'NIFTY at-the-money December straddle, 1 lot'], ['When', 'Last trading day of January, about 11 months out'], ['Exit', 'At December expiry, or at the close when India VIX reaches 30'], ['Not used', 'No adjustments, because the slide lists none']]} />
      </Card>
      <Card title="Results" right={<span>One lot, today’s size</span>}>
        <Table head={['Version', 'Trades', 'Won', 'Per trade', 'Total', 'Best', 'Worst', 'VIX exits', 'Avg days']} rows={sets.map((s) => [s.name, s.trades, s.won == null ? '–' : `${s.won.toFixed(0)}%`, <Money key="a" v={s.perTrade} />, <Money key="b" v={s.total} />, <Money key="c" v={s.best} />, <Money key="d" v={s.worst} />, s.vixExits, s.avgDays])} />
        <Note>Margin for this straddle on the Dec 2027 contract is about {inr(r.long.straddleMarginToday)}, blocked for up to 11 months.</Note>
      </Card>
      <Card title="Year by year"><Bars rows={done.map((x) => ({ label: String(x.year), value: x.net! }))} /></Card>
      <Card title="Every trade" right={<span>With the VIX exit, against no VIX exit</span>}>
        <Table head={['Year', 'Entered', 'Ended', 'How', 'Strike', 'Collected per unit', 'NIFTY in', 'NIFTY out', 'Result', 'If held to expiry']} rows={a.rows.map((x) => (x.net == null ? [x.year, 'Skipped', '–', <span key="s" className="whitespace-normal">{x.skipped}</span>, '–', '–', '–', '–', '–', '–'] : [x.year, x.entry, x.exit, x.reason === 'vix' ? 'VIX crossed 30' : 'Expiry', x.strike, inr(x.creditPerUnit), x.spotIn, x.spotOut, <Money key="n" v={x.net} />, <Money key="h" v={hold.get(x.year)?.net} />]))} />
        <Note>Skipped years had no trade in both options at a strike near the index on that day. Those trades may have been possible during the day, but we can’t test them from closing data.</Note>
      </Card>
    </div>
  );
}

const THIN = 30; // fewer trades than this can be luck
const METRICS = { pm: 'Profit per month held', avg: 'Profit per trade', pml: 'Per month, per ₹1 lakh margin', won: 'Won %', worst: 'Worst trade' } as const;
const dayName = (d: number) => (d < 90 ? `${d} days` : `${Math.round(d / 30.4)} months`);

function MatrixTab({ r }: { r: Report }) {
  const m = r.matrix;
  const [sid, setSid] = useState('n25');
  const [iv, setIv] = useState<'high' | 'all'>('high');
  const [metric, setMetric] = useState<keyof typeof METRICS>('pm');
  const name = (id: string) => m.strategies.find((x) => x.id === id)?.name ?? id;
  const here = m.rows.filter((x) => x.s === sid && x.iv === iv);
  const exits = m.exits.filter((e) => here.some((x) => x.y === e));
  const proven = m.rows.filter((x) => x.iv === iv && x.n >= THIN);
  const top = [...proven].sort((a, b) => (b.pml ?? -1e9) - (a.pml ?? -1e9)).slice(0, 25);
  const best = [...here].filter((x) => x.n >= THIN).sort((a, b) => (b.pml ?? b.pm) - (a.pml ?? a.pm))[0];
  const show = (x: MRow) => (metric === 'won' ? `${x.won}%` : inr(metric === 'pml' ? x.pml : x[metric]));
  return (
    <div className="flex flex-col gap-3">
      <Answer>Across 1,752 combinations, the best proven entries are still 45 to 90 days out. Contracts beyond 4 months have too few past trades to trust, so those boxes are faded.</Answer>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Strategy" value={sid} onChange={(e) => setSid(e.target.value)} className={inputCls}>
          {[...new Set(m.strategies.map((x) => x.group))].map((g) => <optgroup key={g} label={g}>{m.strategies.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
        </select>
        <Segmented label="IV filter" value={iv} onChange={setIv} options={[{ value: 'high', label: 'High IV only' }, { value: 'all', label: 'Every month' }]} />
        <Segmented label="Show" value={metric} onChange={setMetric} options={(Object.keys(METRICS) as (keyof typeof METRICS)[]).map((k) => ({ value: k, label: METRICS[k] }))} />
      </div>
      <Card title={name(sid)} right={<span>Sold ↓ and exited → · one lot · each box shows the result and number of trades</span>}>
        <div className="overflow-x-auto p-3">
          <table className="w-full border-separate border-spacing-1 text-[12px] tabular-nums">
            <thead><tr><th className="text-left font-semibold text-muted">Sold</th>{exits.map((e) => <th key={e} className="font-semibold text-muted">{e === 0 ? 'Expiry' : `${e}d left`}</th>)}</tr></thead>
            <tbody>
              {m.entries.filter((e) => here.some((x) => x.x === e)).map((e) => (
                <tr key={e}>
                  <th className="whitespace-nowrap text-left font-semibold text-muted">{dayName(e)}</th>
                  {exits.map((y) => {
                    const c = here.find((x) => x.x === e && x.y === y);
                    if (!c) return <td key={y} className="px-2 py-1.5 text-center text-muted">–</td>;
                    // The colour follows the number in the box. Won % is not a gain or a loss, so it stays neutral.
                    const value = metric === 'pml' ? c.pml ?? c.pm : metric === 'won' ? null : c[metric];
                    const box = value == null ? 'bg-raised' : value > 0 ? 'bg-up-soft' : 'bg-down-soft', ink = value == null ? 'text-ink' : value > 0 ? 'text-up' : 'text-down';
                    return (
                      <td key={y} title={`${dayName(e)} to ${y ? `${y} days left` : 'expiry'}: ${c.n} trades, won ${c.won}%, per trade ${inr(c.avg)}, worst ${inr(c.worst)}, losing years ${c.ly} of ${c.yc}, held ${c.held} days`}
                        className={`rounded-[8px] px-2 py-1.5 text-center ${box} ${c.n < THIN ? 'opacity-45' : ''} ${best === c ? 'ring-2 ring-accent' : ''}`}>
                        <p className={`font-semibold ${ink}`}>{show(c)}</p>
                        <p className="text-[11px] text-ink-2">{c.n} trades</p>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note>Faded boxes have under {THIN} trades, so they can be luck. Green means a profit and red means a loss in the number shown. Won % has no colour. The outlined box is the best with enough trades. Hover any box for its full details.</Note>
      </Card>
      <Card title="Top 25 combinations with enough trades" right={<span>Ranked by profit per month, per ₹1 lakh of margin</span>}>
        <Table tall head={['Strategy', 'Sold', 'Exit', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Per trade', 'Per month held', 'Per ₹1 lakh', 'Worst trade', 'Losing years', 'Since 2023', 'Margin']} rows={top.map((x) => [name(x.s), dayName(x.x), x.y ? `${x.y} days left` : 'Expiry', x.n, `${x.won}%`, inr(x.win), inr(x.loss), <Money key="a" v={x.avg} />, <Money key="b" v={x.pm} />, <Money key="c" v={x.pml} />, <Money key="d" v={x.worst} />, `${x.ly} of ${x.yc}`, <Money key="e" v={x.s23} />, inr(x.m)])} />
        <Note>One trade per monthly expiry, entered and exited at the close, ₹1 slippage, no stops or adjustments. Long holds overlap each other, so compare per trade or per month, not totals. Margin is an estimate on 3 Nov prices. 45-day rows use the 56-day expiry’s margin.</Note>
      </Card>
    </div>
  );
}

function StraddleTab({ r }: { r: Report }) {
  const l = r.straddleLab;
  const rows = l.factors.filter((x) => x.n);
  const seen = new Set<string>();
  const finals = l.finalists.filter((x) => { const k = `${x.entry}${x.exit}${x.atm}${x.filter}${x.year}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const FILTER: Record<string, string> = { all: 'Every month', high: 'High IV', top: 'Top third of IV' };
  return (
    <div className="flex flex-col gap-3">
      <Answer>Sold at 45 days and exited at 21, the plain straddle earned the most: wins 76%, about ₹49,700 a year. Hedges and re-centring removed most of that. It is sensitive to timing and has no loss limit.</Answer>
      <Card title="Change one thing at a time" right={<span>Baseline against each change, one lot, 2011 to 2026</span>}>
        <Table head={['Version', 'Trades', 'Won', 'Avg win', 'Avg loss', 'Per trade', 'Profit a year', 'Worst trade', 'Deepest fall', 'Losing years', 'To 2022', 'Since 2023']} rows={rows.map((x) => [x.label, x.n, `${x.won}%`, inr(x.win), inr(x.loss), <Money key="a" v={x.avg} />, <Money key="b" v={x.year} />, <Money key="c" v={x.worst} />, inr(x.dd), `${x.ly} of ${x.yc}`, <Money key="d" v={x.to22} />, <Money key="e" v={x.s23} />])} />
        <Note>{l.tested.toLocaleString('en-IN')} combinations tested in total. Holds over 28 days are left out here, because they overlap the next month’s entry. Stops and profit targets are checked at the close, so they rarely fired in 24 days.</Note>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Profit a year"><Bars rows={rows.map((x) => ({ label: x.label!.replace('Baseline: 45 to 21 days, high IV, spot strike', 'Baseline'), value: x.year }))} /></Card>
        <Card title="Worst single trade"><Bars rows={rows.map((x) => ({ label: x.label!.replace('Baseline: 45 to 21 days, high IV, spot strike', 'Baseline'), value: x.worst }))} /></Card>
      </div>
      <Card title="Best rules chosen on years to 2022, checked on 2023 to today" right={<span>2023 onward was not used to choose them</span>}>
        <Table head={['Entry to exit', 'Strike', 'IV', 'Book profit', 'Trades', 'Won', 'Profit a year', 'Worst trade', 'To 2022', 'Since 2023', 'Trades since 2023', 'Won since 2023', 'A day late', '₹2 slippage', '₹5 slippage']} rows={finals.map((x) => [`${x.entry} to ${x.exit} days`, x.atm === 'forward' ? 'Forward' : 'Spot', FILTER[x.filter], x.target ? `${x.target}%` : 'No', x.n, `${x.won}%`, <Money key="a" v={x.year} />, <Money key="b" v={x.worst} />, <Money key="c" v={x.to22} />, <Money key="d" v={x.s23} />, x.n23, `${x.won23}%`, <Money key="e" v={x.lateYear} />, <Money key="f" v={x.dearYear} />, <Money key="g" v={x.fiveYear} />])} />
        <Note>The check period is the honest test. These rules stayed profitable after 2022, but they earned less per year than before, and 14 trades is still few.</Note>
      </Card>
      <Card title="Year by year: baseline"><Bars rows={Object.entries(l.baseYears).map(([y, v]) => ({ label: y, value: v }))} /></Card>
      <Card title="Protection on today’s prices" right={<span>29 Dec expiry, one lot, 3 Nov close</span>}>
        <Table head={['Protection', 'Legs', 'Collected', 'Margin', 'Gap −8%', 'Gap −13%', 'Gap +8%', 'Gap +13%']} rows={l.today.map((t) => [t.label, <span key="l" className="whitespace-normal">{t.legs.join(', ')}</span>, inr(t.credit), inr(t.margin), ...[-8, -13, 8, 13].map((g) => <Money key={g} v={t.gaps.find((x) => x.gapPct === g)?.pnl} />)])} />
      </Card>
    </div>
  );
}

function CompareTab({ r }: { r: Report }) {
  const all = r.compare.rows;
  const [exit, setExit] = useState<'21' | '25'>('21');
  const [iv, setIv] = useState<'high' | 'all'>('high');
  const [pos, setPos] = useState('fwd');
  const rows = all.filter((x) => String(x.exit) === exit && x.filter === iv);
  const sel = rows.find((x) => x.position === pos) ?? rows[0];
  const years = [...new Set(rows.flatMap((x) => x.years.map((y) => y[0])))].sort();
  const label = (x: CRow) => x.name;
  const best = [...all].sort((a, b) => (b.perLakh ?? -1e9) - (a.perLakh ?? -1e9))[0];
  const [fPos, setFPos] = useState('any');
  const [fProtect, setFProtect] = useState('any');
  const [fExit, setFExit] = useState('any');
  const [fIv, setFIv] = useState('any');
  const [sortBy, setSortBy] = useState<'none' | 'year' | 'lakh' | 'worst' | 'won'>('none');
  const key = (x: CRow) => (sortBy === 'year' ? x.perYear : sortBy === 'lakh' ? x.perLakh ?? -1e9 : sortBy === 'worst' ? x.worst : x.won);
  const picked = all.filter((x) => (fPos === 'any' || (fPos === 'fwd' ? !x.position.startsWith('both') : x.position.startsWith('both'))) && (fProtect === 'any' || (fProtect === 'yes') === x.position.endsWith('p')) && (fExit === 'any' || String(x.exit) === fExit) && (fIv === 'any' || x.filter === fIv));
  const shown = sortBy === 'none' ? picked : [...picked].sort((a, b) => key(b) - key(a));
  return (
    <div className="flex flex-col gap-3">
      <Answer>Without protection, the 21-day exit is best, and adding a spot straddle simply doubles the trade: profit, margin and risk. Protection at the breakevens cuts losses hard, but every protected version lost money overall.</Answer>
      <Card title={`${shown.length} of 16 versions`} right={<span>One position, {r.compare.from.slice(0, 4)} to {r.compare.to.slice(0, 4)}, charges and ₹1 slippage. Forward + spot is 2 lots sold.</span>}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Segmented label="Position filter" value={fPos} onChange={setFPos} options={[{ value: 'any', label: 'All positions' }, { value: 'fwd', label: 'Forward' }, { value: 'both', label: 'Forward + spot' }]} />
          <Segmented label="Protection filter" value={fProtect} onChange={setFProtect} options={[{ value: 'any', label: 'Any protection' }, { value: 'no', label: 'Unprotected' }, { value: 'yes', label: 'Protected' }]} />
          <Segmented label="Exit filter" value={fExit} onChange={setFExit} options={[{ value: 'any', label: 'Both exits' }, { value: '21', label: '21 days' }, { value: '25', label: '25 days' }]} />
          <Segmented label="IV filter for the table" value={fIv} onChange={setFIv} options={[{ value: 'any', label: 'All months' }, { value: 'high', label: 'High IV' }, { value: 'all', label: 'Every month' }]} />
          <Segmented label="Sort table" value={sortBy} onChange={setSortBy} options={[{ value: 'none', label: 'No sort' }, { value: 'year', label: 'Profit' }, { value: 'lakh', label: 'Per ₹1 lakh' }, { value: 'worst', label: 'Smallest worst' }, { value: 'won', label: 'Won %' }]} />
        </div>
        <Table tall head={['Position', 'Exit', 'IV', 'Trades', 'Won', 'Losing trades', 'Total won', 'Total lost', 'Net total', 'Avg win', 'Avg loss', 'Per trade', 'Profit a year', 'Per ₹1 lakh margin', 'Worst trade', 'Worst MTM', 'Worst MTM date', 'That trade finished', 'Best trade', 'Deepest fall', 'Losing years', 'To 2022', 'Since 2023', 'A day late', '₹2 slippage']}
          rows={shown.map((x) => [x === best ? <b key="n">{x.name}</b> : x.name, `${x.exit} days left`, x.filter === 'high' ? 'High IV' : 'Every month', x.trades, `${x.won.toFixed(0)}%`, x.tradeRows.filter((t) => t.net <= 0).length, <Money key="w" v={x.tradeRows.filter((t) => t.net > 0).reduce((n, t) => n + t.net, 0)} />, <Money key="l" v={x.tradeRows.filter((t) => t.net <= 0).reduce((n, t) => n + t.net, 0)} />, <Money key="t" v={x.total} />, inr(x.avgWin), inr(x.avgLoss), <Money key="a" v={x.perTrade} />, <Money key="b" v={x.perYear} />, <Money key="c" v={x.perLakh} />, <Money key="d" v={x.worst} />, <Money key="m" v={x.worstMtm} />, x.worstMtmOn ?? '–', <Money key="mf" v={x.worstMtmTradeNet} />, <Money key="e" v={x.best} />, inr(x.deepest), `${x.losingYears} of ${x.yearCount}`, <Money key="f" v={x.to2022} />, <Money key="g" v={x.since2023} />, <Money key="h" v={x.latePerYear} />, <Money key="i" v={x.dearPerYear} />])} />
        <Note>The bold row earned the most per ₹1 lakh of margin. Worst trade is the biggest loss at exit. Worst MTM is the biggest open loss at any day’s close while a trade was running, from real closing prices, so a loss inside the day could be bigger. Protection buys a call and a put away from the strike by the straddle’s combined premium, so if it collects ₹1,000, they sit 1,000 points away. Exits are at the close, with no stops or adjustments.</Note>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Exit" value={exit} onChange={setExit} options={[{ value: '21', label: '45 to 21 days' }, { value: '25', label: '45 to 25 days' }]} />
        <Segmented label="IV filter" value={iv} onChange={setIv} options={[{ value: 'high', label: 'High IV only' }, { value: 'all', label: 'Every month' }]} />
      </div>
      <Card title="Running total of profit"><Lines series={rows.map((x) => ({ name: label(x), pts: x.curve }))} /></Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Profit a year"><Bars rows={rows.map((x) => ({ label: label(x), value: x.perYear }))} /></Card>
        <Card title="Worst single trade"><Bars rows={rows.map((x) => ({ label: label(x), value: x.worst }))} /></Card>
      </div>
      <Card title="Year by year" right={<span>Profit or loss in each year</span>}>
        <Table head={['Year', ...rows.map(label)]} rows={[...years.map((y) => [y, ...rows.map((x) => <Money key={x.id} v={x.years.find((z) => z[0] === y)?.[1] ?? null} />)]), [<b key="t">Total</b>, ...rows.map((x) => <b key={x.id}><Money v={x.total} /></b>)]]} />
      </Card>
      <Card title="On today’s prices" right={<span>29 Dec expiry, 3 Nov close, one position</span>}>
        <Table head={['Position', 'Legs', 'Collected', 'Margin', 'Gap −8%', 'Gap −13%', 'Gap +8%', 'Gap +13%']} rows={rows.map((x) => [x.name, <span key="l" className="whitespace-normal">{x.today?.legs.join(', ')}</span>, inr(x.today?.credit), inr(x.today?.margin), ...[-8, -13, 8, 13].map((g) => <Money key={g} v={x.today?.gaps.find((z) => z.gapPct === g)?.pnl} />)])} />
      </Card>
      <div><Segmented label="Position" value={pos} onChange={setPos} options={[{ value: 'fwd', label: 'Forward' }, { value: 'fwdp', label: 'Forward, protected' }, { value: 'both', label: 'Forward + spot' }, { value: 'bothp', label: 'Forward + spot, protected' }]} /></div>
      <Card title={`Trade by trade: ${sel.name}`} right={<span>{sel.trades} trades, newest first, at today’s size</span>}>
        <Table tall head={['Entered', 'Exited', 'Expiry', 'NIFTY in', 'NIFTY out', 'Collected', 'Result', 'Worst MTM', 'On', 'Big NIFTY days inside', 'Legs']} rows={[...sel.tradeRows].reverse().map((t) => [t.entry, t.exit, t.expiry, t.spotIn, t.spotOut, inr(t.credit), <Money key="n" v={t.net} />, <Money key="m" v={t.worstMtm} />, t.worstMtmOn ?? '–', <span key="g" className="whitespace-normal text-[12px] text-ink-2">{t.bigDays.join(' · ') || '–'}</span>, <span key="l" className="whitespace-normal text-[12px] text-ink-2">{t.legs.join(', ')}</span>])} />
        <Note>Big NIFTY days are a gap of 2% or more at the open, or a 3% move on the day, from NSE’s official index file. Worst MTM is at daily closes.</Note>
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

const TABS = { conclusion: 'Conclusion', summary: 'Summary', ratio: 'Your call ratio', ideas: 'Video ideas checked', workshop: 'Workshop strategies', calendars: 'Calendars', search: 'Strategy search', three: 'Three compared', best: 'Best rules', compare: 'Straddle compare', straddle: 'Straddle lab', matrix: 'All combinations', long: 'Time frames', slide: 'December straddle', moves: 'Market moves', bank: 'NIFTY vs Bank Nifty', collar: 'Ironed Collar', shape: 'Your 2× and 3× shape', adjust: 'Adjustments', older: 'Older tests', words: 'Word meanings' } as const;

export function SellingReportTool({ tool }: { tool: Tool }) {
  const { data, error } = useFeed<Report>('selling-report');
  const [tab, setTab] = useState<keyof typeof TABS>('conclusion');
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
      {tab === 'ratio' && <SellingCallRatio />}
      {tab === 'ideas' && <SellingIdeas />}
      {tab === 'workshop' && <SellingWorkshop />}
      {tab === 'calendars' && <SellingCalendars />}
      {tab === 'search' && <SellingSearch />}
      {tab === 'conclusion' && <SellingConclusion />}
      {tab === 'three' && <SellingThree />}
      {tab === 'best' && <Best r={data} />}
      {tab === 'compare' && <CompareTab r={data} />}
      {tab === 'straddle' && <StraddleTab r={data} />}
      {tab === 'matrix' && <MatrixTab r={data} />}
      {tab === 'long' && <LongTab r={data} />}
      {tab === 'slide' && <SlideTab r={data} />}
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
