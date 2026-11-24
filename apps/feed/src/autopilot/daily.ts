// Autopilot: so the paper tests run without the owner opening the app. On weekdays (NSE holidays are not known
// ahead, so a holiday still gets the reminder):
//   08:45  Telegram: "log in to Kite" with a link that works from the phone (PUBLIC_FEED_URL, e.g. the PC's
//          Tailscale address), unless Kite is already logged in
//   09:10  a second reminder if still not logged in
//   15:35  the day's summary: whether Kite was live, the paper tests' results today, option minutes recorded
// Needs TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and PUBLIC_FEED_URL in .env; without the first two it stays silent.
// What was sent is kept in .userdata/autopilot.json so a restart never sends a message twice.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { channelInfo, send, type Message } from '../alerts/channels';
import { live } from '../intraday/instance';
import { activeSession } from '../providers/kite/session';
import { expReport } from '../tradelab/expiry-straddle';
import { s920Report } from '../tradelab/straddle920';

const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/autopilot.json');
const OPT_DIR = path.resolve(import.meta.dirname, '../../.data/opt1m/NIFTY');
type State = { sent: Record<string, string>; liveSince: Record<string, string> };
const IST = 19800;
const clock = (sec: number) => new Date((sec + IST) * 1000).toISOString().slice(11, 16);
const rs = (paise: number) => `${paise < 0 ? '−' : '+'}₹${Math.abs(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** The link that starts a Kite login and comes back to a phone-friendly page. */
export const phoneLoginLink = () => {
  const base = process.env.PUBLIC_FEED_URL?.trim().replace(/\/$/, '');
  return base ? `${base}/api/kite/login?back=phone` : null;
};

/** Which messages are due at this IST minute (pure, for tests). */
export function due(min: number, weekday: boolean, loggedIn: boolean, sent: (k: string) => boolean): ('login1' | 'login2' | 'summary')[] {
  if (!weekday) return [];
  const out: ('login1' | 'login2' | 'summary')[] = [];
  if (!loggedIn && min >= 8 * 60 + 45 && min < 9 * 60 + 10 && !sent('login1')) out.push('login1');
  if (!loggedIn && min >= 9 * 60 + 10 && min < 10 * 60 && !sent('login2')) out.push('login2');
  if (min >= 15 * 60 + 35 && min < 20 * 60 && !sent('summary')) out.push('summary');
  return out;
}

let state: State | null = null;
async function load(): Promise<State> {
  state ??= await readFile(FILE, 'utf8').then((t) => ({ sent: {}, liveSince: {}, ...JSON.parse(t) }) as State, () => ({ sent: {}, liveSince: {} }));
  return state;
}
async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(state, null, 1));
  await rename(`${FILE}.tmp`, FILE);
}

async function summary(date: string): Promise<Message> {
  const s = await load();
  const lines: string[] = [];
  lines.push(s.liveSince[date] ? `Kite: live from ${s.liveSince[date]}` : 'Kite: not logged in during market hours — paper tests skipped today');
  try {
    const e = await expReport(), d = e.days.find((x) => x.date === date);
    lines.push(!e.rule.enabled ? 'Expiry-day straddle: switched off'
      : !d ? 'Expiry-day straddle: no trade (not an expiry day, or not logged in by 9:40)'
      : !d.clean ? `Expiry-day straddle: left out (${d.note ?? 'not clean'})`
      : `Expiry-day straddle: ${d.netPaise == null ? 'still open' : rs(d.netPaise)} with stops, ${d.noStop?.netPaise != null ? rs(d.noStop.netPaise) : '—'} without · total so far ${rs(e.totals.netPaise)} over ${e.totals.clean} days`);
  } catch (err) { lines.push(`Expiry-day straddle: report failed (${(err as Error).message})`); }
  try {
    const r = await s920Report(), d = r.days.find((x) => x.date === date);
    if (r.rule.enabled || d) lines.push(!d ? '9:20 straddle: no trade today' : !d.clean ? '9:20 straddle: left out' : `9:20 straddle: ${d.netPaise == null ? 'still open' : rs(d.netPaise)} (${d.dte} days to expiry)`);
  } catch { /* the 9:20 test is optional */ }
  const size = await stat(path.join(OPT_DIR, `${date}.bin`)).then((x) => x.size, () => 0);
  lines.push(`Option minutes recorded: ${Math.round(size / 52).toLocaleString('en-IN')}`);
  return { title: `My Trading View · ${date}`, lines, link: null };
}

async function tick(log: (m: string) => void) {
  const tg = channelInfo().find((c) => c.channel === 'telegram');
  const now = Math.floor(Date.now() / 1000), d = new Date((now + IST) * 1000);
  const date = d.toISOString().slice(0, 10), min = d.getUTCHours() * 60 + d.getUTCMinutes(), weekday = d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  const s = await load();
  const loggedIn = !!activeSession();
  if (loggedIn && live.status.state === 'live' && min >= 9 * 60 && min < 15 * 60 + 30 && !s.liveSince[date]) { s.liveSince[date] = clock(now); await save(); }
  if (!tg?.ready) return;
  for (const k of due(min, weekday, loggedIn, (x) => !!s.sent[`${date}|${x}`])) {
    const link = phoneLoginLink();
    const m: Message = k === 'summary' ? await summary(date) : {
      title: k === 'login1' ? 'Log in to Kite for today' : 'Reminder: Kite is still not logged in',
      lines: link ? ['Tap the link, log in on Kite, and the paper tests run by themselves today.', 'If the market is closed today (holiday), ignore this.'] : ['PUBLIC_FEED_URL is not set in .env, so there is no phone link yet.'],
      link,
    };
    try { await send('telegram', m); s.sent[`${date}|${k}`] = clock(now); await save(); log(`Autopilot: sent ${k}`); }
    catch (err) { log(`Autopilot: Telegram failed (${(err as Error).message})`); }
  }
}

/** Starts the minute timer (call once, after the server is listening). */
export function startAutopilot(log: (m: string) => void) {
  const run = () => { tick(log).catch((e) => log(`Autopilot error: ${(e as Error).message}`)); };
  run();
  setInterval(run, 30_000);
}

/** The page a phone sees after the Kite login. */
export const phonePage = (ok: boolean, text: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kite login</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#faf7f2;color:#222">
<div style="text-align:center;padding:24px"><div style="font-size:56px">${ok ? '✓' : '✕'}</div><h1 style="font-size:22px;margin:8px 0">${ok ? 'Kite connected' : 'Kite login did not complete'}</h1><p style="color:#666;max-width:320px">${text}</p></div></body></html>`;
