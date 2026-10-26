import Link from 'next/link';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <header className="flex h-[72px] items-center">
        <Link href="/" aria-label="My Trading View home">
          <Logo />
        </Link>
      </header>
      <article className="panel mx-auto mt-6 max-w-[780px] p-6 sm:p-10">
        <h1 className="text-[34px] font-extrabold tracking-[-0.035em]">{title}</h1>
        <p className="mt-1 text-[13px] text-muted">Last updated {updated}</p>
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-ink-2 [&_h2]:pt-3 [&_h2]:text-[18px] [&_h2]:font-extrabold [&_h2]:text-ink [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
      </article>
      <SiteFooter />
    </div>
  );
}
