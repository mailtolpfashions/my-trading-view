import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BreadthTool, RrgTool } from '@/components/tools/market/market-tools';
import { MARKET_TOOLS } from '@/lib/tools';

type Props = { params: Promise<{ tool: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).tool;
  const t = MARKET_TOOLS.find((x) => x.slug === slug);
  return t ? { title: t.label, description: t.description } : {};
}

export default async function MarketToolPage({ params }: Props) {
  const slug = (await params).tool;
  const tool = MARKET_TOOLS.find((x) => x.slug === slug);
  if (!tool) notFound();
  return <Suspense>{slug === 'rrg' ? <RrgTool tool={tool} /> : <BreadthTool tool={tool} />}</Suspense>;
}
