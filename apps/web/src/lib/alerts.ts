import type { RuleSet } from '@mtv/backtest';
import type { Timeframe } from '@mtv/shared';
import { FEED_URL, feedFetch } from './feed';

export type AlertRow = {
  id: string; symbol: string; kind: 'PRICE' | 'RULES'; status: 'ACTIVE' | 'PAUSED' | 'TRIGGERED'; repeat: 'once' | 'every';
  params: { op: 'crossesAbove' | 'crossesBelow'; valuePaise: number } | { tf: Timeframe; rules: RuleSet };
  note: string | null; createdAt: string; lastTriggeredAt: string | null;
};
export type AlertEventRow = { id: string; alertId: string; symbol: string; message: string; price: number; marketTime: string; triggeredAt: string; emailStatus: string; seen: boolean };
export type AlertsResponse = { alerts: AlertRow[]; events: AlertEventRow[]; limit: number; used: number; emailEnabled: boolean };

export type NewAlert =
  | { symbol: string; kind: 'PRICE'; params: { op: 'crossesAbove' | 'crossesBelow'; value: number }; note?: string; repeat: 'once' | 'every' }
  | { symbol: string; kind: 'RULES'; params: { tf: Timeframe; rules: RuleSet }; note?: string; repeat: 'once' | 'every' };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type only with a body: the server rejects an empty body declared as JSON (e.g. DELETE).
  const res = await feedFetch(`${FEED_URL}/api/alerts${path}`, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Alerts are unavailable right now');
  return body as T;
}

export const fetchAlerts = () => call<AlertsResponse>('');
export const createAlert = (a: NewAlert) => call<AlertRow>('', { method: 'POST', body: JSON.stringify(a) });
export const setAlertStatus = (id: string, status: 'ACTIVE' | 'PAUSED') => call<{ ok: true }>(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const deleteAlert = (id: string) => call<{ ok: true }>(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const markAlertsSeen = () => call<{ ok: true }>('/seen', { method: 'POST', body: '{}' });

export const TF_LABEL: Record<string, string> = { '5': '5 min', '15': '15 min', '60': '1 hour', D: 'Daily' };
