import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OptionTool } from '@/components/tools/option-tool';
import { OPTION_TOOLS } from '@/lib/tools';

type Props = { params: Promise<{ tool: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).tool;
  const t = OPTION_TOOLS.find((x) => x.slug === slug);
  return t ? { title: t.label, description: t.description } : {};
}

export default async function OptionToolPage({ params }: Props) {
  const slug = (await params).tool;
  if (!OPTION_TOOLS.some((x) => x.slug === slug)) notFound();
  return <Suspense><OptionTool slug={slug} /></Suspense>;
}
