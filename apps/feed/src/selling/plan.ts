// The paper rule, day to day: what it says now, the exact legs, and the paper trades it has made. Uses the same decide() and
// entryLegs() the backtest ran, on NSE's latest official close, so nothing here can differ from what was tested. Paper fills
// lose ₹1 per option and pay itemised charges, as in the test. Nothing here can place a real order.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STRIKE_STEP_PAISE, monthlyExpiries, snapshotOf, type DayBook } from '@mtv/backtest';
import {
  GAP_SHOCKS, PAPER_RULE, addDays, daysBetween, decide, entryLegs, gapPnl, isFirstDayWithin, ivAboveMedian, ivOf, nextWeekday, parityForward,
  positionMargin, positionPnl, yearsBetween, type Decision, type MarginLeg, type MarketSnapshot, type OpenLeg, type SellLeg, type SellPosition,
} from '@mtv/options';
import { computeOptionCharges } from '@mtv/paper';
import { fnoCalendar } from '../fno/analytics';
import { latestFnoDate } from '../fno/chain';
import { spanOn } from '../fno/span';
import { UserStoreError, userStore, type SellingPaperTrade } from '../user/store';
import { SELLING_UNDERLYING as U, dayBook, ivHistory } from './books';

const SLIPPAGE_PAISE = 100;
const RULE_FILE = path.resolve(import.meta.dirname, '../../.data/research/selling-rule.json');

type PlanStatus = 'enter' | 'low-iv' | 'wait';
const fill = (side: 'BUY' | 'SELL', marketPaise: number) => (side === 'BUY' ? marketPaise + SLIPPAGE_PAISE : Math.max(5, marketPaise - SLIPPAGE_PAISE));
const chargeOf = (side: 'BUY' | 'SELL', qty: number, premiumPaise: number, date: string) => computeOptionCharges({ side, qty, premiumPaise, date }).total;

function monthlyOf(book: DayBook) {
  return monthlyExpiries(book.expiries.filter((e) => e > book.date));
}

async function latestBook() {
  const date = await latestFnoDate(U);
  const book = date ? await dayBook(date) : null;
  if (!date || !book?.spotPaise) throw new UserStoreError('NSE option data is not available yet');
  return { date, book, spotPaise: book.spotPaise };
}

/** Margin and the model's gap results for a set of legs, on today's SPAN file. */
async function riskOf(legs: OpenLeg[], m: MarketSnapshot) {
  const priced = legs.map((l) => ({ ...l, pricePaise: m.quote(l)?.pricePaise ?? 0 }));
  const T = yearsBetween(m.date, legs[0].expiry);
  const chain = (k: 'CE' | 'PE') => m.chain(legs[0].expiry, k);
  const F = parityForward(chain('CE'), chain('PE'), m.spotPaise, T) ?? m.spotPaise;
  const shock = priced.map((l) => ({ kind: l.kind, side: l.side, qty: l.qty, strikePaise: l.strikePaise, pricePaise: l.pricePaise, iv: ivOf(l.kind, l.pricePaise, F, l.strikePaise, T) ?? 0.15, T, forwardPaise: F }));
  const span = (await spanOn(m.date, U))?.data?.[U];
  const margin = span ? positionMargin(span, priced.map((l): MarginLeg => ({ kind: l.kind, expiry: l.expiry, strike: l.strikePaise / 100, qty: l.side === 'SELL' ? -l.qty : l.qty, pricePaise: l.pricePaise })), m.spotPaise, m.date) : null;
  return {
    marginPaise: margin && !margin.missing.length ? margin.marginPaise : null,
    gaps: GAP_SHOCKS.filter((g) => Math.abs(g.gapPct) >= 8).map((g) => ({ gapPct: g.gapPct, pnlPaise: gapPnl(shock, g) })),
  };
}

/** What the rule says on the latest close. */
export async function currentPlan() {
  const { date, book, spotPaise } = await latestBook();
  const { dates } = await fnoCalendar(U);
  const previous = dates[dates.indexOf(date) - 1] ?? null;
  const monthly = monthlyOf(book);
  const X = PAPER_RULE.entry.calendarDaysBefore!, listed = [...monthly].sort();
  const due = listed.find((e) => isFirstDayWithin(date, previous, e, X));
  const expiry = due ?? listed.find((e) => daysBetween(date, e) > X);
  if (!expiry) throw new UserStoreError('No monthly expiry is listed far enough out');
  const history = await ivHistory();
  const highIv = ivAboveMedian(history, date);
  const reading = history.filter((p) => p.date <= date);
  const past = reading.slice(-251, -1).map((p) => p.iv).sort((a, b) => a - b);
  const status: PlanStatus = !due ? 'wait' : highIv === true ? 'enter' : 'low-iv';
  const snapshot = snapshotOf(book, monthly);
  const lot = book.lotByExpiry.get(expiry) ?? book.lotSize!;
  const made = entryLegs(snapshot, expiry, PAPER_RULE.entry, lot, STRIKE_STEP_PAISE[U]);
  const legs = 'skip' in made ? null : made.legs.map((l) => ({ ...l, pricePaise: snapshot.quote(l)?.pricePaise ?? 0, delta: snapshot.delta(l) }));
  const risk = 'skip' in made ? null : await riskOf(made.legs, snapshot);
  return {
    asOf: date, spotPaise, status, expiry,
    entryOn: due ? date : nextWeekday(addDays(expiry, -X)),
    exitOn: nextWeekday(addDays(expiry, -PAPER_RULE.playbook.exitDaysLeft!)),
    iv: { today: reading.at(-1)?.iv ?? null, median: past.length ? past[Math.floor(past.length / 2)] : null, high: highIv },
    lot, legs, skip: 'skip' in made ? made.skip : null,
    creditPaise: legs ? legs.reduce((s, l) => s + (l.side === 'SELL' ? 1 : -1) * l.qty * l.pricePaise, 0) : null,
    ...risk,
  };
}

export function closeTrade(t: SellingPaperTrade, m: MarketSnapshot, d: Extract<Decision, { type: 'exit' }>): SellingPaperTrade {
  let cash = t.legs.reduce((s, l) => s + (l.side === 'SELL' ? 1 : -1) * l.qty * l.entryPaise, 0), charges = t.chargesPaise;
  for (const l of t.legs) {
    const side = l.side === 'SELL' ? 'BUY' : 'SELL', px = fill(side, m.quote(l)?.pricePaise ?? l.entryPaise);
    cash += (side === 'SELL' ? 1 : -1) * l.qty * px;
    charges += chargeOf(side, l.qty, px, m.date);
  }
  return { ...t, status: 'closed', closedOn: m.date, why: d.why, chargesPaise: charges, netPaise: cash - charges, lastMarkOn: m.date, lastPnlPaise: cash - charges };
}

/** Walks each open trade through every close since it was last looked at, so an exit lands on the right day. */
async function refreshPaper(trades: SellingPaperTrade[], latest: string) {
  if (!trades.some((t) => t.status === 'open' && t.lastMarkOn < latest)) return trades;
  const { dates } = await fnoCalendar(U);
  const out: SellingPaperTrade[] = [];
  for (let t of trades) {
    for (const date of t.status === 'open' ? dates.filter((d) => d > t.lastMarkOn && d <= latest) : []) {
      const book = await dayBook(date);
      if (!book?.spotPaise) continue;
      const m = snapshotOf(book, monthlyOf(book));
      const position: SellPosition = { legs: t.legs, creditPaise: t.creditPaise, realisedPaise: 0, adjustments: 0 };
      const d = decide(position, m, PAPER_RULE.playbook, { fillCost: () => 0, entryDelta: 0.16, wingPct: 0 });
      if (d.type === 'exit') { t = closeTrade(t, m, d); break; }
      t = { ...t, lastMarkOn: date, lastPnlPaise: positionPnl(position, (l) => m.quote(l)?.pricePaise ?? l.entryPaise) - t.chargesPaise };
    }
    out.push(t);
  }
  return out;
}

export async function planAndPaper() {
  const plan = await currentPlan();
  const trades = await userStore.sellingPaper();
  const paper = await refreshPaper(trades, plan.asOf);
  if (paper !== trades) await userStore.saveSellingPaper(paper);
  const tested = await readFile(RULE_FILE, 'utf8').then((s) => JSON.parse(s) as unknown, () => null);
  return { plan, paper, tested };
}

/** Opens the paper trade the rule asks for today, at the latest official close. Refused on any other day. */
export async function startPaperTrade() {
  const plan = await currentPlan();
  if (plan.status !== 'enter') throw new UserStoreError('The rule does not enter today');
  if (!plan.legs) throw new UserStoreError(plan.skip ?? 'The legs could not be priced');
  const trades = await userStore.sellingPaper();
  if (trades.some((t) => t.status === 'open')) throw new UserStoreError('A paper trade is already open');
  let charges = 0, credit = 0;
  const legs: SellLeg[] = plan.legs.map(({ pricePaise, delta: _d, ...l }) => {
    const px = fill(l.side, pricePaise);
    charges += chargeOf(l.side, l.qty, px, plan.asOf);
    credit += (l.side === 'SELL' ? 1 : -1) * l.qty * px;
    return { ...l, entryPaise: px };
  });
  const trade: SellingPaperTrade = {
    id: randomUUID(), openedOn: plan.asOf, expiry: plan.expiry, exitOn: plan.exitOn, spotPaise: plan.spotPaise, creditPaise: credit,
    legs, chargesPaise: charges, status: 'open', closedOn: null, why: null, netPaise: null, lastMarkOn: plan.asOf, lastPnlPaise: -charges,
  };
  await userStore.saveSellingPaper([...trades, trade]);
  return trade;
}
