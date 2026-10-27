import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  CandlestickChart,
  FlaskConical,
  Layers,
  LineChart,
  NotebookPen,
  Radar,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';
import { LANDING } from '@/lib/site-mode';

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@mytradingview.in';
const BETA_MAIL = `mailto:${CONTACT}?subject=${encodeURIComponent('My Trading View beta access')}`;

const MODULES = [
  { icon: CandlestickChart, name: 'Charts', text: 'The TradingView-style workspace traders already know: drawing tools, multi-pane indicators, Heikin Ashi, multi-chart layouts and saved templates.' },
  { icon: Table2, name: 'Option chain', text: 'Live strike ladder with OI, change in OI, IV and Greeks, plus PCR, max pain and ATM straddle for every index and F&O stock.' },
  { icon: LineChart, name: 'Futures', text: 'Basis and premium to spot, open interest, rollover and build-up classification: long build-up, short covering and more.' },
  { icon: Radar, name: 'Signals', text: 'Rule-based buy and sell signals. Each one shows its exact rules, backtest hit-rate and drawdown, and is tracked live.' },
  { icon: FlaskConical, name: 'Backtesting', text: 'Test equity and options strategies on historical data with Indian costs, lot sizes and expiries built in.' },
  { icon: NotebookPen, name: 'Paper trading', text: 'Practise with virtual funds on market prices. Orders, positions and P&L behave like a real broker terminal.' },
  { icon: Bot, name: 'Algo trading', text: 'Connect your broker and automate strategies under SEBI’s retail algo framework, with risk limits on every order.' },
  { icon: BarChart3, name: 'Research', text: 'Scanners for OI build-up, breakouts and volume shocks, market breadth and FII / DII flows in one place.' },
];

const PRINCIPLES = [
  { icon: Layers, title: 'One workspace, not ten tabs', text: 'Chart, option chain, signals and orders sit side by side. Click a strike to chart it; click a price to place a paper order.' },
  { icon: ShieldCheck, title: 'Transparent by design', text: 'No tips and no promised returns. Every signal publishes its rules and its record, wins and losses alike.' },
  { icon: BellRing, title: 'Built for Indian markets', text: 'IST sessions, NSE, BSE and NFO instruments, weekly expiries, lot sizes, MIS / NRML products and Indian brokers.' },
];

const FAQ = [
  { q: 'Is My Trading View investment advice?', a: 'No. It is a charting, research and practice tool. Signals are generated from published rules for research purposes. We are not a SEBI-registered investment adviser or research analyst. Trading in securities is subject to market risk.' },
  { q: 'Is the market data live?', a: 'During the beta, prices may be delayed and every screen says so. Live data arrives with broker connections, starting with Zerodha Kite Connect.' },
  { q: 'Which brokers will be supported?', a: 'Zerodha first, then Upstox, Dhan, Angel One and Fyers. Your broker login stays with your broker.' },
  LANDING
    ? { q: 'What does it cost?', a: 'There will be a Free plan with delayed charts, backtesting and paper trading, and a Live plan with real-time NSE data. Prices will be announced at launch.' }
    : { q: 'What does it cost?', a: 'The Free plan costs nothing: delayed charts, backtesting and paper trading. The Live plan adds real-time NSE data; see the pricing page.' },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <header className="flex h-[72px] items-center gap-6">
        <Link href="/" aria-label="My Trading View home">
          <Logo />
        </Link>
        <nav className="ml-auto hidden items-center gap-1 rounded-full bg-panel p-1 shadow-[var(--shadow-panel)] md:flex" aria-label="Sections">
          {[
            ['#modules', 'Modules'],
            ['#why', 'Why us'],
            ['#faq', 'FAQ'],
            ...(LANDING ? [] : [['/chart', 'Free charts'], ['/pricing', 'Pricing']]),
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full px-4 py-1.5 text-[13.5px] font-semibold text-ink-2 hover:bg-raised hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <a href={BETA_MAIL} className="ml-auto rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-black md:ml-0">
          Join the beta
        </a>
      </header>

      <section className="pt-10 pb-12 text-center sm:pt-16">
        <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3.5 py-1.5 text-[12.5px] font-semibold shadow-[var(--shadow-panel)]">
          <span className="live-dot h-2 w-2 rounded-full bg-up" aria-hidden="true" />
          Beta for NSE &amp; BSE traders
        </span>
        <h1 className="mx-auto mt-6 max-w-[900px] text-[clamp(36px,6vw,68px)] leading-[1.36] font-extrabold tracking-[-0.045em]">
          India&rsquo;s all-in-one <span className="rounded-[0.16em] bg-accent px-[0.12em] text-accent-ink [box-decoration-break:clone]">trading workspace</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[640px] text-[17px] leading-relaxed text-ink-2">
          Charts with every indicator, live option chains, futures analytics, rule-based signals, backtesting and paper trading. One terminal, built for the Indian market.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={BETA_MAIL} className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 font-bold text-white hover:bg-black">
            Request beta access <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a href="#modules" className="rounded-full bg-panel px-6 py-3 font-bold shadow-[var(--shadow-panel)] hover:bg-raised">
            Explore the modules
          </a>
        </div>
      </section>

      <figure className="panel overflow-hidden p-2 shadow-[var(--shadow-pop)]">
        <Image
          src="/terminal.png"
          alt="My Trading View terminal: a NIFTY chart with VWAP and Supertrend, an option chain with OI bars and a paper-trading positions panel"
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
              <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-ink text-accent">
                <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[16px] font-extrabold tracking-[-0.02em]">{name}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="why" className="scroll-mt-6 pt-24">
        <div className="panel grid gap-8 bg-ink p-8 text-white sm:p-10 lg:grid-cols-3">
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
            <h2 className="text-[26px] font-extrabold tracking-[-0.03em]">Be among the first traders in</h2>
            <p className="mt-1 text-ink-2">Free during the beta. Tell us what you trade and we&rsquo;ll send an invite.</p>
          </div>
          <a href={BETA_MAIL} className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-accent-ink hover:brightness-95 sm:ml-auto">
            Request beta access <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
