import type { Metadata } from 'next';
import { OptionsView } from '@/components/options/options-view';

export const metadata: Metadata = {
  title: 'Option chain, strategy builder and simulator',
  description: 'Option chain for every NSE F&O index and stock from NSE’s official close, a strategy builder with NSE SPAN margin and charges, and a day-by-day simulator on past expiries.',
};

export default function OptionsPage() {
  return <OptionsView />;
}
