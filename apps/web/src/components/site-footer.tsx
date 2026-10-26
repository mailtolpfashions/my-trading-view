import Link from 'next/link';
import { Logo } from '@/components/logo';

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@mytradingview.in';

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-ink/10 py-10 text-[13px] text-ink-2">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="max-w-[560px]">
          <Logo />
          <p className="mt-4 leading-relaxed text-muted">
            My Trading View is a charting, research and paper-trading platform. It does not provide investment advice and is not registered with SEBI as an
            investment adviser or research analyst. Signals are generated from published rules for research and education. Past performance does not
            guarantee future results. Investments in securities are subject to market risks; read all related documents carefully before investing.
          </p>
        </div>
        <nav className="flex flex-col gap-2 sm:ml-auto" aria-label="Legal">
          <Link href="/disclaimer" className="hover:text-ink">Disclaimer</Link>
          <Link href="/terms" className="hover:text-ink">Terms of use</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy policy</Link>
          <a href={`mailto:${CONTACT}`} className="hover:text-ink">{CONTACT}</a>
        </nav>
      </div>
      <p className="mt-8 text-muted">© {new Date().getFullYear()} My Trading View · mytradingview.in</p>
    </footer>
  );
}
