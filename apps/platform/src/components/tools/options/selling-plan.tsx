'use client';

import { useState } from 'react';
import { confirmDialog } from '@/components/dialog';
import { InfoTip } from '@/components/info-tip';
import { Button } from '@/components/ui';
import { feed, useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';

type Leg = { expiry: string; strikePaise: number; kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; qty: number; role: 'short' | 'wing'; pricePaise: number; delta: number | null };
type Plan = {
  asOf: string; spotPaise: number; status: 'enter' | 'low-iv' | 'wait'; expiry: string; entryOn: string; exitOn: string; lot: number; skip: string | null;
  iv: { today: number | null; median: number | null; high: boolean | null };
  legs: Leg[] | null; creditPaise: number | null; marginPaise?: number | null; gaps?: { gapPct: number; pnlPaise: number }[];
};
type Paper = {
  id: string; openedOn: string; expiry: string; exitOn: string; creditPaise: number; status: 'open' | 'closed'; closedOn: string | null; why: string | null;
  netPaise: number | null; lastMarkOn: string; lastPnlPaise: number; legs: { strikePaise: number; kind: string; side: string; entryPaise: number }[];
};
type Variant = { name: string; trades: number; wonPct: number | null; perYearPaise: number; worstTradePaise: number | null; losingYears: number; yearCount: number; since2023Paise: number };
type Tested = { from: string; to: string; staleSetAside: number; variants: Variant[] };
type Answer = { plan: Plan; paper: Paper[]; tested: Tested | null };

const inr = (paise: number | null | undefined) => (paise == null ? '–' : `${paise < 0 ? '−' : ''}₹${Math.abs(Math.round(paise / 100)).toLocaleString('en-IN')}`);
const tone = (paise: number | null | undefined) => (paise == null ? '' : paise > 0 ? 'text-up' : paise < 0 ? 'text-down' : '');
const pct = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const th = 'px-3 py-2 text-left text-[11px] font-semibold text-muted whitespace-nowrap';
const td = 'px-3 py-2 text-[13px] whitespace-nowrap tabular-nums';

const HEADLINE: Record<Plan['status'], string> = {
  enter: 'Enter today',
  'low-iv': 'Entry day, but IV is low: skip this month',
  wait: 'No trade today',
};

function Fact({ label, value, cls = '' }: { label: string; value: React.ReactNode; cls?: string }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] font-semibold text-muted">{label}</span><span className={`text-[14px] font-semibold tabular-nums ${cls}`}>{value}</span></div>;
}

/** Today's answer from the paper rule, the exact legs, and the paper trades so far. */
export function SellingPlan() {
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error } = useFeed<Answer>(`selling-plan?r=${rev}`);
  if (!data) return error ? <Card title="This month’s plan"><p className="p-4 text-[13px] text-down">{error}</p></Card> : null;
  const { plan, paper, tested } = data;
  const open = paper.find((p) => p.status === 'open');
  const base = tested?.variants[0];

  const start = async () => {
    const ok = await confirmDialog({ title: 'Start this paper trade?', message: `Practice only, at the ${plan.asOf} close. No real order is placed.`, confirmLabel: 'Start paper trade', cancelLabel: 'Cancel' });
    if (!ok) return;
    setBusy(true); setProblem(null);
    try { await feed('selling-paper/start', {}); setRev((r) => r + 1); } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card
      title={<span className="flex items-center gap-1.5">This month’s plan<InfoTip label="About the rule">
        <p>Sell a 0.16 delta call and put on the monthly NIFTY expiry about 45 days out, only when IV is above its past-year median. Buy a put 15% below the index. Exit everything at 21 days left.</p>
        <p>Prices are NSE’s latest official close, not live. Future dates can move for holidays. Margin and gap figures are estimates. Past results do not promise future ones.</p>
      </InfoTip></span>}
      right={<span>Close of {plan.asOf}</span>}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <p className="text-[18px] font-extrabold tracking-[-0.01em]">{open ? 'Paper trade open' : HEADLINE[plan.status]}</p>
          <Fact label="Next entry" value={plan.entryOn} />
          <Fact label="Exit by" value={plan.exitOn} />
          <Fact label="Expiry" value={plan.expiry} />
          <Fact label="IV now" value={`${pct(plan.iv.today)} vs ${pct(plan.iv.median)}`} cls={plan.iv.high ? 'text-up' : ''} />
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
                    <tr key={`${l.strikePaise}${l.kind}`} className="border-b border-line last:border-0">
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

        {base && (
          <p className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-[13px] text-ink-2">
            <span>Tested {tested.from.slice(0, 4)} to {tested.to.slice(0, 4)}, one lot:</span>
            <span>{base.trades} trades</span><span>won {base.wonPct?.toFixed(0)}%</span><span>{inr(base.perYearPaise)} a year</span>
            <span>worst trade {inr(base.worstTradePaise)}</span><span>{base.losingYears} losing years of {base.yearCount}</span>
          </p>
        )}
      </div>
    </Card>
  );
}
