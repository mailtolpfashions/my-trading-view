import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Terminal } from '@/components/terminal/terminal';
import { getSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Free NSE charts',
  description: 'Free charts for NSE stocks and indices with every indicator, multi-timeframe candles and a watchlist. Prices delayed 15 minutes. No sign-up needed.',
};
export const dynamic = 'force-dynamic';

/** Public chart page: anyone can open it without an account (delayed data). Signed-in users get the full terminal. */
export default async function ChartPage() {
  if (await getSession()) redirect('/terminal');
  return <Terminal user={null} />;
}
