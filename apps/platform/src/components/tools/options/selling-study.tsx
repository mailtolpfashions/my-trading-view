'use client';

import { useMemo, useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { Segmented } from '@/components/ui';
import { useFeed } from '@/lib/feed';
import type { Tool } from '@/lib/tools';
import { Card, ToolShell } from '../tool-shell';
import { SellingDecay } from './selling-decay';
import { SellingPlan } from './selling-plan';

type Period = { period: string; netPaise: number; trades: number; wins: number; worstDrawdownPaise: number };
type Summary = {
  trades: number; winRatePct: number | null; netPaise: number; chargesPaise: number; slippagePaise: number;
  avgWinPaise: number | null; avgLossPaise: number | null; worstTradePaise: number | null;
  worstMonthPaise: number | null; worstMonth: string | null; worstYearPaise: number | null; worstYear: string | null;
  maxDrawdownPaise: number; longestUnderwaterDays: number; years: Period[]; months?: Period[];
  crisis: { id: string; label: string; netPaise: number; worstDrawdownPaise: number }[];
  chosenPeriodNetPaise: number; confirmPeriodNetPaise: number; reasons: Record<string, number>;
  adjustments: number; blockedAdjustments: number; settledFills: number; skipped: number;
  stress: { gapPct: number; worstPaise: number; medianPaise: number }[];
};
type Config = {
  id: string; tenor: string; tenorLabel: string; delta: number; wingPct: number | null; playbook: string; playbookName: string;
  summary: Summary; pass: { pass: boolean; checks: { label: string; ok: boolean; value: string }[] };
  sensitivity: Record<string, { netPaise: number; confirmPeriodNetPaise: number; worstMonthPaise: number | null; maxDrawdownPaise: number }>;
  marginPaise: number | null; fitsCapital: boolean | null;
};
type Study = {
  ranAt: string; from: string; to: string; days: number; capitalPaise: number; todayLot: number; todaySpotPaise: number;
  marginAvailable: boolean; engineMatch: boolean; sensitivity: { key: string; label: string }[];
  tenors: { id: string; label: string }[]; chosen: { naked: string | null; hedged: string | null }; passed: string[]; configs: Config[];
};
type Detail = {
  config: Config; skippedCount: number; equity: [string, number][];
  trades: { entryDate: string; exitDate: string; exitReason: string; creditPaise: number; netTodayPaise: number; adjustments: number; notes: string[] }[];
};

const inr = (paise: number | null) => (paise == null ? '–' : `${paise < 0 ? '−' : ''}₹${Math.abs(Math.round(paise / 100)).toLocaleString('en-IN')}`);
const tone = (paise: number | null) => (paise == null ? '' : paise > 0 ? 'text-up' : paise < 0 ? 'text-down' : '');
const REASONS: Record<string, string> = { expiry: 'Expiry', target: 'Profit booked', stop: 'Stop', 'max-loss': 'Loss limit', 'end-of-data': 'Still open' };
const th = 'px-3 py-2 text-left text-[11px] font-semibold text-muted whitespace-nowrap';
const td = 'px-3 py-2 text-[13px] whitespace-nowrap tabular-nums';
const protection = (w: number | null) => (w == null ? 'Naked' : `Hedged ${w}%`);

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-line">{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Pick({ title, c, cap, open }: { title: string; c: Config | undefined; cap: number; open: (id: string) => void }) {
  if (!c) return null;
  return (
    <button onClick={() => open(c.id)} className="panel flex min-w-0 flex-1 flex-col gap-1.5 p-4 text-left hover:shadow-[var(--shadow-panel)]">
      <span className="text-[12px] font-semibold text-muted">{title}</span>
      <span className="text-[15px] font-bold">{c.tenorLabel}, {c.delta} delta, {protection(c.wingPct)}</span>
      <span className="text-[13px] text-ink-2">{c.playbookName}</span>
      <span className="mt-1 flex flex-wrap gap-x-4 text-[13px] tabular-nums">
        <span>2023 to today <b className={tone(c.summary.confirmPeriodNetPaise)}>{inr(c.summary.confirmPeriodNetPaise)}</b></span>
        <span>Worst month <b className={tone(c.summary.worstMonthPaise)}>{(((c.summary.worstMonthPaise ?? 0) / cap) * 100).toFixed(1)}%</b></span>
      </span>
      <span className={`text-[13px] font-semibold ${c.pass.pass ? 'text-up' : 'text-down'}`}>{c.pass.pass ? 'Passed' : 'Did not pass'}</span>
    </button>
  );
}

function DetailView({ id, cap, labels }: { id: string; cap: number; labels: Study['sensitivity'] }) {
  const { data, error } = useFeed<Detail>(`selling-study/${id}`);
  if (error) return <Card><p className="p-4 text-[13px] text-down">{error}</p></Card>;
  if (!data) return <Card><p className="p-4 text-[13px] text-muted">Loading…</p></Card>;
  const c = data.config, s = c.summary;
  const pct = (p: number | null) => (p == null ? '–' : `${((p / cap) * 100).toFixed(1)}%`);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Pass mark" className="lg:col-span-2" right={c.marginPaise != null ? <span>Margin today {inr(c.marginPaise)} of {inr(cap)}{c.fitsCapital ? '' : ', does not fit'}</span> : <span>Margin not available</span>}>
        <Table head={['Check', 'Result', '']}>
          {c.pass.checks.map((x) => (
            <tr key={x.label} className="border-b border-line last:border-0">
              <td className={td}>{x.label}</td><td className={td}>{x.value}</td>
              <td className={`${td} font-semibold ${x.ok ? 'text-up' : 'text-down'}`}>{x.ok ? 'Pass' : 'Fail'}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Year by year">
        <Table head={['Year', 'Net', '% of capital', 'Trades', 'Wins', 'Worst fall']}>
          {s.years.map((y) => (
            <tr key={y.period} className="border-b border-line last:border-0">
              <td className={td}>{y.period}</td><td className={`${td} ${tone(y.netPaise)}`}>{inr(y.netPaise)}</td><td className={td}>{pct(y.netPaise)}</td>
              <td className={td}>{y.trades}</td><td className={td}>{y.wins}</td><td className={td}>{inr(y.worstDrawdownPaise)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="flex flex-col gap-3">
        <Card title="Shock periods">
          <Table head={['Period', 'Net', 'Worst fall']}>
            {s.crisis.map((x) => (
              <tr key={x.id} className="border-b border-line last:border-0">
                <td className={td}>{x.label}</td><td className={`${td} ${tone(x.netPaise)}`}>{inr(x.netPaise)}</td><td className={td}>{inr(x.worstDrawdownPaise)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={<span className="flex items-center gap-1.5">If the index gapped<InfoTip label="About the gap test"><p>A model estimate of the loss if the index gapped right after entry, with implied volatility rising on falls. Daily closes cannot show a gap, so this is shown apart from the results.</p></InfoTip></span>}>
          <Table head={['Gap', 'Typical', 'Worst entry', '% of capital']}>
            {s.stress.map((x) => (
              <tr key={x.gapPct} className="border-b border-line last:border-0">
                <td className={td}>{x.gapPct > 0 ? '+' : '−'}{Math.abs(x.gapPct)}%</td><td className={`${td} ${tone(x.medianPaise)}`}>{inr(x.medianPaise)}</td>
                <td className={`${td} ${tone(x.worstPaise)}`}>{inr(x.worstPaise)}</td><td className={td}>{pct(x.worstPaise)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="Costs and fills">
        <Table head={['Assumption', 'Net', '2023 to today', 'Worst month']}>
          <tr className="border-b border-line"><td className={td}>Next close, ₹1 slippage</td><td className={`${td} ${tone(s.netPaise)}`}>{inr(s.netPaise)}</td><td className={td}>{inr(s.confirmPeriodNetPaise)}</td><td className={td}>{inr(s.worstMonthPaise)}</td></tr>
          {labels.map((l) => { const x = c.sensitivity[l.key]; return (
            <tr key={l.key} className="border-b border-line last:border-0"><td className={td}>{l.label}</td><td className={`${td} ${tone(x?.netPaise)}`}>{inr(x?.netPaise)}</td><td className={td}>{inr(x?.confirmPeriodNetPaise)}</td><td className={td}>{inr(x?.worstMonthPaise)}</td></tr>
          ); })}
        </Table>
      </Card>
      <Card title="What happened">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-4 text-[13px]">
          {([
            ['Trades', s.trades], ['Won', s.winRatePct == null ? '–' : `${s.winRatePct.toFixed(0)}%`],
            ['Average win', inr(s.avgWinPaise)], ['Average loss', inr(s.avgLossPaise)],
            ['Worst trade', inr(s.worstTradePaise)], ['Worst fall', inr(s.maxDrawdownPaise)],
            ['Longest time below a high', `${s.longestUnderwaterDays} days`], ['Adjustments made', s.adjustments],
            ['Adjustments refused', s.blockedAdjustments], ['Charges', inr(s.chargesPaise)], ['Slippage', inr(s.slippagePaise)], ['Entries skipped', s.skipped],
            ...Object.entries(s.reasons).map(([k, v]): [string, number] => [REASONS[k] ?? k, v]),
          ] as [string, string | number][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>
          ))}
        </dl>
      </Card>
      {s.months && (
        <Card title="Month by month" className="lg:col-span-2">
          <div className="grid max-h-[320px] grid-cols-2 gap-x-4 overflow-y-auto p-3 text-[12px] sm:grid-cols-4 lg:grid-cols-6">
            {s.months.map((m) => <div key={m.period} className="flex justify-between gap-2 py-0.5 tabular-nums"><span className="text-muted">{m.period}</span><span className={tone(m.netPaise)}>{inr(m.netPaise)}</span></div>)}
          </div>
        </Card>
      )}
      <Card title={`Every trade (${data.trades.length})`} className="lg:col-span-2">
        <div className="max-h-[420px] overflow-y-auto">
          <Table head={['Entered', 'Ended', 'How', 'Credit', 'Net', 'What the rules did']}>
            {[...data.trades].reverse().map((t) => (
              <tr key={t.entryDate} className="border-b border-line align-top last:border-0">
                <td className={td}>{t.entryDate}</td><td className={td}>{t.exitDate}</td><td className={td}>{REASONS[t.exitReason] ?? t.exitReason}</td>
                <td className={td}>{inr(t.creditPaise)}</td><td className={`${td} ${tone(t.netTodayPaise)}`}>{inr(t.netTodayPaise)}</td>
                <td className="px-3 py-2 text-[12px] text-ink-2">{t.notes.join(' · ')}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </div>
  );
}

const SORTS = { confirm: 'Latest years', month: 'Worst month', net: 'Total' } as const;

export function SellingStudyTool({ tool }: { tool: Tool }) {
  const { data: study, error } = useFeed<Study>('selling-study');
  const [tenor, setTenor] = useState('all');
  const [cover, setCover] = useState('all');
  const [passedOnly, setPassedOnly] = useState<'all' | 'passed'>('all');
  const [sort, setSort] = useState<keyof typeof SORTS>('confirm');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!study) return [];
    const list = study.configs.filter((c) => (tenor === 'all' || c.tenor === tenor) && (cover === 'all' || (cover === 'naked') === (c.wingPct == null)) && (passedOnly === 'all' || c.pass.pass));
    const key = (c: Config) => (sort === 'confirm' ? c.summary.confirmPeriodNetPaise : sort === 'net' ? c.summary.netPaise : c.summary.worstMonthPaise ?? 0);
    return [...list].sort((a, b) => key(b) - key(a));
  }, [study, tenor, cover, passedOnly, sort]);

  const about = study && (
    <>
      <p>NSE official NIFTY options, {study.from} to {study.to}, {study.days.toLocaleString('en-IN')} days. Rupees are at today’s size: one lot of {study.todayLot} at the current index level, without compounding.</p>
      <p>Rules were picked on the years up to 2022 and checked on 2023 to today. Fills happen at the next day’s close with ₹1 lost per option. Past results do not promise future ones.</p>
    </>
  );

  if (error && !study) return <ToolShell tool={tool}><Card><p className="p-4 text-[13px] text-muted">{error}</p></Card></ToolShell>;
  if (!study) return <ToolShell tool={tool}><Card><p className="p-4 text-[13px] text-muted">Loading…</p></Card></ToolShell>;
  const cap = study.capitalPaise;
  const byId = (id: string | null) => study.configs.find((c) => c.id === id);

  return (
    <ToolShell tool={tool} about={about}>
      <SellingPlan />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="panel flex flex-1 flex-col justify-center gap-1 p-4">
          <span className="text-[12px] font-semibold text-muted">Rule sets that passed</span>
          <span className="text-[26px] font-extrabold tabular-nums">{study.passed.length} <span className="text-[15px] font-semibold text-muted">of {study.configs.length}</span></span>
        </div>
        <Pick title="Best naked, chosen on years to 2022" c={byId(study.chosen.naked)} cap={cap} open={setOpen} />
        <Pick title="Best hedged, chosen on years to 2022" c={byId(study.chosen.hedged)} cap={cap} open={setOpen} />
      </div>

      <SellingDecay />

      {open && <DetailView key={open} id={open} cap={cap} labels={study.sensitivity} />}

      <Card title="All rule sets" right={<span>{rows.length} shown</span>}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Segmented label="Expiry" value={tenor} onChange={setTenor} options={[{ value: 'all', label: 'All' }, ...study.tenors.map((t) => ({ value: t.id, label: t.label.replace(', ', ' ') }))]} />
          <Segmented label="Protection" value={cover} onChange={setCover} options={[{ value: 'all', label: 'All' }, { value: 'naked', label: 'Naked' }, { value: 'hedged', label: 'Hedged' }]} />
          <Segmented label="Show" value={passedOnly} onChange={setPassedOnly} options={[{ value: 'all', label: 'All' }, { value: 'passed', label: 'Passed' }]} />
          <Segmented label="Sort by" value={sort} onChange={setSort} options={Object.entries(SORTS).map(([value, label]) => ({ value: value as keyof typeof SORTS, label }))} />
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          <Table head={['Expiry', 'Delta', 'Protection', 'Rule', 'Won', '2023 to today', 'Total', 'A year', 'Worst month', 'Worst year', 'Result']}>
            {rows.map((c) => (
              <tr key={c.id} onClick={() => setOpen(c.id)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-accent-soft ${open === c.id ? 'bg-accent-soft' : ''}`}>
                <td className={td}>{c.tenorLabel}</td><td className={td}>{c.delta}</td><td className={td}>{protection(c.wingPct)}</td><td className={td}>{c.playbookName}</td>
                <td className={td}>{c.summary.winRatePct?.toFixed(0)}%</td>
                <td className={`${td} ${tone(c.summary.confirmPeriodNetPaise)}`}>{inr(c.summary.confirmPeriodNetPaise)}</td>
                <td className={`${td} ${tone(c.summary.netPaise)}`}>{inr(c.summary.netPaise)}</td>
                <td className={td}>{((c.summary.netPaise / cap / c.summary.years.length) * 100).toFixed(1)}%</td>
                <td className={td}>{(((c.summary.worstMonthPaise ?? 0) / cap) * 100).toFixed(1)}%</td>
                <td className={td}>{(((c.summary.worstYearPaise ?? 0) / cap) * 100).toFixed(1)}%</td>
                <td className={`${td} font-semibold ${c.pass.pass ? 'text-up' : 'text-muted'}`}>{c.pass.pass ? 'Passed' : `${c.pass.checks.filter((x) => !x.ok).length} failed`}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </ToolShell>
  );
}
