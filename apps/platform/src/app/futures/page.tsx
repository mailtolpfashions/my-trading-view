import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FuturesView } from '@/components/futures/futures-view';

export const metadata: Metadata = {
  title: 'Futures by day',
  description: 'Index and stock futures from NSE’s end-of-day files: premium to spot, open interest and build-up, day by day.',
};

export default function FuturesPage() {
  return <Suspense><FuturesView /></Suspense>;
}
