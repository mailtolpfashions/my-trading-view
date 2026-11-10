import type { Metadata } from 'next';
import { TradeLabPage } from '@/components/tradelab/tradelab-page';

export const metadata: Metadata = { title: 'Trade lab', description: 'Paper trading of NSE stocks, futures and options on live prices.' };

export default function Page() {
  return <TradeLabPage />;
}
