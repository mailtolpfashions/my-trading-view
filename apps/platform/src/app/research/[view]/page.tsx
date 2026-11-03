import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResearchModule } from '@/components/research/research-module';
import { RESEARCH_VIEWS, type ResearchSlug } from '@/lib/research-views';

type Props = { params: Promise<{ view: string }> };
const DESCRIPTIONS: Record<ResearchSlug, string> = {
  study: 'Test a condition on NSE history: what followed, counted day by day, month by month and year by year.',
  'nifty-days': 'Every NIFTY session from NSE’s official closes, by day, month and year, with market events marked.',
  fii: 'FII positions in index futures and options from NSE’s participant-wise open interest, with NSDL FPI flows.',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).view;
  const v = RESEARCH_VIEWS.find((x) => x.slug === slug);
  return v ? { title: v.label, description: DESCRIPTIONS[v.slug] } : {};
}

export default async function ResearchPage({ params }: Props) {
  const view = (await params).view;
  if (!RESEARCH_VIEWS.some((x) => x.slug === view)) notFound();
  return <ResearchModule view={view as ResearchSlug} />;
}
