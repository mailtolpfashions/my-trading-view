import type { Metadata } from 'next';
import { BasicChart, type ChartTf } from '@/components/chart/basic-chart';

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ tf?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).symbol).toUpperCase() };
}

export default async function ChartPage({ params, searchParams }: Props) {
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  const tf = (await searchParams).tf;
  const ok: ChartTf[] = ['1m', '5m', '15m', '1h', 'D', 'W', 'M'];
  return <BasicChart key={symbol} symbol={symbol} tf={ok.includes(tf as ChartTf) ? (tf as ChartTf) : 'D'} />;
}
