'use client';

// The first app's dashboard tiles, on the Today page: index tiles with a 3-month sparkline and the day's range, the
// watchlist, NIFTY 500 breadth, NIFTY 50 movers, the FII footprint, quick start and recent charts.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FlaskConical, Layers, Plus, ScanSearch, TrendingDown, TrendingUp, X } from 'lucide-react';
import { PULSE_NAMES, chartHref, useShell } from '@/components/app/shell-context';
import { fetchCandles, keepAnswer, lastAnswer } from '@/lib/feed';
import { fmt } from '@/lib/format';
import { fmtDate } from '@/lib/options';
import { RECENT_KEY, readPersisted } from '@/lib/persisted';
import type { Breadth, FiiPositions, IndexCard, StockMove } from '@/lib/today';

const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${fmt(Number(v.toFixed(digits)))}`;
const contracts = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-IN')}`;

/** Two-letter symbol tile used in lists. */
const Tick = ({ s }: { s: string }) => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft font-sans text-[11px] font-bold text-accent-deep" aria-hidden="true">{s.slice(0, 2)}</span>
);

const SPARK_DAYS = 63; // about three months of sessions
type Spark = { date: string; close: number }[];

/** The last ~3 months of daily closes as a small area chart: green if the index is up over the period, red if down. */
function Sparkline({ symbol }: { symbol: string }) {
  const key = `spark/${symbol}`;
  const [closes, setCloses] = useState<Spark | null>(null);
  useEffect(() => {
    setCloses(lastAnswer<Spark>(key)?.data ?? null); // the last one this browser saw, at once
    const ctrl = new AbortController();
    fetchCandles(symbol, 'D', ctrl.signal).then(
      (r) => {
        const s = r.candles.slice(-SPARK_DAYS).map((k) => ({ date: new Date((k.time + 5.5 * 3600) * 1000).toISOString().slice(0, 10), close: k.close }));
        keepAnswer(key, s);
        setCloses(s);
      },
      () => { if (!ctrl.signal.aborted) setCloses((c) => c ?? []); },
    );
    return () => ctrl.abort();
  }, [symbol, key]);
  if (!closes) return <div className="h-12 w-full animate-pulse rounded-[8px] bg-raised" aria-hidden="true" />;
  if (closes.length < 2) return <div className="h-12" aria-hidden="true" />;
  const W = 160, H = 48, v = closes.map((x) => x.close);
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, 3 + (1 - (y - lo) / r) * (H - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const change = ((v[v.length - 1] - v[0]) / v[0]) * 100;
  const color = change >= 0 ? 'var(--color-up)' : 'var(--color-down)';
  const id = `sp-${symbol}`;
  return (
    <div className="relative">
      <span className={`num absolute -top-4 right-0 text-[10.5px] font-semibold ${change >= 0 ? 'text-up' : 'text-down'}`}>3M {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(1)}%</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-12 w-full" role="img"
        aria-label={`${closes[0].date} to ${closes[closes.length - 1].date}: ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}%`}>
        <title>{`3 months (${closes[0].date} → ${closes[closes.length - 1].date}): ${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`}</title>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Live numbers from the brief, when the session is on; the tile then shows them in place of the last close. */
export type LiveQuote = { ltp: number; changePct: number; high: number; low: number };

export function IndexTile({ c, live, note }: { c: IndexCard; live?: LiveQuote | null; note?: string }) {
  const close = live?.ltp ?? c.close, high = live?.high ?? c.high, low = live?.low ?? c.low;
  const changePct = live?.changePct ?? c.changePct;
  const change = live ? (c.close * live.changePct) / 100 : c.change; // c is the last session, so its close is the previous close
  const span = high - low;
  const at = span > 0 ? ((close - low) / span) * 100 : 50;
  const Trend = (change ?? 0) < 0 ? TrendingDown : TrendingUp;
  return (
    <Link href={chartHref(c.symbol)} className="panel block min-w-0 p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">
      <div className="card-head !mb-3 !pb-3">
        <span className="truncate text-[15px] font-semibold">{PULSE_NAMES[c.symbol] ?? c.symbol}</span>
        {live ? <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-up"><span className="live-dot h-1.5 w-1.5 rounded-full bg-up" />Live</span>
          : <span className="ml-auto text-[11px] font-semibold text-muted">NSE</span>}
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0 shrink-0">
          <p className="num text-[20px] font-bold tracking-[-0.02em]">{fmt(close)}</p>
          <p className={`num mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold ${tone(change)}`}>
            {change != null && <Trend size={14} aria-hidden="true" />}
            {change == null || changePct == null ? '—' : `${signed(change)} (${signed(changePct)}%)`}
          </p>
        </div>
        <div className="min-w-[96px] flex-1 basis-[96px]"><Sparkline symbol={c.symbol} /></div>
      </div>
      <div className="mt-3" title={`Day range ${fmt(low)} – ${fmt(high)}, ${live ? 'now' : 'closed'} at ${fmt(close)}`}>
        <div className="relative h-1.5 rounded-full bg-raised">
          <span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${at}%` }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted"><span>L {fmt(low)}</span><span>H {fmt(high)}</span></div>
      </div>
      {note && <p className="mt-2 text-[11.5px] text-muted">{note}</p>}
    </Link>
  );
}

export function WatchlistCard() {
  const { watch, setWatch, quotes, openSearch } = useShell();
  return (
    <section className="panel flex min-h-[320px] flex-col p-5">
      <div className="card-head">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">My watchlist</h2>
        <button type="button" onClick={() => openSearch('watch')} className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-deep hover:bg-accent-soft"><Plus size={14} /> Add</button>
      </div>
      <ul className="-mx-2 flex flex-col">
        {watch.map((s) => {
          const q = quotes[s];
          return (
            <li key={s} className="group flex items-center gap-3 rounded-[12px] border-t border-line px-2 py-2.5 first:border-t-0 hover:bg-raised">
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

export function BreadthCard({ title, b }: { title: string; b: Breadth | undefined }) {
  const traded = b ? b.advances + b.declines + b.unchanged : 0;
  return (
    <section className="panel p-5">
      <div className="card-head"><h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2></div>
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
          {b.members != null && (
            <p className="mt-2 text-[12px] text-muted">
              {traded} of {b.members} stocks traded that day
              {b.notTraded && b.notTraded.length > 0 && <span title={b.notTraded.join(', ')}> · {b.notTraded.length} with no bar that day (suspended, renamed or not in our history)</span>}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function MoversCard({ title, rows }: { title: string; rows: StockMove[] | undefined }) {
  return (
    <section className="panel p-5">
      <div className="card-head"><h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2></div>
      {!rows ? <div className="h-[200px] animate-pulse rounded-[12px] bg-raised" /> : rows.length === 0 ? <p className="text-[13px] text-muted">None that day.</p> : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((m) => (
            <li key={m.symbol} className="flex items-center gap-3 rounded-[12px] border-t border-line px-2 py-2 first:border-t-0 hover:bg-raised">
              <Tick s={m.symbol} />
              <Link href={chartHref(m.symbol)} className="min-w-0 flex-1 truncate text-[13.5px] font-semibold hover:underline">{m.symbol}</Link>
              <span className="num text-right">
                {m.close != null && <span className="block text-[13.5px] font-semibold">{fmt(m.close)}</span>}
                <span className={`block text-[12px] font-semibold ${tone(m.changePct)}`}>{signed(m.changePct)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FiiCard({ fii, fpi }: { fii: { latest: FiiPositions; previous: FiiPositions | null } | null; fpi: { reportDate: string; netCr: number } | null }) {
  const l = fii?.latest, p = fii?.previous;
  const net = l ? l.futLong - l.futShort : 0;
  const longPct = l && l.futLong + l.futShort ? (l.futLong / (l.futLong + l.futShort)) * 100 : null;
  const change = l && p ? net - (p.futLong - p.futShort) : null;
  return (
    <section className="panel p-5">
      <div className="card-head">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">FII footprint</h2>
        {l && <span className="text-[12px] text-muted">{fmtDate(l.date)}</span>}
        <Link href="/research/fii" className="ml-auto flex items-center gap-1 text-[13px] font-semibold text-accent-deep hover:underline">History <ArrowRight size={13} /></Link>
      </div>
      {!l ? <p className="text-[13px] text-muted">No participant data yet.</p> : (
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

export function QuickStart() {
  const items = [
    { href: '/screener', icon: ScanSearch, title: 'Screener', text: 'Find stocks that match your conditions' },
    { href: '/strategies', icon: FlaskConical, title: 'Strategies', text: 'Build and backtest a trading plan' },
    { href: '/options', icon: Layers, title: 'Option simulator', text: 'Replay an option trade from a past date' },
  ];
  return (
    <section className="panel p-5">
      <div className="card-head"><h2 className="text-[16px] font-semibold tracking-[-0.01em]">Quick start</h2></div>
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

export function RecentCharts() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readPersisted<string[]>(RECENT_KEY, [])), []);
  if (!recent.length) return null;
  return (
    <section className="panel p-5">
      <div className="card-head"><h2 className="text-[16px] font-semibold tracking-[-0.01em]">Recent charts</h2></div>
      <div className="flex flex-wrap gap-2">
        {recent.map((s) => <Link key={s} href={chartHref(s)} className="rounded-full bg-raised px-3.5 py-1.5 text-[13px] font-semibold hover:bg-accent-soft hover:text-accent-deep">{PULSE_NAMES[s] ?? s}</Link>)}
      </div>
    </section>
  );
}
