import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ARTICLES, articleBySlug } from '@/lib/learn';

type Props = { params: Promise<{ slug: string }> };

export const generateStaticParams = () => ARTICLES.map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = articleBySlug((await params).slug);
  return a ? { title: a.title, description: a.summary } : {};
}

export default async function ArticlePage({ params }: Props) {
  const a = articleBySlug((await params).slug);
  if (!a) notFound();
  const i = ARTICLES.indexOf(a);
  const next = ARTICLES[(i + 1) % ARTICLES.length];
  return (
    <div className="min-h-0 overflow-y-auto">
      <article className="mx-auto max-w-[720px] pt-3 pb-10">
        <Link href="/learn" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden="true" /> Learn</Link>
        <p className="eyebrow mt-4">{a.topic}</p>
        <h1 className="mt-1 text-[30px] leading-tight font-bold tracking-[-0.03em]">{a.title}</h1>
        <p className="mt-2 text-[15px] text-ink-2">{a.summary}</p>
        <div className="mt-6 space-y-6">
          {a.sections.map((s, k) => (
            <section key={k}>
              {s.h && <h2 className="mb-2 text-[18px] font-bold tracking-[-0.01em]">{s.h}</h2>}
              <div className="space-y-3 text-[15px] leading-[1.75] text-ink-2">{s.p.map((t, j) => <p key={j}>{t}</p>)}</div>
            </section>
          ))}
        </div>
        <div className="panel mt-8 p-4">
          <p className="text-[13px] font-bold">See it on NSE data</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {a.tools.map((t) => (
              <Link key={t.href} href={t.href} className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-[13px] font-semibold text-accent-deep hover:bg-accent hover:text-accent-ink">{t.label} <ArrowRight size={13} aria-hidden="true" /></Link>
            ))}
          </div>
        </div>
        <Link href={`/learn/${next.slug}`} className="mt-4 flex items-center justify-between rounded-[14px] px-4 py-3 hover:bg-panel">
          <span><span className="block text-[11.5px] text-muted">Next</span><span className="text-[14px] font-semibold">{next.title}</span></span>
          <ArrowRight size={16} className="text-muted" aria-hidden="true" />
        </Link>
        <p className="mt-6 text-[12px] text-muted">For learning only, not investment advice.</p>
      </article>
    </div>
  );
}
