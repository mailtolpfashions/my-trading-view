// The Kite connection and the live-data service's state (apps/feed/src/intraday/live.ts).

import { feed } from './feed';

export type LiveStatus = {
  configured: boolean;
  state: 'off' | 'login-required' | 'starting' | 'live' | 'error';
  message: string | null;
  userName: string | null;
  expiresAt: number | null;
  stocks: number;
  lastTickAt: number | null;
  today: { running: boolean; done: number; total: number };
  history: { running: boolean; done: number; total: number; failed: number; days: number; finishedAt: number | null };
  correctedOn: string | null;
  options: { contracts: number; minutesToday: number };
  liveCheck?: { date: string; stocks: number; minutes: number; closeSamePct: number; highLowSamePct: number; volumeWithin1Pct: number; missedMinutes: number } | null;
};

export const liveApi = {
  status: () => feed<LiveStatus>('kite/status'),
  logout: () => feed<{ ok: true }>('kite/logout', {}),
  /** A plain navigation: the data service redirects to Zerodha's login, which returns to /connect. */
  loginHref: '/api/feed/kite/login?back=platform',
};
