import type { Metadata } from 'next';
import { BacktestModule } from '@/components/backtest/backtest-module';

export const metadata: Metadata = {
  title: 'Options backtest',
  description: 'Backtest NIFTY and BANKNIFTY option strategies on NSE’s official F&O end-of-day data, with expiry settlement and every charge.',
};

export default function OptionsBacktestPage() {
  return <BacktestModule mode="options" />;
}
