// NSDL's "Daily Trends in FPI Investments" (fpi.nsdl.co.in/web/Reports/Latest.aspx): foreign portfolio investors'
// gross purchases, gross sales and net investment in ₹ crore, by asset class (Equity, Debt, Hybrid, Mutual Funds,
// AIFs) and route (stock exchange, primary market). NSDL's figures for a reporting date cover FPI trades of the
// previous trading day(s), as reported by custodians. The page shows only the latest day, so it is read once a day
// and stored; past days are not back-filled automatically.

import { Prisma, prisma } from '@mtv/db';

export const NSDL_LATEST_URL = 'https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type FpiFlowRow = { category: string; route: string; purchaseCr: string; salesCr: string; netCr: string; netUsdMn: string };
export type FpiDay = { reportDate: string; usdInr: string | null; rows: FpiFlowRow[] };

const text = (html: string) => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** "13626.03" → "13626.03"; "(812.73)" → "-812.73". */
const num = (s: string) => {
  const m = /^\(?(-?\d+(?:\.\d+)?)\)?$/.exec(s.replace(/,/g, ''));
  if (!m) return null;
  return s.startsWith('(') ? `-${m[1]}` : m[1];
};

/** Parses the FPI investment table from NSDL's Daily Trends page. Throws on any layout change. */
export function parseNsdlDailyTrends(html: string): FpiDay {
  const head = /Daily Trends in FPI Investments on (\d{2})-([A-Za-z]{3})-(\d{4})/.exec(html);
  if (!head) throw new Error('NSDL FPI: format changed: no "Daily Trends in FPI Investments on <date>" heading');
  const reportDate = `${head[3]}-${String(MONTHS.indexOf(head[2]) + 1).padStart(2, '0')}-${head[1]}`;
  const start = head.index, end = html.indexOf('</table>', start);
  const table = html.slice(start, end);
  const rows: FpiFlowRow[] = [];
  let category = '', usdInr: string | null = null;
  for (const tr of table.match(/<tr[^>]*>[\s\S]*?(?=<tr|$)/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (cells.length < 5) continue;
    const rate = cells.find((c) => /^Rs\.\s*\d/.test(c));
    if (rate) usdInr = rate.replace(/^Rs\.\s*/, '');
    const body = cells.filter((c) => c !== rate && !/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(c));
    const values = body.slice(-4).map(num);
    if (values.some((v) => v == null)) continue; // header or note rows
    const labels = body.slice(0, -4);
    if (labels.length === 2) category = labels[0];
    const route = labels.at(-1) ?? '';
    rows.push({ category: route === 'Total' ? 'Total' : category, route, purchaseCr: values[0]!, salesCr: values[1]!, netCr: values[2]!, netUsdMn: values[3]! });
  }
  const equity = rows.find((r) => r.category === 'Equity' && r.route === 'Sub-total');
  if (!equity || !rows.some((r) => r.category === 'Total')) throw new Error('NSDL FPI: format changed: no Equity sub-total or Total row');
  // Check NSDL's own arithmetic: purchases − sales = net, for every row.
  for (const r of rows) {
    const diff = Math.abs(Number(r.purchaseCr) - Number(r.salesCr) - Number(r.netCr));
    if (diff > 0.011) throw new Error(`NSDL FPI: ${r.category} / ${r.route}: purchases − sales ≠ net (${r.purchaseCr} − ${r.salesCr} vs ${r.netCr})`);
  }
  return { reportDate, usdInr, rows };
}

/** Reads today's page and stores it, unless that reporting date is already stored. Returns the reporting date. */
export async function fetchNsdlDaily(): Promise<string> {
  const res = await fetch(NSDL_LATEST_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyTradingView research; +https://mytradingview.in)' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`NSDL FPI: HTTP ${res.status}`);
  const day = parseNsdlDailyTrends(await res.text());
  if (await prisma.fpiFlow.count({ where: { reportDate: day.reportDate } })) return day.reportDate;
  await prisma.fpiFlow.createMany({
    data: day.rows.map((r) => ({
      reportDate: day.reportDate, category: r.category, route: r.route, usdInr: day.usdInr == null ? null : new Prisma.Decimal(day.usdInr),
      purchaseCr: new Prisma.Decimal(r.purchaseCr), salesCr: new Prisma.Decimal(r.salesCr), netCr: new Prisma.Decimal(r.netCr), netUsdMn: new Prisma.Decimal(r.netUsdMn),
    })),
  });
  return day.reportDate;
}

/** Reads NSDL's page at start and every 3 hours (one request each time); a new reporting date is stored once. */
export function startNsdlDaily(log: (m: string) => void) {
  const run = () => fetchNsdlDaily().then((d) => log(`NSDL FPI daily trends: stored or already held for ${d}`), (e) => log(`NSDL FPI daily trends failed, will retry: ${(e as Error).message}`));
  setTimeout(run, 40_000);
  setInterval(run, 3 * 3600_000);
}
