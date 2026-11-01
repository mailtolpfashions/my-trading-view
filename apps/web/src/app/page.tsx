import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BarChart3, CandlestickChart, Calculator, History, FlaskConical, LineChart, Table2 } from 'lucide-react';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';
import { LANDING, PAID_PLANS } from '@/lib/site-mode';
import { ThemeToggle } from '@/components/theme-toggle';

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@nandibull.in';
const BETA_MAIL = `mailto:${CONTACT}?subject=${encodeURIComponent('Nandibull beta access')}`;
/** Landing mode collects beta requests; otherwise the terminal is open to everyone. */
const CTA = LANDING ? BETA_MAIL : '/dashboard';

const MODULES = [
  { icon: FlaskConical, name: 'Backtesting', text: 'Test stock and option strategies on NSE history from 2011. Brokerage, STT, exchange fees, stamp duty and GST are charged at the rates that applied on each trade date.' },
  { icon: Calculator, name: 'Strategy builder', text: 'Payoff, Greeks and breakevens after charges. Margin is worked out from NSE’s SPAN file, including hedge benefit. Change the price, date or IV to see how the position moves.' },
  { icon: Table2, name: 'Option chain', text: 'NIFTY and BANKNIFTY strikes with OI, IV and Greeks from NSE’s closing data.' },
  { icon: LineChart, name: 'Futures', text: 'Premium to spot, open interest, rollover and daily build-up from NSE’s F&O files.' },
  { icon: CandlestickChart, name: 'Charts', text: 'Daily, weekly and monthly charts with indicators and drawing tools.' },
  { icon: BarChart3, name: 'Research', text: 'NIFTY by day, month and year, FII positions, condition studies and a stock scanner.' },
  { icon: History, name: 'Practice mode', text: 'Coming soon. Replay past days bar by bar and practise entries and exits.' },
];

const FAQ = [
  { q: 'Is this investment advice?', a: 'No. Nandibull is a research and backtesting tool. We don’t give buy or sell calls, and we are not registered with SEBI as an investment adviser or research analyst.' },
  { q: 'Are prices live?', a: 'No. All prices are NSE’s end-of-day data and each one shows its date. Use your broker for live prices and orders.' },
  { q: 'How far back does the data go?', a: 'Stocks, indices, and NIFTY and BANKNIFTY futures and options go back to 2011.' },
  LANDING
    ? { q: 'Is it free?', a: 'It is free during the beta. Pricing will be announced at launch.' }
    : PAID_PLANS
      ? { q: 'Is it free?', a: 'There is a free plan. See the pricing page for the paid plan.' }
      : { q: 'Is it free?', a: 'Yes. Without an account you get a few backtests, studies and scans a day. Sign in with Google to remove the limit.' },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <header className="flex h-[72px] items-center gap-6">
        <Link href="/" aria-label="Nandibull home">
          <Logo />
        </Link>
        <nav className="ml-auto hidden items-center gap-1 rounded-full bg-panel p-1 shadow-[var(--shadow-panel)] md:flex" aria-label="Sections">
          {[
            ['#features', 'Features'],
            ['#faq', 'FAQ'],
            ...(PAID_PLANS && !LANDING ? [['/pricing', 'Pricing']] : []),
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full px-4 py-1.5 text-[13.5px] font-semibold text-ink-2 hover:bg-raised hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <span className="ml-auto md:ml-0"><ThemeToggle /></span>
        <a href={CTA} className="rounded-full bg-inverse px-5 py-2.5 text-[13.5px] font-bold text-on-inverse hover:bg-inverse-hover md:ml-0">
          {LANDING ? 'Join the beta' : 'Open app'}
        </a>
      </header>

      <section className="pt-10 pb-12 text-center sm:pt-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-1.5 text-[12.5px] font-semibold shadow-[var(--shadow-panel)]">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          Beta
        </span>
        <h1 className="mx-auto mt-6 max-w-[900px] text-[clamp(36px,6vw,68px)] leading-[1.36] font-extrabold tracking-[-0.045em]">
          Research and backtest the <span className="rounded-[0.16em] bg-accent px-[0.12em] text-accent-ink [box-decoration-break:clone]">Indian market</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[640px] text-[17px] leading-relaxed text-ink-2">
          Charts, backtests, option strategies and market research on NSE end-of-day data.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={CTA} className="inline-flex items-center gap-2 rounded-[12px] bg-inverse px-6 py-3 font-bold text-on-inverse hover:bg-inverse-hover">
            {LANDING ? 'Request access' : 'Get started'} <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a href="#features" className="rounded-[12px] border border-accent px-6 py-3 font-bold text-accent-deep hover:bg-accent-soft">
            See features
          </a>
        </div>
      </section>

      <figure className="panel overflow-hidden p-2 shadow-[var(--shadow-pop)]">
        <Image
          src="/terminal.png"
          alt="Nandibull: a NIFTY daily chart on NSE end-of-day data with indicators and a watchlist"
          width={2400}
          height={1350}
          priority
          className="h-auto w-full rounded-[10px]"
        />
      </figure>

      <section id="features" className="scroll-mt-6 pt-24">
        <h2 className="text-[clamp(28px,4vw,40px)] leading-tight font-extrabold tracking-[-0.035em]">Features</h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map(({ icon: Icon, name, text }) => (
            <article key={name} className="panel p-5">
              <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-deep text-accent">
                <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[16px] font-extrabold tracking-[-0.02em]">{name}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="scroll-mt-6 pt-24">
        <h2 className="text-[clamp(28px,4vw,40px)] font-extrabold tracking-[-0.035em]">FAQ</h2>
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="panel p-6">
              <h3 className="text-[16px] font-extrabold tracking-[-0.02em]">{q}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pt-24 pb-6">
        <div className="panel flex flex-col items-start gap-5 p-8 sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="text-[26px] font-extrabold tracking-[-0.03em]">{LANDING ? 'Join the beta' : 'Try Nandibull'}</h2>
            <p className="mt-1 text-ink-2">{LANDING ? 'Email us and we’ll send you an invite.' : 'No account needed to start.'}</p>
          </div>
          <a href={CTA} className="inline-flex items-center gap-2 rounded-[12px] bg-accent px-6 py-3 font-bold text-accent-ink hover:brightness-95 sm:ml-auto">
            {LANDING ? 'Request access' : 'Get started'} <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
