import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  CandlestickChart,
  Calculator,
  History,
  FlaskConical,
  Layers,
  LineChart,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';
import { LANDING, PAID_PLANS } from '@/lib/site-mode';
import { ThemeToggle } from '@/components/theme-toggle';

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@nandibull.in';
const BETA_MAIL = `mailto:${CONTACT}?subject=${encodeURIComponent('Nandibull beta access')}`;
/** Landing mode collects beta requests; otherwise the terminal is open to everyone. */
const CTA = LANDING ? BETA_MAIL : '/dashboard';

const MODULES = [
  { icon: FlaskConical, name: 'Backtesting', text: 'Test stock and options strategies on years of NSE end-of-day history, with every Indian charge (brokerage, STT, exchange fees, stamp duty, GST) at the rate in force on each trade date.' },
  { icon: Calculator, name: 'Option strategy builder', text: 'Payoff at expiry and before it, Greeks, breakevens after charges, margin computed from NSE Clearing’s SPAN file with hedge benefit, and what-if: move NIFTY, the date or IV and see every premium.' },
  { icon: Table2, name: 'Option chain', text: 'NSE’s end-of-day strike ladder with OI, IV and Greeks for NIFTY and BANKNIFTY: the starting point for building strategies.' },
  { icon: LineChart, name: 'Futures', text: 'Basis and premium to spot, open interest, rollover and build-up classification from NSE’s end-of-day F&O files.' },
  { icon: CandlestickChart, name: 'Charts', text: 'A full charting workspace on daily, weekly and monthly NSE data: indicators, drawing tools, Fibonacci and channels.' },
  { icon: BarChart3, name: 'Research', text: 'NIFTY day by day, month by month and year by year from NSE’s own files, with crisis periods you can isolate, plus a scanner for your own conditions.' },
  { icon: History, name: 'Practice mode', text: 'Coming next: replay history bar by bar from a date at least 30 days back and practise entries and exits with real charges.' },
];

const PRINCIPLES = [
  { icon: Layers, title: 'Research, not tips', text: 'You build and test your own ideas. We provide the data, the maths and the costs; no calls, no promised returns.' },
  { icon: ShieldCheck, title: 'Official data, shown as published', text: 'Prices come from NSE’s official end-of-day files. Gaps and corrections are reported, never filled or hidden.' },
  { icon: BellRing, title: 'Built for Indian markets', text: 'NSE instruments, weekly expiries, lot sizes, SPAN margin, STT and every other Indian charge built in.' },
];

const FAQ = [
  { q: 'Is Nandibull investment advice?', a: 'No. It is a research, backtesting and strategy-building tool. We do not give buy or sell calls. We are not a SEBI-registered investment adviser or research analyst. Trading in securities is subject to market risk.' },
  { q: 'Is the market data live?', a: 'No. Nandibull is for analysis and research: every price is from NSE’s official end-of-day files and is shown with its date. Use your broker for live prices and orders.' },
  { q: 'How far back does the data go?', a: 'Stocks and indices from mid-2011, NIFTY and BANKNIFTY options and futures from 2011, all from NSE’s archive.' },
  LANDING
    ? { q: 'What does it cost?', a: 'There will be a Free plan and a paid plan. Prices will be announced at launch.' }
    : PAID_PLANS
      ? { q: 'What does it cost?', a: 'The Free plan costs nothing. See the pricing page for the paid plan.' }
      : { q: 'What does it cost?', a: 'Nothing. Everything is free. Without an account you get a few backtests, studies and scans a day; sign in with Google (free) for unlimited use.' },
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
            ['#modules', 'Modules'],
            ['#why', 'Why us'],
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
          {LANDING ? 'Join the beta' : 'Open the dashboard'}
        </a>
      </header>

      <section className="pt-10 pb-12 text-center sm:pt-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-1.5 text-[12.5px] font-semibold shadow-[var(--shadow-panel)]">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          Beta · NSE end-of-day data
        </span>
        <h1 className="mx-auto mt-6 max-w-[900px] text-[clamp(36px,6vw,68px)] leading-[1.36] font-extrabold tracking-[-0.045em]">
          Research and backtest the <span className="rounded-[0.16em] bg-accent px-[0.12em] text-accent-ink [box-decoration-break:clone]">Indian market</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[640px] text-[17px] leading-relaxed text-ink-2">
          Backtest stock and options strategies, build option strategies with exact NSE margin and charges, and study years of NSE data, all on official end-of-day prices.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={CTA} className="inline-flex items-center gap-2 rounded-full bg-inverse px-6 py-3 font-bold text-on-inverse hover:bg-inverse-hover">
            {LANDING ? 'Request beta access' : 'Start free, no sign-up'} <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a href="#modules" className="rounded-full bg-panel px-6 py-3 font-bold shadow-[var(--shadow-panel)] hover:bg-raised">
            Explore the modules
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
        <figcaption className="px-2 pt-2 pb-1 text-left text-[12px] text-muted">Product preview. Prices shown are sample data.</figcaption>
      </figure>

      <section id="modules" className="scroll-mt-6 pt-24">
        <p className="eyebrow">Modules</p>
        <h2 className="mt-2 max-w-[640px] text-[clamp(28px,4vw,40px)] leading-tight font-extrabold tracking-[-0.035em]">
          Everything from the first chart to the final order
        </h2>
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

      <section id="why" className="scroll-mt-6 pt-24">
        <div className="panel grid gap-8 bg-deep p-8 text-white sm:p-10 lg:grid-cols-3">
          {PRINCIPLES.map(({ icon: Icon, title, text }) => (
            <div key={title}>
              <Icon size={22} className="text-accent" strokeWidth={1.9} aria-hidden="true" />
              <h3 className="mt-4 text-[18px] font-extrabold tracking-[-0.02em]">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="scroll-mt-6 pt-24">
        <p className="eyebrow">FAQ</p>
        <h2 className="mt-2 text-[clamp(28px,4vw,40px)] font-extrabold tracking-[-0.035em]">Good questions</h2>
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
            <h2 className="text-[26px] font-extrabold tracking-[-0.03em]">{LANDING ? 'Be among the first traders in' : 'Free for everyone'}</h2>
            <p className="mt-1 text-ink-2">{LANDING ? <>Free during the beta. Tell us what you trade and we&rsquo;ll send an invite.</> : 'Try it without signing up. Sign in with Google for unlimited backtests, studies and scans.'}</p>
          </div>
          <a href={CTA} className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-accent-ink hover:brightness-95 sm:ml-auto">
            {LANDING ? 'Request beta access' : 'Open the dashboard'} <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
