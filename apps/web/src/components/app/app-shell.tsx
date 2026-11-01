'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CandlestickChart, ChevronsLeft, ChevronsRight, FlaskConical, History, Layers, LayoutDashboard, Microscope, Search, TrendingUp,
} from 'lucide-react';
import { LogoMark } from '@/components/logo';
import { SymbolSearch } from '@/components/terminal/symbol-search';
import { UserMenu, type TerminalUser } from '@/components/terminal/user-menu';
import { VISITOR_RUNS_EVENT, fmtTradingDay, useCloses, type VisitorRuns } from '@/lib/feed';
import { fmt } from '@/lib/format';
import { readPersisted, usePersisted, writePersisted } from '@/lib/persisted';
import { ThemeToggle } from '@/components/theme-toggle';
import { DEFAULT_WATCH, PULSE, PULSE_NAMES, ShellContext, chartHref, type Shell } from './shell-context';

type NavItem = { href: string; match: string; label: string; icon: typeof LayoutDashboard; soon?: boolean };
const NAV: NavItem[] = [
  { href: '/dashboard', match: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/chart', match: '/chart', label: 'Chart', icon: CandlestickChart },
  { href: '/options', match: '/options', label: 'Options & simulator', icon: Layers },
  { href: '/futures', match: '/futures', label: 'Futures', icon: TrendingUp },
  { href: '/backtest', match: '/backtest', label: 'Backtest', icon: FlaskConical },
  { href: '/research', match: '/research', label: 'Research', icon: Microscope },
  { href: '/practice', match: '/practice', label: 'Practice', icon: History, soon: true },
];

/**
 * The app's frame: a sidebar with one page per feature, the market pulse ribbon (last NSE closes), and a top bar with
 * search, the theme switch and the account. Shared state (watchlist, closes, search) lives here, so it survives
 * moving between pages.
 */
export function AppShell({ user, children }: { user: TerminalUser | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = usePersisted('mtv.sidebar.collapsed', false);
  const [watch, setWatch] = usePersisted<string[]>('mtv.watchlist', DEFAULT_WATCH);
  const [search, setSearch] = useState<null | 'chart' | 'watch'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSymbol, setLastSymbol] = useState('NIFTY');
  useEffect(() => { setLastSymbol(readPersisted('mtv.lastSymbol', 'NIFTY')); }, [pathname]);

  const subscribed = useMemo(() => [...new Set([...PULSE, ...watch])], [watch]);
  const { quotes, asOf } = useCloses(subscribed);

  // Visitors: runs left today (from the feed's counted routes), and the sign-in prompt when they run out.
  const [runs, setRuns] = useState<VisitorRuns | null>(null);
  const [limitPrompt, setLimitPrompt] = useState(false);
  useEffect(() => {
    if (user) return;
    const on = (e: Event) => { const d = (e as CustomEvent<VisitorRuns>).detail; setRuns(d); if (d.limitReached) setLimitPrompt(true); };
    window.addEventListener(VISITOR_RUNS_EVENT, on);
    return () => window.removeEventListener(VISITOR_RUNS_EVENT, on);
  }, [user]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch('chart'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 2600); return () => clearTimeout(t); }, [notice]);

  const openChart = useCallback((symbol: string) => { writePersisted('mtv.tf', 'D'); router.push(chartHref(symbol)); }, [router]);
  const shell: Shell = useMemo(() => ({ user, quotes, asOf, watch, setWatch, openSearch: setSearch, openChart, notify: setNotice }), [user, quotes, asOf, watch, setWatch, openChart]);
  const signInHref = `/login?next=${encodeURIComponent(pathname)}`;

  return (
    <ShellContext.Provider value={shell}>
      <div className="grid h-dvh grid-cols-[auto_minmax(0,1fr)] overflow-hidden bg-canvas">
        {/* sidebar */}
        <nav aria-label="Main" className={`m-2 mr-0 flex flex-col rounded-[var(--radius-panel)] bg-panel shadow-[var(--shadow-panel)] transition-[width] ${collapsed ? 'w-[60px]' : 'w-[60px] lg:w-[212px]'}`}>
          <Link href="/" className="flex h-14 items-center gap-2.5 px-4" aria-label="My Trading View home">
            <LogoMark size={26} />
            {!collapsed && <span className="hidden text-[15px] font-extrabold tracking-[-0.03em] whitespace-nowrap lg:inline">My Trading View</span>}
          </Link>
          <ul className="flex flex-1 flex-col gap-0.5 px-2">
            {NAV.map((n) => {
              const on = pathname === n.match || pathname.startsWith(n.match + '/');
              const href = n.href === '/chart' ? chartHref(lastSymbol) : n.href;
              const Icon = n.icon;
              return (
                <li key={n.href}>
                  <Link href={href} aria-current={on ? 'page' : undefined} title={n.label}
                    className={`flex h-10 items-center gap-3 rounded-[11px] px-3 text-[13px] font-semibold whitespace-nowrap ${on ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:bg-raised hover:text-ink'}`}>
                    <Icon size={18} aria-hidden="true" className="shrink-0" />
                    {!collapsed && <span className="hidden lg:inline">{n.label}</span>}
                    {!collapsed && n.soon && <span className={`ml-auto hidden rounded-full px-1.5 text-[10px] font-bold lg:inline ${on ? 'bg-accent text-accent-ink' : 'bg-raised text-muted'}`}>Soon</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="m-2 hidden h-9 items-center justify-center rounded-[11px] text-muted hover:bg-raised hover:text-ink lg:flex">
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          </button>
        </nav>

        <div className="grid min-w-0 grid-rows-[34px_52px_minmax(0,1fr)] overflow-hidden">
          {/* market pulse: auto margins centre the row, yet keep it scrollable from the start on narrow screens */}
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 whitespace-nowrap [scrollbar-width:none] [&>*:first-child]:ml-auto [&>*:last-child]:mr-auto" role="region" aria-label="Market pulse">
            <span className="eyebrow pr-1" title="Last official NSE closing prices; this site shows no live data">NSE close{asOf ? ` · ${fmtTradingDay(asOf)}` : ''}</span>
            {PULSE.map((s) => {
              const q = quotes[s];
              return (
                <Link key={s} href={chartHref(s)} className="flex h-6 shrink-0 items-center gap-2 rounded-full px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-panel">
                  {PULSE_NAMES[s] ?? s}
                  <span className="num font-medium text-ink">{q ? fmt(q.ltp) : '—'}</span>
                  {q && <span className={`num text-[11.5px] ${q.change >= 0 ? 'text-up' : 'text-down'}`}>{q.changePct >= 0 ? '+' : ''}{fmt(q.changePct)}%</span>}
                </Link>
              );
            })}
          </div>

          {/* top bar */}
          <header className="flex items-center gap-2 px-2">
            <button type="button" onClick={() => setSearch('chart')} className="flex h-[38px] w-full max-w-[460px] items-center gap-2.5 rounded-full bg-panel pr-1.5 pl-4 text-[13px] text-muted shadow-[var(--shadow-panel)]">
              <Search size={15} aria-hidden="true" /> Search symbols
              <kbd className="num ml-auto rounded-full bg-raised px-2.5 py-1 text-[11px] text-ink-2">Ctrl K</kbd>
            </button>
            <span className="ml-auto hidden h-8 items-center gap-1.5 rounded-full bg-panel px-3 text-[12px] font-semibold whitespace-nowrap text-ink-2 shadow-[var(--shadow-panel)] md:flex" title="All prices are NSE's official end-of-day data">
              <History size={14} aria-hidden="true" /> End-of-day data{asOf ? ` · ${fmtTradingDay(asOf)}` : ''}
            </span>
            <ThemeToggle />
            {user ? <UserMenu user={user} /> : (
              <>
                <span className="hidden h-8 items-center rounded-full bg-panel px-3 text-[12px] font-semibold whitespace-nowrap text-ink-2 shadow-[var(--shadow-panel)] sm:flex"
                  title="Backtests, studies, scans and simulations count as runs. Charts, option chains and the strategy builder are unlimited.">
                  {runs ? `${runs.remaining} free run${runs.remaining === 1 ? '' : 's'} left today` : 'Free · a few runs a day'}
                </span>
                <Link href={signInHref} className="flex h-8 items-center rounded-full bg-inverse px-3.5 text-[12px] font-bold whitespace-nowrap text-on-inverse hover:bg-inverse-hover">Sign in · unlimited</Link>
              </>
            )}
          </header>

          <main className="grid min-h-0 grid-rows-[minmax(0,1fr)] px-2 pb-2">{children}</main>
        </div>
      </div>

      <SymbolSearch
        open={search !== null}
        title={search === 'watch' ? 'Add to watchlist' : 'Symbol search'}
        onClose={() => setSearch(null)}
        onPick={(i) => (search === 'watch' ? !watch.includes(i.symbol) && setWatch([...watch, i.symbol]) : router.push(chartHref(i.symbol)))}
      />
      {limitPrompt && <LimitPrompt signInHref={signInHref} onClose={() => setLimitPrompt(false)} />}
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-inverse px-5 py-2.5 text-[13px] font-semibold text-on-inverse shadow-[var(--shadow-pop)]">{notice}</div>}
    </ShellContext.Provider>
  );
}

/** Shown when a visitor has used today's free runs. */
function LimitPrompt({ signInHref, onClose }: { signInHref: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Free runs used">
      <div className="panel max-w-[360px] px-6 py-6 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-extrabold tracking-[-0.02em]">You&rsquo;ve used today&rsquo;s free runs</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Sign in with Google for unlimited backtests, studies, scans and simulations. It&rsquo;s free. Charts, option chains and the strategy builder stay open either way.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href={signInHref} className="rounded-full bg-inverse px-4 py-2 text-[13px] font-bold text-on-inverse hover:bg-inverse-hover">Sign in, free</Link>
          <button type="button" onClick={onClose} className="rounded-full bg-raised px-4 py-2 text-[13px] font-bold hover:bg-line">Not now</button>
        </div>
      </div>
    </div>
  );
}
