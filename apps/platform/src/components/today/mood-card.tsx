'use client';

// "Market mood" on Today: NIFTY 500 breadth, a sector strip (hover a bar to read it) and the FII futures position in
// one line, with the full history one click away.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { InfoTip } from '@/components/info-tip';
import { fmtDate } from '@/lib/options';
import type { Breadth, Brief, Dashboard } from '@/lib/today';
import { tone } from './market-tiles';

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
const short = (n: string) => n.replace(/^NIFTY /, '').replace(/ INDEX$/, '');
const contracts = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-IN')}`;

export function MoodCard({ breadth, sectors, fii, fpi }: { breadth: Breadth | undefined; sectors: Brief['sectors']; fii: Dashboard['fii']; fpi: Dashboard['fpi'] }) {
  return (
    <section className="panel flex min-h-0 flex-col p-5">
      <div className="card-head !mb-3 !pb-3"><h2 className="text-[16px] font-semibold tracking-[-0.01em]">Market mood</h2></div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <BreadthBar b={breadth} />
        <SectorStrip sectors={sectors} />
        <FiiLine fii={fii} fpi={fpi} />
      </div>
    </section>
  );
}

function BreadthBar({ b }: { b: Breadth | undefined }) {
  if (!b) return <div className="h-[54px] animate-pulse rounded-[12px] bg-raised" />;
  const traded = b.advances + b.declines + b.unchanged;
  const upShare = traded ? (b.advances / traded) * 100 : 0;
  return (
    <div>
      <p className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] text-muted">
        <span className="font-semibold text-ink-2">NIFTY 500</span>
        <span className="ml-auto"><b className="num text-[15px] text-ink">{upShare.toFixed(0)}%</b> of stocks rose</span>
        <InfoTip label="About breadth">{b.advances} rose, {b.declines} fell and {b.unchanged} were unchanged, of {traded} traded{b.members != null ? ` out of ${b.members} members` : ''}.{b.notTraded?.length ? ` No bar that day: ${b.notTraded.join(', ')}.` : ''}</InfoTip>
      </p>
      <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" role="img" aria-label={`${b.advances} rose, ${b.declines} fell, ${b.unchanged} unchanged`}>
        <span className="rounded-full bg-up transition-[flex-grow] duration-500" style={{ flexGrow: b.advances }} title={`${b.advances} rose`} />
        {b.unchanged > 0 && <span className="rounded-full bg-muted" style={{ flexGrow: b.unchanged }} title={`${b.unchanged} unchanged`} />}
        <span className="rounded-full bg-down transition-[flex-grow] duration-500" style={{ flexGrow: b.declines }} title={`${b.declines} fell`} />
      </div>
      <p className="num mt-1 flex justify-between text-[11.5px]"><span className="text-up">{b.advances} up</span><span className="text-down">{b.declines} down</span></p>
    </div>
  );
}

/** Every sector as a small bar around zero, best on the left; hovering one reads it out under the strip. */
function SectorStrip({ sectors }: { sectors: Brief['sectors'] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!sectors.length) return null;
  const list = [...sectors].sort((a, b) => b.d1 - a.d1);
  const max = Math.max(...list.map((s) => Math.abs(s.d1)), 0.1);
  const best = list[0], worst = list[list.length - 1];
  const h = hover == null ? null : list[hover];
  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-semibold text-ink-2">Sectors today</p>
      <div className="flex h-14 items-stretch gap-[2px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`Strongest ${short(best.name)} ${pct(best.d1)}, weakest ${short(worst.name)} ${pct(worst.d1)}`}>
        {list.map((s, i) => (
          <span key={s.name} onMouseEnter={() => setHover(i)} className="relative flex-1 cursor-default">
            <span className={`absolute left-0 right-0 rounded-[2px] transition-opacity ${s.d1 >= 0 ? 'bottom-1/2 bg-up' : 'top-1/2 bg-down'} ${hover != null && hover !== i ? 'opacity-35' : ''}`}
              style={{ height: `${Math.max(2, (Math.abs(s.d1) / max) * 50)}%` }} />
          </span>
        ))}
      </div>
      <p className="mt-1.5 min-h-[18px] text-[12.5px]">
        {h ? <><b>{short(h.name)}</b> <span className={`num font-semibold ${tone(h.d1)}`}>{pct(h.d1)}</span> <span className="text-muted">· week {pct(h.w1)} · month {pct(h.m1)}</span></>
          : <><span className="text-muted">Best</span> <b>{short(best.name)}</b> <span className={`num ${tone(best.d1)}`}>{pct(best.d1)}</span> <span className="text-muted">· worst</span> <b>{short(worst.name)}</b> <span className={`num ${tone(worst.d1)}`}>{pct(worst.d1)}</span></>}
      </p>
    </div>
  );
}

function FiiLine({ fii, fpi }: { fii: Dashboard['fii']; fpi: Dashboard['fpi'] }) {
  const l = fii?.latest, p = fii?.previous;
  if (!l) return null;
  const net = l.futLong - l.futShort;
  const change = p ? net - (p.futLong - p.futShort) : null;
  return (
    <Link href="/research/fii" className="group mt-auto flex items-center gap-2 rounded-[12px] bg-raised px-3 py-2.5 text-[12.5px] hover:bg-accent-soft">
      <span className="min-w-0 flex-1">
        <span className="block text-muted">FII index futures, {fmtDate(l.date)}</span>
        <span className="num block font-semibold">
          <span className={tone(net)}>{contracts(net)}</span> net{change != null && <> · <span className={tone(change)}>{contracts(change)}</span> on the day</>}
          {fpi && <span className="font-normal text-muted"> · FPI cash <span className={tone(fpi.netCr)}>{fpi.netCr > 0 ? '+' : ''}{fpi.netCr.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr</span></span>}
        </span>
      </span>
      <ArrowRight size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent-deep" />
    </Link>
  );
}
