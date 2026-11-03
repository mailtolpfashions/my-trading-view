'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './logo';
import { LiveChip } from './live-status';
import { ThemeToggle } from './theme-toggle';

const NAV: { href: string; label: string; match?: string; soon?: boolean }[] = [
  { href: '/screener', label: 'Screener' },
  { href: '/strategies', label: 'Strategies' },
  { href: '/chart/NIFTY', label: 'Charts', match: '/chart' },
  { href: '/watchlists', label: 'Watchlists' },
];

/** Top bar with the four modules. Modules not built yet are shown, marked "Soon", and not linked. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-5">
          <Link href="/screener" aria-label="Home"><Logo /></Link>
          <nav className="flex items-center gap-1" aria-label="Modules">
            {NAV.map((n) => {
              const active = path.startsWith(n.match ?? n.href);
              if (n.soon) return (
                <span key={n.href} className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[14px] font-medium text-muted" title="Coming in a later step">
                  {n.label}<span className="rounded-full bg-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Soon</span>
                </span>
              );
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                  className={`rounded-[10px] px-3 py-2 text-[14px] font-medium ${active ? 'bg-panel text-ink shadow-[var(--shadow-panel)]' : 'text-ink-2 hover:text-ink'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2"><LiveChip /><ThemeToggle /></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-5 py-6">{children}</main>
    </div>
  );
}
