'use client';

import { useState } from 'react';
import { confirmDialog } from '@/components/dialog';
import { InfoTip } from '@/components/info-tip';
import { Button } from '@/components/ui';
import { feed, useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';

type Leg = { expiry: string; strikePaise: number; kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; qty: number; role: 'short' | 'wing'; pricePaise: number; delta: number | null };
type Plan = {
  rule: string; name: string; asOf: string; spotPaise: number; status: 'enter' | 'low-iv' | 'wait'; expiry: string; entryOn: string; exitOn: string; lot: number; skip: string | null;
  iv: { today: number | null; median: number | null; high: boolean | null; rank: number | null };
  legs: Leg[] | null; creditPaise: number | null; marginPaise?: number | null; gaps?: { gapPct: number; pnlPaise: number }[];
};
type Paper = {
  id: string; rule: string; openedOn: string; expiry: string; exitOn: string; creditPaise: number; status: 'open' | 'closed'; closedOn: string | null; why: string | null;
  netPaise: number | null; lastMarkOn: string; lastPnlPaise: number; legs: { strikePaise: number; kind: string; side: string; entryPaise: number }[];
};
type Variant = { name: string; trades: number; wonPct: number | null; perYearPaise: number; worstTradePaise: number | null; losingYears: number; yearCount: number; since2023Paise: number };
type Tested = { from: string; to: string; staleSetAside: number; variants: Variant[] };
type Quick = { n: number; won: number; year: number; worst: number; ly: number; yc: number };
type Answer = { plan: Plan; straddle: Plan; paper: Paper[]; tested: Tested | null; testedStraddle: Quick | null };

const inr = (paise: number | null | undefined) => (paise == null ? '–' : `${paise < 0 ? '−' : ''}₹${Math.abs(Math.round(paise / 100)).toLocaleString('en-IN')}`);
const tone = (paise: number | null | undefined) => (paise == null ? '' : paise > 0 ? 'text-up' : paise < 0 ? 'text-down' : '');
const pct = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const th = 'px-3 py-2 text-left text-[11px] font-semibold text-muted whitespace-nowrap';
const td = 'px-3 py-2 text-[13px] whitespace-nowrap tabular-nums';

const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
// A rule enters only on its one entry day a month, so on other days say whether IV passes and when that day is.
const headline = (p: Plan) => (p.status === 'enter' ? 'Enter today'
  : p.status === 'low-iv' ? 'Entry day, but IV is low: skip this month'
  : `${p.iv.high ? 'IV passes.' : 'IV is low now.'} Next entry day: ${dayName(p.entryOn)}`);

function Fact({ label, value, cls = '' }: { label: string; value: React.ReactNode; cls?: string }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] font-semibold text-muted">{label}</span><span className={`text-[14px] font-semibold tabular-nums ${cls}`}>{value}</span></div>;
}

const pctInt = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);

/** One paper rule: today's answer, the exact legs, and its paper trades. */
function PlanCard({ plan, paper, tested, about, title, onStarted }: { plan: Plan; paper: Paper[]; tested: React.ReactNode; about: React.ReactNode; title: string; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = paper.find((p) => p.status === 'open');
  const straddle = plan.rule === 'paper-straddle';
  const start = async () => {
    const ok = await confirmDialog({ title: 'Start this paper trade?', message: `${title}. Practice only, at the ${plan.asOf} close. No real order is placed.`, confirmLabel: 'Start paper trade', cancelLabel: 'Cancel' });
    if (!ok) return;
    setBusy(true); setProblem(null);
    try { await feed('selling-paper/start', { rule: plan.rule }); onStarted(); } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-1.5">{title}<InfoTip label={`About ${title}`}>{about}</InfoTip></span>} right={<span>Close of {plan.asOf}</span>}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <p className="text-[18px] font-extrabold tracking-[-0.01em]">{open ? 'Paper trade open' : headline(plan)}</p>
          <Fact label="Next entry" value={plan.entryOn} />
          <Fact label="Exit by" value={plan.exitOn} />
          <Fact label="Expiry" value={plan.expiry} />
          {straddle
            ? <Fact label="IV rank, needs 67%" value={pctInt(plan.iv.rank)} cls={plan.iv.high ? 'text-up' : ''} />
            : <Fact label="IV now" value={`${pct(plan.iv.today)} vs ${pct(plan.iv.median)}`} cls={plan.iv.high ? 'text-up' : ''} />}
          {plan.status === 'enter' && !open && <Button variant="primary" disabled={busy} onClick={() => void start()} className="ml-auto">Start paper trade</Button>}
        </div>
        {problem && <p className="text-[13px] text-down">{problem}</p>}
        {plan.skip && <p className="text-[13px] text-muted">{plan.skip}</p>}
        {plan.legs && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-line">{[plan.status === 'enter' ? 'Legs' : 'Legs if it were today', 'Strike', 'Price', 'Delta'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {plan.legs.map((l) => (
                    <tr key={`${l.strikePaise}${l.kind}${l.side}`} className="border-b border-line last:border-0">
                      <td className={td}>{l.side === 'SELL' ? 'Sell' : 'Buy crash put'} 1 lot</td><td className={td}>{l.strikePaise / 100} {l.kind}</td><td className={td}>₹{(l.pricePaise / 100).toFixed(2)}</td><td className={td}>{l.delta?.toFixed(2) ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 content-start gap-3">
              <Fact label={`Credit, lot ${plan.lot}`} value={inr(plan.creditPaise)} />
              <Fact label="Margin" value={inr(plan.marginPaise)} />
              {(plan.gaps ?? []).filter((g) => Math.abs(g.gapPct) === 13).map((g) => <Fact key={g.gapPct} label={`If it gapped ${g.gapPct > 0 ? '+' : '−'}13%`} value={inr(g.pnlPaise)} cls="text-down" />)}
            </div>
          </div>
        )}
        {paper.length > 0 && (
          <div className="overflow-x-auto border-t border-line pt-3">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-line">{['Paper trade', 'Credit', 'Result', 'Status', 'Note'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {[...paper].reverse().map((p) => {
                  const pnl = p.netPaise ?? p.lastPnlPaise;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className={td}>{p.openedOn} to {p.closedOn ?? p.exitOn}</td><td className={td}>{inr(p.creditPaise)}</td><td className={`${td} ${tone(pnl)}`}>{inr(pnl)}</td>
                      <td className={td}>{p.status === 'open' ? `Open, marked ${p.lastMarkOn}` : 'Closed'}</td><td className="px-3 py-2 text-[12px] text-ink-2">{p.why}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tested}
      </div>
    </Card>
  );
}

/** Both paper rules, side by side in time, so they can be compared on the same days. */
export function SellingPlan() {
  const [rev, setRev] = useState(0);
  const { data, error } = useFeed<Answer>(`selling-plan?r=${rev}`);
  if (!data) return error ? <Card title="This month’s plan"><p className="p-4 text-[13px] text-down">{error}</p></Card> : null;
  const { plan, straddle, paper, tested, testedStraddle: q } = data;
  const base = tested?.variants[0];
  const line = 'flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-[13px] text-ink-2';
  const again = () => setRev((r) => r + 1);
  const common = <p>Prices are NSE’s latest official close, not live. Future dates can move for holidays. Margin and gap figures are estimates. Past results do not promise future ones.</p>;
  return (
    <div className="flex flex-col gap-3">
      <PlanCard title="Main paper rule" plan={plan} paper={paper.filter((p) => p.rule === 'paper-rule')} onStarted={again}
        about={<><p>Sell a 0.16 delta call and put on the monthly NIFTY expiry about 45 days out, only when IV is above its past-year median. Buy a put 15% below the index. Exit everything at 21 days left.</p>{common}</>}
        tested={base && <p className={line}><span>Tested {tested.from.slice(0, 4)} to {tested.to.slice(0, 4)}, one lot:</span><span>{base.trades} trades</span><span>won {base.wonPct?.toFixed(0)}%</span><span>{inr(base.perYearPaise)} a year</span><span>worst trade {inr(base.worstTradePaise)}</span><span>{base.losingYears} losing years of {base.yearCount}</span></p>} />
      <PlanCard title="Second paper rule: straddle" plan={straddle} paper={paper.filter((p) => p.rule === 'paper-straddle')} onStarted={again}
        about={<><p>Sell the NIFTY straddle at the forward price about 45 days before monthly expiry, only when IV is in the top third of its past year. Book it at 50% of the credit, or exit at 25 days left.</p><p>It has no protection, so a gap has no limit. It runs here only to compare with the main rule.</p>{common}</>}
        tested={q && <p className={line}><span>Tested 2011 to 2026, one lot:</span><span>{q.n} trades</span><span>won {q.won}%</span><span>{inr(q.year * 100)} a year</span><span>worst trade {inr(q.worst * 100)}</span><span>{q.ly} losing years of {q.yc}</span></p>} />
    </div>
  );
}
