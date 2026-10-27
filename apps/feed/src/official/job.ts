// Downloads NSE's official end-of-day files once per trading day, politely:
// at most 3 attempts per date, at least an hour apart, and a backfill that stops at the first network failure.

import { NotPublished, nseGet } from '../nse-http';
import { INDICES } from '../symbols';
import { bhavcopyUrl, indexCloseUrl, parseBhavcopy, parseIndexClose, recentWeekdays, unzipFirstCsv, type OfficialBar, type TradeDate } from './nse-files';
import { hasDay, saveDay } from './store';

const PUBLISH_AFTER = (18 * 60 + 30) * 60; // NSE publishes the day's files in the evening; try from 18:30 IST
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 60 * 60_000;
const BACKFILL_DAYS = 5;

type Attempt = { count: number; last: number; result: string };
const attempts = new Map<TradeDate, Attempt>();
export const officialAttempts = () => Object.fromEntries(attempts);

const get = (url: string) => nseGet(url, 30_000);

/** Fetches and stores one trading day. Returns 'saved', 'not-published' (holiday or too early) or throws on network errors. */
export async function fetchDay(date: TradeDate): Promise<'saved' | 'not-published'> {
  try {
    const indexCsv = await (await get(indexCloseUrl(date))).text();
    const bhavZip = new Uint8Array(await (await get(bhavcopyUrl(date))).arrayBuffer());
    const indices = parseIndexClose(indexCsv);
    const equities = parseBhavcopy(unzipFirstCsv(bhavZip));
    const bars: Record<string, OfficialBar> = Object.fromEntries(equities);
    for (const idx of INDICES) {
      const bar = idx.nseName && indices.get(idx.nseName);
      if (bar) bars[idx.symbol] = bar;
    }
    if (!bars.NIFTY || equities.size < 500) throw new Error(`official files look incomplete (${equities.size} equities)`);
    await saveDay({ date, fetchedAt: new Date().toISOString(), bars });
    return 'saved';
  } catch (e) {
    if (e instanceof NotPublished) return 'not-published';
    throw e;
  }
}

async function attempt(date: TradeDate, log: (m: string) => void): Promise<boolean> {
  const a = attempts.get(date) ?? { count: 0, last: 0, result: '' };
  if (a.count >= MAX_ATTEMPTS || Date.now() - a.last < RETRY_GAP_MS) return true;
  a.count++;
  a.last = Date.now();
  attempts.set(date, a);
  try {
    a.result = await fetchDay(date);
    log(`NSE official data ${date}: ${a.result}`);
    return true;
  } catch (e) {
    a.result = `error: ${(e as Error).message}`;
    log(`NSE official data ${date}: ${a.result}`);
    return false; // network problem: caller stops instead of hammering NSE
  }
}

export function startOfficialJob(log: (m: string) => void) {
  const now = () => Date.now() / 1000;
  const afterPublish = () => (now() + 5.5 * 3600) % 86400 >= PUBLISH_AFTER;

  // Backfill recent trading days we don't have yet, one at a time, stopping at the first network failure.
  void (async () => {
    for (const d of recentWeekdays(now(), BACKFILL_DAYS, afterPublish())) {
      if (hasDay(d)) continue;
      if (!(await attempt(d, log))) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();

  // Each evening, fetch today's files once they are published.
  setInterval(() => {
    const [today] = recentWeekdays(now(), 1, true);
    const istToday = new Date((now() + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
    if (today === istToday && afterPublish() && !hasDay(today)) void attempt(today, log);
  }, 30 * 60_000);
}
