'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { InfoTip } from '@/components/info-tip';
import { ARTICLES } from '@/lib/learn';
import { FUTURES_TOOLS, MARKET_TOOLS, OPTION_TOOLS, UTILITY_TOOLS, type Tool, type ToolGroup } from '@/lib/tools';

const DATA_NOTE: Record<ToolGroup, string> = {
  options: 'Data: NSE’s official end-of-day F&O files (bhavcopy). Closing prices, not live. IV, Greeks and gamma are model estimates.',
  futures: 'Data: NSE’s official end-of-day F&O files (bhavcopy). Closing prices, not live.',
  market: 'Data: NSE’s official index closes and end-of-day equity files, with prices adjusted for splits and bonuses. Not live.',
  utility: 'Data: NSE’s official end-of-day files. Calculations run in your browser.',
};

/** The pages to switch between for a tool's group. */
const siblingsOf = (tool: Tool) => tool.group === 'options'
  ? OPTION_TOOLS.map((t) => ({ slug: t.slug, label: t.label, href: `/options/${t.slug}` }))
  : tool.group === 'futures'
    ? [{ slug: '', label: 'Futures by day', href: '/futures' }, ...FUTURES_TOOLS.map((t) => ({ slug: t.slug, label: t.label, href: `/futures/${t.slug}` }))]
    : tool.group === 'market'
      ? [...MARKET_TOOLS.map((t) => ({ slug: t.slug, label: t.label, href: `/market/${t.slug}` })), { slug: 'fii', label: 'FII footprints', href: '/research/fii' }]
      : UTILITY_TOOLS.map((t) => ({ slug: t.slug, label: t.label, href: `/tools/${t.slug}` }));

/**
 * Frame of an analysis tool: title and switcher, a row of controls, the content, and a plain note on how the
 * numbers are calculated and where they come from. Scrolls as one column.
 */
export function ToolShell({ tool, controls, children, about, dataNote }: { tool: Tool; controls?: React.ReactNode; children: React.ReactNode; about?: React.ReactNode; dataNote?: string }) {
  const params = useSearchParams();
  const u = params.get('u');
  const siblings = siblingsOf(tool);
  const href = siblings.find((s) => s.slug === tool.slug)?.href;
  const learn = href ? ARTICLES.find((a) => a.tools.some((t) => t.href.split('?')[0] === href)) : undefined;
  return (
    <div className="flex min-h-0 flex-col gap-3 pt-1 lg:overflow-y-auto lg:pr-1 [&>*]:shrink-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-nowrap">
        <h1 className="flex shrink-0 items-center gap-1.5 text-[20px] font-extrabold tracking-[-0.02em]" title={tool.description}>
          {tool.label}
          <InfoTip label={`About ${tool.label}`}>
            <p className="font-semibold text-ink">{tool.description}</p>
            {about}
            <p className="text-muted">{dataNote ?? DATA_NOTE[tool.group]}</p>
            {learn && <p><Link href={`/learn/${learn.slug}`} className="font-semibold text-accent-deep hover:underline">Learn: {learn.title} →</Link></p>}
          </InfoTip>
        </h1>
        {siblings.length > 0 && (
          <nav aria-label="Related tools" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:thin]">
            <ul className="flex gap-1.5 pb-1">
              {siblings.map((t) => (
                <li key={t.slug}>
                  <Link href={`${t.href}${u ? `?u=${encodeURIComponent(u)}` : ''}`} aria-current={t.slug === tool.slug ? 'page' : undefined}
                    className={`block rounded-full px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap ${t.slug === tool.slug ? 'bg-accent-soft text-accent-deep' : 'bg-panel text-ink-2 shadow-[var(--shadow-panel)] hover:text-ink'}`}>{t.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      {children}
    </div>
  );
}

/** A titled panel. */
export function Card({ title, right, children, className = '' }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel flex min-w-0 flex-col overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-[13px] font-bold">{title}</h2>}
          {right && <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Colour key for a chart legend. */
export function Key({ color, label, dashed, bar }: { color: string; label: string; dashed?: boolean; bar?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {bar ? <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        : <i className="inline-block w-4" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />}
      {label}
    </span>
  );
}
