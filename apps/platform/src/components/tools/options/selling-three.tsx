'use client';

import { useMemo, useState } from 'react';
import { Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Lines, Money, Table, inr, tone } from './selling-charts';

type Trade = { entry: string; exit: string; expiry: string; hi: boolean; rank: number | null; net: number; worstMtm: number; worstMtmOn: string | null; credit: number; booked: boolean; offDelta: number | null; spotIn: number; spotOut: number; legs: string[]; bigDays: string[] };
type Skip = { entry: string; hi: boolean; rank: number | null; why: string };
type Variant = { strat: StratId; name: string; exit: number; put: boolean; book: boolean; trades: Trade[]; skipped: Skip[] };
type Data = { from: string; to: string; lot: number; spot: number; tradingDays: Record<string, number>; margins: Record<StratId, { none: number | null; put: number | null }>; variants: Variant[] };

const STRATS = [{ id: 'n16', name: '0.16 strangle', color: 'var(--chart-1)' }, { id: 'n25', name: '0.25 strangle', color: 'var(--chart-2)' }, { id: 'fwd', name: 'Straddle at forward', color: 'var(--chart-3)' }] as const;
type StratId = (typeof STRATS)[number]['id'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (v: number | null | undefined) => (v == null ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const pct2 = (v: number | null | undefined) => (v == null ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
const Pct = ({ v }: { v: number | null | undefined }) => <span className={tone(v)}>{pct(v)}</span>;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const ivLabel = (t: { hi: boolean; rank: number | null }) => ((t.rank ?? 0) >= 0.67 ? 'Top third' : t.hi ? 'High' : 'Normal');

type Basis = 'capital' | 'margin';
function statsOf(rows: Trade[], years: number, margin: number | null, capital: number, yearList: string[]) {
  const n = rows.map((t) => t.net), wins = n.filter((v) => v > 0), losses = n.filter((v) => v <= 0), total = sum(n), perYear = total / years;
  const byYear = new Map<string, number>(yearList.map((y) => [y, 0]));
  for (const t of rows) byYear.set(t.exit.slice(0, 4), (byYear.get(t.exit.slice(0, 4)) ?? 0) + t.net);
  const yearValues = [...byYear.values()];
  let eq = 0, peak = 0, deepest = 0;
  const curve: [string, number][] = [];
  for (const t of rows) { eq += t.net; peak = Math.max(peak, eq); deepest = Math.max(deepest, peak - eq); curve.push([t.exit, Math.round(eq)]); }
  const deep = rows.reduce<Trade | null>((b, t) => (!b || t.worstMtm < b.worstMtm ? t : b), null);
  return {
    trades: rows.length, won: rows.length ? (wins.length / rows.length) * 100 : 0, wins: wins.length, losses: losses.length, totalWon: sum(wins), totalLost: sum(losses), total, avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0, perTrade: rows.length ? total / rows.length : 0,
    perYear, perMonth: perYear / 12, margin, roiYearCapital: (perYear / capital) * 100, roiMonthCapital: (perYear / 12 / capital) * 100, roiYearMargin: margin ? (perYear / margin) * 100 : null, roiMonthMargin: margin ? (perYear / 12 / margin) * 100 : null,
    bestYear: yearValues.length ? Math.max(...yearValues) : 0, worstYear: yearValues.length ? Math.min(...yearValues) : 0, losingYears: yearValues.filter((v) => v < 0).length, yearCount: yearValues.length, byYear,
    worst: n.length ? Math.min(...n) : 0, best: n.length ? Math.max(...n) : 0, worstMtm: deep?.worstMtm ?? 0, worstMtmOn: deep?.worstMtmOn ?? null, worstMtmNet: deep?.net ?? 0, deepest, since2023: sum(rows.filter((t) => t.entry >= '2023').map((t) => t.net)), curve,
  };
}
type Stats = ReturnType<typeof statsOf>;

function HBars({ rows, format }: { rows: { name: string; value: number | null; color: string }[]; format: (v: number | null) => string }) {
  const max = Math.max(0.001, ...rows.map((r) => Math.abs(r.value ?? 0))), hasNeg = rows.some((r) => (r.value ?? 0) < 0);
  return (
    <div className="flex flex-col gap-2.5 p-4">
      {rows.map((r) => {
        const w = (Math.abs(r.value ?? 0) / max) * (hasNeg ? 50 : 100);
        return (
          <div key={r.name} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_78px] items-center gap-3 text-[13px]" title={`${r.name}: ${format(r.value)}`}>
            <span className="truncate text-ink-2">{r.name}</span>
            <div className="relative h-3">
              {hasNeg && <span className="absolute left-1/2 top-0 h-3 w-px bg-line-strong" />}
              <span className="absolute top-0 h-3 rounded-[4px]" style={{ width: `${Math.max(w, 0.5)}%`, left: hasNeg ? ((r.value ?? 0) >= 0 ? '50%' : `${50 - w}%`) : 0, background: r.color }} />
            </div>
            <span className="text-right font-semibold tabular-nums">{format(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

const YW = 1320, YH = 300, YP = { l: 72, r: 16, t: 14, b: 28 };
/** Each year, side by side, for the three positions. Hover a year to read all three. */
function YearChart({ years, series, format }: { years: string[]; series: { name: string; color: string; values: Map<string, number | null> }[]; format: (v: number | null) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const all = series.flatMap((s) => [...s.values.values()].map((v) => v ?? 0)), lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const y = (v: number) => YP.t + ((hi - v) / (hi - lo || 1)) * (YH - YP.t - YP.b), group = (YW - YP.l - YP.r) / Math.max(1, years.length), bar = Math.min(26, (group - 10) / 3 - 2);
  const ticks = [...new Set([lo, 0, hi])];
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[12px] text-ink-2">
        {series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${YW} ${YH}`} className="w-full" role="img" aria-label="Return each year for the three positions" onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={YP.l} x2={YW - YP.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} /><text x={YP.l - 6} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)">{format(v)}</text></g>)}
        {years.map((yr, i) => {
          const x0 = YP.l + i * group, width = series.length * (bar + 2);
          return (
            <g key={yr} onPointerEnter={() => setHover(yr)}>
              <rect x={x0} y={YP.t} width={group} height={YH - YP.t - YP.b} fill={hover === yr ? 'var(--color-line)' : 'transparent'} opacity={0.4} />
              {series.map((s, j) => { const v = s.values.get(yr) ?? 0; return <rect key={s.name} x={x0 + (group - width) / 2 + j * (bar + 2)} y={Math.min(y(v), y(0))} width={bar} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="3" fill={s.color} />; })}
              <text x={x0 + group / 2} y={YH - 9} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{yr}</text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute right-4 top-9 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[var(--shadow-panel)]">
          <p className="font-semibold">{hover}</p>
          {series.map((s) => <p key={s.name} className="tabular-nums text-ink-2">{s.name}: {format(s.values.get(hover) ?? null)}</p>)}
        </div>
      )}
    </div>
  );
}

function Pie({ title, centre, parts }: { title: string; centre: string; parts: { label: string; value: number; color: string; text: string }[] }) {
  const total = sum(parts.map((p) => p.value)) || 1, r = 44, c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="flex min-w-0 items-center gap-4 p-4">
      <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${p.text}`).join(', ')}`}>
        <g transform="rotate(-90 60 60)">
          {parts.map((p) => { const part = (p.value / total) * c, el = <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${Math.max(0, part - 2)} ${c - Math.max(0, part - 2)}`} strokeDashoffset={-at}><title>{`${p.label}: ${p.text}`}</title></circle>; at += part; return el; })}
        </g>
        <text x="60" y="65" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--color-ink)">{centre}</text>
      </svg>
      <div className="min-w-0 text-[12px]">
        <p className="mb-1 truncate text-[13px] font-semibold">{title}</p>
        {parts.map((p) => <p key={p.label} className="flex items-center gap-1.5 text-ink-2"><span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />{p.label}: <b className="tabular-nums text-ink">{p.text}</b></p>)}
      </div>
    </div>
  );
}

const DEFAULT_CAPITAL = 500000;

export function SellingThree() {
  const { data, error } = useFeed<Data>('selling-three');
  const [exit, setExit] = useState<'21' | '25'>('21');
  const [iv, setIv] = useState<'high' | 'top' | 'all'>('high');
  const [put, setPut] = useState<'no' | 'yes'>('no');
  const [book, setBook] = useState<'no' | 'yes'>('no');
  const [off, setOff] = useState<'keep' | 'drop'>('keep');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [months, setMonths] = useState<number[]>([]); // the months left out
  const [capital, setCapital] = useState(DEFAULT_CAPITAL);
  const [basis, setBasis] = useState<Basis>('capital');
  const [pick, setPick] = useState<StratId>('fwd');
  const [cell, setCell] = useState<'rupees' | Basis>('rupees');
  const [result, setResult] = useState<'all' | 'won' | 'lost'>('all');
  const [sort, setSort] = useState<'date' | 'net' | 'mtm'>('date');

  const allYears = useMemo(() => Object.keys(data?.tradingDays ?? {}).sort(), [data]);
  const fromY = from || allYears[0], toY = to || allYears.at(-1) || '';
  const view = useMemo(() => {
    if (!data) return null;
    const yearList = allYears.filter((y) => y >= fromY && y <= toY), years = sum(yearList.map((y) => data.tradingDays[y])) / 248;
    const ivOk = (t: { hi: boolean; rank: number | null }) => (iv === 'all' ? true : iv === 'high' ? t.hi : (t.rank ?? 0) >= 0.67);
    const per = STRATS.map((s) => {
      const v = data.variants.find((x) => x.strat === s.id && String(x.exit) === exit && x.put === (put === 'yes') && x.book === (book === 'yes'))!;
      const trades = v.trades.filter((t) => { const y = t.exit.slice(0, 4); return ivOk(t) && y >= fromY && y <= toY && !months.includes(Number(t.exit.slice(5, 7)) - 1) && (off === 'keep' || t.offDelta == null); });
      const skipped = v.skipped.filter((t) => ivOk(t) && t.entry.slice(0, 4) >= fromY && t.entry.slice(0, 4) <= toY);
      const margin = data.margins[s.id][put === 'yes' ? 'put' : 'none'];
      return { ...s, trades, skipped, margin, stats: statsOf(trades, years, margin, capital, yearList), offCount: v.trades.filter((t) => ivOk(t) && t.offDelta != null).length };
    });
    return { per, yearList, years };
  }, [data, allYears, fromY, toY, iv, exit, put, book, off, months, capital]);

  if (!data || !view) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const { per, yearList, years } = view, cap = inr(capital), sel = per.find((p) => p.id === pick)!, hasTrades = per.some((p) => p.trades.length);
  const basisRoi = (p: (typeof per)[number], v: number) => { const b = basis === 'capital' ? capital : p.margin; return b ? (v / b) * 100 : null; };
  const reset = () => { setExit('21'); setIv('high'); setPut('no'); setBook('no'); setOff('keep'); setFrom(''); setTo(''); setMonths([]); setCapital(DEFAULT_CAPITAL); };
  const bestOf = (get: (s: Stats) => number) => per.reduce((b, p) => (get(p.stats) > get(b.stats) ? p : b)).name;
  const bestRoi = bestOf((s) => s.roiYearCapital), safest = bestOf((s) => s.worstMtm), surest = bestOf((s) => s.won);

  type Row = { label: string; tip?: string; show: (s: Stats, p: (typeof per)[number]) => React.ReactNode; score?: (s: Stats) => number };
  const groups: { title: string; rows: Row[] }[] = [
    { title: 'Return', rows: [
      { label: 'Profit a year', show: (s) => <Money v={s.perYear} />, score: (s) => s.perYear },
      { label: 'Profit a month', tip: 'Profit a year ÷ 12, so months without a trade are counted too.', show: (s) => <Money v={s.perMonth} />, score: (s) => s.perMonth },
      { label: `Yearly ROI on ${cap}`, show: (s) => <Pct v={s.roiYearCapital} />, score: (s) => s.roiYearCapital },
      { label: `Monthly ROI on ${cap}`, show: (s) => <span className={tone(s.roiMonthCapital)}>{pct2(s.roiMonthCapital)}</span>, score: (s) => s.roiMonthCapital },
      { label: 'Yearly ROI on margin', show: (s) => <Pct v={s.roiYearMargin} />, score: (s) => s.roiYearMargin ?? -1e9 },
      { label: 'Monthly ROI on margin', show: (s) => <span className={tone(s.roiMonthMargin)}>{pct2(s.roiMonthMargin)}</span>, score: (s) => s.roiMonthMargin ?? -1e9 },
      { label: 'Total profit', show: (s) => <Money v={s.total} />, score: (s) => s.total },
      { label: 'Profit since 2023', tip: 'Trades entered from 1 Jan 2023, inside the years chosen.', show: (s) => <Money v={s.since2023} />, score: (s) => s.since2023 },
    ] },
    { title: 'Money needed', rows: [
      { label: 'Margin for 1 lot', tip: `NSE SPAN margin on ${data.to} for the 29 Dec 2026 expiry. This is today's margin used for every past trade, so it is an estimate.`, show: (s) => inr(s.margin), score: (s) => -(s.margin ?? 1e12) },
      { label: `Margin as % of ${cap}`, show: (s) => pct(s.margin ? (s.margin / capital) * 100 : null) },
      { label: 'Margin + worst MTM', tip: 'What you must be able to hold at the worst moment.', show: (s) => inr((s.margin ?? 0) - s.worstMtm), score: (s) => -((s.margin ?? 0) - s.worstMtm) },
      { label: `Spare out of ${cap}`, tip: 'Capital left after margin and the worst MTM.', show: (s) => <Money v={capital - (s.margin ?? 0) + s.worstMtm} />, score: (s) => capital - (s.margin ?? 0) + s.worstMtm },
    ] },
    { title: 'Trades', rows: [
      { label: 'Trades', show: (s) => s.trades },
      { label: 'Entries skipped', tip: 'No traded strike that day, so the trade could not be tested.', show: (_s, p) => p.skipped.length },
      { label: 'Won', show: (s) => `${s.won.toFixed(0)}%`, score: (s) => s.won },
      { label: 'Winning / losing trades', show: (s) => `${s.wins} / ${s.losses}` },
      { label: 'Total won', show: (s) => <Money v={s.totalWon} /> },
      { label: 'Total lost', show: (s) => <Money v={s.totalLost} /> },
      { label: 'Average win', show: (s) => <Money v={s.avgWin} />, score: (s) => s.avgWin },
      { label: 'Average loss', show: (s) => <Money v={s.avgLoss} />, score: (s) => s.avgLoss },
      { label: 'Profit per trade', show: (s) => <Money v={s.perTrade} />, score: (s) => s.perTrade },
    ] },
    { title: 'Risk', rows: [
      { label: 'Worst trade', show: (s) => <Money v={s.worst} />, score: (s) => s.worst },
      { label: 'Worst MTM', tip: 'Deepest open loss at any daily close. A move during the day can go deeper.', show: (s) => <Money v={s.worstMtm} />, score: (s) => s.worstMtm },
      { label: 'Worst MTM date', show: (s) => s.worstMtmOn ?? '–' },
      { label: 'That trade finished at', show: (s) => <Money v={s.worstMtmNet} /> },
      { label: `Worst MTM as % of ${cap}`, show: (s) => <Pct v={(s.worstMtm / capital) * 100} />, score: (s) => s.worstMtm },
      { label: 'Deepest fall', tip: 'Biggest drop in running profit, from a high to the next low, across trades.', show: (s) => <Money v={-s.deepest} />, score: (s) => -s.deepest },
      { label: 'Best year', show: (s) => <Money v={s.bestYear} />, score: (s) => s.bestYear },
      { label: 'Worst year', show: (s) => <Money v={s.worstYear} />, score: (s) => s.worstYear },
      { label: 'Losing years', show: (s) => `${s.losingYears} of ${s.yearCount}`, score: (s) => -s.losingYears },
    ] },
  ];
  const winner = (r: Row) => { if (!r.score) return null; const top = Math.max(...per.map((p) => r.score!(p.stats))); const hit = per.filter((p) => r.score!(p.stats) === top); return hit.length === per.length ? null : new Set(hit.map((p) => p.id)); };
  const yearSeries = per.map((p) => ({ name: p.name, color: p.color, values: new Map(yearList.map((y) => [y, basisRoi(p, p.stats.byYear.get(y) ?? 0)])) }));
  const cellShow = (v: number | undefined, p: (typeof per)[number]) => { if (v == null) return ''; const b = cell === 'capital' ? capital : p.margin; return cell === 'rupees' ? <Money v={v} /> : <Pct v={b ? (v / b) * 100 : null} />; };
  const monthRows = yearList.map((y) => {
    const cells: (number | undefined)[] = Array(12).fill(undefined);
    for (const t of sel.trades) if (t.exit.startsWith(y)) { const m = Number(t.exit.slice(5, 7)) - 1; cells[m] = (cells[m] ?? 0) + t.net; }
    return [<b key="y">{y}</b>, ...cells.map((v, i) => <span key={i}>{cellShow(v, sel)}</span>), <b key="t">{cellShow(sel.stats.byYear.get(y) ?? 0, sel)}</b>];
  });
  const listed = sel.trades.filter((t) => (result === 'all' ? true : result === 'won' ? t.net > 0 : t.net <= 0));
  const shown = sort === 'date' ? [...listed].reverse() : [...listed].sort((a, b) => (sort === 'net' ? a.net - b.net : a.worstMtm - b.worstMtm));
  const selectCls = `${inputCls} h-8 !rounded-[9px] px-2 text-[13px]`;

  return (
    <div className="flex flex-col gap-3">
      <Card title="Filters" right={<button type="button" onClick={reset} className="text-[12px] font-semibold text-accent-deep">Reset</button>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Exit" value={exit} onChange={setExit} options={[{ value: '21', label: '21 days left' }, { value: '25', label: '25 days left' }]} />
          <Segmented label="IV months" value={iv} onChange={setIv} options={[{ value: 'high', label: 'High IV' }, { value: 'top', label: 'Top third IV' }, { value: 'all', label: 'Every month' }]} />
          <Segmented label="Crash put" value={put} onChange={setPut} options={[{ value: 'no', label: 'No crash put' }, { value: 'yes', label: '15% crash put' }]} />
          <Segmented label="Book profit" value={book} onChange={setBook} options={[{ value: 'no', label: 'Hold to exit' }, { value: 'yes', label: 'Book 50%' }]} />
          <Segmented label="Off-delta trades" value={off} onChange={setOff} options={[{ value: 'keep', label: 'Keep off-delta trades', title: 'Trades where no strike near the delta traded that day' }, { value: 'drop', label: 'Remove them' }]} />
          <InfoTip label="About off-delta trades">On a few days no option near the chosen delta traded, so the rule took the nearest one. On 16 Mar 2020 the 0.16 strangle sold a 0.28 delta put, the lowest that traded. These trades are real prices but not a true 0.16 or 0.25.</InfoTip>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3 text-[13px] text-ink-2">
          <label className="flex items-center gap-1.5">From <select aria-label="From year" className={selectCls} value={fromY} onChange={(e) => setFrom(e.target.value)}>{allYears.map((y) => <option key={y} disabled={y > toY}>{y}</option>)}</select></label>
          <label className="flex items-center gap-1.5">To <select aria-label="To year" className={selectCls} value={toY} onChange={(e) => setTo(e.target.value)}>{allYears.map((y) => <option key={y} disabled={y < fromY}>{y}</option>)}</select></label>
          <label className="flex items-center gap-1.5">Capital for 1 lot <input aria-label="Capital for 1 lot" type="number" min={1} step={50000} className={`${selectCls} w-28 tabular-nums`} value={capital} onChange={(e) => setCapital(Math.max(1, Number(e.target.value) || 1))} /></label>
          <span className="ml-1 flex flex-wrap items-center gap-1" role="group" aria-label="Months to include">
            {MONTHS.map((m, i) => { const on = !months.includes(i); return <button key={m} type="button" aria-pressed={on} onClick={() => setMonths(on ? [...months, i] : months.filter((x) => x !== i))} className={`h-8 rounded-[9px] px-2 text-[12px] font-semibold ${on ? 'bg-accent-soft text-accent-deep' : 'bg-raised text-muted line-through'}`}>{m}</button>; })}
            <InfoTip label="About the month buttons">Tap a month to leave out trades that exited in it. The years stay the same, so ROI shows what you earn if you sit those months out.</InfoTip>
          </span>
        </div>
      </Card>

      {!hasTrades ? <Card><p className="p-4 text-[13px] text-muted">No trades match these filters.</p></Card> : <>
        <div className="panel p-4 text-[14px] font-semibold">On these filters: highest return is {bestRoi}. Most trades won is {surest}. Smallest worst MTM is {safest}.</div>

        <div className="grid gap-3 md:grid-cols-3">
          {per.map((p) => (
            <Card key={p.id} title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />{p.name}</span>} right={<span>{p.stats.trades} trades, {p.stats.won.toFixed(0)}% won</span>}>
              <div className="grid grid-cols-2 gap-3 p-4">
                <div><p className="text-[11px] font-semibold text-muted">ROI a year on {cap}</p><p className={`text-[26px] font-bold tabular-nums ${tone(p.stats.roiYearCapital)}`}>{pct(p.stats.roiYearCapital)}</p><p className="text-[12px] text-ink-2">{pct2(p.stats.roiMonthCapital)} a month</p></div>
                <div><p className="text-[11px] font-semibold text-muted">ROI a year on margin</p><p className={`text-[26px] font-bold tabular-nums ${tone(p.stats.roiYearMargin)}`}>{pct(p.stats.roiYearMargin)}</p><p className="text-[12px] text-ink-2">{pct2(p.stats.roiMonthMargin)} a month</p></div>
                <div><p className="text-[11px] font-semibold text-muted">Profit a year</p><p className="text-[15px] font-bold"><Money v={p.stats.perYear} /></p></div>
                <div><p className="text-[11px] font-semibold text-muted">Margin</p><p className="text-[15px] font-bold tabular-nums">{inr(p.margin)}</p></div>
                <div><p className="text-[11px] font-semibold text-muted">Worst trade</p><p className="text-[15px] font-bold"><Money v={p.stats.worst} /></p></div>
                <div><p className="text-[11px] font-semibold text-muted">Worst MTM</p><p className="text-[15px] font-bold"><Money v={p.stats.worstMtm} /></p></div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Card title={`Yearly ROI on ${cap}`}><HBars format={pct} rows={per.map((p) => ({ name: p.name, value: p.stats.roiYearCapital, color: p.color }))} /></Card>
          <Card title="Yearly ROI on margin"><HBars format={pct} rows={per.map((p) => ({ name: p.name, value: p.stats.roiYearMargin, color: p.color }))} /></Card>
          <Card title={`Monthly ROI on ${cap}`}><HBars format={pct2} rows={per.map((p) => ({ name: p.name, value: p.stats.roiMonthCapital, color: p.color }))} /></Card>
          <Card title="Monthly ROI on margin"><HBars format={pct2} rows={per.map((p) => ({ name: p.name, value: p.stats.roiMonthMargin, color: p.color }))} /></Card>
        </div>

        <Card title="Trades won and lost"><div className="grid md:grid-cols-3">{per.map((p) => <Pie key={p.id} title={p.name} centre={`${p.stats.won.toFixed(0)}%`} parts={[{ label: 'Won', value: p.stats.wins, color: 'var(--color-up)', text: String(p.stats.wins) }, { label: 'Lost', value: p.stats.losses, color: 'var(--color-down)', text: String(p.stats.losses) }]} />)}</div></Card>
        <Card title={`How ${cap} is used at the worst moment`}><div className="grid md:grid-cols-3">{per.map((p) => { const m = p.margin ?? 0, l = -p.stats.worstMtm, spare = capital - m - l; return <Pie key={p.id} title={p.name} centre={spare < 0 ? 'Short' : `${Math.round((spare / capital) * 100)}%`} parts={[{ label: 'Margin', value: m, color: p.color, text: inr(m) }, { label: 'Worst MTM', value: l, color: 'var(--color-down)', text: inr(l) }, { label: spare < 0 ? 'Short by' : 'Spare', value: Math.max(0, spare), color: 'var(--color-line-strong)', text: inr(Math.abs(spare)) }]} />; })}</div></Card>

        <Card title="ROI each year" right={<Segmented label="ROI basis" value={basis} onChange={setBasis} options={[{ value: 'capital', label: `On ${cap}` }, { value: 'margin', label: 'On margin' }]} />}>
          <YearChart years={yearList} series={yearSeries} format={pct} />
        </Card>
        <Card title="Running total profit">{per.some((p) => p.stats.curve.length) && <Lines series={per.filter((p) => p.stats.curve.length).map((p) => ({ name: p.name, pts: p.stats.curve, color: p.color }))} />}</Card>

        <Card title="Full comparison" right={<span>{data.lot} quantity, {years.toFixed(1)} years. Best in each row is marked.</span>}>
          <Table head={['', ...per.map((p) => p.name)]} rows={groups.flatMap((g) => [
            [<b key="g" className="text-[11px] uppercase tracking-wide text-muted">{g.title}</b>, '', '', ''],
            ...g.rows.map((r) => { const w = winner(r); return [<span key="l" className="flex items-center gap-1 text-ink-2">{r.label}{r.tip && <InfoTip label={r.label}>{r.tip}</InfoTip>}</span>, ...per.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5">{r.show(p.stats, p)}{w?.has(p.id) && <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent-deep">Best</span>}</span>)]; }),
          ])} />
        </Card>

        <Card title="Year by year">
          <Table head={['Year', ...per.flatMap((p) => [p.name, `ROI ${cap}`, 'ROI margin'])]} rows={[...yearList].reverse().map((y) => [<b key="y">{y}</b>, ...per.flatMap((p) => { const v = p.stats.byYear.get(y) ?? 0; return [<Money key="a" v={v} />, <Pct key="b" v={(v / capital) * 100} />, <Pct key="c" v={p.margin ? (v / p.margin) * 100 : null} />]; })])} />
        </Card>

        <Card title="Month by month" right={<div className="flex flex-wrap gap-2">
          <Segmented label="Position" value={pick} onChange={setPick} options={per.map((p) => ({ value: p.id, label: p.name }))} />
          <Segmented label="Show" value={cell} onChange={setCell} options={[{ value: 'rupees', label: '₹' }, { value: 'capital', label: `% of ${cap}` }, { value: 'margin', label: '% of margin' }]} />
        </div>}>
          <Table head={['Year', ...MONTHS, 'Year total']} rows={monthRows} />
        </Card>

        <Card title={`${shown.length} trades: ${sel.name}`} right={<div className="flex flex-wrap gap-2">
          <Segmented label="Position" value={pick} onChange={setPick} options={per.map((p) => ({ value: p.id, label: p.name }))} />
          <Segmented label="Result" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />
          <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'date', label: 'Newest' }, { value: 'net', label: 'Biggest loss' }, { value: 'mtm', label: 'Worst MTM' }]} />
        </div>}>
          <Table tall head={['Entry', 'Exit', 'Expiry', 'IV', 'Position', 'NIFTY in', 'NIFTY out', 'Premium', 'Profit', `ROI ${cap}`, 'ROI margin', 'Worst MTM', 'MTM date', 'Exit reason', 'Big NIFTY days']} rows={shown.map((t) => [
            t.entry, t.exit, t.expiry, ivLabel(t),
            <span key="l" className="whitespace-normal text-[12px]">{t.legs.join(', ')}{t.offDelta != null && <b className="block text-down">Off delta: {t.offDelta}</b>}</span>,
            t.spotIn.toLocaleString('en-IN'), t.spotOut.toLocaleString('en-IN'), inr(t.credit), <Money key="n" v={t.net} />, <Pct key="c" v={(t.net / capital) * 100} />, <Pct key="m" v={sel.margin ? (t.net / sel.margin) * 100 : null} />, <Money key="w" v={t.worstMtm} />, t.worstMtmOn ?? '–', t.booked ? 'Booked 50%' : 'Time',
            <span key="b" className="whitespace-normal text-[12px]">{t.bigDays.join('; ') || '–'}</span>,
          ])} />
        </Card>

        {sel.skipped.length > 0 && <Card title={`${sel.skipped.length} entries skipped: ${sel.name}`}><Table head={['Entry', 'IV', 'Why']} rows={sel.skipped.map((s) => [s.entry, ivLabel(s), s.why])} /></Card>}
      </>}
    </div>
  );
}
