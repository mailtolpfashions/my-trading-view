'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AreaChart, BarChart3, CandlestickChart, Check, ChevronDown, LineChart, PlugZap, Search, TrendingUp } from 'lucide-react';
import { mergeTick } from '@mtv/indicators';
import { marketSession, type Candle, type DataQuality, type Instrument, type MarketSession, type Timeframe } from '@mtv/shared';
import { LogoMark } from '@/components/logo';
import { STUDIES } from '@/lib/chart/studies';
import { FEED_URL, feedFetch, fetchCandles, useQuotes } from '@/lib/feed';
import { fmt, tfLabel } from '@/lib/format';
import { BacktestModule } from '@/components/backtest/backtest-module';
import { OptionsView } from '@/components/options/options-view';
import { ScannerView } from '@/components/signals/scanner-view';
import { SignalsSide, SignalsView } from '@/components/signals/signals-view';
import { ChartView, type ChartType } from './chart-view';
import { DataCheck } from './data-check';
import { OrderTicket, type TicketRequest } from './order-ticket';
import { PaperPanel } from './paper-panel';
import { SymbolSearch } from './symbol-search';
import { UserMenu, type TerminalUser } from './user-menu';
import { Watchlist } from './watchlist';

type Sym = Pick<Instrument, 'symbol' | 'name' | 'exchange'>;

const INDICES = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'NIFTYIT', 'INDIAVIX', 'SENSEX']);
const PULSE = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'MIDCPNIFTY', 'INDIAVIX'];
const PULSE_NAMES: Record<string, string> = { NIFTY: 'NIFTY 50', MIDCPNIFTY: 'MIDCAP SEL', INDIAVIX: 'INDIA VIX' };
const DEFAULT_WATCH = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'INDIAVIX', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'BHARTIARTL', 'ITC', 'LT', 'AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 'MARUTI'];
const TFS: Timeframe[] = ['1', '5', '15', '30', '60', 'D', 'W'];
const MODULES = ['Chart', 'Option chain', 'Futures', 'Signals', 'Backtest', 'Paper', 'Algo', 'Research'];
const LIVE_MODULES = ['Chart', 'Option chain', 'Signals', 'Backtest', 'Research'];
const DAY = 86400;
const RANGES: [label: string, tf: Timeframe, seconds: number | (() => number)][] = [
  ['1D', '1', DAY], ['5D', '5', 7 * DAY], ['1M', '30', 31 * DAY], ['3M', '60', 92 * DAY], ['6M', '60', 183 * DAY],
  ['YTD', 'D', () => Date.now() / 1000 - Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000], ['1Y', 'D', 365 * DAY], ['5Y', 'W', 5 * 365 * DAY], ['All', 'W', 1e10],
];
const CHART_TYPES: [ChartType, string, typeof CandlestickChart][] = [
  ['candles', 'Candles', CandlestickChart], ['ha', 'Heikin Ashi', CandlestickChart], ['bars', 'Bars', BarChart3], ['line', 'Line', LineChart], ['area', 'Area', AreaChart],
];

/** Per-viewer preferences kept in this browser only; the page works fine without them. */
function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw));
    } catch { /* storage unavailable */ }
  }, [key]);
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [key]);
  return [v, set];
}

/** `user` is null on the public chart page: a visitor without an account sees delayed charts only. */
export function Terminal({ user }: { user: TerminalUser | null }) {
  const [sym, setSym] = usePersisted<Sym>('mtv.symbol', { symbol: 'NIFTY', name: 'NIFTY 50', exchange: 'NSE' });
  const [tf, setTf] = usePersisted<Timeframe>('mtv.tf', '5');
  const [chartType, setChartType] = usePersisted<ChartType>('mtv.chartType', 'candles');
  const [studies, setStudies] = usePersisted<string[]>('mtv.studies', ['vwap', 'st', 'rsi']);
  const [watch, setWatch] = usePersisted<string[]>('mtv.watchlist', DEFAULT_WATCH);
  const [data, setData] = useState<{ candles: Candle[]; key: string; for: string; quality: DataQuality | null }>({ candles: [], key: '', for: '', quality: null });
  const [visibleSeconds, setVisibleSeconds] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState<null | 'chart' | 'watch'>(null);
  const [menu, setMenu] = useState<null | 'type' | 'ind'>(null);
  const [side, setSide] = useState<'watch' | 'chain' | 'signals' | 'scanner'>('watch');
  const [notice, setNotice] = useState<string | null>(null);
  const [module, setModule] = useState('Chart');
  /** Feature a visitor tried to use (shows the "create a free account" prompt). */
  const [guestPrompt, setGuestPrompt] = useState<string | null>(null);

  const subscribed = useMemo(() => [...new Set([...PULSE, ...watch, sym.symbol])], [watch, sym.symbol]);
  const { quotes, status, session: feedSession, connected, paper } = useQuotes(subscribed);
  const delayed = status?.delayed ?? true;
  const [ticket, setTicket] = useState<TicketRequest | null>(null);
  const openTicket = (side: 'BUY' | 'SELL') => {
    if (!user) return setGuestPrompt('Paper trading');
    if (INDICES.has(sym.symbol)) return setNotice(`${sym.symbol} is an index and can't be traded directly. Pick a stock to paper trade.`);
    setTicket({ symbol: sym.symbol, side, ltp: quotes[sym.symbol]?.ltp ?? data.candles.at(-1)?.close });
  };
  const chartPositions = (paper?.positions ?? []).filter((p) => p.symbol === sym.symbol && p.qty !== 0);

  // ---- history for the current symbol/timeframe ----
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchCandles(sym.symbol, tf, ctrl.signal)
      .then((r) => setData({ candles: r.candles, key: `${sym.symbol}:${tf}:${Date.now()}`, for: `${sym.symbol}:${tf}`, quality: r.quality }))
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [sym.symbol, tf, status?.provider]); // reload from the new source when Kite connects or its session expires

  // ---- Kite connection (daily login) ----
  const [kite, setKite] = useState<{ selected: boolean; configured: boolean; loggedIn: boolean; userName: string | null } | null>(null);
  useEffect(() => {
    feedFetch(`${FEED_URL}/api/kite/status`).then((r) => r.json()).then(setKite, () => setKite(null));
  }, [status?.provider]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('kite');
    if (!result) return;
    setNotice(result === 'connected' ? 'Kite connected: live prices are on' : result === 'cancelled' ? 'Kite login cancelled' : 'Kite login failed. Please try again.');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // ---- Free users on a live source get a second-by-second replay 15 minutes behind. Until the server has
  // recorded 15 minutes of ticks (just after it starts) prices come once a minute; meanwhile reload the server's
  // complete candles (real OHLC from 1-minute data) so bars are never drawn flat. ----
  const delayedLive = delayed && status?.provider === 'kite';
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  useEffect(() => {
    if (!delayedLive) return;
    const want = `${sym.symbol}:${tf}`;
    const id = setInterval(() => {
      const last = quotesRef.current[sym.symbol];
      const replaying = last && Date.now() / 1000 - last.time < 905; // replay prices are ~900 s old
      if (replaying) return;
      fetchCandles(sym.symbol, tf).then(
        (r) => setData((d) => (d.for === want ? { ...d, candles: r.candles, quality: r.quality } : d)), // same key keeps the zoom
        () => {},
      );
    }, 20_000);
    return () => clearInterval(id);
  }, [delayedLive, sym.symbol, tf]);

  // ---- live bar from streamed quotes (for Free users on a live source, the 15-minute-delayed replay) ----
  const q = quotes[sym.symbol];
  useEffect(() => {
    if (!q?.time || data.for !== `${sym.symbol}:${tf}`) return;
    // A once-a-minute delayed price (before the replay has started) would draw a flat bar: the 20 s reload covers it.
    if (delayedLive && Date.now() / 1000 - q.time >= 905) return;
    setData((d) => {
      const next = mergeTick(d.candles, tf, q.ltp, q.time);
      return next === d.candles ? d : { ...d, candles: next };
    });
  }, [q?.ltp, q?.time]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard: Ctrl/Cmd+K opens search ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch('chart'); }
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  const loadSymbol = (s: Sym) => { setVisibleSeconds(undefined); setSym({ symbol: s.symbol, name: s.name, exchange: s.exchange }); };
  const changeTf = (t: Timeframe) => { setVisibleSeconds(undefined); setTf(t); };
  /** Signals and scans are end-of-day: open the stock's daily chart. */
  const openDailyChart = (symbol: string) => {
    loadSymbol({ symbol, name: symbol, exchange: 'NSE' });
    setTf('D');
    setModule('Chart');
  };
  const applyRange = (rtf: Timeframe, secs: number) => {
    setVisibleSeconds(secs);
    if (rtf === tf) setData((d) => ({ ...d, key: d.key + 'r' }));
    else setTf(rtf);
  };
  const toggleStudy = (id: string) => setStudies(studies.includes(id) ? studies.filter((s) => s !== id) : [...studies, id]);
  const pickFromWatch = (s: string) => {
    if (s === sym.symbol) return;
    loadSymbol({ symbol: s, name: PULSE_NAMES[s] ?? s, exchange: s === 'SENSEX' ? 'BSE' : 'NSE' });
  };

  const session: MarketSession = feedSession ?? marketSession(Date.now() / 1000);
  const TypeIcon = CHART_TYPES.find(([k]) => k === chartType)?.[2] ?? CandlestickChart;

  return (
    <div className="grid h-dvh grid-rows-[56px_30px_1fr] gap-2 overflow-hidden bg-canvas px-2 pb-2" onClick={() => setMenu(null)}>
      {/* header */}
      <header className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2.5 pr-1" aria-label="My Trading View home">
          <LogoMark size={26} />
          <span className="hidden text-[15.5px] font-extrabold tracking-[-0.03em] whitespace-nowrap 2xl:inline">My Trading View</span>
        </Link>
        <nav className="hidden gap-0.5 rounded-full bg-panel p-1 shadow-[var(--shadow-panel)] lg:flex" aria-label="Modules">
          {MODULES.map((m) => {
            const live = LIVE_MODULES.includes(m), on = m === module;
            const locked = !user && m !== 'Chart'; // visitors: charts only
            return (
              <button
                key={m}
                type="button"
                disabled={!live}
                onClick={() => (locked ? setGuestPrompt(m) : live && setModule(m))}
                aria-current={on ? 'page' : undefined}
                title={!live ? `${m}: coming in a later build step` : locked ? `${m}: create a free account to use it` : undefined}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap ${on ? 'bg-ink text-white' : 'text-ink-2 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent'}`}
              >
                {on && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-[2px]" />}
                {m}
              </button>
            );
          })}
        </nav>
        <button type="button" onClick={() => setSearch('chart')} className="ml-auto flex h-[38px] w-full max-w-[420px] items-center gap-2.5 rounded-full bg-panel pr-1.5 pl-4 text-[13px] text-muted shadow-[var(--shadow-panel)]">
          <Search size={15} aria-hidden="true" /> Search symbols
          <kbd className="num ml-auto rounded-full bg-raised px-2.5 py-1 text-[11px] text-ink-2">Ctrl K</kbd>
        </button>
        <span className="flex h-8 items-center gap-2 rounded-full bg-panel px-3 text-[12px] font-semibold whitespace-nowrap shadow-[var(--shadow-panel)]">
          <span className={`h-2 w-2 rounded-full ${session === 'open' ? 'live-dot bg-up' : session === 'pre-open' ? 'bg-accent' : 'bg-muted'}`} />
          {session === 'open' ? 'Market open' : session === 'pre-open' ? 'Pre-open' : 'Market closed'}
        </span>
        {user?.admin && status?.provider === 'kite' && (
          <span className="flex h-8 items-center gap-1.5 rounded-full bg-up-soft px-3 text-[12px] font-bold whitespace-nowrap text-up" title={kite?.userName ? `Zerodha Kite · ${kite.userName}. Session ends 06:00 IST.` : 'Zerodha Kite'}>
            <span className="live-dot h-2 w-2 rounded-full bg-up" /> Kite connected
          </span>
        )}
        {!delayed && (
          <span className="flex h-8 items-center gap-1.5 rounded-full bg-up-soft px-3 text-[12px] font-bold whitespace-nowrap text-up" title="Real-time prices">
            <span className="live-dot h-2 w-2 rounded-full bg-up" /> Real-time
          </span>
        )}
        {user?.admin && delayed && kite?.selected && kite.configured && !kite.loggedIn && (
          <a href={`${FEED_URL}/api/kite/login`} className="flex h-8 items-center rounded-full bg-ink px-3 text-[12px] font-bold whitespace-nowrap text-white hover:bg-black" title="Log in to Zerodha once a day for live prices">
            Connect Kite
          </a>
        )}
        {delayed && (
          <span className="flex h-8 items-center rounded-full bg-accent px-3 text-[12px] font-bold whitespace-nowrap text-accent-ink" title={user?.plan === 'LIVE' ? 'The live data source is unavailable right now; showing delayed prices.' : 'Prices are 15 minutes delayed. The Live plan has real-time data.'}>
            Delayed 15 min
          </span>
        )}
        {!connected && <span className="flex h-8 items-center rounded-full bg-down-soft px-3 text-[12px] font-bold whitespace-nowrap text-down">Feed offline</span>}
        {user ? <UserMenu user={user} /> : (
          <>
            <Link href="/login?next=/terminal" className="flex h-8 items-center rounded-full bg-panel px-3 text-[12px] font-bold whitespace-nowrap shadow-[var(--shadow-panel)] hover:bg-raised">Sign in</Link>
            <Link href="/signup?next=/terminal" className="flex h-8 items-center rounded-full bg-ink px-3.5 text-[12px] font-bold whitespace-nowrap text-white hover:bg-black">Start free</Link>
          </>
        )}
      </header>

      {/* market pulse */}
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <span className="eyebrow pr-1">Market pulse</span>
        {PULSE.map((s) => {
          const pq = quotes[s];
          return (
            <button key={s} type="button" onClick={() => pickFromWatch(s)} className="flex h-7 items-center gap-2 rounded-full bg-white/60 px-3 text-[12px] font-semibold text-ink-2 hover:bg-white">
              {PULSE_NAMES[s] ?? s}
              <span className="num font-medium text-ink">{pq ? fmt(pq.ltp) : '—'}</span>
              {pq && <span className={`num text-[11.5px] ${pq.change >= 0 ? 'text-up' : 'text-down'}`}>{pq.changePct >= 0 ? '+' : ''}{fmt(pq.changePct)}%</span>}
            </button>
          );
        })}
      </div>

      {/* workspace */}
      {module === 'Backtest' ? <BacktestModule /> : module === 'Option chain' ? <OptionsView />
        : module === 'Signals' ? <SignalsView onOpenChart={openDailyChart} />
        : module === 'Research' ? <ScannerView onOpenChart={openDailyChart} /> : (
      <main className="grid min-h-0 grid-cols-[1fr_380px] grid-rows-[1fr_210px] gap-2">
        <section className="panel grid min-h-0 min-w-0 grid-rows-[44px_1fr_34px] overflow-hidden">
          {/* chart toolbar */}
          <div className="flex items-center gap-0.5 border-b border-line px-2 whitespace-nowrap">
            <button type="button" onClick={() => setSearch('chart')} className="flex h-[30px] min-w-[130px] items-center gap-2 rounded-full bg-raised px-3 text-[13px] font-bold">
              <Search size={14} className="text-muted" aria-hidden="true" /> {sym.symbol}
            </button>
            <span className="mx-1.5 h-5 w-px bg-line" />
            {TFS.map((t) => (
              <button key={t} type="button" onClick={() => changeTf(t)} aria-pressed={t === tf}
                className={`num h-7 rounded-full px-2.5 text-[12px] font-medium ${t === tf ? 'bg-ink text-white' : 'hover:bg-raised'}`}>
                {tfLabel(t)}
              </button>
            ))}
            <span className="mx-1.5 h-5 w-px bg-line" />
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => setMenu(menu === 'type' ? null : 'type')} className="flex h-[30px] items-center gap-1 rounded-full px-2 hover:bg-raised" aria-label="Chart type" aria-expanded={menu === 'type'}>
                <TypeIcon size={17} /><ChevronDown size={12} />
              </button>
              {menu === 'type' && (
                <div className="absolute top-9 left-0 z-30 w-44 rounded-[12px] bg-panel py-1.5 shadow-[var(--shadow-pop)]">
                  {CHART_TYPES.map(([k, label, Icon]) => (
                    <button key={k} type="button" onClick={() => { setChartType(k); setMenu(null); }} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-raised">
                      <Icon size={15} /> {label} {k === chartType && <Check size={14} className="ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => setMenu(menu === 'ind' ? null : 'ind')} className="flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold hover:bg-raised" aria-expanded={menu === 'ind'}>
                <TrendingUp size={16} /> Indicators
              </button>
              {menu === 'ind' && (
                <div className="absolute top-9 left-0 z-30 w-64 rounded-[12px] bg-panel py-1.5 shadow-[var(--shadow-pop)]">
                  <p className="eyebrow px-3.5 pt-1 pb-1.5">On the chart</p>
                  {STUDIES.filter((s) => s.place === 'main').map((s) => (
                    <button key={s.id} type="button" onClick={() => toggleStudy(s.id)} className="flex w-full items-center px-3.5 py-1.5 text-left text-[13px] hover:bg-raised">
                      {s.name} {studies.includes(s.id) && <Check size={14} className="ml-auto" />}
                    </button>
                  ))}
                  <p className="eyebrow px-3.5 pt-2.5 pb-1.5">In a separate pane</p>
                  {STUDIES.filter((s) => s.place === 'pane').map((s) => (
                    <button key={s.id} type="button" onClick={() => toggleStudy(s.id)} className="flex w-full items-center px-3.5 py-1.5 text-left text-[13px] hover:bg-raised">
                      {s.name} {studies.includes(s.id) && <Check size={14} className="ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {loading && <span className="ml-3 text-[12px] text-muted">Loading…</span>}
            <span className="flex-1" />
            {!loading && <DataCheck quality={data.quality} delayed={delayed} />}
          </div>

          {/* chart */}
          <div className="relative min-h-0">
            <ChartView
              candles={data.candles}
              loadKey={data.key}
              symbol={sym.symbol}
              name={sym.name}
              exchange={sym.exchange}
              tf={tf}
              chartType={chartType}
              studies={studies}
              delayed={delayed}
              visibleSeconds={visibleSeconds}
              onRemoveStudy={(id) => setStudies(studies.filter((s) => s !== id))}
              onTrade={openTicket}
              positions={chartPositions}
            />
            {error && (
              <div className="absolute inset-0 z-20 grid place-items-center bg-white/80">
                <div className="panel max-w-sm p-6 text-center">
                  <p className="font-bold">{error}</p>
                  <p className="mt-1 text-[13px] text-muted">Check that the feed service is running, then pick another symbol or timeframe.</p>
                </div>
              </div>
            )}
          </div>

          {/* range bar */}
          <div className="flex items-center gap-0.5 border-t border-line px-2 text-[12.5px]">
            {RANGES.map(([label, rtf, secs]) => (
              <button key={label} type="button" onClick={() => applyRange(rtf, typeof secs === 'function' ? secs() : secs)} className="rounded-full px-2 py-1 font-medium hover:bg-raised">
                {label}
              </button>
            ))}
            <span className="flex-1" />
            <span className="hidden truncate px-3 text-[10.5px] text-muted xl:inline">
              Research tool · not SEBI-registered advice · subject to market risk{delayed ? ' · prices delayed' : ''}
            </span>
            <Clock />
          </div>
        </section>

        {/* side panel */}
        <section className="panel row-span-2 flex min-h-0 flex-col overflow-hidden">
          <div className="m-2.5 mb-1.5 flex gap-0.5 rounded-full bg-raised p-[3px]" role="tablist">
            {([['watch', 'Watchlist'], ['chain', 'Option chain'], ['signals', 'Signals'], ['scanner', 'Scanner']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={side === k} onClick={() => setSide(k)}
                className={`flex-1 rounded-full py-1.5 text-[12px] font-semibold ${side === k ? 'bg-panel text-ink shadow-[0_1px_3px_rgb(18_18_18/0.14)]' : 'text-ink-2'}`}>
                {label}
              </button>
            ))}
          </div>
          {side === 'watch' && (
            <Watchlist
              symbols={watch}
              quotes={quotes}
              active={sym.symbol}
              onSelect={pickFromWatch}
              onAdd={() => setSearch('watch')}
              onRemove={(s) => setWatch(watch.filter((w) => w !== s))}
            />
          )}
          {side === 'chain' && (
            <EmptyState icon={PlugZap} title="Option chain needs a live broker feed">
              Free data sources don&rsquo;t provide NSE option chains or futures OI. This panel comes alive when a broker API is connected:
              Zerodha Kite Connect, or Upstox and Dhan, which offer free APIs.
            </EmptyState>
          )}
          {side === 'signals' && (user ? <SignalsSide onOpenChart={openDailyChart} onOpenModule={() => setModule('Signals')} /> : <GuestPrompt feature="Signals" inline />)}
          {side === 'scanner' && (user ? <ScannerView compact onOpenChart={openDailyChart} /> : <GuestPrompt feature="Scanner" inline />)}
        </section>

        {user ? <PaperPanel snapshot={paper} unavailable={connected && !paper} onTicket={setTicket} onNotice={setNotice} /> : (
          <section className="panel grid place-items-center p-6 text-center">
            <div>
              <p className="text-[15px] font-extrabold tracking-[-0.02em]">Practise with ₹10 lakh of virtual money</p>
              <p className="mt-1 text-[13px] text-ink-2">Paper trading, backtesting, scanners and rule-based signals are free with an account.</p>
              <Link href="/signup?next=/terminal" className="mt-3 inline-flex rounded-full bg-ink px-5 py-2 text-[13px] font-bold text-white hover:bg-black">Create a free account</Link>
            </div>
          </section>
        )}
      </main>
      )}

      {user && <OrderTicket req={ticket} snapshot={paper} delayed={delayed} onClose={() => setTicket(null)} onDone={setNotice} />}
      {guestPrompt && <GuestPrompt feature={guestPrompt} onClose={() => setGuestPrompt(null)} />}

      <SymbolSearch
        open={search !== null}
        title={search === 'watch' ? 'Add to watchlist' : 'Symbol search'}
        onClose={() => setSearch(null)}
        onPick={(i) => (search === 'watch' ? !watch.includes(i.symbol) && setWatch([...watch, i.symbol]) : loadSymbol(i))}
      />
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)]">{notice}</div>}
    </div>
  );
}

/** "Create a free account" prompt for visitors: inline in a panel, or as a dialog. */
function GuestPrompt({ feature, inline, onClose }: { feature: string; inline?: boolean; onClose?: () => void }) {
  const body = (
    <div className="max-w-[320px] px-4 text-center">
      <h3 className="text-[15px] font-extrabold tracking-[-0.02em]">{feature} needs a free account</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">Charts are open to everyone. Sign up free for paper trading, backtesting, scanners and signals.</p>
      <div className="mt-3 flex justify-center gap-2">
        <Link href="/signup?next=/terminal" className="rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white hover:bg-black">Create a free account</Link>
        <Link href="/login?next=/terminal" className="rounded-full bg-raised px-4 py-2 text-[13px] font-bold hover:bg-line">Sign in</Link>
      </div>
    </div>
  );
  if (inline) return <div className="m-auto">{body}</div>;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${feature} needs an account`}>
      <div className="panel py-6" onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, children }: { icon: typeof PlugZap; title: string; children: React.ReactNode }) {
  return (
    <div className="m-auto max-w-[300px] px-4 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-[12px] bg-ink text-accent"><Icon size={20} aria-hidden="true" /></span>
      <h3 className="mt-3 text-[15px] font-extrabold tracking-[-0.02em]">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<string>('');
  const ref = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    const tick = () => setNow(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 19));
    tick();
    ref.current = setInterval(tick, 1000);
    return () => clearInterval(ref.current);
  }, []);
  return <span className="num pr-2 text-[12px] text-ink-2">{now} IST</span>;
}
