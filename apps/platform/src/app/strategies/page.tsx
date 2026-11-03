import type { Metadata } from 'next';
import { StrategyWorkspace } from '@/components/strategy/strategy-workspace';

export const metadata: Metadata = { title: 'Strategies' };

export default function Page() {
  return <StrategyWorkspace />;
}
