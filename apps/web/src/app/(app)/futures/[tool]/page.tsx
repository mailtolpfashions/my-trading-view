import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BuildUpCycleTool, MoversTool } from '@/components/tools/futures/futures-tools';
import { FUTURES_TOOLS } from '@/lib/tools';

type Props = { params: Promise<{ tool: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).tool;
  const t = FUTURES_TOOLS.find((x) => x.slug === slug);
  return t ? { title: t.label, description: t.description } : {};
}

export default async function FuturesToolPage({ params }: Props) {
  const slug = (await params).tool;
  const tool = FUTURES_TOOLS.find((x) => x.slug === slug);
  if (!tool) notFound();
  return <Suspense>{slug === 'movers' ? <MoversTool tool={tool} /> : <BuildUpCycleTool tool={tool} />}</Suspense>;
}
