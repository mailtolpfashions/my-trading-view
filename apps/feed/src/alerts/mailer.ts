// Alert emails through a transactional email service (Resend's HTTP API). Off until RESEND_API_KEY and
// ALERT_EMAIL_FROM are set: alerts are then in-app only and each event records "not_configured".

export type EmailResult = 'sent' | 'not_configured' | 'failed';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function sendAlertEmail(to: string, subject: string, lines: string[], log: (m: string) => void): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY, from = process.env.ALERT_EMAIL_FROM;
  if (!key || !from) return 'not_configured';
  const site = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mytradingview.in';
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#121212;line-height:1.5">
    ${lines.map((l) => `<p style="margin:0 0 10px">${escape(l)}</p>`).join('')}
    <p style="margin:16px 0 0"><a href="${site}/terminal" style="color:#2962ff">Open My Trading View</a></p>
    <p style="margin:16px 0 0;font-size:12px;color:#7d7c75">You set this alert on My Trading View. Alerts are for research and are not investment advice. Manage your alerts in the terminal.</p>
  </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text: lines.join('\n') }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { log(`Alert email to ${to} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); return 'failed'; }
    return 'sent';
  } catch (e) {
    log(`Alert email to ${to} failed: ${(e as Error).message}`);
    return 'failed';
  }
}
