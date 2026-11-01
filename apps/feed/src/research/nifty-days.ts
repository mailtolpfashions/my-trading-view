// NIFTY day by day, from NSE's official index closes: every trading day as one row (gap, change, range, India VIX,
// weekday, expiry day, event tag). No averages here: month and year tables are built from these rows by the reader,
// so any day can be traced back.

import type { Candle } from '@mtv/shared';

export type NiftyDay = {
  date: string;
  weekday: string;
  prevClose: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  /** open − previous close, points and % of previous close */
  gapPts: number | null;
  gapPct: number | null;
  changePts: number | null;
  changePct: number | null;
  /** (high − low) / previous close, % */
  rangePct: number | null;
  vixClose: number | null;
  /** true / false when we hold that day's F&O data, null otherwise */
  expiryDay: boolean | null;
  events: string[];
};

/**
 * Dated events, kept by hand from official announcements. A period is [from, to] inclusive. Users can isolate or
 * exclude them; the list is shown on the page so every tag can be checked.
 */
export const MARKET_EVENTS: { id: string; name: string; from: string; to: string; source: string }[] = [
  { id: 'covid-2020', name: 'COVID-19 crash and lockdown', from: '2020-02-24', to: '2020-05-31', source: 'First heavy global fall (24 Feb 2020) to the end of India\'s nationwide lockdown 4.0 (31 May 2020, MHA)' },
  { id: 'election-2014', name: 'General election results 2014', from: '2014-05-16', to: '2014-05-16', source: 'Election Commission of India' },
  { id: 'election-2019', name: 'General election results 2019', from: '2019-05-23', to: '2019-05-23', source: 'Election Commission of India' },
  { id: 'election-2024', name: 'General election results 2024', from: '2024-06-04', to: '2024-06-04', source: 'Election Commission of India' },
  { id: 'demonetisation-2016', name: 'Demonetisation (announced night of 8 Nov)', from: '2016-11-09', to: '2016-11-09', source: 'Government of India, 8 Nov 2016' },
  { id: 'tax-cut-2019', name: 'Corporate tax cut announcement', from: '2019-09-20', to: '2019-09-20', source: 'Ministry of Finance, 20 Sep 2019' },
  ...['2012-03-16', '2013-02-28', '2014-02-17', '2014-07-10', '2015-02-28', '2016-02-29', '2017-02-01', '2018-02-01', '2019-02-01', '2019-07-05', '2020-02-01',
    '2021-02-01', '2022-02-01', '2023-02-01', '2024-02-01', '2024-07-23', '2025-02-01', '2026-02-01'].map((d) => ({ id: `budget-${d}`, name: `Union Budget ${d.slice(0, 4)}`, from: d, to: d, source: 'Union Budget presentation date (Ministry of Finance)' })),
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateOf = (c: Candle) => new Date((c.time + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One row per NIFTY trading day. `fnoDates` are days we hold NIFTY F&O data for, and `expiries` NIFTY option expiry
 * dates, so "expiry day" is known only where the data is.
 */
export function niftyDays(nifty: Candle[], vix: Candle[], expiries: Set<string>, fnoDates: Set<string>): NiftyDay[] {
  const vixOn = new Map(vix.map((c) => [dateOf(c), c.close]));
  return nifty.map((c, i) => {
    const date = dateOf(c);
    const prev = i > 0 ? nifty[i - 1].close : null;
    return {
      date,
      weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()],
      prevClose: prev,
      open: c.open, high: c.high, low: c.low, close: c.close,
      gapPts: prev == null ? null : r2(c.open - prev),
      gapPct: prev == null ? null : ((c.open - prev) / prev) * 100,
      changePts: prev == null ? null : r2(c.close - prev),
      changePct: prev == null ? null : ((c.close - prev) / prev) * 100,
      rangePct: prev == null ? null : ((c.high - c.low) / prev) * 100,
      vixClose: vixOn.get(date) ?? null,
      expiryDay: fnoDates.has(date) ? expiries.has(date) : null,
      events: MARKET_EVENTS.filter((e) => date >= e.from && date <= e.to).map((e) => e.id),
    };
  });
}
