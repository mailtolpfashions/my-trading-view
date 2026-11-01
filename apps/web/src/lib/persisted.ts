'use client';

import { useCallback, useEffect, useState } from 'react';

/** Per-viewer preferences kept in this browser only; the page works fine without them. */
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw));
    } catch { /* storage unavailable */ }
  }, [key]);
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [key]);
  return [v, set];
}

export function readPersisted<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
export function writePersisted(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

/** Charts opened recently (most recent first), for the dashboard. */
export const RECENT_KEY = 'mtv.recent';
export function rememberChart(symbol: string) {
  writePersisted(RECENT_KEY, [symbol, ...readPersisted<string[]>(RECENT_KEY, []).filter((s) => s !== symbol)].slice(0, 8));
  writePersisted('mtv.lastSymbol', symbol);
}
