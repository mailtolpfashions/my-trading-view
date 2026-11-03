import type { Metadata } from 'next';
import { ChartWorkspace } from '@/components/terminal/chart-workspace';

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  return {
    title: `${symbol} chart`,
    description: `${symbol} daily, weekly and monthly chart on NSE’s official end-of-day data, adjusted for splits and bonuses, with indicators and drawing tools.`,
  };
}

export default async function ChartPage({ params }: Props) {
  return <ChartWorkspace symbol={decodeURIComponent((await params).symbol).toUpperCase()} />;
}
