import type { Metadata } from 'next';
import { BacktestModule } from '@/components/backtest/backtest-module';

export const metadata: Metadata = {
  title: 'Backtest stock and index strategies',
  description: 'Backtest indicator strategies on NSE stocks and indices with real Indian charges, on adjusted end-of-day data.',
};

export default function BacktestPage() {
  return <BacktestModule mode="stocks" />;
}
