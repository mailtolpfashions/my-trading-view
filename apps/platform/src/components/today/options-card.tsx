'use client';

// "Options today" on Today: for NIFTY or BANK NIFTY, the nearest expiry's open-interest walls on a scale with the
// price and max pain, the move the straddle prices in, and how high implied volatility is against the past year.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { InfoTip } from '@/components/info-tip';
import { Segmented } from '@/components/ui';
import { fmt } from '@/lib/format';
import type { Brief } from '@/lib/today';

type Opt = NonNullable<Brief['options']>[number];
const NAMES: Record<string, string> = { NIFTY: 'NIFTY', BANKNIFTY: 'BANKNIFTY' };
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function OptionsCard({ options, pick, onPick, price }: { options: Brief['options']; pick: string; onPick: (u: string) => void; price: (u: string) => number | null }) {
  const list = options ?? [];
  const o = list.find((x) => x.underlying === pick) ?? list[0];
  return (
    <section className="panel flex min-h-0 flex-col p-5">
      <div className="card-head !mb-3 !pb-3">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Options today</h2>
        <InfoTip label="About these numbers">From NSE&apos;s F&amp;O close of {o?.date ?? '–'}, nearest expiry. Open interest is the number of contracts still open; the biggest piles of call and put open interest are often watched as resistance and support. Max pain is the strike where option buyers as a whole lose the most at expiry.</InfoTip>
        {list.length > 1 && <div className="ml-auto"><Segmented label="Index" value={o.underlying} onChange={onPick} options={list.map((x) => ({ value: x.underlying, label: NAMES[x.underlying] ?? x.underlying }))} /></div>}
      </div>
      {!o ? <p className="text-[13.5px] text-muted">No F&amp;O data yet.</p> : (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto text-[13px]">
          <p className="text-ink-2">Expiry <b className="text-ink">{day(o.expiry)}</b> · {o.daysToExpiry === 0 ? 'today' : `${o.daysToExpiry} day${o.daysToExpiry === 1 ? '' : 's'} left`}</p>
          <Walls o={o} price={price(o.underlying) ?? o.spot} />
          <dl className="grid grid-cols-2 gap-2">
            <Stat k="Put-call ratio" v={o.pcr == null ? '–' : o.pcr.toFixed(2)} hint={o.pcr == null ? '' : o.pcr > 1.2 ? 'More puts written' : o.pcr < 0.8 ? 'More calls written' : 'Balanced'} />
            <Stat k="Priced move by expiry" v={o.impliedMovePct == null ? '–' : `±${o.impliedMovePct.toFixed(1)}%`} hint={o.straddle == null ? '' : `Straddle ₹${fmt(o.straddle)}`} />
          </dl>
          {o.atmIv != null && <IvGauge iv={o.atmIv} pctile={o.ivPercentile} />}
          <Link href="/options" className="mt-auto inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-accent-deep hover:underline">Open the option chain <ArrowRight size={13} /></Link>
        </div>
      )}
    </section>
  );
}

const Stat = ({ k, v, hint }: { k: string; v: string; hint: string }) => (
  <div className="rounded-[12px] bg-raised px-3 py-2"><dt className="text-[11.5px] text-muted">{k}</dt><dd className="num text-[16px] font-bold">{v}</dd>{hint && <dd className="text-[11.5px] text-ink-2">{hint}</dd>}</div>
);

/** Put wall, price, max pain and call wall on one scale. */
function Walls({ o, price }: { o: Opt; price: number | null }) {
  const marks = [o.putWall, o.callWall, o.maxPain, price].filter((v): v is number => v != null);
  if (marks.length < 2) return null;
  const lo = Math.min(...marks), hi = Math.max(...marks), pad = (hi - lo) * 0.08 || 50;
  const at = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const pin = (v: number | null, label: string, cls: string, below = false) => v == null ? null : (
    <span className="absolute -translate-x-1/2 text-center" style={{ left: `${at(v)}%`, [below ? 'top' : 'bottom']: 0 }} title={`${label} ${fmt(v)}`}>
      {!below && <span className="block whitespace-nowrap text-[10.5px] font-semibold text-muted">{label}</span>}
      {!below && <span className={`num block whitespace-nowrap text-[11.5px] font-semibold ${cls}`}>{fmt(v)}</span>}
      {below && <span className={`num block whitespace-nowrap text-[11.5px] font-semibold ${cls}`}>{fmt(v)}</span>}
      {below && <span className="block whitespace-nowrap text-[10.5px] font-semibold text-muted">{label}</span>}
    </span>
  );
  return (
    <div className="px-6">
      <div className="relative h-9">{o.putWall != null && o.putWall === o.callWall ? pin(o.putWall, 'Call and put wall', 'text-ink') : <>{pin(o.putWall, 'Put wall', 'text-up')}{pin(o.callWall, 'Call wall', 'text-down')}</>}</div>
      <div className="relative my-1 h-2 rounded-full bg-raised">
        {o.putWall != null && o.callWall != null && <span className="absolute top-0 bottom-0 rounded-full bg-accent-soft" style={{ left: `${at(Math.min(o.putWall, o.callWall))}%`, width: `${Math.abs(at(o.callWall) - at(o.putWall))}%` }} />}
        {[o.putWall, o.callWall].map((v, i) => v != null && <span key={i} className={`absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${i ? 'bg-down' : 'bg-up'}`} style={{ left: `${at(v)}%` }} />)}
        {o.maxPain != null && <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink-2" style={{ left: `${at(o.maxPain)}%` }} title={`Max pain ${fmt(o.maxPain)}`} />}
        {price != null && <span className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-[left] duration-500" style={{ left: `${at(price)}%` }} title={`Price ${fmt(price)}`} />}
      </div>
      <div className="relative h-9">{pin(price, 'Price', 'text-accent-deep', true)}{o.maxPain != null && price != null && Math.abs(at(o.maxPain) - at(price)) > 14 && pin(o.maxPain, 'Max pain', 'text-ink-2', true)}</div>
    </div>
  );
}

function IvGauge({ iv, pctile }: { iv: number; pctile: number | null }) {
  const p = pctile == null ? null : Math.round(pctile);
  return (
    <div title={p == null ? undefined : `Implied volatility was lower than today on ${p}% of days in the past year`}>
      <p className="mb-1 flex justify-between text-[12px]"><span className="text-muted">Implied volatility</span><span><b className="num">{(iv * 100).toFixed(1)}%</b>{p != null && <span className="text-ink-2"> · higher than {p}% of the year</span>}</span></p>
      {p != null && (
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-up-soft via-raised to-down-soft">
          <span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-[left] duration-500" style={{ left: `${p}%` }} />
        </div>
      )}
    </div>
  );
}
