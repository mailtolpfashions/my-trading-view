import Link from 'next/link';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';
import { getSession } from '@/lib/auth';
import { PAID_PLANS } from '@/lib/site-mode';
import { ThemeToggle } from '@/components/theme-toggle';

/** Header and footer for the public and account pages. */
export async function SiteShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <header className="flex h-[72px] items-center gap-3">
        <Link href="/" aria-label="Nandibull home" className="mr-auto">
          <Logo />
        </Link>
        <ThemeToggle />
        {PAID_PLANS && <Link href="/pricing" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Pricing</Link>}
        {session ? (
          <>
            <Link href="/account" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Account</Link>
            <Link href="/dashboard" className="rounded-full bg-inverse px-5 py-2.5 text-[13.5px] font-bold text-on-inverse hover:bg-inverse-hover">Open dashboard</Link>
          </>
        ) : (
          <>
            <Link href="/login" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Sign in</Link>
            <Link href="/dashboard" className="rounded-full bg-inverse px-5 py-2.5 text-[13.5px] font-bold text-on-inverse hover:bg-inverse-hover">Open dashboard</Link>
          </>
        )}
      </header>
      {children}
      <SiteFooter />
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'good' | 'bad'; children: React.ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-[14px] px-4 py-3 text-[13.5px] font-semibold ${tone === 'bad' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>
      {children}
    </p>
  );
}
