// The owner's saved screens, watchlists and recent runs, kept by the data service (apps/feed/src/user/store.ts).

import type { Tf } from '@mtv/rules';
import { feed } from './feed';
import type { Screen } from './screener';

export type Category = 'technical' | 'fundamental' | 'fno' | 'custom';
export const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'technical', label: 'Technical' }, { value: 'fundamental', label: 'Fundamental' }, { value: 'fno', label: 'F&O' }, { value: 'custom', label: 'Custom' },
];

export type RunRecord = { at: string; asOf: string | null; matches: number; scanned: number; ms: number };
export type SavedScreen = Omit<Screen, 'name'> & { id: string; name: string; category: Category; favourite: boolean; createdAt: string; updatedAt: string; runs: RunRecord[] };
export type Watchlist = { id: string; name: string; symbols: string[]; createdAt: string; updatedAt: string };
export type RecentRun = RunRecord & { screenId: string | null; name: string; formula: string; tf: Tf };

export const userApi = {
  screens: () => feed<SavedScreen[]>('user/screens'),
  saveScreen: (s: Screen & { id?: string; category: Category }) => feed<SavedScreen>('user/screens', s),
  deleteScreen: (id: string) => feed<{ ok: true }>('user/screens/delete', { id }),
  favourite: (id: string, favourite: boolean) => feed<SavedScreen>('user/screens/favourite', { id, favourite }),
  recent: () => feed<RecentRun[]>('user/recent'),
  watchlists: () => feed<Watchlist[]>('user/watchlists'),
  saveWatchlist: (w: { id?: string; name: string; symbols: string[] }) => feed<Watchlist>('user/watchlists', w),
  addToWatchlist: (id: string, symbols: string[]) => feed<Watchlist>('user/watchlists/add', { id, symbols }),
  deleteWatchlist: (id: string) => feed<{ ok: true }>('user/watchlists/delete', { id }),
};

const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
/** "5 minutes ago", "yesterday", "3 days ago". */
export function ago(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'just now';
}
