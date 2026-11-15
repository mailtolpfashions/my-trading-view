'use client';

// "All strategies": every strategy the research tested, in plain words. Filters and sorts in everyday terms, a
// Worked / Mixed / Didn't work label with its reasons, a click for the full story (money chart, each year, every
// trade), and up to four strategies compared side by side. Options can be shown at 1, 2 or 3 lots per ₹10 lakh.

import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { Segmented, inputCls } from '@/components/ui';
import { useFeed } from '@/lib/feed';
import { GROUP_LABEL, quantApi, type Strategy, type StrategyDetail, type StrategyGroup, type TradeRow } from '@/lib/quant';
import { Card } from '../tools/tool-shell';
import { Lines, Table, inr, tone } from '../tools/options/selling-charts';
import { YearBars } from './quant-simple';

const CAPITAL = 1_000_000;
const SEL = `${inputCls} h-9 text-[13px]`;
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const VERDICT: Record<Strategy['verdict'], { label: string; cls: string; about: string }> = {
  worked: { label: 'Worked', cls: 'bg-up/15 text-up', about: 'Made money overall, in both halves of the years, in at least 7 of 10 years, and in the final check where it was part of it.' },
  mixed: { label: 'Mixed', cls: 'bg-accent-soft text-accent-deep', about: 'Made money overall, but not steadily: one half of the years lost, too many losing years, or (stocks) much deeper falls than NIFTY.' },
  failed: { label: 'Didn’t work', cls: 'bg-down/15 text-down', about: 'Lost money overall (options), or did worse than simply holding NIFTY (stocks).' },
};
type Sort = 'return' | 'safest' | 'perRisk' | 'steady' | 'wins';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'return', label: 'Most money made' }, { value: 'perRisk', label: 'Best return for the risk' }, { value: 'safest', label: 'Smallest fall' },
  { value: 'steady', label: 'Most good years' }, { value: 'wins', label: 'Most trades won' },
];

/** Numbers as shown for the chosen lots: options scale with lots (on ₹10 lakh, simple %), stocks are as they are. */
function view(s: Strategy, lots: number) {
  const k = s.unit === 'option' ? lots : 1;
  return {
    perYearPct: s.unit === 'option' ? ((s.perYearRs ?? 0) * k / CAPITAL) * 100 : s.perYearPct,
    perYearRs: s.perYearRs != null ? s.perYearRs * k : null,
    ddPct: s.unit === 'option' ? (s.maxDdRs * k / CAPITAL) * 100 : s.maxDdPct,
    worstTrade: s.worstTradeRs != null ? s.worstTradeRs * k : null,
    finalPct: s.final?.perYearRs != null ? (s.final.perYearRs * k / CAPITAL) * 100 : null,
  };
}

export function QuantStrategies() {
  const { data, error } = useFeed<{ strategies: Strategy[] }>('quant/strategies');
  const [group, setGroup] = useState<'all' | StrategyGroup | 'options' | 'stocks'>('all');
  const [result, setResult] = useState<'all' | Strategy['verdict'] | 'money'>('all');
  const [when, setWhen] = useState<'all' | 'expensive' | 'always'>('all');
  const [distance, setDistance] = useState<'all' | NonNullable<Strategy['distance']>>('all');
  const [checked, setChecked] = useState<'all' | 'yes'>('all');
  const [sort, setSort] = useState<Sort>('return');
  const [lots, setLots] = useState<'1' | '2' | '3'>('1');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const L = Number(lots);
  const all = data?.strategies ?? [];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = all.filter((s) =>
      (group === 'all' || (group === 'options' ? s.unit === 'option' : group === 'stocks' ? s.unit === 'stock' : s.group === group))
      && (result === 'all' || (result === 'money' ? s.perYearPct > 0 : s.verdict === result))
      && (when === 'all' || s.when === when)
      && (distance === 'all' || s.distance === distance)
      && (checked === 'all' || s.final != null)
      && (!needle || `${s.title} ${s.plain}`.toLowerCase().includes(needle)));
    const key = (s: Strategy) => { const v = view(s, L); return sort === 'return' ? v.perYearPct : sort === 'safest' ? -v.ddPct : sort === 'perRisk' ? v.perYearPct / Math.max(0.5, v.ddPct) : sort === 'steady' ? s.goodYears / Math.max(1, s.years) + v.perYearPct / 1000 : (s.wonPct ?? -1); };
    return out.sort((a, b) => key(b) - key(a));
  }, [all, group, result, when, distance, checked, q, sort, L]);
  useEffect(() => setLimit(50), [group, result, when, distance, checked, q, sort]);
  const counts = useMemo(() => ({ worked: rows.filter((s) => s.verdict === 'worked').length, mixed: rows.filter((s) => s.verdict === 'mixed').length, failed: rows.filter((s) => s.verdict === 'failed').length }), [rows]);
  const toggleCompare = (k: string) => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : c.length >= 4 ? c : [...c, k]));
  const openRow = (k: string) => { setOpen(open === k ? null : k); setShowCompare(false); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

  if (error) return <p className="text-[13px] text-down">{error}</p>;
  if (!data) return <p className="text-[13px] text-muted">Loading…</p>;
  const isOptions = group === 'all' || group === 'options' || group === 'monthly' || group === 'weekly-nifty' || group === 'weekly-bank';

  return (
    <div className="grid gap-3">
      <Card>
        <div className="grid gap-3 p-4">
          <p className="text-[13.5px] text-ink-2">Every strategy we tested, {all.length} in all, in plain words. Pick what you want to see, then click a strategy for its full story. Tick up to four to compare them. <InfoTip label="How to read the numbers">
            <p><b>Options</b> are shown for {lots} lot{L > 1 ? 's' : ''} (change it on the right) on ₹10 lakh: &ldquo;made a year&rdquo; is the average profit after all charges as a share of ₹10 lakh, and &ldquo;worst fall&rdquo; is the deepest drop of the money from a high, at daily closes. One lot ties up about ₹1.75 lakh as margin.</p>
            <p><b>Stocks</b> use all of ₹10 lakh; &ldquo;made a year&rdquo; is the compound growth.</p>
            <p>Results are for 2011–2023 (weekly NIFTY from 2019, Bank Nifty from 2016). &ldquo;Final check&rdquo; is 2024 to Nov 2026, kept aside and used once at the end, for the strategies that were part of it.</p>
            <p>Labels: {Object.values(VERDICT).map((v) => `${v.label}: ${v.about}`).join(' ')}</p>
          </InfoTip></p>
          <div className="flex flex-wrap items-center gap-2">
            <select className={SEL} value={group} onChange={(e) => setGroup(e.target.value as typeof group)} aria-label="What">
              <option value="all">Everything</option><option value="options">All options</option>
              {(Object.keys(GROUP_LABEL) as StrategyGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
              <option value="stocks">All stocks</option>
            </select>
            <select className={SEL} value={result} onChange={(e) => setResult(e.target.value as typeof result)} aria-label="Result">
              <option value="all">Any result</option><option value="worked">Worked</option><option value="mixed">Mixed</option><option value="failed">Didn&rsquo;t work</option><option value="money">Made money at all</option>
            </select>
            {isOptions && <>
              <select className={SEL} value={when} onChange={(e) => setWhen(e.target.value as typeof when)} aria-label="When">
                <option value="all">Any timing</option><option value="expensive">Only when options are expensive</option><option value="always">Every time</option>
              </select>
              <select className={SEL} value={distance} onChange={(e) => setDistance(e.target.value as typeof distance)} aria-label="How far">
                <option value="all">Any distance</option><option value="at">At today&rsquo;s price</option><option value="near">Near the price</option><option value="medium">Medium distance</option><option value="far">Far from the price</option>
              </select>
            </>}
            <select className={SEL} value={checked} onChange={(e) => setChecked(e.target.value as typeof checked)} aria-label="Final check">
              <option value="all">With or without final check</option><option value="yes">Only ones in the final check</option>
            </select>
            <input className={`${SEL} w-[200px]`} placeholder="Search words, e.g. Monday" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-muted">Sort by</span>
            <Segmented label="Sort" value={sort} onChange={setSort} options={SORTS} />
            <span className="ml-auto flex items-center gap-2 text-[12.5px] text-muted">Option lots per ₹10 lakh <Segmented label="Lots" value={lots} onChange={setLots} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} /></span>
          </div>
          <p className="text-[12.5px] text-ink-2"><b>{rows.length}</b> strategies: <span className="text-up">{counts.worked} worked</span>, <span className="text-accent-deep">{counts.mixed} mixed</span>, <span className="text-down">{counts.failed} didn&rsquo;t work</span>.
            {compare.length > 0 && <> · <button type="button" className="font-semibold text-accent-deep hover:underline" onClick={() => { setShowCompare(true); setOpen(null); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>Compare {compare.length} ticked</button> · <button type="button" className="text-muted hover:underline" onClick={() => setCompare([])}>clear</button></>}
          </p>
        </div>
      </Card>

      <div ref={detailRef} className="scroll-mt-4">
        {open && !showCompare && <Detail key={open} k={open} lots={L} onClose={() => setOpen(null)} />}
        {showCompare && compare.length > 0 && <Compare keys={compare} lots={L} all={all} onClose={() => setShowCompare(false)} />}
      </div>

      <Card>
        <div className="max-h-[720px] overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-line text-left text-[11.5px] text-muted">
                <th className="px-3 py-2" title="Tick to compare">Compare</th><th className="px-3 py-2">Strategy</th><th className="px-3 py-2">Result</th>
                <th className="px-3 py-2 text-right">Made a year</th><th className="px-3 py-2 text-right">Worst fall</th><th className="px-3 py-2 text-right">Good years</th>
                <th className="px-3 py-2 text-right">Trades won</th><th className="px-3 py-2 text-right">Final check</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((s) => {
                const v = view(s, L), isOpen = open === s.key;
                return (
                  <tr key={s.key} className={`cursor-pointer border-b border-line align-top last:border-0 hover:bg-raised/60 ${isOpen ? 'bg-accent-soft/40' : ''}`} onClick={() => openRow(s.key)}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Compare ${s.title}`} checked={compare.includes(s.key)} onChange={() => toggleCompare(s.key)} className="accent-[var(--color-accent)]" /></td>
                    <td className="max-w-[560px] px-3 py-2.5"><p className="font-semibold">{s.title}</p><p className="text-[12px] text-ink-2">{s.plain}</p></td>
                    <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].label}</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums"><b className={tone(v.perYearPct)}>{pct(v.perYearPct)}</b>{v.perYearRs != null && <p className="text-[11.5px] text-muted">{inr(v.perYearRs)}</p>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-down">{pct(-v.ddPct)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{s.goodYears} of {s.years}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{s.wonPct == null ? '–' : pct(s.wonPct, 0)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{v.finalPct == null ? <span className="text-muted">–</span> : <span className={tone(v.finalPct)}>{pct(v.finalPct)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit && <div className="p-3 text-center"><button type="button" className="rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-semibold hover:border-accent" onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit} left)</button></div>}
          {!rows.length && <p className="p-6 text-center text-[13.5px] text-muted">Nothing matches these choices.</p>}
        </div>
      </Card>
    </div>
  );
}

/** The full story of one strategy. */
function Detail({ k, lots, onClose }: { k: string; lots: number; onClose: () => void }) {
  const [d, setD] = useState<StrategyDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { quantApi.strategy(k).then(setD, (e: Error) => setErr(e.message)); }, [k]);
  if (err) return <Card><p className="p-4 text-[13px] text-down">{err}</p></Card>;
  if (!d) return <Card><p className="p-4 text-[13px] text-muted">Loading…</p></Card>;
  const v = view(d, lots), mult = d.unit === 'option' ? lots : 1;
  const money = (c: [string, number][]) => c.map(([t, e]) => [t, Math.round(CAPITAL + (e - CAPITAL) * mult)] as [string, number]);
  const end = money(d.curve).at(-1)?.[1] ?? CAPITAL, niftyEnd = d.niftyCurve.at(-1)?.[1] ?? CAPITAL;
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2">{d.title}<span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${VERDICT[d.verdict].cls}`}>{VERDICT[d.verdict].label}</span></span>} right={<button type="button" className="font-semibold text-ink-2 hover:text-ink" onClick={onClose}>Close ✕</button>}>
      <div className="grid gap-4 p-4">
        <p className="text-[14px]">{d.plain}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Big label="Made a year" value={pct(v.perYearPct)} sub={d.unit === 'option' ? `${inr(v.perYearRs ?? 0)} for ${lots} lot${lots > 1 ? 's' : ''}` : `NIFTY: ${pct(d.nifty?.perYearPct)}`} good={v.perYearPct > 0} bad={v.perYearPct < 0} />
          <Big label="Worst fall from a high" value={pct(-v.ddPct)} sub={d.unit === 'option' ? `${inr(-d.maxDdRs * mult)} at daily closes` : `NIFTY: ${pct(-(d.nifty?.maxDdPct ?? 0))}`} bad />
          <Big label="Good years" value={`${d.goodYears} of ${d.years}`} sub={`${d.period.from.slice(0, 4)}–${d.period.to.slice(0, 4)}`} />
          <Big label={d.unit === 'option' ? 'Trades won' : 'Trades'} value={d.unit === 'option' ? pct(d.wonPct, 0) : d.trades.toLocaleString('en-IN')} sub={d.unit === 'option' ? `${d.trades} trades; worst ${inr(v.worstTrade ?? 0)}` : 'buys and sells in the test'} />
        </div>
        <div>
          <p className="mb-1 text-[13px] font-semibold">Why it is labelled &ldquo;{VERDICT[d.verdict].label}&rdquo;</p>
          <ul className="ml-4 list-disc text-[13px] text-ink-2">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="px-4 pt-3 text-[13px] font-semibold">₹10 lakh over time: {inr(CAPITAL)} → {inr(end)} (NIFTY bought and held: {inr(niftyEnd)})</p>
        <Lines series={[{ name: d.title, pts: money(d.curve), color: 'var(--chart-1)' }, { name: 'NIFTY (buy and hold)', pts: d.niftyCurve, color: 'var(--color-ink-2)' }]} />
      </div>
      <div className="border-t border-line">
        <p className="px-4 pt-3 text-[13px] font-semibold">Each year {d.unit === 'option' ? `(₹ for ${lots} lot${lots > 1 ? 's' : ''})` : '(% on ₹10 lakh)'}</p>
        <YearBars years={d.byYear.map((y) => y.year)} holdoutFrom="9999" series={[{ name: d.title, color: 'var(--chart-1)', byYear: Object.fromEntries(d.byYear.map((y) => [y.year, y.value * mult])) }]}
          format={d.unit === 'option' ? (x) => inr(x) : undefined} formatTip={d.unit === 'option' ? (x) => inr(x) : undefined} />
      </div>
      {d.tradeList.length > 0 && <Trades title={`Every trade, ${d.period.from.slice(0, 4)}–${d.period.to.slice(0, 4)}`} rows={d.tradeList} mult={mult} />}
      {d.finalTrades.length > 0 && <Trades title="Final check trades, 2024 to Nov 2026" rows={d.finalTrades} mult={mult} />}
      {d.unit === 'stock' && <p className="border-t border-line px-4 py-3 text-[12.5px] text-muted">Stock strategies hold many stocks at once; their individual buys and sells are in Expert details for the chosen setting only.</p>}
    </Card>
  );
}

function Big({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-[12px] border border-line p-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`text-[20px] font-bold tabular-nums ${good ? 'text-up' : bad ? 'text-down' : ''}`}>{value}</p>
      {sub && <p className="text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function Trades({ title, rows, mult }: { title: string; rows: TradeRow[]; mult: number }) {
  const [order, setOrder] = useState<'date' | 'best' | 'worst'>('date');
  const [only, setOnly] = useState<'all' | 'won' | 'lost'>('all');
  const [year, setYear] = useState('all');
  const years = [...new Set(rows.map((r) => r.closed.slice(0, 4)))];
  const shown = rows.filter((r) => (only === 'all' || (only === 'won' ? r.result > 0 : r.result <= 0)) && (year === 'all' || r.closed.startsWith(year)))
    .sort((a, b) => (order === 'date' ? a.opened.localeCompare(b.opened) : order === 'best' ? b.result - a.result : a.result - b.result));
  const hasIndex = rows.some((r) => r.indexIn != null), hasOut = rows.some((r) => r.indexOut != null);
  const total = shown.reduce((a, r) => a + r.result * mult, 0);
  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12.5px]">
        <b className="text-[13px]">{title}</b>
        <span className="text-muted">{shown.length} shown, total <span className={tone(total)}>{inr(total)}</span></span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented label="Show" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />
          <select className={`${SEL} h-8`} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year"><option value="all">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <Segmented label="Order" value={order} onChange={setOrder} options={[{ value: 'date', label: 'By date' }, { value: 'worst', label: 'Worst first' }, { value: 'best', label: 'Best first' }]} />
        </span>
      </div>
      <Table tall head={['Opened', 'Closed', 'Expiry', ...(hasIndex ? ['NIFTY at open'] : []), ...(hasOut ? ['NIFTY at close'] : []), 'Result', 'Worst along the way', 'How it ended']} rows={shown.map((r) => [
        r.opened, r.closed, r.expiry ?? '–', ...(hasIndex ? [r.indexIn?.toLocaleString('en-IN') ?? '–'] : []), ...(hasOut ? [r.indexOut?.toLocaleString('en-IN') ?? '–'] : []),
        <span key="r" className={`font-semibold ${tone(r.result)}`}>{inr(r.result * mult)}</span>, r.worstAlong == null ? '–' : <span key="w" className={tone(r.worstAlong)}>{inr(r.worstAlong * mult)}</span>, r.how,
      ])} />
    </div>
  );
}

/** Up to four strategies on one chart, one bar chart and one table. */
function Compare({ keys, lots, all, onClose }: { keys: string[]; lots: number; all: Strategy[]; onClose: () => void }) {
  const [ds, setDs] = useState<StrategyDetail[]>([]);
  useEffect(() => { Promise.all(keys.map((k) => quantApi.strategy(k))).then(setDs, () => setDs([])); }, [keys]);
  const list = keys.map((k) => all.find((s) => s.key === k)).filter((s): s is Strategy => !!s);
  if (!ds.length) return <Card><p className="p-4 text-[13px] text-muted">Loading…</p></Card>;
  const multOf = (s: Strategy) => (s.unit === 'option' ? lots : 1);
  const years = [...new Set(ds.flatMap((d) => d.byYear.map((y) => y.year)))].sort();
  const yearPct = (d: StrategyDetail) => Object.fromEntries(d.byYear.map((y) => [y.year, d.unit === 'option' ? (y.value * lots / CAPITAL) * 100 : y.value]));
  const from = ds.map((d) => d.period.from).sort()[0], longest = [...ds].sort((a, b) => a.period.from.localeCompare(b.period.from))[0];
  const short = (s: string, i: number) => `${i + 1}. ${s.length > 48 ? `${s.slice(0, 46)}…` : s}`;
  return (
    <Card title={`Comparing ${ds.length} strateg${ds.length > 1 ? 'ies' : 'y'}`} right={<button type="button" className="font-semibold text-ink-2 hover:text-ink" onClick={onClose}>Close ✕</button>}>
      <ol className="grid gap-1 p-4 text-[13px]">{ds.map((d, i) => <li key={d.key} className="flex gap-2"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: COLORS[i] }} /><span><b>{d.title}.</b> <span className="text-ink-2">{d.plain}</span></span></li>)}</ol>
      <div className="border-t border-line">
        <p className="px-4 pt-3 text-[13px] font-semibold">₹10 lakh over time {ds.some((d) => d.period.from !== from) ? '(each line starts when its data starts)' : ''}</p>
        <Lines series={[
          ...ds.map((d, i) => ({ name: short(d.title, i), pts: d.curve.map(([t, e]) => [t, Math.round(CAPITAL + (e - CAPITAL) * multOf(d))] as [string, number]), color: COLORS[i] })),
          { name: 'NIFTY (buy and hold)', pts: longest.niftyCurve, color: 'var(--color-ink-2)' },
        ]} />
      </div>
      <div className="border-t border-line">
        <p className="px-4 pt-3 text-[13px] font-semibold">Each year, % on ₹10 lakh</p>
        <YearBars years={years} holdoutFrom="9999" series={ds.map((d, i) => ({ name: short(d.title, i), color: COLORS[i], byYear: yearPct(d) }))} />
      </div>
      <div className="border-t border-line">
        <Table head={['', ...ds.map((d, i) => `${i + 1}`)]} rows={[
          ['Result', ...list.map((s) => <span key={s.key} className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].label}</span>)],
          ['Made a year', ...list.map((s) => { const v = view(s, lots); return <span key={s.key} className={tone(v.perYearPct)}>{pct(v.perYearPct)}{v.perYearRs != null ? ` (${inr(v.perYearRs)})` : ''}</span>; })],
          ['Worst fall from a high', ...list.map((s) => <span key={s.key} className="text-down">{pct(-view(s, lots).ddPct)}</span>)],
          ['Good years', ...list.map((s) => `${s.goodYears} of ${s.years}`)],
          ['Trades won', ...list.map((s) => (s.wonPct == null ? '–' : `${pct(s.wonPct, 0)} of ${s.trades}`))],
          ['Worst trade', ...list.map((s) => (s.worstTradeRs == null ? '–' : <span key={s.key} className="text-down">{inr(s.worstTradeRs * multOf(s))}</span>))],
          ...(list[0]?.halves ?? []).map((_, hi) => [`Per year, ${list.map((s) => s.halves[hi]?.label).filter((x, i, a) => a.indexOf(x) === i).join(' / ')}`, ...list.map((s) => { const h = s.halves[hi]; if (!h) return '–'; const val = s.unit === 'option' ? (h.value * lots / CAPITAL) * 100 : h.value; return <span key={s.key} className={tone(val)}>{pct(val)}</span>; })]),
          ['Final check 2024–26, per year', ...list.map((s) => { const f = view(s, lots).finalPct; return f == null ? '–' : <span key={s.key} className={tone(f)}>{pct(f)}</span>; })],
          ['Years tested', ...list.map((s) => `${s.period.from.slice(0, 4)}–${s.period.to.slice(0, 4)}`)],
        ]} />
      </div>
    </Card>
  );
}
