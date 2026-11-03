import { redirect } from 'next/navigation';

// Stocks and indices are backtested in Strategies now; old links and bookmarks to /backtest land there.
export default function BacktestHome() {
  redirect('/strategies');
}
