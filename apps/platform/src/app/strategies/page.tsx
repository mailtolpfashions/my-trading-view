import type { Metadata } from 'next';
import { StrategyWorkspace } from '@/components/strategy/strategy-workspace';

export const metadata: Metadata = { title: 'Backtest' };

export default function Page() {
  return <StrategyWorkspace />;
}
