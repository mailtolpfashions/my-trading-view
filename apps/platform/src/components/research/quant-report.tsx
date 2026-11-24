'use client';

// The quant research report: the verdict, every registered experiment with its assumptions and numbers, and an
// explorer for each experiment's settings: filter by any parameter and by year, sort, open a setting to read its
// trades and its curve. Data: the feed's /api/quant routes over apps/feed/.data/research.

import { useEffect, useMemo, useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { Segmented, inputCls } from '@/components/ui';
import { useFeed } from '@/lib/feed';
import { FAMILY_LABEL, VERDICT_LABEL, quantApi, type QuantDetail, type QuantExperiment, type QuantSetting, type QuantTrade } from '@/lib/quant';
import { Card } from '../tools/tool-shell';
import { Lines, Money, Table, inr, tone } from '../tools/options/selling-charts';
import { QuantPortfolio } from './quant-portfolio';
import { QuantSimple } from './quant-simple';
import { QuantStrategies } from './quant-strategies';

type Tab = 'simple' | 'portfolio' | 'strategies' | 'summary' | 'experiments' | 'explore';
const SEL = `${inputCls} h-9 text-[13px]`;
const chip = (v: string) => `rounded-full px-2 py-0.5 text-[11px] font-semibold ${v === 'pass' ? 'bg-up/15 text-up' : v === 'lead' ? 'bg-accent-soft text-accent-deep' : v === 'fail' ? 'bg-down/15 text-down' : 'bg-raised text-ink-2'}`;
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const fmt = (v: unknown): string => (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(Math.abs(v) < 10 ? 3 : 2)) : typeof v === 'string' ? v : v == null ? '–' : JSON.stringify(v));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const yrs = (a: string, b: string) => Math.max((Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000), 1 / 12);

/** Any saved object as a readable tree: numbers and words inline, objects folded. */
function JsonTree({ value, depth = 0, name }: { value: unknown; depth?: number; name?: string }) {
  if (value == null || typeof value !== 'object') return <span className="tabular-nums">{fmt(value)}</span>;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const simple = entries.every(([, v]) => v == null || typeof v !== 'object');
  if (simple && entries.length <= 12) return <span className="text-[12.5px]">{entries.map(([k, v]) => <span key={k} className="mr-3 inline-block"><span className="text-muted">{k}</span> <b className="tabular-nums">{fmt(v)}</b></span>)}</span>;
  return (
    <details open={depth < 1} className="group">
      <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-2">{name ?? (Array.isArray(value) ? `${entries.length} items` : `${entries.length} fields`)}</summary>
      <ul className="ml-3 grid gap-0.5 border-l border-line pl-3 text-[12.5px]">
        {entries.slice(0, 400).map(([k, v]) => <li key={k}><span className="text-muted">{k}: </span><JsonTree value={v} depth={depth + 1} name={typeof v === 'object' && v != null ? k : undefined} /></li>)}
      </ul>
    </details>
  );
}

function statsOf(trades: QuantTrade[], from: string, to: string) {
  const n = trades.map((t) => t.net), w = n.filter((x) => x > 0), l = n.filter((x) => x <= 0), total = sum(n);
  const byYear = new Map<string, number>();
  for (const t of trades) byYear.set(t.exit.slice(0, 4), (byYear.get(t.exit.slice(0, 4)) ?? 0) + t.net);
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.exit.localeCompare(b.exit))) { eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {
    trades: trades.length, wonPct: trades.length ? (w.length / trades.length) * 100 : null, total, perYear: total / yrs(from, to),
    avgWin: w.length ? sum(w) / w.length : null, avgLoss: l.length ? sum(l) / l.length : null, pf: sum(l) < 0 ? sum(w) / -sum(l) : null,
    worst: n.length ? Math.min(...n) : null, worstMtm: trades.length ? Math.min(0, ...trades.map((t) => t.worstMtm ?? t.net)) : null, drawdown: dd, byYear,
    losingYears: [...byYear.values()].filter((v) => v < 0).length,
  };
}
function curveStats(curve: [string, number][]) {
  if (curve.length < 2) return null;
  const start = curve[0][1], end = curve[curve.length - 1][1];
  let peak = -Infinity, ddPct = 0;
  for (const [, v] of curve) { peak = Math.max(peak, v); if (peak > 0) ddPct = Math.max(ddPct, ((peak - v) / peak) * 100); }
  const years = yrs(curve[0][0], curve[curve.length - 1][0]);
  return { start, end, returnPct: start > 0 ? (end / start - 1) * 100 : null, cagrPct: start > 0 && end > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : null, maxDdPct: ddPct };
}

export function QuantReport() {
  const [tab, setTab] = useState<Tab>('simple');
  const { data, error } = useFeed<{ experiments: QuantExperiment[] }>('quant/experiments');
  const [explore, setExplore] = useState<{ id: string; name: string } | null>(null);
  const list = data?.experiments ?? [];
  const open = (id: string, name: string) => { setExplore({ id, name }); setTab('explore'); };
  return (
    <div className="flex min-h-0 flex-col gap-3 pt-1 lg:overflow-y-auto lg:pr-1 [&>*]:shrink-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="flex items-center gap-1.5 text-[20px] font-extrabold tracking-[-0.02em]">Quant research report
          <InfoTip label="About this report">
            <p>The research programme of November 2026: can a systematic NSE strategy reach 35% a year with a drawdown under 10%? Every experiment was registered with its data version, costs, assumptions and validation; this page reads that registry.</p>
            <p>Train 2011 to 2018, validation 2019 to 2023, holdout 2024 to November 2026 read once at the end. Money is one NIFTY lot at today&rsquo;s index level unless lots are stated; ₹1 slippage per option per fill and itemised dated charges are included. Daily closes only: what happened inside a day is not seen.</p>
            <p>Write-ups: docs/quant/01-audit-and-roadmap.md, 02-results-phase5-11.md, 03-holdout-and-paper.md.</p>
          </InfoTip>
        </h1>
        <Segmented label="Section" value={tab === 'summary' || tab === 'experiments' || tab === 'explore' ? 'expert' : tab} onChange={(v) => setTab(v === 'expert' ? 'summary' : v)}
          options={[{ value: 'simple', label: 'Summary' }, { value: 'portfolio', label: '₹5 lakh portfolio' }, { value: 'strategies', label: 'All strategies' }, { value: 'expert', label: 'Expert details' }]} />
        {(tab === 'summary' || tab === 'experiments' || tab === 'explore') && (
          <Segmented label="Expert section" value={tab} onChange={setTab} options={[{ value: 'summary', label: 'Verdict' }, { value: 'experiments', label: `Experiments${list.length ? ` (${list.length})` : ''}` }, { value: 'explore', label: 'Raw settings & trades' }]} />
        )}
      </div>
      {error && <p className="text-[13px] text-down">{error}</p>}
      {tab === 'strategies' && <QuantStrategies />}
      {tab === 'simple' && <QuantSimple />}
      {tab === 'portfolio' && <QuantPortfolio />}
      {tab === 'summary' && <Summary list={list} onOpen={open} />}
      {tab === 'experiments' && <Experiments list={list} onOpen={open} />}
      {tab === 'explore' && <Explore list={list} start={explore} />}
    </div>
  );
}

// ---------------------------------------------------------------- verdict

function Summary({ list, onOpen }: { list: QuantExperiment[]; onOpen: (id: string, name: string) => void }) {
  const holdout = list.find((e) => e.family === 'P12');
  return (
    <div className="grid gap-3">
      <Card title="The answer">
        <div className="grid gap-2 p-4 text-[13.5px] leading-relaxed">
          <p><b>Nothing tested reaches 35% a year with a drawdown under 10%.</b> Not in index options, not in stocks, not combined. Realistic from what is here: about 10 to 14% a year on ₹10 lakh at a drawdown of 8 to 18% at closes, from the NIFTY premium books at 2 to 3 lots, with a one-night loss of 7 to 12% of capital about once in three years.</p>
          <p><b>What survived.</b> Short NIFTY weekly strangles entered at Monday&rsquo;s close in high-IV weeks (0.16 delta, held to expiry) earned premium in most years on both indices 2016 to 2023 and again in the holdout 2024 to 2026 (90 trades, 86% won, about ₹49,600 a year per lot). The monthly 0.25-delta strangle 45→21 days in high IV also held up in the holdout (19 trades, 79% won, ₹62,600 a year per lot) but cannot be found by any honest selection rule: walk-forward loses, and its neighbours in train keep almost nothing of its result.</p>
          <p><b>What failed.</b> Choosing a monthly setting on past years (walk-forward) loses money. Close-based loss limits make premium selling worse. 52-week-high stock breakouts: the raw signal&rsquo;s &ldquo;+1% excess&rdquo; is a mean carried by a few winners, the median is zero, and the portfolio draws down 27 to 68%. Stock momentum beats NIFTY on return (15 to 36% a year in validation) with 35 to 65% drawdowns, so it is a return engine that needs a market filter before it can be called a strategy.</p>
          <p><b>The tail is real.</b> On 4 June 2024 a Monday-close weekly position met the election gap: −12% of capital at 3 lots at closes, where the model had said about −14% for a −5% gap. Premium is paid for carrying that risk, and no size removes it.</p>
          <p><b>Next.</b> The weekly rule is running as a paper trade in Trade lab (off until you switch it on) to measure real fills against NSE&rsquo;s close. The next research item is momentum with a NIFTY trend filter.</p>
        </div>
      </Card>
      <Card title="Experiments, in order">
        <Table head={['ID', 'Family', 'Name', 'Period', 'Verdict', 'Result']} rows={list.map((e) => [
          <button key={e.id} type="button" className="font-semibold text-accent-deep hover:underline" onClick={() => e.details[0] && onOpen(e.id, e.details[0])}>{e.id}</button>,
          FAMILY_LABEL[e.family] ?? e.family, <span key="name" className="block min-w-[240px] max-w-[360px] whitespace-normal">{e.name}</span>, `${e.period.from} → ${e.period.to} (${e.period.role})`, <span key="v" className={chip(e.verdict)}>{VERDICT_LABEL[e.verdict] ?? e.verdict}</span>, <span key="n" className="block min-w-[320px] max-w-[560px] whitespace-normal">{e.notes ?? ''}</span>,
        ])} />
        {holdout && <p className="px-4 py-2 text-[12px] text-muted">The holdout ({holdout.period.from} → {holdout.period.to}) was read once on {holdout.ranAt.slice(0, 10)}; nothing may be re-tuned on it.</p>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- experiments

function Experiments({ list, onOpen }: { list: QuantExperiment[]; onOpen: (id: string, name: string) => void }) {
  const [family, setFamily] = useState('all'), [verdict, setVerdict] = useState('all'), [q, setQ] = useState(''), [openId, setOpenId] = useState<string | null>(null);
  const families = [...new Set(list.map((e) => e.family))];
  const shown = list.filter((e) => (family === 'all' || e.family === family) && (verdict === 'all' || e.verdict === verdict) && (!q.trim() || `${e.id} ${e.name} ${e.hypothesis} ${e.notes ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const sel = list.find((e) => e.id === openId) ?? null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={SEL} value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Family"><option value="all">All families</option>{families.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f] ?? f}</option>)}</select>
        <select className={SEL} value={verdict} onChange={(e) => setVerdict(e.target.value)} aria-label="Verdict"><option value="all">All verdicts</option>{Object.entries(VERDICT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className={`${SEL} w-[260px]`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search experiments" />
        <span className="text-[12.5px] text-muted">{shown.length} of {list.length}</span>
      </div>
      <Card>
        <Table head={['ID', 'Family', 'Name', 'Period', 'Data to', 'Verdict', 'Result']} rows={shown.map((e) => [
          <button key={e.id} type="button" className="font-semibold text-accent-deep hover:underline" onClick={() => setOpenId(openId === e.id ? null : e.id)}>{e.id}</button>,
          FAMILY_LABEL[e.family] ?? e.family, <span key="name" className="block min-w-[240px] max-w-[360px] whitespace-normal">{e.name}</span>, `${e.period.from} → ${e.period.to}`, `${fmt(e.data.fnoLast)} · ${fmt(e.data.git)}`, <span key="v" className={chip(e.verdict)}>{VERDICT_LABEL[e.verdict] ?? e.verdict}</span>, <span key="n" className="block min-w-[320px] max-w-[560px] whitespace-normal">{e.notes ?? ''}</span>,
        ])} />
      </Card>
      {sel && (
        <Card title={`${sel.id} · ${sel.name}`} right={<span>{sel.ranAt.slice(0, 16).replace('T', ' ')} UTC · {sel.script}</span>}>
          <div className="grid gap-3 p-4 text-[13px]">
            <p><b>Hypothesis.</b> {sel.hypothesis}</p>
            <p><b>Period.</b> {sel.period.from} → {sel.period.to} ({sel.period.role}). <b>Data.</b> EOD to {fmt(sel.data.eodLast)}, F&O {fmt(sel.data.fnoFirst)} → {fmt(sel.data.fnoLast)}, minutes to {fmt(sel.data.minutesLast)}, commit {fmt(sel.data.git)}.</p>
            <p><b>Costs.</b> {Object.entries(sel.costs).map(([k, v]) => `${k}: ${fmt(v)}`).join('; ')}</p>
            <div><b>Parameters.</b> <JsonTree value={sel.params} /></div>
            <div><b>Validation.</b> <JsonTree value={sel.validation} /></div>
            <p><b>Caveats.</b> {sel.caveats.join(' ')}</p>
            <p><b>Verdict.</b> <span className={chip(sel.verdict)}>{VERDICT_LABEL[sel.verdict] ?? sel.verdict}</span> {sel.notes}</p>
            <div><b>Every number the script saved.</b> <JsonTree value={sel.metrics} /></div>
            {sel.details.length > 0 && <p className="flex flex-wrap items-center gap-2"><b>Settings and trades:</b> {sel.details.map((d) => <button key={d} type="button" className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-semibold hover:border-accent" onClick={() => onOpen(sel.id, d)}>{d}</button>)}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings and trades

type SortDir = 'asc' | 'desc';
function Explore({ list, start }: { list: QuantExperiment[]; start: { id: string; name: string } | null }) {
  const withDetails = list.filter((e) => e.details.length);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(start ?? (withDetails[0] ? { id: withDetails[0].id, name: withDetails[0].details[0] } : null));
  useEffect(() => { if (start) setPick(start); }, [start]);
  const [detail, setDetail] = useState<QuantDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [yearFrom, setYearFrom] = useState('all'), [yearTo, setYearTo] = useState('all');
  const [scope, setScope] = useState<'all' | 'train' | 'validation' | 'fit' | 'test'>('all');
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: 'total', dir: 'desc' });
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [daily, setDaily] = useState<QuantSetting | null>(null);
  useEffect(() => {
    if (!pick) return;
    setLoading(true); setDetail(null); setSelected(null); setDaily(null); setFilters({}); setYearFrom('all'); setYearTo('all');
    quantApi.detail(pick.id, pick.name).then((d) => { setDetail(d); setLoading(false); }, () => setLoading(false));
  }, [pick]);
  useEffect(() => {
    if (!pick || selected == null || detail?.kind === 'curves' || detail?.kind === 'combos' || detail?.kind === 'curve') { setDaily(null); return; }
    quantApi.detail(pick.id, pick.name, selected).then((d) => setDaily(d.settings[0] ?? null), () => setDaily(null));
  }, [pick, selected, detail?.kind]);

  const exp = list.find((e) => e.id === pick?.id);
  const paramKeys = useMemo(() => (detail ? [...new Set(detail.settings.flatMap((s) => Object.keys(s.params)))] : []), [detail]);
  const values = (k: string) => [...new Set((detail?.settings ?? []).map((s) => String(s.params[k] ?? '')))].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const s of detail?.settings ?? []) { for (const t of s.trades ?? []) ys.add(t.exit.slice(0, 4)); for (const c of s.curve ?? []) ys.add(c[0].slice(0, 4)); }
    return [...ys].sort();
  }, [detail]);
  const from = yearFrom === 'all' ? '0000' : `${yearFrom}-01-01`, to = yearTo === 'all' ? '9999' : `${yearTo}-12-31`;
  const inRange = (t: QuantTrade) => t.exit >= from && t.exit <= to;
  const period = { from: yearFrom === 'all' ? (years[0] ? `${years[0]}-01-01` : '2011-01-01') : from, to: yearTo === 'all' ? (years.at(-1) ? `${years.at(-1)}-12-31` : '2026-12-31') : to };

  type Row = { s: QuantSetting; stats?: ReturnType<typeof statsOf>; curve?: ReturnType<typeof curveStats>; numbers?: Record<string, number> };
  const rows: Row[] = useMemo(() => (detail?.settings ?? [])
    .filter((s) => paramKeys.every((k) => !filters[k] || filters[k] === 'all' || String(s.params[k] ?? '') === filters[k]) && (!q.trim() || s.id.toLowerCase().includes(q.trim().toLowerCase())))
    .map((s) => detail?.kind === 'combos' ? { s, numbers: Object.fromEntries(Object.entries(s.numbers ?? {}).filter(([k]) => scope === 'all' ? !k.includes('.') || k.startsWith('all.') : k.startsWith(`${scope}.`))) } : s.trades ? { s, stats: statsOf(s.trades.filter(inRange), period.from, period.to) } : s.curve ? { s, curve: curveStats(s.curve.filter((c) => c[0] >= from && c[0] <= to)) } : { s, numbers: Object.fromEntries(Object.entries(s.numbers ?? {}).filter(([k]) => scope === 'all' ? !k.includes('.') || k.startsWith('all.') : k.startsWith(`${scope}.`))) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [detail, filters, q, from, to, scope, paramKeys]);
  const numberKeys = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.numbers ?? {})))].slice(0, 14), [rows]);
  const valueOf = (r: Row, key: string): number | string | null => {
    if (key in r.s.params) return r.s.params[key] as number | string;
    if (r.stats) { if (key.startsWith('y:')) return r.stats.byYear.get(key.slice(2)) ?? 0; return (r.stats as unknown as Record<string, number | null>)[key] ?? null; }
    if (r.curve) return (r.curve as unknown as Record<string, number | null>)[key] ?? null;
    return r.numbers?.[key] ?? null;
  };
  const sorted = [...rows].sort((a, b) => { const x = valueOf(a, sort.key), y = valueOf(b, sort.key); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return sort.dir === 'asc' ? c : -c; });
  const kind = detail?.kind;
  const yearCols = years.filter((y) => y >= from.slice(0, 4) && y <= to.slice(0, 4));
  const statCols: [string, string][] = kind === 'settings' || kind === 'trades' ? [['trades', 'Trades'], ['wonPct', 'Won'], ['total', 'Total'], ['perYear', 'Per year'], ['avgWin', 'Avg win'], ['avgLoss', 'Avg loss'], ['pf', 'PF'], ['worst', 'Worst trade'], ['worstMtm', 'Worst open'], ['drawdown', 'Max DD'], ['losingYears', 'Losing yrs']] : kind === 'curves' || kind === 'curve' ? [['start', 'Start'], ['end', 'End'], ['returnPct', 'Return'], ['cagrPct', 'CAGR'], ['maxDdPct', 'Max DD']] : numberKeys.map((k) => [k, k]);
  const head = [...paramKeys, ...statCols.map(([, l]) => l), ...(kind === 'settings' || kind === 'trades' ? yearCols : [])];
  const cell = (r: Row, key: string) => {
    const v = valueOf(r, key);
    if (typeof v !== 'number') return <span>{fmt(v)}</span>;
    if (['wonPct', 'returnPct', 'cagrPct', 'maxDdPct'].includes(key) || key.endsWith('Pct')) return <span className={key === 'maxDdPct' ? '' : tone(v)}>{pct(v)}</span>;
    if (['trades', 'losingYears', 'pf', 'start', 'end'].includes(key) || key.includes('calmar') || key.includes('sharpe') || key.includes('stopsHit') || key.includes('trades')) return <span>{fmt(v)}</span>;
    return <Money v={v} />;
  };
  const selRow = selected != null ? rows.find((r) => r.s.index === selected) ?? null : null;
  const selTrades = (daily?.trades ?? selRow?.s.trades ?? []).filter(inRange).sort((a, b) => a.exit.localeCompare(b.exit));
  const [tradeSort, setTradeSort] = useState<'date' | 'net'>('date');
  const chart = useMemo((): [string, number][] => {
    if (selRow?.s.curve) return selRow.s.curve.filter((c) => c[0] >= from && c[0] <= to);
    if (daily?.trades && daily.trades.some((t) => t.daily?.length)) {
      const closed = new Map<string, number>(), open = new Map<string, number>();
      for (const t of selTrades) { closed.set(t.exit, (closed.get(t.exit) ?? 0) + t.net); for (const p of t.daily ?? []) if (p.date < t.exit && p.date >= from && p.date <= to) open.set(p.date, (open.get(p.date) ?? 0) + p.mtm); }
      const dates = [...new Set([...closed.keys(), ...open.keys()])].sort();
      let cum = 0;
      return dates.map((d) => { cum += closed.get(d) ?? 0; return [d, Math.round(cum + (open.get(d) ?? 0))]; });
    }
    let cum = 0;
    return selTrades.map((t) => { cum += t.net; return [t.exit, Math.round(cum)]; });
  }, [selRow, daily, selTrades, from, to]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${SEL} max-w-[420px]`} value={pick ? `${pick.id}|${pick.name}` : ''} onChange={(e) => { const [id, name] = e.target.value.split('|'); setPick({ id, name }); }} aria-label="Experiment and file">
          {withDetails.flatMap((e) => e.details.map((d) => <option key={`${e.id}|${d}`} value={`${e.id}|${d}`}>{e.id} · {e.name.slice(0, 60)} · {d}</option>))}
        </select>
        {paramKeys.map((k) => (
          <select key={k} className={SEL} value={filters[k] ?? 'all'} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} aria-label={k}>
            <option value="all">{k}: all</option>{values(k).map((v) => <option key={v} value={v}>{k}: {v}</option>)}
          </select>
        ))}
        {years.length > 0 && <>
          <select className={SEL} value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} aria-label="From year"><option value="all">From the start</option>{years.map((y) => <option key={y} value={y}>From {y}</option>)}</select>
          <select className={SEL} value={yearTo} onChange={(e) => setYearTo(e.target.value)} aria-label="To year"><option value="all">To the end</option>{years.map((y) => <option key={y} value={y}>To {y}</option>)}</select>
        </>}
        {kind === 'combos' && <Segmented label="Period" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Whole' }, { value: 'train', label: 'Train' }, { value: 'validation', label: 'Validation' }, { value: 'fit', label: 'Fit' }, { value: 'test', label: 'Test' }]} />}
        <input className={`${SEL} w-[200px]`} placeholder="Search settings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search settings" />
        <select className={SEL} value={`${sort.key}|${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split('|'); setSort({ key, dir: dir as SortDir }); }} aria-label="Sort">
          {[...paramKeys, ...statCols.map(([k]) => k), ...(kind === 'settings' || kind === 'trades' ? yearCols.map((y) => `y:${y}`) : [])].flatMap((k) => [<option key={`${k}|desc`} value={`${k}|desc`}>Sort: {k.replace('y:', '')} ↓</option>, <option key={`${k}|asc`} value={`${k}|asc`}>Sort: {k.replace('y:', '')} ↑</option>])}
        </select>
        <span className="text-[12.5px] text-muted">{loading ? 'Loading…' : detail ? `${rows.length} of ${detail.settings.length} settings` : ''}</span>
      </div>
      <details className="panel px-4 py-3 text-[13px] leading-relaxed">
        <summary className="cursor-pointer font-semibold">What the names mean</summary>
        <div className="mt-2 grid gap-3 text-ink-2 md:grid-cols-2">
          <div>
            <p className="font-semibold text-ink">shape: what is sold (always 1 call + 1 put)</p>
            <ul className="ml-4 list-disc">
              <li><b>s10, s16, s20, s25, s30</b>: a strangle at that delta. s25 sells the call and the put whose delta is 0.25, which means roughly a 25% chance each of ending in the money. A lower number is further from the index: smaller premium, fewer losses.</li>
              <li>Rough distance from NIFTY for a monthly trade (45 days): s10 about 6 to 7%, s16 about 5%, s20 about 4%, s25 about 3 to 4%, s30 about 2 to 3%. For a weekly trade (one week) the distances are about a third of that: s16 is about 1.5%.</li>
              <li><b>straddle</b>: the call and put at the same strike, at the forward price (at the money). Biggest premium, smallest cushion.</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-ink">timing and filters</p>
            <ul className="ml-4 list-disc">
              <li><b>daysBefore</b> (monthly): calendar days before expiry when the trade is opened, e.g. 45.</li>
              <li><b>daysLeft</b> (monthly): close the trade when this many days are left, e.g. 21. "45→21" means open 45 days before, close at 21 left.</li>
              <li><b>window</b> (weekly): entry day → exit. "Mon→exp" opens at Monday&rsquo;s close and holds to expiry; "Mon→Wed" closes at Wednesday&rsquo;s close; "Fri→Tue" holds only over the weekend. Note: rows labelled Tue→Wed / Tue→exp in this run are also Monday entries (a labelling mistake found later).</li>
              <li><b>iv</b>: <b>high</b> trades only when NIFTY&rsquo;s option prices (ATM implied volatility) are above their past-year median; <b>any</b> trades every time.</li>
              <li><b>lots, stopPct</b> (sizing study): lots of each option; stop as % of ₹10 lakh capital (0 = no stop).</li>
              <li><b>maxOpen, trail, maxBars, exitRule, lookback</b> (stock studies): number of stocks held, trailing stop in ATRs, maximum days held, exit on a close under the 50-day average, momentum look-back in trading days.</li>
            </ul>
          </div>
        </div>
      </details>
      {exp && <p className="text-[12.5px] text-ink-2">{exp.name}. {exp.hypothesis} <span className="text-muted">Trades: money is ₹ per lot at today&rsquo;s size, after charges and ₹1 slippage an option; stats are for the chosen years. Click a row for its trades and curve.</span></p>}
      {detail && (
        <Card>
          <Table tall head={head} rows={sorted.slice(0, 400).map((r) => [
            ...paramKeys.map((k, i) => i === 0 ? <button key={k} type="button" className={`font-semibold hover:underline ${selected === r.s.index ? 'text-accent-deep' : ''}`} onClick={() => setSelected(selected === r.s.index ? null : r.s.index)}>{fmt(r.s.params[k])}</button> : <span key={k}>{fmt(r.s.params[k])}</span>),
            ...statCols.map(([k]) => <span key={k}>{cell(r, k)}</span>),
            ...((kind === 'settings' || kind === 'trades') ? yearCols.map((y) => <Money key={y} v={r.stats?.byYear.get(y) ?? 0} />) : []),
          ])} />
          {sorted.length > 400 && <p className="px-4 py-2 text-[12px] text-muted">Showing 400 of {sorted.length}; narrow the filters.</p>}
        </Card>
      )}
      {selRow && (
        <Card title={`${selRow.s.id}${selRow.s.skipped != null ? ` · ${selRow.s.skipped} entries skipped` : ''}`} right={<span>{chart.length ? (selRow.s.curve ? 'Equity' : daily?.trades?.some((t) => t.daily?.length) ? 'Running total, marked daily' : 'Running total by exit') : ''}</span>}>
          {chart.length > 1 && <Lines series={[{ name: selRow.s.id, pts: chart }]} />}
          {selTrades.length > 0 && (
            <>
              <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[12.5px]">
                <span className="font-semibold">{selTrades.length} trades</span>
                <Segmented label="Order" value={tradeSort} onChange={setTradeSort} options={[{ value: 'date', label: 'By date' }, { value: 'net', label: 'By result' }]} />
              </div>
              <Table tall head={['Entry', 'Exit', 'Expiry', 'Index in', 'Index out', 'Net', 'Worst open', 'Reason', 'Legs']} rows={[...selTrades].sort((a, b) => (tradeSort === 'net' ? a.net - b.net : a.entry.localeCompare(b.entry))).map((t) => [
                t.entry, t.exit, t.expiry ?? '–', t.spotIn != null ? t.spotIn.toLocaleString('en-IN') : '–', t.spotOut != null ? t.spotOut.toLocaleString('en-IN') : '–', <Money key="n" v={t.net} />, <Money key="w" v={t.worstMtm} />, t.reason ?? t.symbol ?? '–', <span key="l" className="whitespace-normal text-[12px]">{(t.legs ?? []).join('; ')}</span>,
              ])} />
            </>
          )}
          {selRow.curve && <p className="px-4 py-2 text-[12.5px] text-ink-2">Start {inr(selRow.curve.start)} → end {inr(selRow.curve.end)}, return {pct(selRow.curve.returnPct)}, CAGR {pct(selRow.curve.cagrPct)}, max drawdown {pct(selRow.curve.maxDdPct)} over the chosen years.</p>}
        </Card>
      )}
    </div>
  );
}
