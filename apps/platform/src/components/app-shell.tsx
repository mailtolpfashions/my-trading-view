'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { DEFAULT_WATCH, PULSE, ShellContext, chartHref, type Shell } from '@/components/app/shell-context';
import { SymbolSearch } from '@/components/terminal/symbol-search';
import { useCloses } from '@/lib/feed';
import { usePersisted, writePersisted } from '@/lib/persisted';
import { AlertsBell } from './alerts-bell';
import { LiveChip } from './live-status';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

/** Six plain choices; every other tool is a card on the Tools page. */
const NAV: { href: string; label: string; match: string[] }[] = [
  { href: '/today', label: 'Today', match: ['/today'] },
  { href: '/screener', label: 'Screener', match: ['/screener'] },
  { href: '/strategies', label: 'Strategies', match: ['/strategies'] },
  { href: '/options', label: 'Options', match: ['/options', '/backtest/options'] },
  { href: '/chart', label: 'Charts', match: ['/chart'] },
  { href: '/tools', label: 'Tools', match: ['/tools', '/futures', '/market', '/research', '/practice', '/learn', '/watchlists', '/alerts', '/connect'] },
];

/**
 * The app's frame: six plain choices, symbol search (Ctrl+K), Kite status, alerts and theme. It also provides the
 * shared state the tools rely on (watchlist, last closes, search, opening a chart, short notices).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [watch, setWatch] = usePersisted<string[]>('mtv.watchlist', DEFAULT_WATCH);
  const [search, setSearch] = useState<null | 'chart' | 'watch'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const subscribed = useMemo(() => [...new Set([...PULSE, ...watch])], [watch]);
  const { quotes, asOf } = useCloses(subscribed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch('chart'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 2600); return () => clearTimeout(t); }, [notice]);
  const openChart = useCallback((symbol: string) => { writePersisted('mtv.tf', 'D'); router.push(chartHref(symbol)); }, [router]);
  const shell: Shell = useMemo(() => ({ quotes, asOf, watch, setWatch, openSearch: setSearch, openChart, notify: setNotice }), [quotes, asOf, watch, setWatch, openChart]);

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-5">
            <Link href="/today" aria-label="Home"><Logo /></Link>
            <nav className="flex items-center gap-0.5" aria-label="Modules">
              {NAV.map((n) => {
                const active = n.match.some((p) => path === p || path.startsWith(`${p}/`));
                return <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap rounded-[10px] px-3 py-2 text-[14px] font-medium ${active ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2 hover:text-ink'}`}>{n.label}</Link>;
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => setSearch('chart')} title="Search symbols (Ctrl+K)" aria-label="Search symbols"
                className="flex h-11 items-center gap-2 rounded-[12px] border border-line bg-panel px-3 text-[13px] text-muted hover:border-line-strong hover:text-ink">
                <Search size={16} /> <kbd className="hidden rounded border border-line px-1 text-[11px] 2xl:inline">Ctrl K</kbd>
              </button>
              <LiveChip />
              <AlertsBell />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-5 py-6">{children}</main>
      </div>
      <SymbolSearch open={!!search} onClose={() => setSearch(null)} title={search === 'watch' ? 'Add to watchlist' : 'Open a chart'}
        onPick={(i) => {
          if (search === 'watch') { if (!watch.includes(i.symbol)) setWatch([...watch, i.symbol]); setNotice(`${i.symbol} added to the watchlist`); }
          else openChart(i.symbol);
          setSearch(null);
        }} />
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[12px] bg-deep px-4 py-2.5 text-[13.5px] text-white shadow-[var(--shadow-pop)]">{notice}</div>}
    </ShellContext.Provider>
  );
}
