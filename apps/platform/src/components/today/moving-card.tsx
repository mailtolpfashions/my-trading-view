'use client';

// "Stocks moving" on Today: NIFTY 50 gainers, losers and NIFTY 500 sudden volume behind one set of tabs. A row opens
// the chart; the + on hover adds the stock to the watchlist.

import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import { chartHref, useShell } from '@/components/app/shell-context';
import { InfoTip } from '@/components/info-tip';
import { fmt } from '@/lib/format';
import { usePersisted } from '@/lib/persisted';
import type { Brief, StockMove } from '@/lib/today';
import { tone } from './market-tiles';

type Tab = 'up' | 'down' | 'volume';
const TABS: { value: Tab; label: string }[] = [{ value: 'up', label: 'Gainers' }, { value: 'down', label: 'Losers' }, { value: 'volume', label: 'Volume' }];

export function MovingCard({ gainers, losers, spikes, scanning }: { gainers: StockMove[] | undefined; losers: StockMove[] | undefined; spikes: Brief['volumeSpikes']; scanning: boolean }) {
  const [tab, setTab] = usePersisted<Tab>('mtv.today.moving', 'up');
  const { watch, setWatch, notify } = useShell();
  const rows: { symbol: string; price?: number; changePct: number; extra?: string }[] | undefined =
    tab === 'volume' ? spikes.map((v) => ({ symbol: v.symbol, price: v.close, changePct: v.changePct, extra: `${v.rvol.toFixed(1)}× vol` }))
      : (tab === 'up' ? gainers : losers)?.map((m) => ({ symbol: m.symbol, price: m.close, changePct: m.changePct }));
  const add = (s: string) => { if (!watch.includes(s)) { setWatch([...watch, s]); notify(`${s} added to the watchlist`); } };
  const idx = TABS.findIndex((t) => t.value === tab);

  return (
    <section className="panel flex min-h-0 flex-col p-5">
      <div className="card-head !mb-3 !pb-3">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Stocks moving</h2>
        <InfoTip label="Where these come from">Gainers and losers: NIFTY 50, last session. Volume: NIFTY 500 stocks trading far more than usual; during the session, volume so far against the same time on the previous 20 sessions, after it the last session against its 20-day average.</InfoTip>
      </div>
      <div role="tablist" aria-label="Stocks moving" className="relative mb-2 grid grid-cols-3 rounded-[12px] bg-raised p-1 text-[13px] font-semibold">
        <span aria-hidden="true" className="absolute top-1 bottom-1 left-1 rounded-[9px] bg-panel shadow-[var(--shadow-panel)] transition-transform duration-200 motion-reduce:transition-none"
          style={{ width: 'calc((100% - 0.5rem) / 3)', transform: `translateX(${idx * 100}%)` }} />
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
            className={`relative z-10 h-8 rounded-[9px] ${tab === t.value ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>{t.label}</button>
        ))}
      </div>
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
        {!rows ? Array.from({ length: 5 }, (_, i) => <li key={i} className="mx-2 my-1.5 h-8 animate-pulse rounded-[8px] bg-raised" />)
          : rows.length === 0 ? <li className="px-2 py-4 text-[13px] text-muted">{tab === 'volume' && scanning ? 'Checking volumes across NIFTY 500… this takes a minute.' : tab === 'volume' ? 'No stock is trading far above its usual volume.' : 'None that day.'}</li>
            : rows.map((r) => {
              const has = watch.includes(r.symbol);
              return (
                <li key={r.symbol} className="group flex items-center gap-1 rounded-[10px] px-2 hover:bg-raised">
                  <Link href={chartHref(r.symbol)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-[13.5px]">
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.symbol}</span>
                    {r.extra && <span className="num rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent-deep">{r.extra}</span>}
                    {r.price != null && <span className="num w-[72px] text-right text-ink-2">{fmt(r.price)}</span>}
                    <span className={`num w-[58px] text-right font-semibold ${tone(r.changePct)}`}>{r.changePct > 0 ? '+' : ''}{r.changePct.toFixed(2)}%</span>
                  </Link>
                  <button type="button" onClick={() => add(r.symbol)} disabled={has} title={has ? 'In your watchlist' : 'Add to watchlist'} aria-label={has ? `${r.symbol} is in your watchlist` : `Add ${r.symbol} to watchlist`}
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-[6px] ${has ? 'text-up' : 'text-accent-deep opacity-0 hover:bg-accent-soft focus:opacity-100 group-hover:opacity-100'}`}>
                    {has ? <Check size={13} /> : <Plus size={14} />}
                  </button>
                </li>
              );
            })}
      </ul>
    </section>
  );
}
