import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LotSizeTool } from '@/components/tools/utility/lot-size';
import { SipTool } from '@/components/tools/utility/sip';
import { UTILITY_TOOLS } from '@/lib/tools';

type Props = { params: Promise<{ tool: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).tool;
  const t = UTILITY_TOOLS.find((x) => x.slug === slug);
  return t ? { title: t.label, description: t.description } : {};
}

export default async function UtilityToolPage({ params }: Props) {
  const slug = (await params).tool;
  const tool = UTILITY_TOOLS.find((x) => x.slug === slug);
  if (!tool) notFound();
  return <Suspense>{slug === 'lot-size' ? <LotSizeTool tool={tool} /> : <SipTool tool={tool} />}</Suspense>;
}
