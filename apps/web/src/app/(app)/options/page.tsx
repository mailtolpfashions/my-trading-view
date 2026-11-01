import type { Metadata } from 'next';
import { OptionsView } from '@/components/options/options-view';

export const metadata: Metadata = {
  title: 'Option chain, strategy builder and simulator',
  description: 'NIFTY and BANKNIFTY option chain from NSE’s official close, a strategy builder with exact NSE SPAN margin and charges, and a day-by-day simulator on past expiries.',
};

export default function OptionsPage() {
  return <OptionsView />;
}
