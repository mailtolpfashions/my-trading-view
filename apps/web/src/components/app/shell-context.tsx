'use client';

import { createContext, useContext } from 'react';
import type { Quote } from '@mtv/shared';
import type { TerminalUser } from '@/components/terminal/user-menu';

export type Shell = {
  /** Null for a visitor without an account. */
  user: TerminalUser | null;
  /** Last NSE closes for the ribbon and the watchlist, and their trading day. */
  quotes: Record<string, Quote>;
  asOf: string | null;
  watch: string[];
  setWatch: (w: string[]) => void;
  openSearch: (mode: 'chart' | 'watch') => void;
  /** Opens a symbol's daily chart page. */
  openChart: (symbol: string) => void;
  notify: (message: string) => void;
};

export const ShellContext = createContext<Shell | null>(null);
export function useShell(): Shell {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell outside AppShell');
  return s;
}

export const PULSE = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYIT', 'INDIAVIX'];
export const PULSE_NAMES: Record<string, string> = { NIFTY: 'NIFTY 50', BANKNIFTY: 'BANK NIFTY', FINNIFTY: 'FIN NIFTY', MIDCPNIFTY: 'MIDCAP SELECT', NIFTYIT: 'NIFTY IT', INDIAVIX: 'INDIA VIX' };
export const DEFAULT_WATCH = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'INDIAVIX', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'BHARTIARTL', 'ITC', 'LT', 'AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 'MARUTI'];
/** Path of a symbol's chart page. */
export const chartHref = (symbol: string) => `/chart/${encodeURIComponent(symbol)}`;
