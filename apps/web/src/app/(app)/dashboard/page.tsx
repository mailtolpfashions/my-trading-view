import type { Metadata } from 'next';
import { Dashboard } from '@/components/app/dashboard';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'The last NSE session at a glance: index closes, NIFTY 50 gainers and losers, NIFTY 500 breadth and the FII footprint, from NSE’s official files.',
};

export default function DashboardPage() {
  return <Dashboard />;
}
