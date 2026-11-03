// Alerts on saved screens and strategies (apps/feed/src/alerts), and their history.

import { feed } from './feed';

export type AlertChannel = 'inApp' | 'telegram' | 'email' | 'whatsapp';
export const CHANNEL_LABEL: Record<AlertChannel, string> = { inApp: 'In the app (with a sound)', telegram: 'Telegram', email: 'Email', whatsapp: 'WhatsApp' };

export type Alert = {
  id: string; name: string; source: { kind: 'screen' | 'strategy'; id: string }; trigger: 'first' | 'every'; session: 'market' | 'always';
  channels: AlertChannel[]; until: string | null; enabled: boolean; createdAt: string; lastCheckAt: string | null; lastError: string | null; matching: string[] | null;
};
export type AlertEvent = {
  id: string; alertId: string; alertName: string; at: string; read: boolean;
  hits: { symbol: string; price: number; bar: string }[]; note: string | null; delivered: Partial<Record<AlertChannel, string>>;
};
export type ChannelInfo = { channel: AlertChannel; ready: boolean; needs: string[] };

export const alertsApi = {
  list: () => feed<Alert[]>('user/alerts'),
  save: (a: Pick<Alert, 'name' | 'source' | 'trigger' | 'session' | 'channels' | 'until'> & { id?: string }) => feed<Alert>('user/alerts', a),
  remove: (id: string) => feed<{ ok: true }>('user/alerts/delete', { id }),
  enable: (id: string, enabled: boolean) => feed<Alert>('user/alerts/enabled', { id, enabled }),
  events: () => feed<AlertEvent[]>('user/alert-events'),
  read: (ids?: string[]) => feed<{ ok: true }>('user/alert-events/read', { ids }),
  channels: () => feed<ChannelInfo[]>('alerts/channels'),
  test: (channel: AlertChannel) => feed<{ ok: true }>('alerts/test', { channel }),
};
