'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ListChecks, Search } from 'lucide-react';
import { DEFAULT_WATCH, PULSE, ShellContext, chartHref, type Shell } from '@/components/app/shell-context';
import { SymbolSearch } from '@/components/terminal/symbol-search';
import { lastAnswer, useCloses } from '@/lib/feed';
import { MODE_TF, type DaySettings } from '@/lib/today';
import { usePersisted, writePersisted } from '@/lib/persisted';
import { AlertsBell } from './alerts-bell';
import { DialogHost } from './dialog';
import { LiveChip } from './live-status';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { WatchPanel } from './app/watch-panel';
import { OrderTicket } from './tradelab/order-ticket';
import type { TicketStart } from '@/lib/tradelab';

/** Seven plain choices; every other tool is a card on the Tools page. */
const NAV: { href: string; label: string; match: string[] }[] = [
  { href: '/today', label: 'Today', match: ['/today'] },
  { href: '/scanner', label: 'Scanner', match: ['/scanner'] },
  { href: '/strategies', label: 'Strategies', match: ['/strategies'] },
  { href: '/options', label: 'Options', match: ['/options', '/backtest/options'] },
  { href: '/tradelab', label: 'Trade lab', match: ['/tradelab'] },
  { href: '/chart', label: 'Charts', match: ['/chart'] },
  { href: '/tools', label: 'Tools', match: ['/tools', '/futures', '/market', '/research', '/practice', '/learn', '/watchlists', '/alerts', '/connect'] },
];

/** Pages laid out edge to edge (the rest keep a 1600px column until their own redesign). */
const FULL_WIDTH = ['/today', '/scanner', '/chart', '/strategies', '/tradelab'];
/** Full width on this exact page only (its tool pages under /options/… keep the column). */
const FULL_WIDTH_EXACT = ['/options'];

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
  const [ticket, setTicket] = useState<TicketStart | null>(null);
  const [panelOpen, setPanelOpen] = usePersisted<boolean>('mtv.watchPanel', true);
  const [drawer, setDrawer] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const showPanel = true; // the watchlist and scanner panel, on every page (Charts included)
  const full = FULL_WIDTH.some((p) => path === p || path.startsWith(`${p}/`)) || FULL_WIDTH_EXACT.includes(path);
  const subscribed = useMemo(() => [...new Set([...PULSE, ...watch])], [watch]);
  const { quotes, asOf } = useCloses(subscribed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch('chart'); return; }
      // W shows or hides the watchlist, unless the key is meant for a text box
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() === 'w' && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) setPanelOpen(!panelOpenRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPanelOpen]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 2600); return () => clearTimeout(t); }, [notice]);
  // A chart opened from search starts on the trading mode's timeframe (Today page), daily when none is set.
  const openChart = useCallback((symbol: string) => {
    const mode = lastAnswer<DaySettings>('user/settings')?.data.mode;
    writePersisted('mtv.tf', mode ? MODE_TF[mode].chart : 'D');
    router.push(chartHref(symbol));
  }, [router]);
  const shell: Shell = useMemo(() => ({ quotes, asOf, watch, setWatch, openSearch: setSearch, openChart, notify: setNotice, openTicket: (s?: TicketStart) => setTicket(s ?? {}) }), [quotes, asOf, watch, setWatch, openChart]);

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-4 sm:px-5">
            <Link href="/today" aria-label="Home" className="shrink-0"><Logo /></Link>
            <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label="Modules">
              {NAV.map((n) => {
                const active = n.match.some((p) => path === p || path.startsWith(`${p}/`));
                return <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap rounded-[10px] px-3 py-2 text-[14px] font-medium ${active ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2 hover:text-ink'}`}>{n.label}</Link>;
              })}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={() => setSearch('chart')} title="Search symbols (Ctrl+K)" aria-label="Search symbols"
                className="flex h-11 items-center gap-2 rounded-[12px] border border-line bg-panel px-3 text-[13px] text-muted hover:border-line-strong hover:text-ink">
                <Search size={16} /> <kbd className="hidden rounded border border-line px-1 text-[11px] 2xl:inline">Ctrl K</kbd>
              </button>
              {showPanel && (
                <button type="button" onClick={() => setDrawer(true)} aria-label="Open watchlist" title="Watchlist"
                  className="grid h-11 w-11 place-items-center rounded-[12px] border border-line bg-panel text-ink-2 hover:text-ink lg:hidden"><ListChecks size={17} /></button>
              )}
              <LiveChip />
              <AlertsBell />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="flex flex-1">
          <main className={full ? 'min-w-0 flex-1 px-5 py-5' : 'mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-5 py-6'}>{children}</main>
          {showPanel && <WatchPanel open={panelOpen} onToggle={() => setPanelOpen(!panelOpen)} drawer={drawer} onCloseDrawer={() => setDrawer(false)} />}
        </div>
      </div>
      <SymbolSearch open={!!search} onClose={() => setSearch(null)} title={search === 'watch' ? 'Add to watchlist' : 'Open a chart'}
        onPick={(i) => {
          if (search === 'watch') { if (!watch.includes(i.symbol)) setWatch([...watch, i.symbol]); setNotice(`${i.symbol} added to the watchlist`); }
          else openChart(i.symbol);
          setSearch(null);
        }} />
      <DialogHost />
      {ticket && <OrderTicket start={ticket} onClose={() => setTicket(null)} onPlaced={(m) => setNotice(m.length > 90 ? `${m.slice(0, 88)}…` : m)} />}
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[12px] bg-deep px-4 py-2.5 text-[13.5px] text-white shadow-[var(--shadow-pop)]">{notice}</div>}
    </ShellContext.Provider>
  );
}
