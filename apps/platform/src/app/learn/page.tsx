import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ARTICLES, TOPICS } from '@/lib/learn';

export const metadata: Metadata = {
  title: 'Learn',
  description: 'Short, plain explanations of option chains, open interest, volatility and F&O mechanics, each linked to a tool on NSE data.',
};

export default function LearnIndex() {
  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-6 pt-3 pb-8">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">Learn</h1>
          <p className="mt-1 text-[14px] text-ink-2">Short explanations of the ideas behind the tools, each with a link to see it on NSE&rsquo;s own data.</p>
        </div>
        {TOPICS.map((topic) => (
          <section key={topic} aria-labelledby={`t-${topic}`}>
            <h2 id={`t-${topic}`} className="eyebrow mb-2">{topic}</h2>
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {ARTICLES.filter((a) => a.topic === topic).map((a) => (
                <li key={a.slug}>
                  <Link href={`/learn/${a.slug}`} className="panel group flex h-full flex-col p-4 hover:ring-2 hover:ring-accent">
                    <span className="text-[15px] font-bold group-hover:text-accent-deep">{a.title}</span>
                    <span className="mt-1 flex-1 text-[13px] leading-relaxed text-ink-2">{a.summary}</span>
                    <span className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-accent-deep">Read <ArrowRight size={13} aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
