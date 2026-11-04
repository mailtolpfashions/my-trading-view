// The paper rule on all of NSE's NIFTY history, with and without its crash put, under each fill and cost assumption.
// Written to apps/feed/.data/research/selling-rule.json for the app. Read-only on the database.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=8192 -- npx tsx scripts/selling-rule.ts [BANKNIFTY]
// Heavy: run after market hours, never beside the live recording.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { STRIKE_STEP_PAISE, runSelling, snapshotOf, summariseSelling, type SellingConfig } from '@mtv/backtest';
import { GAP_SHOCKS, PAPER_RULE, daysBetween, entryLegs, gapPnl, ivAboveMedian, ivOf, parityForward, positionMargin, yearsBetween, type MarginLeg } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { dayBook, ivHistory, loadBooks } from '../src/selling/books';

const U = (process.argv[2] ?? 'NIFTY') as 'NIFTY' | 'BANKNIFTY';

const { books, monthly, calendar, stale } = await loadBooks(console.log, U);
const history = await ivHistory(U);
const latest = books.at(-1)!;
const todayNotionalPaise = latest.spotPaise! * latest.lotSize!;
const years = calendar.length / 248;
const allowEntry = (d: string) => ivAboveMedian(history, d) === true;

const run = (name: string, crash: boolean, over: Partial<SellingConfig>) => {
  const r = runSelling({ ...PAPER_RULE, entry: { ...PAPER_RULE.entry, crashPutPct: crash ? PAPER_RULE.entry.crashPutPct : undefined }, underlying: U, fill: 'same-close', slippagePaise: 100, todayNotionalPaise, calendar, allowEntry, ...over }, books, monthly);
  const s = summariseSelling(r);
  return {
    name, trades: s.trades, wonPct: s.winRatePct, avgWinPaise: s.avgWinPaise, avgLossPaise: s.avgLossPaise, netPaise: s.netPaise, perYearPaise: Math.round(s.netPaise / years),
    worstTradePaise: s.worstTradePaise, worstYearPaise: s.worstYearPaise, worstYear: s.worstYear, maxDrawdownPaise: s.maxDrawdownPaise,
    since2023Paise: s.confirmPeriodNetPaise, losingYears: s.years.filter((y) => y.netPaise < 0).length, yearCount: s.years.length, years: s.years, crisis: s.crisis, skipped: s.skipped, tradeRows: r.trades.map((t) => ({ entryDate: t.entryDate, exitDate: t.exitDate, netTodayPaise: t.netTodayPaise })),
  };
};
const variants = [
  run('The rule, with crash put', true, {}),
  run('The rule, ₹2 slippage', true, { slippagePaise: 200 }),
  run('The rule, acting a day late', true, { fill: 'next-close' }),
  run('Without the crash put', false, {}),
  run('Without the crash put, acting a day late', false, { fill: 'next-close' }),
];
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, U === 'NIFTY' ? 'selling-rule.json' : `selling-rule-${U.toLowerCase()}.json`), JSON.stringify({ underlying: U, ranAt: new Date().toISOString(), from: calendar[0], to: calendar.at(-1), yearsCovered: years, staleSetAside: stale, todayLot: latest.lotSize, variants }));
const r = (p: number | null) => Math.round((p ?? 0) / 100);
for (const v of variants) console.log(`${v.name.padEnd(42)} n ${v.trades} skipped ${v.skipped} | won ${v.wonPct?.toFixed(0)}% | win ${r(v.avgWinPaise)} loss ${r(v.avgLossPaise)} | /yr ${r(v.perYearPaise)} | worst ${r(v.worstTradePaise)} | worst yr ${r(v.worstYearPaise)} (${v.worstYear}) | fall ${r(v.maxDrawdownPaise)} | losing yrs ${v.losingYears}/${v.yearCount} | since 2023 ${r(v.since2023Paise)}`);
console.log('Crisis, with crash put:', variants[0].crisis.map((c) => `${c.id} ${r(c.netPaise)}`).join(' | '));
console.log('Crisis, without:', variants[3].crisis.map((c) => `${c.id} ${r(c.netPaise)}`).join(' | '));
const book = await dayBook(latest.date, U), span = (await spanOn(latest.date, U))?.data?.[U];
if (U !== 'NIFTY' && book) {
  const m = snapshotOf(book, monthly), e = m.expiries.find((x) => monthly.has(x) && daysBetween(latest.date, x) > 45) ?? m.expiries.find((x) => monthly.has(x))!;
  const made = entryLegs(m, e, PAPER_RULE.entry, book.lotByExpiry.get(e) ?? book.lotSize!, STRIKE_STEP_PAISE[U]);
  if ('skip' in made) console.log('Today:', made.skip);
  else {
    const T = yearsBetween(latest.date, e), F = parityForward(m.chain(e, 'CE'), m.chain(e, 'PE'), m.spotPaise, T) ?? m.spotPaise;
    const legs = made.legs.map((l) => ({ ...l, pricePaise: m.quote(l)?.pricePaise ?? 0 }));
    const margin = span ? positionMargin(span, legs.map((l): MarginLeg => ({ kind: l.kind, expiry: l.expiry, strike: l.strikePaise / 100, qty: l.side === 'SELL' ? -l.qty : l.qty, pricePaise: l.pricePaise })), m.spotPaise, m.date).marginPaise : 0;
    const shock = legs.map((l) => ({ kind: l.kind, side: l.side, qty: l.qty, strikePaise: l.strikePaise, pricePaise: l.pricePaise, iv: ivOf(l.kind, l.pricePaise, F, l.strikePaise, T) ?? 0.15, T, forwardPaise: F }));
    console.log('Today', e, legs.map((l) => `${l.side} ${l.strikePaise / 100}${l.kind} @${l.pricePaise / 100}`).join(', '), '| margin', r(margin), '|', GAP_SHOCKS.filter((g) => Math.abs(g.gapPct) >= 8).map((g) => `${g.gapPct}%: ${r(gapPnl(shock, g))}`).join(' '));
  }
}
await prisma.$disconnect();
