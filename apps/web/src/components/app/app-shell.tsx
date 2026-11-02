'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity, BarChart3, CandlestickChart, GraduationCap, Wrench, ChevronsLeft, ChevronsRight, FlaskConical, History, Layers, LayoutDashboard, Menu, Microscope, Search, TrendingUp, X,
} from 'lucide-react';
import { LogoMark } from '@/components/logo';
import { SymbolSearch } from '@/components/terminal/symbol-search';
import { UserMenu, type TerminalUser } from '@/components/terminal/user-menu';
import { VISITOR_RUNS_EVENT, fmtTradingDay, useCloses, type VisitorRuns } from '@/lib/feed';
import { fmt } from '@/lib/format';
import { readPersisted, usePersisted, writePersisted } from '@/lib/persisted';
import { ThemeToggle } from '@/components/theme-toggle';
import { RESEARCH_VIEWS } from '@/lib/research-views';
import { FUTURES_TOOLS, MARKET_TOOLS, OPTION_TOOLS, UTILITY_TOOLS } from '@/lib/tools';
import { DEFAULT_WATCH, PULSE, PULSE_NAMES, ShellContext, chartHref, type Shell } from './shell-context';

type NavItem = { href: string; match: string; label: string; icon: typeof LayoutDashboard; soon?: boolean; exact?: boolean };
const NAV: NavItem[] = [
  { href: '/dashboard', match: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/chart', match: '/chart', label: 'Chart', icon: CandlestickChart },
  { href: '/options', match: '/options', label: 'Options & simulator', icon: Layers, exact: true },
  { href: '/options/open-interest', match: '/options', label: 'Option tools', icon: BarChart3 },
  { href: '/futures', match: '/futures', label: 'Futures', icon: TrendingUp },
  { href: '/market/rrg', match: '/market', label: 'Market', icon: Activity },
  { href: '/backtest', match: '/backtest', label: 'Backtest', icon: FlaskConical },
  { href: '/research', match: '/research', label: 'Research', icon: Microscope },
  { href: '/practice', match: '/practice', label: 'Practice', icon: History },
  { href: '/tools/lot-size', match: '/tools', label: 'Tools', icon: Wrench },
  { href: '/learn', match: '/learn', label: 'Learn', icon: GraduationCap },
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
  // Below lg the sidebar is a drawer; it closes whenever the page changes.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { setDrawer(false); }, [pathname]);
  const labels = drawer || !collapsed;
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
      <div className="grid h-dvh grid-cols-1 overflow-hidden bg-canvas lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* sidebar: a slide-in drawer below lg, a fixed column from lg */}
        {drawer && <div className="fixed inset-0 z-40 bg-scrim lg:hidden" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <nav aria-label="Main" className={`flex-col border-r border-line bg-panel ${drawer ? 'fixed inset-y-0 left-0 z-50 flex w-[272px] shadow-[var(--shadow-pop)]' : 'hidden'} lg:static lg:z-auto lg:flex lg:shadow-none lg:transition-[width] ${collapsed ? 'lg:w-[76px]' : 'lg:w-[256px]'}`}>
          <div className="mx-3 flex h-[76px] shrink-0 items-center border-b border-dashed border-line-strong">
            <Link href="/" className="flex items-center gap-3 px-2.5" aria-label="Nandibull home">
              <LogoMark size={36} />
              {labels && <span className="text-[21px] font-bold tracking-[-0.03em] whitespace-nowrap">Nandibull</span>}
            </Link>
            {drawer && <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="ml-auto grid h-10 w-10 place-items-center rounded-[12px] text-muted hover:bg-raised lg:hidden"><X size={20} /></button>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-4">
            {labels && <p className="px-3 pb-2 text-[11.5px] font-semibold text-muted">Workspace</p>}
            <ul className="flex flex-col gap-1">
              {NAV.map((n) => {
                const on = n.exact ? pathname === n.match : n.href.startsWith('/options/') ? pathname.startsWith('/options/') : pathname === n.match || pathname.startsWith(n.match + '/');
                const href = n.href === '/chart' ? chartHref(lastSymbol) : n.href;
                const Icon = n.icon;
                return (
                  <li key={n.href}>
                    <Link href={href} aria-current={on ? 'page' : undefined} title={n.label}
                      className={`relative flex h-11 items-center gap-3 rounded-[12px] px-3.5 text-[14.5px] whitespace-nowrap ${on
                        ? 'bg-accent-soft font-bold text-accent-deep before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent'
                        : 'font-medium text-ink-2 hover:bg-raised hover:text-ink'}`}>
                      <Icon size={19} aria-hidden="true" className="shrink-0" />
                      {labels && <span>{n.label}</span>}
                      {labels && n.soon && <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-semibold text-muted">Soon</span>}
                    </Link>
                    {n.href === '/options/open-interest' && on && labels && (
                      <ul className="my-1 ml-[30px] flex flex-col border-l border-line-strong">
                        {OPTION_TOOLS.map((t) => {
                          const subOn = pathname === `/options/${t.slug}`;
                          return (
                            <li key={t.slug}>
                              <Link href={`/options/${t.slug}`} aria-current={subOn ? 'page' : undefined}
                                className={`block px-4 py-[6px] text-[13px] ${subOn ? 'font-semibold text-accent-deep' : 'text-ink-2 hover:text-ink'}`}>{t.label}</Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {n.href === '/futures' && on && labels && (
                      <ul className="my-1 ml-[30px] flex flex-col border-l border-line-strong">
                        {[{ slug: '', label: 'Futures by day' }, ...FUTURES_TOOLS].map((t) => {
                          const href = t.slug ? `/futures/${t.slug}` : '/futures';
                          const subOn = pathname === href;
                          return (
                            <li key={href}>
                              <Link href={href} aria-current={subOn ? 'page' : undefined}
                                className={`block px-4 py-[6px] text-[13px] ${subOn ? 'font-semibold text-accent-deep' : 'text-ink-2 hover:text-ink'}`}>{t.label}</Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {n.match === '/tools' && on && labels && (
                      <ul className="my-1 ml-[30px] flex flex-col border-l border-line-strong">
                        {UTILITY_TOOLS.map((t) => {
                          const subOn = pathname === `/tools/${t.slug}`;
                          return (
                            <li key={t.slug}>
                              <Link href={`/tools/${t.slug}`} aria-current={subOn ? 'page' : undefined}
                                className={`block px-4 py-[6px] text-[13px] ${subOn ? 'font-semibold text-accent-deep' : 'text-ink-2 hover:text-ink'}`}>{t.label}</Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {n.match === '/market' && on && labels && (
                      <ul className="my-1 ml-[30px] flex flex-col border-l border-line-strong">
                        {MARKET_TOOLS.map((t) => {
                          const subOn = pathname === `/market/${t.slug}`;
                          return (
                            <li key={t.slug}>
                              <Link href={`/market/${t.slug}`} aria-current={subOn ? 'page' : undefined}
                                className={`block px-4 py-[6px] text-[13px] ${subOn ? 'font-semibold text-accent-deep' : 'text-ink-2 hover:text-ink'}`}>{t.label}</Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {n.href === '/research' && labels && (
                      <ul className="my-1 ml-[30px] flex flex-col border-l border-line-strong">
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
            {labels && (
              <div className="mt-auto mb-3 rounded-[18px] bg-accent-soft p-4" title="All prices are NSE's official end-of-day data">
                <p className="text-[11.5px] font-semibold text-muted">Data as of</p>
                <p className="num mt-0.5 text-[16px] font-bold">{asOf ? fmtTradingDay(asOf) : 'Loading…'}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/25"><div className={`h-full bg-accent ${asOf ? 'w-full' : 'w-1/3 animate-pulse'}`} /></div>
                <p className="mt-2 text-[12px] leading-snug text-ink-2">NSE closing prices. Not live.</p>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mx-3 mb-3 hidden h-10 shrink-0 items-center justify-center rounded-[12px] text-muted hover:bg-raised hover:text-ink lg:flex">
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </nav>

        <div className="grid min-w-0 grid-rows-[64px_minmax(0,1fr)] overflow-hidden md:grid-rows-[76px_40px_minmax(0,1fr)]">
          {/* top bar */}
          <header className="flex min-w-0 items-center gap-2 px-3 sm:gap-2.5 sm:px-6">
            <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-line bg-panel text-ink-2 lg:hidden"><Menu size={20} /></button>
            <Link href="/" aria-label="Nandibull home" className="shrink-0 sm:hidden"><LogoMark size={32} /></Link>
            <button type="button" onClick={() => setSearch('chart')} aria-label="Search symbols"
              className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-line bg-panel text-muted sm:ml-0 sm:flex sm:h-12 sm:w-full sm:max-w-[440px] sm:items-center sm:gap-2.5 sm:rounded-[14px] sm:pr-1.5 sm:pl-4 sm:text-[14px] hover:border-line-strong">
              <Search size={17} aria-hidden="true" /> <span className="hidden truncate sm:inline">Search a symbol, e.g. RELIANCE</span>
              <kbd className="num ml-auto hidden rounded-[8px] border border-line-strong px-2 py-1 text-[11px] font-semibold text-muted md:inline">Ctrl K</kbd>
            </button>
            <span className="ml-auto hidden h-9 items-center gap-2 rounded-full bg-up-soft px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-up xl:flex" title="All prices are NSE's official end-of-day data">
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> EOD{asOf ? ` · ${fmtTradingDay(asOf)}` : ''}
            </span>
            {!user && (
              <span className="hidden h-9 items-center rounded-full bg-panel px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-ink-2 shadow-[var(--shadow-panel)] xl:flex"
                title="Backtests, studies, scans and simulations count as runs. Charts, option chains and the strategy builder are unlimited.">
                {runs ? `${runs.remaining} free run${runs.remaining === 1 ? '' : 's'} left today` : 'Free daily runs'}
              </span>
            )}
            <span className="hidden sm:ml-auto sm:block xl:hidden" />
            <ThemeToggle />
            {user ? <UserMenu user={user} /> : (
              <Link href={signInHref} className="flex h-11 shrink-0 items-center rounded-[12px] bg-inverse px-3.5 text-[13.5px] font-semibold whitespace-nowrap text-on-inverse hover:bg-inverse-hover sm:px-5">Sign in</Link>
            )}
          </header>

          {/* market pulse (from md): auto margins centre the row, yet keep it scrollable from the start when narrow */}
          <div className="hidden items-center gap-1.5 overflow-x-auto px-4 whitespace-nowrap [scrollbar-width:none] sm:px-6 md:flex [&>*:first-child]:ml-auto [&>*:last-child]:mr-auto" role="region" aria-label="Market pulse">
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

          {/* below lg the page scrolls as one column; from lg each page fills the window and scrolls inside its panels */}
          <main className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-3 pb-4 sm:px-6 sm:pb-5 lg:grid lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">{children}</main>
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
        <h3 className="text-[15px] font-extrabold tracking-[-0.02em]">Daily limit reached</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          You have used today&rsquo;s free runs. Sign in to keep running backtests, studies, scans and simulations. Charts and the option chain don&rsquo;t need an account.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href={signInHref} className="rounded-[12px] bg-inverse px-4 py-2.5 text-[13px] font-semibold text-on-inverse hover:bg-inverse-hover">Sign in</Link>
          <button type="button" onClick={onClose} className="rounded-[12px] border border-accent px-4 py-2.5 text-[13px] font-semibold text-accent-deep hover:bg-accent-soft">Not now</button>
        </div>
      </div>
    </div>
  );
}
