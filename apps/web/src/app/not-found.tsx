import Link from 'next/link';
import { Logo } from '@/components/logo';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <header className="flex h-[72px] items-center">
        <Link href="/" aria-label="Nandibull home"><Logo /></Link>
      </header>
      <section className="panel mx-auto mt-16 max-w-[480px] p-10 text-center">
        <p className="num text-[44px] font-bold tracking-[-0.03em] text-accent-deep">404</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em]">Page not found</h1>
        <p className="mt-2 text-[14px] text-ink-2">The link may be wrong or the page may have moved.</p>
        <div className="mt-6 flex justify-center gap-2.5">
          <Link href="/dashboard" className="rounded-[12px] bg-inverse px-5 py-2.5 text-[14px] font-semibold text-on-inverse hover:bg-inverse-hover">Go to dashboard</Link>
          <Link href="/" className="rounded-[12px] border border-accent px-5 py-2.5 text-[14px] font-semibold text-accent-deep hover:bg-accent-soft">Home</Link>
        </div>
      </section>
    </div>
  );
}
