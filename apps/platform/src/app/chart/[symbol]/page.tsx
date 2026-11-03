import type { Metadata } from 'next';
import { BasicChart } from '@/components/chart/basic-chart';

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ tf?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).symbol).toUpperCase() };
}

export default async function ChartPage({ params, searchParams }: Props) {
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  const tf = (await searchParams).tf;
  return <BasicChart key={symbol} symbol={symbol} tf={tf === 'W' || tf === 'M' ? tf : 'D'} />;
}
