'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FlaskConical, Layers, Microscope, Plus, X } from 'lucide-react';
import { fetchOverview, type Breadth, type FiiPositions, type IndexCard, type Overview, type StockMove } from '@/lib/dashboard';
import { fmt } from '@/lib/format';
import { fmtDate } from '@/lib/options';
import { RECENT_KEY, readPersisted } from '@/lib/persisted';
import { PULSE_NAMES, chartHref, useShell } from './shell-context';

const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${fmt(Number(v.toFixed(digits)))}`;
const contracts = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-IN')}`;

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
      <div className="mx-auto max-w-[1480px] space-y-2 pb-4">
        <div className="flex items-baseline gap-3 px-1 pt-1">
          <h1 className="text-[20px] font-extrabold tracking-[-0.03em]">Market overview</h1>
          <span className="text-[12.5px] text-muted">{data ? `NSE session of ${fmtDate(data.asOf)} · official end-of-day data` : error ? '' : 'Loading the last NSE session…'}</span>
        </div>
        {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}

        <section aria-label="Indices" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {(data?.indices ?? []).map((c) => <IndexTile key={c.symbol} c={c} />)}
          {!data && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="panel h-[128px] animate-pulse" />)}
        </section>

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
          <WatchlistCard />
          <div className="space-y-2">
            <BreadthCard title="NIFTY 500 breadth" b={data?.nifty500?.breadth} />
            <div className="grid gap-2 sm:grid-cols-2">
              <MoversCard title="NIFTY 50 gainers" rows={data?.nifty50?.gainers} />
              <MoversCard title="NIFTY 50 losers" rows={data?.nifty50?.losers} />
            </div>
          </div>
          <div className="space-y-2">
            <FiiCard loading={!data && !error} fii={data?.fii ?? null} fpi={data?.fpi ?? null} />
            <QuickStart />
            {recent.length > 0 && (
              <section className="panel p-3">
                <h2 className="text-[13px] font-extrabold">Recent charts</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recent.map((s) => <Link key={s} href={chartHref(s)} className="rounded-full bg-raised px-3 py-1 text-[12px] font-semibold hover:bg-line">{PULSE_NAMES[s] ?? s}</Link>)}
                </div>
              </section>
            )}
          </div>
        </div>

        {data && (
          <p className="px-1 text-[11px] leading-snug text-muted">
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
  return (
    <Link href={chartHref(c.symbol)} className="panel block p-3 hover:shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-ink-2">{PULSE_NAMES[c.symbol] ?? c.symbol}</span>
        <span className="text-[10.5px] font-semibold text-muted">NSE</span>
      </div>
      <p className="num mt-1 text-[20px] font-semibold tracking-[-0.01em]">{fmt(c.close)}</p>
      <p className={`num text-[12px] font-semibold ${tone(c.change)}`}>{c.change == null ? '—' : `${signed(c.change)} (${signed(c.changePct!)}%)`}</p>
      <div className="mt-2.5" title={`Day range ${fmt(c.low)} – ${fmt(c.high)}, closed at ${fmt(c.close)}`}>
        <div className="relative h-1.5 rounded-full bg-raised">
          <span className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${at}%` }} />
        </div>
        <div className="num mt-1 flex justify-between text-[10.5px] text-muted"><span>L {fmt(c.low)}</span><span>H {fmt(c.high)}</span></div>
      </div>
    </Link>
  );
}

function WatchlistCard() {
  const { watch, setWatch, quotes, openSearch } = useShell();
  return (
    <section className="panel flex min-h-[320px] flex-col overflow-hidden">
      <div className="flex items-center px-3 pt-3 pb-1.5">
        <h2 className="text-[13px] font-extrabold">My watchlist</h2>
        <button type="button" onClick={() => openSearch('watch')} className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-blue hover:bg-raised"><Plus size={13} /> Add</button>
      </div>
      <table className="num w-full text-[12.5px]">
        <thead className="text-[10.5px] font-bold tracking-[0.05em] text-muted">
          <tr><th className="px-3 py-1 text-left">SYMBOL</th><th className="px-2 text-right">CLOSE</th><th className="px-2 text-right">CHG%</th><th className="w-7" /></tr>
        </thead>
        <tbody>
          {watch.map((s) => {
            const q = quotes[s];
            return (
              <tr key={s} className="group border-t border-line hover:bg-raised">
                <td className="px-3 py-1.5 font-sans font-bold"><Link href={chartHref(s)} className="hover:underline">{PULSE_NAMES[s] ?? s}</Link></td>
                <td className="px-2 text-right">{q ? fmt(q.ltp) : '—'}</td>
                <td className={`px-2 text-right font-semibold ${tone(q?.changePct)}`}>{q ? `${signed(q.changePct)}%` : ''}</td>
                <td className="pr-2 text-right">
                  <button type="button" onClick={() => setWatch(watch.filter((w) => w !== s))} aria-label={`Remove ${s} from watchlist`} className="invisible rounded p-0.5 text-muted group-hover:visible hover:text-down"><X size={13} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function BreadthCard({ title, b }: { title: string; b: Breadth | undefined }) {
  const traded = b ? b.advances + b.declines + b.unchanged : 0;
  return (
    <section className="panel p-3">
      <h2 className="text-[13px] font-extrabold">{title}</h2>
      {!b ? <div className="mt-2 h-10 animate-pulse rounded-[8px] bg-raised" /> : (
        <>
          <p className="mt-1.5 flex gap-4 text-[12.5px] font-semibold">
            <span className="text-up">▲ {b.advances} advanced</span>
            <span className="text-down">▼ {b.declines} declined</span>
            {b.unchanged > 0 && <span className="text-muted">{b.unchanged} unchanged</span>}
          </p>
          <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${b.advances} advanced, ${b.declines} declined, ${b.unchanged} unchanged`}>
            <span className="rounded-full bg-up" style={{ flexGrow: b.advances }} />
            {b.unchanged > 0 && <span className="rounded-full bg-muted" style={{ flexGrow: b.unchanged }} />}
            <span className="rounded-full bg-down" style={{ flexGrow: b.declines }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
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
    <section className="panel overflow-hidden">
      <h2 className="px-3 pt-3 pb-1.5 text-[13px] font-extrabold">{title}</h2>
      {!rows ? <div className="mx-3 mb-3 h-[150px] animate-pulse rounded-[8px] bg-raised" /> : rows.length === 0 ? <p className="px-3 pb-3 text-[12px] text-muted">None that day.</p> : (
        <table className="num w-full text-[12.5px]">
          <tbody>
            {rows.map((m) => (
              <tr key={m.symbol} className="border-t border-line hover:bg-raised">
                <td className="px-3 py-1.5 font-sans font-bold"><Link href={chartHref(m.symbol)} className="hover:underline">{m.symbol}</Link></td>
                <td className="px-2 text-right">{fmt(m.close)}</td>
                <td className={`px-3 text-right font-semibold ${tone(m.changePct)}`}>{signed(m.changePct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <section className="panel p-3">
      <div className="flex items-baseline">
        <h2 className="text-[13px] font-extrabold">FII footprint</h2>
        {l && <span className="ml-2 text-[11px] text-muted">{fmtDate(l.date)}</span>}
        <Link href="/research/fii" className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-blue hover:underline">History <ArrowRight size={12} /></Link>
      </div>
      {!l ? (loading ? <div className="mt-2 h-[104px] animate-pulse rounded-[10px] bg-raised" /> : <p className="mt-2 text-[12px] text-muted">No participant data yet.</p>) : (
        <dl className="num mt-2 grid grid-cols-2 gap-1.5 text-[12px]">
          <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><dt className="font-sans text-[11px] text-muted">Index futures, net</dt><dd className={`text-[14px] font-semibold ${tone(net)}`}>{contracts(net)}</dd></div>
          <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><dt className="font-sans text-[11px] text-muted">Change on the day</dt><dd className={`text-[14px] font-semibold ${tone(change)}`}>{change == null ? '—' : contracts(change)}</dd></div>
          <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><dt className="font-sans text-[11px] text-muted">Long share of futures</dt><dd className="text-[14px] font-semibold">{longPct == null ? '—' : `${longPct.toFixed(1)}%`}</dd></div>
          <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><dt className="font-sans text-[11px] text-muted">Index options, net calls / puts</dt><dd className="text-[12.5px] font-semibold"><span className={tone(l.callLong - l.callShort)}>{contracts(l.callLong - l.callShort)}</span> / <span className={tone(l.putLong - l.putShort)}>{contracts(l.putLong - l.putShort)}</span></dd></div>
        </dl>
      )}
      {fpi && (
        <p className="mt-2 text-[12px] text-ink-2">
          FPI equity, net: <b className={`num ${tone(fpi.netCr)}`}>{signed(fpi.netCr)} Cr</b> <span className="text-muted">(NSDL, reported {fmtDate(fpi.reportDate)})</span>
        </p>
      )}
      <p className="mt-1 text-[10.5px] text-muted">Contracts, from NSE&rsquo;s participant-wise open interest. Long minus short; not a forecast.</p>
    </section>
  );
}

function QuickStart() {
  const items = [
    { href: '/options', icon: Layers, title: 'Simulate an option strategy', text: 'Build on a past day, follow it to expiry' },
    { href: '/research/study', icon: Microscope, title: 'Run a condition study', text: 'What followed, year by year' },
    { href: '/backtest', icon: FlaskConical, title: 'Backtest a strategy', text: 'Indicator rules with real charges' },
  ];
  return (
    <section className="panel p-1.5">
      {items.map(({ href, icon: Icon, title, text }) => (
        <Link key={href} href={href} className="flex items-center gap-3 rounded-[11px] px-2 py-2 hover:bg-raised">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-deep text-accent"><Icon size={17} aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold">{title}</span>
            <span className="block truncate text-[11.5px] text-muted">{text}</span>
          </span>
          <ArrowRight size={14} className="ml-auto shrink-0 text-muted" />
        </Link>
      ))}
    </section>
  );
}
