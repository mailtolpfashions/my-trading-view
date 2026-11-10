import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ScreenerWorkspace } from '@/components/screener/screener-workspace';

export const metadata: Metadata = { title: 'Scanner' };

export default function ScannerPage() {
  // The workspace reads ?watchlist= from the URL, which needs a Suspense boundary.
  return <Suspense><ScreenerWorkspace /></Suspense>;
}
