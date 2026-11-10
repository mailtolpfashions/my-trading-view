'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { RESEARCH_VIEWS } from '@/lib/research-views';
import { FUTURES_TOOLS, MARKET_TOOLS, OPTION_TOOLS, UTILITY_TOOLS } from '@/lib/tools';

type Tool = { href: string; label: string; about: string };

const RESEARCH_ABOUT: Record<string, string> = {
  study: 'Test a condition on NSE history and see what followed, day by day, month by month and year by year.',
  'nifty-days': 'Every NIFTY session from NSE’s official closes, by day, month and year, with market events marked.',
  fii: 'FII positions in index futures and options, with NSDL FPI flows.',
};

/** Every tool in plain groups, one card each. */
const GROUPS: { title: string; tools: Tool[] }[] = [
  { title: 'My workspace', tools: [
    { href: '/watchlists', label: 'Watchlists', about: 'Lists of stocks you follow, with their last price. Scan a whole list in one click.' },
    { href: '/alerts', label: 'Alerts', about: 'Get told when a saved scan or strategy finds a new stock.' },
    { href: '/connect', label: 'Kite connection', about: 'Connect your Zerodha account for live prices (once a day).' },
  ] },
  { title: 'Options', tools: [
    { href: '/options', label: 'Option chain & strategy builder', about: 'Build an option trade, see its payoff, Greeks and margin, and replay it day by day.' },
    { href: '/backtest/options', label: 'Option backtest', about: 'Test an option strategy leg by leg on NSE history.' },
    ...OPTION_TOOLS.map((t) => ({ href: `/options/${t.slug}`, label: t.label, about: t.description })),
  ] },
  { title: 'Futures', tools: [{ href: '/futures', label: 'Futures overview', about: 'Every F&O future: price, open interest and what they say together.' }, ...FUTURES_TOOLS.map((t) => ({ href: `/futures/${t.slug}`, label: t.label, about: t.description }))] },
  { title: 'Market', tools: MARKET_TOOLS.map((t) => ({ href: `/market/${t.slug}`, label: t.label, about: t.description })) },
  { title: 'Research', tools: RESEARCH_VIEWS.map((v) => ({ href: `/research/${v.slug}`, label: v.label, about: RESEARCH_ABOUT[v.slug] ?? '' })) },
  { title: 'Practice and learning', tools: [
    { href: '/practice', label: 'Practice', about: 'Replay past bars one at a time and practise your trades. No real money.' },
    { href: '/learn', label: 'Learn', about: 'Short, plain guides: option chains, Greeks, open interest and more.' },
    ...UTILITY_TOOLS.map((t) => ({ href: `/tools/${t.slug}`, label: t.label, about: t.description })),
  ] },
];

export default function ToolsPage() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => !needle || `${t.label} ${t.about}`.toLowerCase().includes(needle)) })).filter((g) => g.tools.length);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">Tools</h1>
          <p className="text-[14px] text-ink-2">Everything else in one place.</p>
        </div>
        <label className="ml-auto flex h-11 w-full max-w-[340px] items-center gap-2 rounded-[12px] border border-line-strong bg-panel px-3">
          <Search size={16} className="text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tool" aria-label="Find a tool" className="w-full bg-transparent text-[14px] focus:outline-none" />
        </label>
      </div>
      {groups.map((g) => (
        <section key={g.title} className="grid gap-3">
          <h2 className="eyebrow">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.tools.map((t) => (
              <Link key={t.href} href={t.href} className="panel block p-4 transition-shadow hover:shadow-[var(--shadow-pop)]">
                <span className="block text-[15px] font-semibold text-ink">{t.label}</span>
                <span className="mt-1 line-clamp-3 block text-[13px] text-ink-2">{t.about}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {!groups.length && <p className="text-[14px] text-ink-2">No tool matches “{q}”.</p>}
    </div>
  );
}
