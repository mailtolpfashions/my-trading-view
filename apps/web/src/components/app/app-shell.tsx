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
import { RESEARCH_VIEWS } from '@/lib/research-views';
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
 * The app's frame: a sidebar with one page per feature (Research opens into its views) and the data date, a top bar
 * with search, the theme switch and the account, and the market pulse ribbon (last NSE closes). Shared state (watchlist, closes, search) lives here, so it survives
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
        <nav aria-label="Main" className={`flex flex-col border-r border-line bg-panel transition-[width] ${collapsed ? 'w-[76px]' : 'w-[76px] lg:w-[256px]'}`}>
          <Link href="/" className="mx-3 flex h-[76px] shrink-0 items-center gap-3 border-b border-dashed border-line-strong px-2.5" aria-label="Nandibull home">
            <LogoMark size={36} />
            {!collapsed && <span className="hidden text-[21px] font-bold tracking-[-0.03em] whitespace-nowrap lg:inline">Nandibull</span>}
          </Link>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-4">
            {!collapsed && <p className="hidden px-3 pb-2 text-[11.5px] font-semibold text-muted lg:block">Workspace</p>}
            <ul className="flex flex-col gap-1">
              {NAV.map((n) => {
                const on = pathname === n.match || pathname.startsWith(n.match + '/');
                const href = n.href === '/chart' ? chartHref(lastSymbol) : n.href;
                const Icon = n.icon;
                return (
                  <li key={n.href}>
                    <Link href={href} aria-current={on ? 'page' : undefined} title={n.label}
                      className={`relative flex h-11 items-center gap-3 rounded-[12px] px-3.5 text-[14.5px] whitespace-nowrap ${on
                        ? 'bg-accent-soft font-bold text-accent-deep before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent'
                        : 'font-medium text-ink-2 hover:bg-raised hover:text-ink'}`}>
                      <Icon size={19} aria-hidden="true" className="shrink-0" />
                      {!collapsed && <span className="hidden lg:inline">{n.label}</span>}
                      {!collapsed && n.soon && <span className="ml-auto hidden rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-semibold text-muted lg:inline">Soon</span>}
                    </Link>
                    {n.href === '/research' && !collapsed && (
                      <ul className="my-1 ml-[30px] hidden flex-col border-l border-line-strong lg:flex">
                        {RESEARCH_VIEWS.map((v) => {
                          const subOn = pathname === `/research/${v.slug}`;
                          return (
                            <li key={v.slug}>
                              <Link href={`/research/${v.slug}`} aria-current={subOn ? 'page' : undefined}
                                className={`block px-4 py-[7px] text-[13.5px] ${subOn ? 'font-semibold text-accent-deep' : 'text-ink-2 hover:text-ink'}`}>{v.label}</Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {!collapsed && (
              <div className="mt-auto mb-3 hidden rounded-[18px] bg-accent-soft p-4 lg:block" title="All prices are NSE's official end-of-day data">
                <p className="text-[11.5px] font-semibold text-muted">NSE end-of-day data</p>
                <p className="num mt-0.5 text-[16px] font-bold">{asOf ? fmtTradingDay(asOf) : 'Loading…'}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/25"><div className={`h-full bg-accent ${asOf ? 'w-full' : 'w-1/3 animate-pulse'}`} /></div>
                <p className="mt-2 text-[12px] leading-snug text-ink-2">Official closing prices, F&amp;O and FPI flows. No live prices.</p>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mx-3 mb-3 hidden h-10 shrink-0 items-center justify-center rounded-[12px] text-muted hover:bg-raised hover:text-ink lg:flex">
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </nav>

        <div className="grid min-w-0 grid-rows-[76px_40px_minmax(0,1fr)] overflow-hidden">
          {/* top bar */}
          <header className="flex items-center gap-2.5 px-4 sm:px-6">
            <button type="button" onClick={() => setSearch('chart')} className="flex h-12 w-full max-w-[440px] items-center gap-2.5 rounded-[14px] border border-line bg-panel pr-1.5 pl-4 text-[14px] text-muted hover:border-line-strong">
              <Search size={17} aria-hidden="true" /> Search a symbol, e.g. RELIANCE
              <kbd className="num ml-auto rounded-[8px] border border-line-strong px-2 py-1 text-[11px] font-semibold text-muted">Ctrl K</kbd>
            </button>
            <span className="ml-auto hidden h-9 items-center gap-2 rounded-full bg-up-soft px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-up md:flex" title="All prices are NSE's official end-of-day data">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> EOD{asOf ? ` · ${fmtTradingDay(asOf)}` : ''}
            </span>
            {!user && (
              <span className="hidden h-9 items-center rounded-full bg-panel px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-ink-2 shadow-[var(--shadow-panel)] lg:flex"
                title="Backtests, studies, scans and simulations count as runs. Charts, option chains and the strategy builder are unlimited.">
                {runs ? `${runs.remaining} free run${runs.remaining === 1 ? '' : 's'} left today` : 'Free · a few runs a day'}
              </span>
            )}
            <ThemeToggle />
            {user ? <UserMenu user={user} /> : (
              <Link href={signInHref} className="flex h-11 items-center rounded-[12px] bg-inverse px-5 text-[13.5px] font-semibold whitespace-nowrap text-on-inverse hover:bg-inverse-hover">Sign in · unlimited</Link>
            )}
          </header>

          {/* market pulse: auto margins centre the row, yet keep it scrollable from the start on narrow screens */}
          <div className="flex items-center gap-1.5 overflow-x-auto px-4 whitespace-nowrap [scrollbar-width:none] sm:px-6 [&>*:first-child]:ml-auto [&>*:last-child]:mr-auto" role="region" aria-label="Market pulse">
            <span className="eyebrow pr-1" title="Last official NSE closing prices; this site shows no live data">NSE close{asOf ? ` · ${fmtTradingDay(asOf)}` : ''}</span>
            {PULSE.map((s) => {
              const q = quotes[s];
              return (
                <Link key={s} href={chartHref(s)} className="flex h-7 shrink-0 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold text-ink-2 hover:bg-panel">
                  {PULSE_NAMES[s] ?? s}
                  <span className="num font-medium text-ink">{q ? fmt(q.ltp) : '—'}</span>
                  {q && <span className={`num text-[12px] ${q.change >= 0 ? 'text-up' : 'text-down'}`}>{q.changePct >= 0 ? '+' : ''}{fmt(q.changePct)}%</span>}
                </Link>
              );
            })}
          </div>

          <main className="grid min-h-0 grid-rows-[minmax(0,1fr)] px-3 pb-3 sm:px-6 sm:pb-5">{children}</main>
        </div>
      </div>

      <SymbolSearch
        open={search !== null}
        title={search === 'watch' ? 'Add to watchlist' : 'Symbol search'}
        onClose={() => setSearch(null)}
        onPick={(i) => (search === 'watch' ? !watch.includes(i.symbol) && setWatch([...watch, i.symbol]) : router.push(chartHref(i.symbol)))}
      />
      {limitPrompt && <LimitPrompt signInHref={signInHref} onClose={() => setLimitPrompt(false)} />}
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-deep px-5 py-2.5 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)]">{notice}</div>}
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
          <Link href={signInHref} className="rounded-[12px] bg-inverse px-4 py-2.5 text-[13px] font-semibold text-on-inverse hover:bg-inverse-hover">Sign in, free</Link>
          <button type="button" onClick={onClose} className="rounded-[12px] border border-accent px-4 py-2.5 text-[13px] font-semibold text-accent-deep hover:bg-accent-soft">Not now</button>
        </div>
      </div>
    </div>
  );
}
