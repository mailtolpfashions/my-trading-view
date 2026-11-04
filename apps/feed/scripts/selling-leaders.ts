// The final check on the best rules from the study: each one with no crash put and with a put 12% or 15% below the index,
// compared on the same trades, by year, on gaps, and on today's prices. Written to .data/research/selling-leaders.json.
// Heavy: run after market hours.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=8192 -- npx tsx scripts/selling-leaders.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { STRIKE_STEP_PAISE, monthlyExpiries, runSelling, snapshotOf, summariseSelling, type SellingConfig } from '@mtv/backtest';
import { GAP_SHOCKS, PAPER_RULE, daysBetween, entryLegs, gapPnl, ivAboveMedian, ivOf, parityForward, positionMargin, yearsBetween, type MarginLeg, type Playbook, type SellEntry } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { dayBook, ivHistory, loadBooks } from '../src/selling/books';

const U = 'NIFTY';
const { books, monthly, calendar } = await loadBooks(console.log, U);
const history = await ivHistory(U);
const latest = books.at(-1)!;
const todayNotionalPaise = latest.spotPaise! * latest.lotSize!;
const years = calendar.length / 248;
const allowEntry = (d: string) => ivAboveMedian(history, d) === true;

const LEADERS: { id: string; name: string; delta: number; exitDaysLeft?: number }[] = [
  { id: 'd10-hold', name: '0.10 delta, hold to expiry', delta: 0.1 },
  { id: 'd25-21', name: '0.25 delta, exit at 21 days left', delta: 0.25, exitDaysLeft: 21 },
  { id: 'd16-21', name: '0.16 delta, exit at 21 days left', delta: 0.16, exitDaysLeft: 21 },
];
const PUTS: (number | undefined)[] = [undefined, 12, 15];

const book = (await dayBook(latest.date, U))!, span = (await spanOn(latest.date, U))?.data?.[U];
const today = (entry: SellEntry) => {
  const listed = monthlyExpiries(book.expiries.filter((x) => x > book.date)); // only what is listed today, as the plan does
  const m = snapshotOf(book, listed), e = m.expiries.find((x) => listed.has(x) && daysBetween(latest.date, x) > 45) ?? m.expiries.find((x) => listed.has(x))!;
  const made = entryLegs(m, e, entry, book.lotByExpiry.get(e) ?? book.lotSize!, STRIKE_STEP_PAISE[U]);
  if ('skip' in made) return null;
  const T = yearsBetween(latest.date, e), F = parityForward(m.chain(e, 'CE'), m.chain(e, 'PE'), m.spotPaise, T) ?? m.spotPaise;
  const legs = made.legs.map((l) => ({ ...l, pricePaise: m.quote(l)?.pricePaise ?? 0 }));
  const margin = span ? positionMargin(span, legs.map((l): MarginLeg => ({ kind: l.kind, expiry: l.expiry, strike: l.strikePaise / 100, qty: l.side === 'SELL' ? -l.qty : l.qty, pricePaise: l.pricePaise })), m.spotPaise, m.date).marginPaise : null;
  const shock = legs.map((l) => ({ kind: l.kind, side: l.side, qty: l.qty, strikePaise: l.strikePaise, pricePaise: l.pricePaise, iv: ivOf(l.kind, l.pricePaise, F, l.strikePaise, T) ?? 0.15, T, forwardPaise: F }));
  return {
    expiry: e, marginPaise: margin, creditPaise: legs.reduce((s, l) => s + (l.side === 'SELL' ? 1 : -1) * l.qty * l.pricePaise, 0),
    legs: legs.map((l) => ({ side: l.side, strike: l.strikePaise / 100, kind: l.kind, price: l.pricePaise / 100 })),
    gaps: GAP_SHOCKS.map((g) => ({ gapPct: g.gapPct, pnlPaise: gapPnl(shock, g) })),
  };
};

const out = [];
for (const l of LEADERS) {
  const playbook: Playbook = { id: l.id, name: l.name, exitDaysLeft: l.exitDaysLeft };
  const base = runSelling(cfg(l.delta, undefined, playbook), books, monthly);
  const baseByEntry = new Map(base.trades.map((t) => [t.entryDate, t.netTodayPaise]));
  for (const put of PUTS) {
    const entry: SellEntry = { ...PAPER_RULE.entry, short: { delta: l.delta }, crashPutPct: put };
    const run = (over: Partial<SellingConfig> = {}) => runSelling({ ...cfg(l.delta, put, playbook), ...over }, books, monthly);
    const r = run(), s = summariseSelling(r), late = summariseSelling(run({ fill: 'next-close' })), dear = summariseSelling(run({ slippagePaise: 200 }));
    const sameBase = r.trades.reduce((t, x) => t + (baseByEntry.get(x.entryDate) ?? 0), 0);
    const row = {
      id: `${l.id}-${put ?? 'none'}`, leader: l.id, name: l.name, putPct: put ?? null,
      trades: s.trades, skipped: s.skipped, wonPct: s.winRatePct, avgWinPaise: s.avgWinPaise, avgLossPaise: s.avgLossPaise, perYearPaise: Math.round(s.netPaise / years),
      netPaise: s.netPaise, sameTradesNoPutPaise: sameBase, worstTradePaise: s.worstTradePaise, worstMonthPaise: s.worstMonthPaise, worstMonth: s.worstMonth,
      worstYearPaise: s.worstYearPaise, worstYear: s.worstYear, maxDrawdownPaise: s.maxDrawdownPaise, longestUnderwaterDays: s.longestUnderwaterDays,
      since2023Paise: s.confirmPeriodNetPaise, upTo2022Paise: s.chosenPeriodNetPaise, losingYears: s.years.filter((y) => y.netPaise < 0).length, yearCount: s.years.length,
      years: s.years, crisis: s.crisis, stress: s.stress, latePerYearPaise: Math.round(late.netPaise / years), lateWorstPaise: late.worstTradePaise, dearPerYearPaise: Math.round(dear.netPaise / years),
      equity: r.equity.filter((_, i) => i % 10 === 0 || i === r.equity.length - 1).map((e) => [e.date, Math.round(e.equityTodayPaise / 100)]),
      today: today(entry),
    };
    out.push(row);
    const R = (p: number | null) => Math.round((p ?? 0) / 100);
    console.log(`${l.name.padEnd(36)} put ${String(put ?? '-').padStart(2)} | n ${row.trades} skip ${row.skipped} | won ${row.wonPct?.toFixed(0)}% | win ${R(row.avgWinPaise)} loss ${R(row.avgLossPaise)} | /yr ${R(row.perYearPaise)} | net ${R(row.netPaise)} vs no put same trades ${R(sameBase)} | worst ${R(row.worstTradePaise)} | worst yr ${R(row.worstYearPaise)} (${row.worstYear}) | fall ${R(row.maxDrawdownPaise)} | lose yrs ${row.losingYears}/${row.yearCount} | to2022 ${R(row.upTo2022Paise)} since23 ${R(row.since2023Paise)} | late /yr ${R(row.latePerYearPaise)} | margin ${R(row.today?.marginPaise ?? 0)} | stress worst ${s.stress.map((g) => `${g.gapPct}:${R(g.worstPaise)}`).join(' ')} | today ${row.today?.gaps.filter((g) => Math.abs(g.gapPct) >= 8).map((g) => `${g.gapPct}:${R(g.pnlPaise)}`).join(' ')}`);
  }
}
const OUT = path.resolve(import.meta.dirname, '../.data/research');
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'selling-leaders.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: calendar[0], to: calendar.at(-1), yearsCovered: years, todayLot: latest.lotSize, rows: out }));
await prisma.$disconnect();

function cfg(delta: number, put: number | undefined, playbook: Playbook): SellingConfig {
  return { entry: { ...PAPER_RULE.entry, short: { delta }, crashPutPct: put }, playbook, underlying: U, fill: 'same-close', slippagePaise: 100, todayNotionalPaise, calendar, allowEntry };
}
