'use client';

// The plain view of the research: only what worked, in everyday words, with a chart of money over time against NIFTY
// and a bank deposit, a bar per year, and one comparison table. Numbers come from the feed's /api/quant/leads.

import { useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import type { LeadBook, Leads } from '@/lib/quant';
import { Card } from '../tools/tool-shell';
import { Lines, Table, inr, tone } from '../tools/options/selling-charts';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const lakh = (v: number) => `₹${(v / 100_000).toFixed(2)} lakh`;

/** A bar per year for several books, side by side; unseen (holdout) years are marked. */
export function YearBars({ years, series, holdoutFrom, format = (v: number) => pct(v, 0), formatTip = (v: number) => pct(v) }: { years: string[]; series: { name: string; color: string; byYear: Record<string, number> }[]; holdoutFrom: string; format?: (v: number) => string; formatTip?: (v: number) => string }) {
  const W = 1320, H = 300, P = { l: 56, r: 16, t: 24, b: 30 };
  const [hover, setHover] = useState<string | null>(null);
  const all = series.flatMap((s) => Object.values(s.byYear)), lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const y = (v: number) => P.t + ((hi - v) / (hi - lo || 1)) * (H - P.t - P.b), group = (W - P.l - P.r) / Math.max(1, years.length), bar = Math.min(26, (group - 12) / series.length - 2);
  const hoYear = holdoutFrom.slice(0, 4);
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[12px] text-ink-2">
        {series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.name}</span>)}
        {years.some((yr) => yr >= hoYear) && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-accent-soft" />Shaded years: never used to choose anything (the final test)</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Return each year" onPointerLeave={() => setHover(null)}>
        {years.map((yr, i) => yr >= hoYear && <rect key={`h${yr}`} x={P.l + i * group} y={P.t - 6} width={group} height={H - P.t - P.b + 6} fill="var(--color-accent-soft)" opacity="0.5" />)}
        {[lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || Math.abs(y(v) - y(0)) >= 16)).map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)">{format(v)}</text></g>)}
        {years.map((yr, i) => {
          const x0 = P.l + i * group + (group - series.length * (bar + 2)) / 2;
          return (
            <g key={yr} onPointerEnter={() => setHover(yr)}>
              <rect x={P.l + i * group} y={P.t - 6} width={group} height={H - P.t - P.b + 6} fill="transparent" />
              {series.map((s, k) => { const v = s.byYear[yr] ?? 0; return <rect key={s.name} x={x0 + k * (bar + 2)} y={Math.min(y(0), y(v))} width={bar} height={Math.abs(y(v) - y(0))} rx="3" fill={s.color} opacity={hover && hover !== yr ? 0.45 : 1} />; })}
              <text x={P.l + i * group + group / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-muted)">{yr}</text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-16 top-9 rounded-[10px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[var(--shadow-panel)]">
          <p className="font-semibold">{hover}{hover >= hoYear ? ' (final test year)' : ''}</p>
          {series.map((s) => <p key={s.name} className="tabular-nums text-ink-2">{s.name}: <span className={tone(s.byYear[hover] ?? 0)}>{formatTip(s.byYear[hover] ?? 0)}</span></p>)}
        </div>
      )}
    </div>
  );
}

function BookCard({ b, color }: { b: LeadBook; color: string }) {
  const end = b.curve[b.curve.length - 1]?.[1] ?? 0, start = b.curve[0]?.[1] ?? 0;
  return (
    <Card title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />{b.name}</span>} right={<span>{b.lots} lot{b.lots > 1 ? 's' : ''} · about {b.marginPct}% of the money as margin</span>}>
      <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="text-[13.5px] leading-relaxed">
          <p className="font-semibold">What you do</p>
          <ol className="ml-4 list-decimal text-ink-2">{b.what.map((w) => <li key={w}>{w}</li>)}</ol>
          <p className="mt-2 font-semibold">What can go wrong</p>
          <p className="text-ink-2">{b.risk}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <Stat label="Made per year" value={pct(b.stats.cagrPct)} sub={`₹10 lakh → ${lakh(end)} in ${b.stats.years} years`} good={b.stats.cagrPct > 0} />
          <Stat label="Worst fall from a high" value={pct(b.stats.maxDdPct)} sub="measured at daily closes" bad />
          <Stat label="Worst single day" value={pct(b.stats.worstDayPct)} sub={b.stats.worstDayDate ?? ''} bad />
          <Stat label="Worst month" value={pct(b.stats.worstMonthPct)} bad />
          <Stat label="Trades won" value={pct(b.stats.wonPct, 0)} sub={`${b.stats.trades} trades`} />
          <Stat label="Years that lost" value={`${b.stats.losingYears} of ${b.yearly.length}`} />
          <Stat label="In the final test years" value={pct(b.holdout.cagrPct)} sub={`a year, from ${b.yearly.find((y) => y.unseen)?.year ?? '2024'}; worst fall ${pct(b.holdout.maxDdPct)}`} good={b.holdout.cagrPct > 0} />
          <Stat label="Typical win / loss" value={`${inr(b.stats.avgWin)} / ${inr(b.stats.avgLoss)}`} sub={`biggest loss ${inr(b.stats.worstTrade)}`} />
        </div>
      </div>
      <p className="sr-only">{start}</p>
    </Card>
  );
}
function Stat({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-[12px] border border-line p-2.5">
      <p className="text-[11.5px] text-muted">{label}</p>
      <p className={`text-[18px] font-bold tabular-nums ${good ? 'text-up' : bad ? 'text-down' : ''}`}>{value}</p>
      {sub && <p className="text-[11.5px] text-muted">{sub}</p>}
    </div>
  );
}

export function QuantSimple() {
  const { data, error } = useFeed<Leads>('quant/leads');
  if (error) return <p className="text-[13px] text-down">{error}</p>;
  if (!data) return <p className="text-[13px] text-muted">Loading…</p>;
  const years = data.nifty.yearly.map((y) => y.year);
  const series = data.books.map((b, i) => ({ name: b.name.split(':')[0], color: COLORS[i], byYear: Object.fromEntries(b.yearly.map((y) => [y.year, y.returnPct])) }));
  series.push({ name: 'NIFTY (buy and hold)', color: 'var(--color-ink-2)', byYear: Object.fromEntries(data.nifty.yearly.map((y) => [y.year, y.returnPct])) });
  const niftyEnd = data.nifty.curve[data.nifty.curve.length - 1][1], fdEnd = data.fd.curve[data.fd.curve.length - 1][1];
  return (
    <div className="grid gap-3">
      <Card title="In one minute">
        <div className="grid gap-2 p-4 text-[14px] leading-relaxed">
          <p>We looked for a way to make <b>35% a year</b> without ever being down more than <b>10%</b>. We tested hundreds of versions of option selling, stock momentum and breakouts on 15 years of NSE data, then checked the survivors on three years they had never seen. <b>No method gets near 35% with that safety.</b></p>
          <p>Two methods did make steady money: selling NIFTY options for a short time when they are expensive, weekly and monthly. Together they made about <b>{pct(data.books[2]?.stats.cagrPct)} a year</b> on ₹10 lakh from {data.from.slice(0, 4)} to {data.to.slice(0, 4)}, with the worst fall from a high of <b>{pct(data.books[2]?.stats.maxDdPct)}</b>. NIFTY itself made {pct(data.nifty.cagrPct)} a year over the same years, with a {pct(data.nifty.maxDdPct)} fall. A {data.fd.ratePct}% deposit would have grown ₹10 lakh to {lakh(fdEnd)}.</p>
          <p>The catch is one bad night. These methods earn a small amount most weeks and give a lot back on the rare day the market jumps 5% or more overnight. That day cannot be removed, only kept small by not using too many lots. <InfoTip label="How the numbers were made"><p>One NIFTY lot at today&rsquo;s index level, Zerodha charges and taxes as on each date, ₹1 of slippage per option per fill. Prices are NSE&rsquo;s daily closes, so what happened inside a day is not seen. The years from {data.holdoutFrom.slice(0, 4)} were kept aside until the end and read once; nothing was adjusted after seeing them.</p></InfoTip></p>
        </div>
      </Card>

      {data.books.map((b, i) => <BookCard key={b.id} b={b} color={COLORS[i]} />)}

      <Card title={`₹10 lakh from ${data.from} to ${data.to}`} right={<span>Lines: the three books, NIFTY bought and held, and a {data.fd.ratePct}% deposit</span>}>
        <Lines series={[
          ...data.books.map((b, i) => ({ name: b.name.split(':')[0], pts: b.curve, color: COLORS[i] })),
          { name: 'NIFTY (buy and hold)', pts: data.nifty.curve, color: 'var(--color-ink-2)' },
          { name: `${data.fd.ratePct}% deposit`, pts: data.fd.curve, color: 'var(--color-muted)' },
        ]} />
      </Card>

      <Card title="Each year">
        <YearBars years={years} series={series} holdoutFrom={data.holdoutFrom} />
      </Card>

      <Card title="Side by side">
        <Table head={['', ...data.books.map((b) => b.name.split(':')[0]), 'NIFTY', `${data.fd.ratePct}% deposit`]} rows={[
          ['Made per year', ...data.books.map((b) => <span key={b.id} className={tone(b.stats.cagrPct)}>{pct(b.stats.cagrPct)}</span>), <span key="n" className={tone(data.nifty.cagrPct)}>{pct(data.nifty.cagrPct)}</span>, `${data.fd.ratePct}%`],
          ['₹10 lakh became', ...data.books.map((b) => lakh(b.curve[b.curve.length - 1][1])), lakh(niftyEnd), lakh(fdEnd)],
          ['Worst fall from a high', ...data.books.map((b) => <span key={b.id} className="text-down">{pct(b.stats.maxDdPct)}</span>), <span key="n" className="text-down">{pct(data.nifty.maxDdPct)}</span>, '0%'],
          ['Worst single day', ...data.books.map((b) => <span key={b.id} className="text-down">{pct(b.stats.worstDayPct)}</span>), '–', '0%'],
          ['Worst month', ...data.books.map((b) => <span key={b.id} className="text-down">{pct(b.stats.worstMonthPct)}</span>), '–', '0%'],
          ['Worst year', ...data.books.map((b) => <span key={b.id} className={tone(Math.min(...b.yearly.map((y) => y.returnPct)))}>{pct(Math.min(...b.yearly.map((y) => y.returnPct)))}</span>), <span key="n" className={tone(data.nifty.worstYearPct)}>{pct(data.nifty.worstYearPct)}</span>, `${data.fd.ratePct}%`],
          ['Trades won', ...data.books.map((b) => pct(b.stats.wonPct, 0)), '–', '–'],
          ['Years that lost money', ...data.books.map((b) => `${b.stats.losingYears} of ${b.yearly.length}`), `${data.nifty.yearly.filter((y) => y.returnPct < 0).length} of ${years.length}`, '0'],
          ['In the final test years, per year', ...data.books.map((b) => <span key={b.id} className={tone(b.holdout.cagrPct)}>{pct(b.holdout.cagrPct)}</span>), '–', `${data.fd.ratePct}%`],
          ['Money tied up as margin', ...data.books.map((b) => `about ${b.marginPct}%`), '100%', '100%'],
        ]} />
      </Card>

      <Card title="What did not work, and why">
        <ul className="grid gap-2 p-4 text-[13.5px] leading-relaxed text-ink-2">
          <li><b className="text-ink">Picking the monthly setting from past years.</b> Each year we let the computer choose the best setting of the previous five years and trade it the next year. It lost money: the setting that just won tends to be the one that just got lucky.</li>
          <li><b className="text-ink">Stop-losses on option selling.</b> Cutting a losing position at a daily close made results worse, not better: most losses recover, and the ones that do not happen too fast for a daily stop.</li>
          <li><b className="text-ink">Buying stocks at a 52-week high.</b> On average these stocks look good, but the average comes from a few huge winners; the typical breakout goes nowhere, and a portfolio of them fell 30 to 60% from its highs.</li>
          <li><b className="text-ink">Buying the strongest stocks (momentum).</b> It beat NIFTY on return in most versions, but with falls of 35 to 65% along the way. It needs a rule to step aside in bear markets before it is usable; that is the next thing to test.</li>
          <li><b className="text-ink">Intraday option strategies.</b> Not tested: there is no minute-by-minute option history before November 2026. The recorder is collecting it now.</li>
        </ul>
      </Card>

      <Card title="What this means">
        <ul className="grid gap-2 p-4 text-[13.5px] leading-relaxed text-ink-2">
          <li>Expect about <b className="text-ink">10 to 14% a year</b> from the mix on ₹10 lakh, not 35%, and expect one day every few years that takes 8 to 12% away in one go.</li>
          <li>Never run more than 3 weekly lots per ₹10 lakh. More lots means a bigger bad night, not a safer return.</li>
          <li>The weekly rule is now running as a <b className="text-ink">paper trade</b> in Trade lab, to see what real fills cost before any real money.</li>
        </ul>
      </Card>
    </div>
  );
}
