// Delivery of alert messages. In-app needs nothing (events are stored and the platform shows them); the others are
// plain HTTPS calls switched on by keys in .env:
//   Telegram   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID           (free: create a bot with @BotFather)
//   Email      RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO (Resend; the sender domain must be verified there)
//   WhatsApp   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TO, WHATSAPP_TEMPLATE
//              (Meta WhatsApp Business Cloud API; messages the business starts must use an approved template with one
//               body parameter, which receives the alert text on one line: WhatsApp refuses line breaks there)

import type { AlertChannel } from '../user/store';

const env = (k: string) => process.env[k]?.trim() ?? '';

export type ChannelInfo = { channel: AlertChannel; ready: boolean; needs: string[] };

export function channelInfo(): ChannelInfo[] {
  const need = (keys: string[]) => keys.filter((k) => !env(k));
  return [
    { channel: 'inApp', ready: true, needs: [] },
    { channel: 'telegram', ...(() => { const n = need(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']); return { ready: !n.length, needs: n }; })() },
    { channel: 'email', ...(() => { const n = need(['RESEND_API_KEY', 'ALERT_EMAIL_FROM', 'ALERT_EMAIL_TO']); return { ready: !n.length, needs: n }; })() },
    { channel: 'whatsapp', ...(() => { const n = need(['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_TO', 'WHATSAPP_TEMPLATE']); return { ready: !n.length, needs: n }; })() },
  ];
}

export type Message = { title: string; lines: string[]; link: string | null };

const plain = (m: Message) => [m.title, ...m.lines, ...(m.link ? [m.link] : [])].join('\n');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
}

/** Sends one message on one channel; throws with the provider's reason on failure. In-app is a no-op here. */
export async function send(channel: AlertChannel, m: Message): Promise<void> {
  switch (channel) {
    case 'inApp': return;
    case 'telegram':
      return post(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
        chat_id: env('TELEGRAM_CHAT_ID'), parse_mode: 'HTML', disable_web_page_preview: true,
        text: [`<b>${esc(m.title)}</b>`, ...m.lines.map(esc), ...(m.link ? [m.link] : [])].join('\n'),
      });
    case 'email':
      return post('https://api.resend.com/emails', {
        from: env('ALERT_EMAIL_FROM'), to: env('ALERT_EMAIL_TO').split(',').map((x) => x.trim()), subject: m.title,
        text: plain(m), html: `<p><b>${esc(m.title)}</b></p><p>${m.lines.map(esc).join('<br>')}</p>${m.link ? `<p><a href="${m.link}">Open</a></p>` : ''}`,
      }, { authorization: `Bearer ${env('RESEND_API_KEY')}` });
    case 'whatsapp':
      return post(`https://graph.facebook.com/v20.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
        messaging_product: 'whatsapp', to: env('WHATSAPP_TO'), type: 'template',
        template: { name: env('WHATSAPP_TEMPLATE'), language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: plain(m).replace(/\s*\n\s*/g, ' · ').slice(0, 1000) }] }] },
      }, { authorization: `Bearer ${env('WHATSAPP_TOKEN')}` });
  }
}
