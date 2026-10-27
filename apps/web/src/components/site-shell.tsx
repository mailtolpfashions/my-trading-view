import Link from 'next/link';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';
import { getSession } from '@/lib/auth';

/** Header and footer for the public and account pages. */
export async function SiteShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <header className="flex h-[72px] items-center gap-3">
        <Link href="/" aria-label="My Trading View home" className="mr-auto">
          <Logo />
        </Link>
        <Link href="/chart" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Free charts</Link>
        <Link href="/pricing" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Pricing</Link>
        {session ? (
          <>
            <Link href="/account" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Account</Link>
            <Link href="/terminal" className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-black">Open terminal</Link>
          </>
        ) : (
          <>
            <Link href="/login" className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-2 hover:bg-panel hover:text-ink">Sign in</Link>
            <Link href="/signup" className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-black">Start free</Link>
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
