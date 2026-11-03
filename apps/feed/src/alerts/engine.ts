// Watches saved screens (and saved strategies' entry rules) and tells the owner when stocks match.
// - When: an intraday screen is checked as each of its bars closes (5 s after, while Kite is live and the market is
//   open). A daily / weekly / monthly screen is checked when NSE's end-of-day file adds a day, and, if it uses the live
//   candle and Kite is live, every 5 minutes during the session. A check never runs twice for the same bar or day.
// - What: "first" alerts a stock when it newly matches, again only after it has stopped matching; "every" alerts all
//   matches on every check. The first check of a new alert is a baseline: it notes how many already match and alerts
//   none of them, so creating an alert never floods you.
// - How: one message per check (all new stocks in it), to each chosen channel; failures are kept on the alert.

import { barEnd, bucketStart, isIntraday, TF_MINUTES, type Tf } from '@mtv/rules';
import { eodLatestDate } from '../eod/store';
import { live } from '../intraday/instance';
import { runScreen, type ScreenRequest } from '../screener/screener';
import { userStore, type Alert, type AlertChannel } from '../user/store';
import { send, type Message } from './channels';

const IST = 5.5 * 3600;
const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:3100';
const MAX_LISTED = 20;

/** Which stocks to report: none on the baseline check; new ones for "first"; all for "every". */
export function decide(trigger: Alert['trigger'], previous: string[] | null, current: string[]): { baseline: boolean; notify: string[] } {
  if (previous == null) return { baseline: true, notify: [] };
  if (trigger === 'every') return { baseline: false, notify: current };
  const before = new Set(previous);
  return { baseline: false, notify: current.filter((s) => !before.has(s)) };
}

const istMinutes = (now: number) => Math.floor(((now + IST) % 86400) / 60);
const weekday = (now: number) => { const d = new Date((now + IST) * 1000).getUTCDay(); return d > 0 && d < 6; };
/** 09:15–15:31 IST on a weekday (the last minute lets the 15:29 bar close). */
export const inSession = (now: number) => weekday(now) && istMinutes(now) >= 9 * 60 + 15 && istMinutes(now) <= 15 * 60 + 31;

/**
 * What a check now would be based on, or null if no check is due. Intraday: the bar that just closed. Daily and
 * longer: the latest end-of-day date, or during the session a 5-minute slot when the screen reads the live candle.
 */
export function basisNow(tf: Tf, candle: 'closed' | 'live', session: Alert['session'], now: number, liveOn: boolean, eodDate: string | null): string | null {
  if (isIntraday(tf)) {
    if (!liveOn || !inSession(now)) return null;
    // The latest bar that had closed 5 s ago (real close times: the session's last bar is shorter).
    const t = now - 5, b = bucketStart(t, tf);
    return `${tf}:${barEnd(b, tf) <= t ? b : b - TF_MINUTES[tf]! * 60}`;
  }
  if (candle === 'live' && liveOn && inSession(now)) return `live:${Math.floor(now / 300)}`;
  void session; // market hours only matter for the intraday and live checks above, which run in the session anyway
  return eodDate ? `eod:${eodDate}` : null;
}

export class AlertEngine {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private log: (m: string) => void) {}

  start(everyMs = 15_000) {
    this.timer ??= setInterval(() => void this.tick(), everyMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Checks every alert that is due. Runs one at a time; a slow check never overlaps the next tick. */
  async tick(now = Math.floor(Date.now() / 1000)) {
    if (this.running) return;
    this.running = true;
    try {
      const today = new Date((now + IST) * 1000).toISOString().slice(0, 10);
      for (const a of await userStore.alerts()) {
        if (!a.enabled) continue;
        if (a.until && a.until < today) { await userStore.setAlertEnabled(a.id, false); continue; }
        await this.check(a, now).catch((e) => {
          this.log(`Alert "${a.name}": ${(e as Error).message}`);
          return userStore.recordAlertCheck(a.id, { lastError: (e as Error).message, lastCheckAt: new Date(now * 1000).toISOString() });
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async request(a: Alert): Promise<ScreenRequest & { label: string } | null> {
    if (a.source.kind === 'screen') {
      const s = await userStore.screen(a.source.id);
      return s && { label: s.name, formula: s.formula, tf: s.tf, candle: s.candle, universe: s.universe, filters: s.filters, columns: [], limit: 5000 };
    }
    const st = (await userStore.strategies()).find((x) => x.id === a.source.id);
    if (!st) return null;
    const x = st.strategy as { entry?: string; tf?: Tf };
    return { label: st.name, formula: x.entry ?? '', tf: x.tf ?? 'D', candle: 'closed', universe: st.universe, filters: {}, columns: [], limit: 5000 };
  }

  private async check(a: Alert, now: number) {
    const req = await this.request(a);
    if (!req) throw new Error(`The saved ${a.source.kind} it watches no longer exists`);
    const basis = basisNow(req.tf ?? 'D', req.candle ?? 'closed', a.session, now, live.status.state === 'live', eodLatestDate());
    if (!basis || basis === a.lastBasis) return;
    // An intraday alert in its own timeframe reads the bar that just closed; the screen's candle setting decides the rest.
    const r = await runScreen(isIntraday(req.tf ?? 'D') ? { ...req, candle: 'closed' } : req, now);
    const current = r.rows.map((x) => x.symbol).sort();
    const { baseline, notify } = decide(a.trigger, a.matching, current);
    const at = new Date(now * 1000).toISOString();
    const patch = { lastCheckAt: at, lastBasis: basis, lastError: null, matching: current };
    if (baseline) {
      await userStore.recordAlertCheck(a.id, patch, { alertId: a.id, alertName: a.name, at, hits: [], delivered: {}, note: `Watching "${req.label}". ${current.length.toLocaleString('en-IN')} stocks match right now; you will be told about stocks that match after this.` });
      return;
    }
    if (!notify.length) { await userStore.recordAlertCheck(a.id, patch); return; }
    const rows = new Map(r.rows.map((x) => [x.symbol, x]));
    const hits = notify.map((s) => ({ symbol: s, price: rows.get(s)!.close, bar: rows.get(s)!.barDate }));
    const msg: Message = {
      title: `${a.name}: ${hits.length} ${a.trigger === 'every' ? 'matching' : 'new'} stock${hits.length === 1 ? '' : 's'}`,
      lines: [...hits.slice(0, MAX_LISTED).map((h) => `${h.symbol}  ₹${h.price.toLocaleString('en-IN')}`), ...(hits.length > MAX_LISTED ? [`and ${hits.length - MAX_LISTED} more`] : []), `${req.label} · ${r.tf} · ${hits[0].bar}`],
      link: `${PLATFORM_URL}/alerts`,
    };
    const delivered: Partial<Record<AlertChannel, string>> = {};
    for (const ch of a.channels) {
      try { await send(ch, msg); delivered[ch] = 'sent'; } catch (e) { delivered[ch] = `failed: ${(e as Error).message}`; }
    }
    const failed = Object.entries(delivered).filter(([, v]) => v !== 'sent').map(([k, v]) => `${k} ${v}`);
    await userStore.recordAlertCheck(a.id, { ...patch, lastError: failed.length ? failed.join('; ') : null }, { alertId: a.id, alertName: a.name, at, hits, delivered, note: null });
    this.log(`Alert "${a.name}": ${hits.length} stock(s) → ${JSON.stringify(delivered)}`);
  }
}
