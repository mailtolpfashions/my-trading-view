import type { Metadata } from 'next';
import { FuturesView } from '@/components/futures/futures-view';

export const metadata: Metadata = {
  title: 'NIFTY and BANKNIFTY futures',
  description: 'Index futures from NSE’s end-of-day files: premium to spot, open interest and build-up, day by day.',
};

export default function FuturesPage() {
  return <FuturesView />;
}
