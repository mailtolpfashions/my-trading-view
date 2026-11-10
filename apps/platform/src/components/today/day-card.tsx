'use client';

// "Your day" on Today: what needs you (alerts), the day's risk limits (edit in place) and the way into the scanner.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, CalendarClock, Pencil, Target } from 'lucide-react';
import type { intraday } from '@mtv/options';
import { useFeed } from '@/lib/feed';
import { Button, inputCls } from '@/components/ui';
import { MODE_LABEL, type Brief, type DaySettings } from '@/lib/today';

const NAMES: Record<string, string> = { NIFTY: 'NIFTY', BANKNIFTY: 'BANK NIFTY', FINNIFTY: 'FIN NIFTY', MIDCPNIFTY: 'MIDCAP' };

export function DayCard({ brief, settings, onSave }: { brief: Brief; settings: DaySettings | null; onSave: (p: Partial<DaySettings>) => void }) {
  const n = brief.needsYou.alertsToday;
  // The nearest expiry of each index (the brief lists weekly and monthly ones)
  const soon = [...brief.expiries].sort((a, b) => a.calendarDays - b.calendarDays).filter((e, i, all) => all.findIndex((x) => x.underlying === e.underlying) === i).slice(0, 2);
  return (
    <section className="panel flex min-h-0 flex-col p-5">
      <div className="card-head !mb-3 !pb-3"><h2 className="text-[16px] font-semibold tracking-[-0.01em]">Your day</h2></div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-[13.5px]">
        <Link href="/alerts" className="flex items-center gap-3 rounded-[12px] px-2 py-1.5 hover:bg-raised">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${n ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-2'}`}><Bell size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{n ? `${n} alert${n === 1 ? '' : 's'} fired today` : 'No alerts fired today'}</span>
            {brief.needsYou.latest[0] && <span className="block truncate text-[12.5px] text-muted">{brief.needsYou.latest[0].name}: {brief.needsYou.latest[0].symbols.join(', ')}</span>}
          </span>
          <ArrowRight size={14} className="shrink-0 text-muted" />
        </Link>
        {soon.length > 0 && (
          <p className="flex items-center gap-3 px-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-raised text-ink-2"><CalendarClock size={16} /></span>
            <span className="text-ink-2">{soon.map((e) => `${NAMES[e.underlying] ?? e.underlying} expiry ${e.calendarDays === 0 ? 'today' : `in ${e.calendarDays} day${e.calendarDays === 1 ? '' : 's'}`}`).join(' · ')}</span>
          </p>
        )}
        <SellerLine />
        {settings && <DayRules s={settings} onSave={onSave} />}
      </div>
      <Link href="/scanner" className="mt-3 inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] bg-inverse px-4 text-[14px] font-semibold text-on-inverse transition-colors hover:bg-inverse-hover">
        Find {settings ? MODE_LABEL[settings.mode].toLowerCase() : ''} trades <ArrowRight size={15} />
      </Link>
    </section>
  );
}

/** One line from the intraday seller engine (Options → Intraday seller): the setup and its invalidation, or why there is none. */
function SellerLine() {
  const r = useFeed<{ view: intraday.View }>('seller/view', 300_000);
  const v = r.data?.view;
  const n = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const text = !v ? (r.error ? 'Not available' : 'Checking…')
    : v.stop ? (v.stop.startsWith('Market closed') ? 'Market closed' : 'No live data')
      : v.setup ? `${v.setup.side} ${n(v.setup.strike)} ${v.setup.side === 'CALL SELL' ? 'CE' : 'PE'} · invalid on a 15-min close ${v.setup.side === 'CALL SELL' ? 'above' : 'below'} ${n(v.setup.invalidation.level)}`
        : `No sell setup · ${v.sellerView === 'BOTH COMPARABLE' ? 'both sides too similar' : 'nothing passes the filters'}`;
  return (
    <Link href="/options/intraday-seller" className="flex items-center gap-3 rounded-[12px] px-2 py-1.5 hover:bg-raised">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${v?.setup ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-2'}`}><Target size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Option seller{v && !v.stop ? ` · ${v.mode === 'NONE' ? 'SIDE: NONE' : v.sellerView}` : ''}</span>
        <span className="block truncate text-[12.5px] text-muted">{text}</span>
      </span>
      <ArrowRight size={14} className="shrink-0 text-muted" />
    </Link>
  );
}

function DayRules({ s, onSave }: { s: DaySettings; onSave: (p: Partial<DaySettings>) => void }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(s);
  useEffect(() => setD(s), [s]);
  const risk = (s.capitalRupees * s.riskPerTradePct) / 100;
  return (
    <div className="rounded-[12px] bg-raised px-3 py-2.5">
      <div className="flex items-start gap-2">
        <dl className="grid flex-1 grid-cols-3 gap-2">
          {([['Risk a trade', `₹${risk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`], ['Stop the day at', `−₹${s.maxDailyLossRupees.toLocaleString('en-IN')}`], ['Max trades', String(s.maxTradesPerDay)]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-[11.5px] text-muted">{k}</dt><dd className="num text-[14px] font-semibold">{v}</dd></div>
          ))}
        </dl>
        <Button variant="ghost" className="h-7 px-2" onClick={() => setEdit((v) => !v)} aria-label="Edit day rules" title="Edit day rules"><Pencil size={13} /></Button>
      </div>
      {edit && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([['Capital ₹', 'capitalRupees'], ['Risk a trade %', 'riskPerTradePct'], ['Max loss a day ₹', 'maxDailyLossRupees'], ['Max trades a day', 'maxTradesPerDay']] as const).map(([label, k]) => (
            <label key={k} className="grid gap-1"><span className="text-[11.5px] text-muted">{label}</span>
              <input type="number" min={0} step="any" value={d[k]} onChange={(e) => setD({ ...d, [k]: Number(e.target.value) })} className={`${inputCls} num h-9`} />
            </label>
          ))}
          <Button variant="primary" className="col-span-2 h-9" onClick={() => { onSave(d); setEdit(false); }}>Save</Button>
        </div>
      )}
    </div>
  );
}
