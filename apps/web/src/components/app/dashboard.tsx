'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CandlestickChart, FlaskConical, Layers, Microscope, Plus, TrendingDown, TrendingUp, X } from 'lucide-react';
import { fetchOverview, type Breadth, type FiiPositions, type IndexCard, type Overview, type StockMove } from '@/lib/dashboard';
import { fmt } from '@/lib/format';
import { fmtDate } from '@/lib/options';
import { RECENT_KEY, readPersisted } from '@/lib/persisted';
import { PULSE_NAMES, chartHref, useShell } from './shell-context';

const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${fmt(Number(v.toFixed(digits)))}`;
const contracts = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-IN')}`;

/** Two-letter symbol tile used in lists. */
const Tick = ({ s }: { s: string }) => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft font-sans text-[11px] font-bold text-accent-deep" aria-hidden="true">{s.slice(0, 2)}</span>
);

/**
 * Dashboard: the last NSE session at a glance. Every number comes from NSE's (or NSDL's) published files, shown with
 * its date; nothing here is live, simulated or predicted.
 */
export function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchOverview(ctrl.signal).then(setData, (e: Error) => { if (e.name !== 'AbortError') setError(e.message); });
    setRecent(readPersisted<string[]>(RECENT_KEY, []));
    return () => ctrl.abort();
  }, []);

  return (
    <div className="min-h-0 overflow-auto">
      <div className="mx-auto max-w-[1520px] space-y-5 pb-6">
        <div className="flex flex-wrap items-end gap-3 pt-3">
          <div>
            <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] sm:text-[34px]">Market overview</h1>
            <p className="mt-1 text-[14px] text-muted">{data ? `NSE closing data for ${fmtDate(data.asOf)}` : error ? '' : 'Loading…'}</p>
          </div>
          <div className="ml-auto flex gap-2.5">
            <Link href={chartHref('NIFTY')} className="flex h-11 items-center gap-2 rounded-[12px] bg-inverse px-5 text-[14px] font-semibold text-on-inverse hover:bg-inverse-hover">
              <CandlestickChart size={17} aria-hidden="true" /> Open chart
            </Link>
            <Link href="/backtest" className="flex h-11 items-center rounded-[12px] border border-accent px-5 text-[14px] font-semibold text-accent-deep hover:bg-accent-soft">Run backtest</Link>
          </div>
        </div>
        {error && <p role="alert" className="rounded-[14px] bg-down-soft px-4 py-3 text-[13.5px] font-semibold text-down">{error}</p>}

        <section aria-label="Indices" className="grid grid-cols-2 gap-5 md:grid-cols-3 2xl:grid-cols-6">
          {(data?.indices ?? []).map((c) => <IndexTile key={c.symbol} c={c} />)}
          {!data && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="panel h-[176px] animate-pulse" />)}
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <WatchlistCard />
          <div className="space-y-5">
            <BreadthCard title="NIFTY 500 breadth" b={data?.nifty500?.breadth} />
            <div className="grid gap-5 sm:grid-cols-2">
              <MoversCard title="NIFTY 50 gainers" rows={data?.nifty50?.gainers} />
              <MoversCard title="NIFTY 50 losers" rows={data?.nifty50?.losers} />
            </div>
          </div>
          <div className="space-y-5">
            <FiiCard loading={!data && !error} fii={data?.fii ?? null} fpi={data?.fpi ?? null} />
            <QuickStart />
            {recent.length > 0 && (
              <section className="panel p-6">
                <div className="card-head"><h2 className="text-[17px] font-semibold">Recent charts</h2></div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((s) => <Link key={s} href={chartHref(s)} className="rounded-full bg-raised px-3.5 py-1.5 text-[13px] font-semibold hover:bg-accent-soft hover:text-accent-deep">{PULSE_NAMES[s] ?? s}</Link>)}
                </div>
              </section>
            )}
          </div>
        </div>

        {data && (
          <p className="text-[12px] leading-snug text-muted">
            Sources: {Object.values(data.sources).join('; ')}. NIFTY 50 and NIFTY 500 use NSE&rsquo;s current constituent lists. Research data, not investment advice.
          </p>
        )}
      </div>
    </div>
  );
}

function IndexTile({ c }: { c: IndexCard }) {
  const span = c.high - c.low;
  const at = span > 0 ? ((c.close - c.low) / span) * 100 : 50;
  const Trend = (c.change ?? 0) < 0 ? TrendingDown : TrendingUp;
  return (
    <Link href={chartHref(c.symbol)} className="panel block p-5 transition-shadow hover:shadow-[var(--shadow-pop)]">
      <div className="card-head !mb-3 !pb-3">
        <span className="truncate text-[15.5px] font-semibold">{PULSE_NAMES[c.symbol] ?? c.symbol}</span>
        <span className="ml-auto text-[11px] font-semibold text-muted">NSE</span>
      </div>
      <p className="num text-[23px] font-bold tracking-[-0.02em]">{fmt(c.close)}</p>
      <p className={`num mt-1 flex items-center gap-1.5 text-[13px] font-semibold ${tone(c.change)}`}>
        {c.change != null && <Trend size={15} aria-hidden="true" />}
        {c.change == null ? '—' : `${signed(c.change)} (${signed(c.changePct!)}%)`}
      </p>
      <div className="mt-3" title={`Day range ${fmt(c.low)} – ${fmt(c.high)}, closed at ${fmt(c.close)}`}>
        <div className="relative h-1.5 rounded-full bg-raised">
          <span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${at}%` }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted"><span>L {fmt(c.low)}</span><span>H {fmt(c.high)}</span></div>
      </div>
    </Link>
  );
}

function WatchlistCard() {
  const { watch, setWatch, quotes, openSearch } = useShell();
  return (
    <section className="panel flex min-h-[320px] flex-col p-6">
      <div className="card-head">
        <h2 className="text-[17px] font-semibold">My watchlist</h2>
        <button type="button" onClick={() => openSearch('watch')} className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-deep hover:bg-accent-soft"><Plus size={14} /> Add</button>
      </div>
      <ul className="-mx-2 flex flex-col">
        {watch.map((s) => {
          const q = quotes[s];
          return (
            <li key={s} className="group flex items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-raised border-t border-line first:border-t-0">
              <Tick s={PULSE_NAMES[s] ?? s} />
              <Link href={chartHref(s)} className="min-w-0 flex-1 truncate text-[14px] font-semibold hover:underline">{PULSE_NAMES[s] ?? s}</Link>
              <span className="num text-right">
                <span className="block text-[14px] font-semibold">{q ? fmt(q.ltp) : '—'}</span>
                <span className={`block text-[12px] font-semibold ${tone(q?.changePct)}`}>{q ? `${signed(q.changePct)}%` : ''}</span>
              </span>
              <button type="button" onClick={() => setWatch(watch.filter((w) => w !== s))} aria-label={`Remove ${s} from watchlist`} className="invisible rounded p-0.5 text-muted group-hover:visible hover:text-down"><X size={14} /></button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BreadthCard({ title, b }: { title: string; b: Breadth | undefined }) {
  const traded = b ? b.advances + b.declines + b.unchanged : 0;
  return (
    <section className="panel p-6">
      <div className="card-head"><h2 className="text-[17px] font-semibold">{title}</h2></div>
      {!b ? <div className="h-[92px] animate-pulse rounded-[12px] bg-raised" /> : (
        <>
          <p className="flex items-baseline gap-2.5">
            <b className="num text-[30px] font-bold tracking-[-0.02em]">{b.advances}</b>
            <span className="text-[14px] text-muted">advanced of {traded} traded</span>
          </p>
          <div className="mt-3 flex h-3 gap-[3px] overflow-hidden rounded-full" role="img" aria-label={`${b.advances} advanced, ${b.declines} declined, ${b.unchanged} unchanged`}>
            <span className="rounded-full bg-up" style={{ flexGrow: b.advances }} />
            {b.unchanged > 0 && <span className="rounded-full bg-muted" style={{ flexGrow: b.unchanged }} />}
            <span className="rounded-full bg-down" style={{ flexGrow: b.declines }} />
          </div>
          <p className="num mt-2.5 flex justify-between text-[13px] text-muted">
            <span><b className="text-up">{b.advances}</b> up</span>
            {b.unchanged > 0 && <span><b className="text-ink">{b.unchanged}</b> unchanged</span>}
            <span><b className="text-down">{b.declines}</b> down</span>
          </p>
          <p className="mt-2 text-[12px] text-muted">
            {traded} of {b.members} stocks traded that day
            {b.notTraded.length > 0 && <span title={b.notTraded.join(', ')}> · {b.notTraded.length} with no bar that day (suspended, renamed or not in our history)</span>}
          </p>
        </>
      )}
    </section>
  );
}

function MoversCard({ title, rows }: { title: string; rows: StockMove[] | undefined }) {
  return (
    <section className="panel p-6">
      <div className="card-head"><h2 className="text-[17px] font-semibold">{title}</h2></div>
      {!rows ? <div className="h-[200px] animate-pulse rounded-[12px] bg-raised" /> : rows.length === 0 ? <p className="text-[13px] text-muted">None that day.</p> : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((m) => (
            <li key={m.symbol} className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-raised border-t border-line first:border-t-0">
              <Tick s={m.symbol} />
              <Link href={chartHref(m.symbol)} className="min-w-0 flex-1 truncate text-[13.5px] font-semibold hover:underline">{m.symbol}</Link>
              <span className="num text-right">
                <span className="block text-[13.5px] font-semibold">{fmt(m.close)}</span>
                <span className={`block text-[12px] font-semibold ${tone(m.changePct)}`}>{signed(m.changePct)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FiiCard({ loading, fii, fpi }: { loading: boolean; fii: { latest: FiiPositions; previous: FiiPositions | null } | null; fpi: { reportDate: string; netCr: number } | null }) {
  const l = fii?.latest, p = fii?.previous;
  const net = l ? l.futLong - l.futShort : 0;
  const longPct = l && l.futLong + l.futShort ? (l.futLong / (l.futLong + l.futShort)) * 100 : null;
  const change = l && p ? net - (p.futLong - p.futShort) : null;
  return (
    <section className="panel p-6">
      <div className="card-head">
        <h2 className="text-[17px] font-semibold">FII footprint</h2>
        {l && <span className="text-[12px] text-muted">{fmtDate(l.date)}</span>}
        <Link href="/research/fii" className="ml-auto flex items-center gap-1 text-[13px] font-semibold text-accent-deep hover:underline">History <ArrowRight size={13} /></Link>
      </div>
      {!l ? (loading ? <div className="h-[128px] animate-pulse rounded-[12px] bg-raised" /> : <p className="text-[13px] text-muted">No participant data yet.</p>) : (
        <dl className="num grid grid-cols-2 gap-2.5 text-[12px]">
          <div className="rounded-[14px] bg-raised px-3.5 py-2.5"><dt className="font-sans text-[12px] text-muted">Index futures, net</dt><dd className={`mt-0.5 text-[16px] font-bold ${tone(net)}`}>{contracts(net)}</dd></div>
          <div className="rounded-[14px] bg-raised px-3.5 py-2.5"><dt className="font-sans text-[12px] text-muted">Change on the day</dt><dd className={`mt-0.5 text-[16px] font-bold ${tone(change)}`}>{change == null ? '—' : contracts(change)}</dd></div>
          <div className="rounded-[14px] bg-raised px-3.5 py-2.5"><dt className="font-sans text-[12px] text-muted">Long share of futures</dt><dd className="mt-0.5 text-[16px] font-bold">{longPct == null ? '—' : `${longPct.toFixed(1)}%`}</dd></div>
          <div className="rounded-[14px] bg-raised px-3.5 py-2.5"><dt className="font-sans text-[12px] text-muted">Index options, net calls / puts</dt><dd className="mt-0.5 text-[14px] font-bold"><span className={tone(l.callLong - l.callShort)}>{contracts(l.callLong - l.callShort)}</span> / <span className={tone(l.putLong - l.putShort)}>{contracts(l.putLong - l.putShort)}</span></dd></div>
        </dl>
      )}
      {fpi && (
        <p className="mt-3 text-[13px] text-ink-2">
          FPI equity, net: <b className={`num ${tone(fpi.netCr)}`}>{signed(fpi.netCr)} Cr</b> <span className="text-muted">(NSDL, reported {fmtDate(fpi.reportDate)})</span>
        </p>
      )}
      <p className="mt-1.5 text-[11.5px] text-muted">In contracts. Source: NSE participant-wise open interest.</p>
    </section>
  );
}

function QuickStart() {
  const items = [
    { href: '/options', icon: Layers, title: 'Option simulator', text: 'Replay an option trade from a past date' },
    { href: '/research/study', icon: Microscope, title: 'Condition study', text: 'What happened after a signal, by year' },
    { href: '/backtest', icon: FlaskConical, title: 'Backtest', text: 'Test indicator rules with real charges' },
  ];
  return (
    <section className="panel p-6">
      <div className="card-head"><h2 className="text-[17px] font-semibold">Quick start</h2></div>
      <div className="-mx-2 flex flex-col gap-1">
        {items.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="flex items-center gap-3.5 rounded-[14px] px-2 py-2.5 hover:bg-raised">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-deep"><Icon size={19} aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">{title}</span>
              <span className="block truncate text-[12.5px] text-muted">{text}</span>
            </span>
            <ArrowRight size={15} className="ml-auto shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </section>
  );
}
