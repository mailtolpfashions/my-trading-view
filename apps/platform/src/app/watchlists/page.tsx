import type { Metadata } from 'next';
import { WatchlistsPage } from '@/components/watchlists/watchlists-page';

export const metadata: Metadata = { title: 'Watchlists' };

export default function Page() {
  return <WatchlistsPage />;
}
