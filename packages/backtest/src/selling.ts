// Backtest of sold option positions with adjustments, on NSE's official end-of-day F&O data. It calls the same decide()
// the live advisor will call, so a rule cannot be suggested without having been tested. Rules that keep it honest:
// - Fills: 'next-close' acts on a decision at the following day's close (no look-ahead, the study's default);
//   'same-close' acts at the deciding close, which is a best case and is always labelled so.
// - Past days have no bid/ask, so slippage is a stated amount per option, charged against us on every fill.
// - An adjustment needs its new legs to have really traded. If they did not, it is cancelled and counted. A closing leg
//   that did not trade fills at NSE's settlement price, and is counted.
// - Expiry settles at intrinsic value against the index's official close; long in-the-money legs pay exercise STT.
// - Stops are seen at the close only, because daily files cannot show what happened inside a day. The gap stress test
//   (GAP_SHOCKS) is reported separately for that reason.
// All money is integer paise.

import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import {
  GAP_SHOCKS, ADDED_WING_PCT, decide, deltaOf, entryLegs, gapPnl, isFirstDayWithin, ivOf, legKey, parityForward, positionPnl, yearsBetween,
  type ChainQuote, type Decision, type DecideContext, type Kind, type LegRef, type MarketSnapshot, type OpenLeg, type Playbook, type SellEntry, type SellLeg, type SellPosition, type ShockLeg,
} from '@mtv/options';
import { STRIKE_STEP_PAISE, type OptionsData } from './options';

export type BookRow = { strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };

/** One day's option chain. Snapshots and deltas are kept on it, so many runs over the same days stay fast. */
export type DayBook = {
  date: string;
  spotPaise: number | null;
  lotSize: number | null;
  lotByExpiry: Map<string, number>;
  expiries: string[];
  rows: Map<string, BookRow[]>; // `${expiry}|${kind}`
  byLeg: Map<string, BookRow>;
  snapshot?: MarketSnapshot;
};

export function makeBook(date: string, spotPaise: number | null, lotSize: number | null, rows: (BookRow & { expiry: string; kind: Kind })[], lotByExpiry = new Map<string, number>()): DayBook {
  const book: DayBook = { date, spotPaise, lotSize, lotByExpiry, expiries: [], rows: new Map(), byLeg: new Map() };
  const exp = new Set<string>();
  for (const r of rows) {
    exp.add(r.expiry);
    const k = `${r.expiry}|${r.kind}`;
    const row: BookRow = { strikePaise: r.strikePaise, closePaise: r.closePaise, settlePaise: r.settlePaise, traded: r.traded };
    const list = book.rows.get(k);
    if (list) list.push(row); else book.rows.set(k, [row]);
    book.byLeg.set(legKey(r), row);
  }
  book.expiries = [...exp].sort();
  return book;
}

/** The last listed expiry of each calendar month. */
export function monthlyExpiries(expiries: Iterable<string>): Set<string> {
  const last = new Map<string, string>();
  for (const e of expiries) { const m = e.slice(0, 7); if (!last.has(m) || e > last.get(m)!) last.set(m, e); }
  return new Set(last.values());
}

/** Loads days through the same data interface as the plain options backtester. Used by tests and small windows. */
export async function booksFrom(data: OptionsData, underlying: string, from: string, to: string): Promise<DayBook[]> {
  const out: DayBook[] = [];
  for (const date of await data.tradingDates(underlying, from, to)) {
    const meta = await data.meta(underlying, date);
    const rows: (BookRow & { expiry: string; kind: Kind })[] = [];
    const lots = new Map<string, number>();
    for (const expiry of await data.expiries(underlying, date)) {
      const lot = await data.lotFor?.(underlying, date, expiry);
      if (lot) lots.set(expiry, lot);
      for (const kind of ['CE', 'PE'] as const) for (const r of await data.chain(underlying, date, expiry, kind)) rows.push({ ...r, expiry, kind });
    }
    out.push(makeBook(date, meta?.spotPaise ?? null, meta?.lotSize ?? null, rows, lots));
  }
  return out;
}

const toQuote = (r: BookRow): ChainQuote => ({ strikePaise: r.strikePaise, pricePaise: r.traded ? r.closePaise : r.settlePaise, traded: r.traded });

export function snapshotOf(book: DayBook, monthly: Set<string>): MarketSnapshot {
  if (book.snapshot) return book.snapshot;
  const spot = book.spotPaise ?? 0, date = book.date;
  const chains = new Map<string, ChainQuote[]>(), forwards = new Map<string, number>(), deltas = new Map<string, number | null>();
  const chain = (expiry: string, kind: Kind) => {
    const k = `${expiry}|${kind}`;
    let c = chains.get(k);
    if (!c) { c = (book.rows.get(k) ?? []).map(toQuote); chains.set(k, c); }
    return c;
  };
  const forward = (expiry: string) => {
    let f = forwards.get(expiry);
    if (f == null) { f = parityForward(chain(expiry, 'CE'), chain(expiry, 'PE'), spot, yearsBetween(date, expiry)) ?? spot; forwards.set(expiry, f); }
    return f;
  };
  book.snapshot = {
    date, spotPaise: spot,
    expiries: book.expiries.filter((e) => e > date),
    isMonthly: (e) => monthly.has(e),
    chain,
    quote: (l) => { const r = book.byLeg.get(legKey(l)); return r ? toQuote(r) : null; },
    delta: (l) => {
      const k = legKey(l);
      if (deltas.has(k)) return deltas.get(k)!;
      const r = book.byLeg.get(k), T = yearsBetween(date, l.expiry);
      const d = r?.traded && r.closePaise > 0 && T > 0 ? deltaOf(l.kind, r.closePaise, forward(l.expiry), l.strikePaise, T) : null;
      deltas.set(k, d);
      return d;
    },
  };
  return book.snapshot;
}

export type SellFill = LegRef & { date: string; side: 'BUY' | 'SELL'; qty: number; pricePaise: number; chargesPaise: number; stage: 'entry' | 'adjust' | 'exit' | 'expiry' };
export type SellExitReason = 'expiry' | 'target' | 'stop' | 'max-loss' | 'time' | 'end-of-data';
export type SellTrade = {
  entryDate: string; exitDate: string; exitReason: SellExitReason;
  spotEntryPaise: number; spotExitPaise: number; qty: number;
  fills: SellFill[];
  notes: string[]; // the reason given for each adjustment and exit, in plain words
  creditPaise: number; grossPaise: number; chargesPaise: number; slippagePaise: number; netPaise: number;
  adjustments: number; blockedAdjustments: number; settledFills: number; tradingDays: number;
  /** Multiplier that puts this trade at today's position size (today's index level and lot), so old years compare fairly. */
  scale: number; netTodayPaise: number;
  /** Model result of each GAP_SHOCKS gap on the day of entry, at today's size. Null when a leg's IV could not be read. */
  stressTodayPaise: number[] | null;
};

export type SellingConfig = {
  entry: SellEntry;
  playbook: Playbook;
  underlying?: 'NIFTY' | 'BANKNIFTY';
  fill: 'next-close' | 'same-close';
  /** Rupees per option lost on every fill, in paise. */
  slippagePaise: number;
  /** Value of one position today, index × lot, in paise: what `scale` scales each trade to. */
  todayNotionalPaise: number;
  from?: string;
  to?: string;
  /** Every trading date, future ones included (NSE publishes them in advance). Defaults to the dates of the books. */
  calendar?: string[];
  /** A condition on the entry day, such as high IV. Days it refuses are not traded and are not counted as skips. */
  allowEntry?: (date: string) => boolean;
  /** False blocks a new entry on the day a position ended (as the plain backtester does). */
  reenterSameDay?: boolean;
};

export type SellingResult = {
  trades: SellTrade[];
  equity: { date: string; equityPaise: number; equityTodayPaise: number }[];
  skipped: { date: string; reason: string }[];
};

type Open = {
  pos: SellPosition; entryDate: string; entryIndex: number; spotEntry: number; qty: number; scale: number; entryDelta: number;
  fills: SellFill[]; notes: string[]; slippage: number; blocked: number; settled: number; last: Map<string, number>; stress: number[] | null;
};
type Pending =
  | { type: 'enter'; expiry: string; legs: OpenLeg[]; delta: number }
  | Exclude<Decision, { type: 'none' }>;

export function runSelling(cfg: SellingConfig, books: DayBook[], monthly: Set<string>): SellingResult {
  const { entry, playbook } = cfg;
  const days = books.filter((b) => b.date >= (cfg.from ?? '0000') && b.date <= (cfg.to ?? '9999'));
  const indexOf = new Map((cfg.calendar ?? days.map((b) => b.date)).map((d, i) => [d, i]));
  const step = STRIKE_STEP_PAISE[cfg.underlying ?? 'NIFTY'];
  const slip = cfg.slippagePaise;
  const reenter = cfg.reenterSameDay ?? true;
  const trades: SellTrade[] = [], equity: SellingResult['equity'] = [], skipped: SellingResult['skipped'] = [];
  let open = null as Open | null, pending = null as Pending | null;
  let realised = 0, realisedToday = 0;

  const charge = (side: 'BUY' | 'SELL', qty: number, pricePaise: number, date: string) => computeOptionCharges({ side, qty, premiumPaise: pricePaise, date }).total;

  /** One fill: the price moves against us by the slippage, never below 5 paise (the tick). */
  const fill = (o: Open, l: LegRef, side: 'BUY' | 'SELL', qty: number, marketPaise: number, date: string, stage: 'entry' | 'adjust' | 'exit'): number => {
    const pricePaise = side === 'BUY' ? marketPaise + slip : Math.max(5, marketPaise - slip);
    o.slippage += Math.abs(pricePaise - marketPaise) * qty;
    o.fills.push({ date, expiry: l.expiry, strikePaise: l.strikePaise, kind: l.kind, side, qty, pricePaise, chargesPaise: charge(side, qty, pricePaise, date), stage });
    return pricePaise;
  };

  /** Today's price of a leg to trade at: the traded close, else NSE's settlement (counted), else the last known. */
  const tradePrice = (o: Open, m: MarketSnapshot, l: LegRef) => {
    const q = m.quote(l);
    if (!q || !q.traded) o.settled++;
    return q?.pricePaise ?? o.last.get(legKey(l)) ?? 0;
  };

  const closeLeg = (o: Open, leg: SellLeg, m: MarketSnapshot, stage: 'adjust' | 'exit') => {
    const px = fill(o, leg, leg.side === 'SELL' ? 'BUY' : 'SELL', leg.qty, tradePrice(o, m, leg), m.date, stage);
    o.pos.realisedPaise += (leg.side === 'SELL' ? 1 : -1) * leg.qty * (leg.entryPaise - px);
  };

  const finish = (o: Open, date: string, reason: SellExitReason, spot: number, index: number) => {
    const signed = (f: SellFill) => (f.side === 'SELL' ? 1 : -1) * f.qty * f.pricePaise;
    const grossPaise = o.fills.reduce((s, f) => s + signed(f), 0);
    const chargesPaise = o.fills.reduce((s, f) => s + f.chargesPaise, 0);
    const netPaise = grossPaise - chargesPaise;
    const netTodayPaise = Math.round(netPaise * o.scale);
    trades.push({
      entryDate: o.entryDate, exitDate: date, exitReason: reason, spotEntryPaise: o.spotEntry, spotExitPaise: spot, qty: o.qty,
      fills: o.fills, notes: o.notes, creditPaise: o.pos.creditPaise, grossPaise, chargesPaise, slippagePaise: o.slippage, netPaise,
      adjustments: o.pos.adjustments, blockedAdjustments: o.blocked, settledFills: o.settled, tradingDays: index - o.entryIndex,
      scale: o.scale, netTodayPaise, stressTodayPaise: o.stress,
    });
    realised += netPaise;
    realisedToday += netTodayPaise;
    open = null;
  };

  const exitAll = (o: Open, m: MarketSnapshot, reason: SellExitReason, index: number) => {
    for (const leg of o.pos.legs) closeLeg(o, leg, m, 'exit');
    o.pos.legs = [];
    finish(o, m.date, reason, m.spotPaise, index);
  };

  const stressOf = (m: MarketSnapshot, legs: SellLeg[], scale: number): number[] | null => {
    const shock: ShockLeg[] = [];
    for (const l of legs) {
      const T = yearsBetween(m.date, l.expiry);
      const q = m.quote(l);
      const F = parityForward(m.chain(l.expiry, 'CE'), m.chain(l.expiry, 'PE'), m.spotPaise, T) ?? m.spotPaise;
      const iv = q?.traded && T > 0 ? ivOf(l.kind, q.pricePaise, F, l.strikePaise, T) : null;
      if (iv == null) return null;
      shock.push({ kind: l.kind, side: l.side, qty: l.qty, strikePaise: l.strikePaise, pricePaise: q!.pricePaise, iv, T, forwardPaise: F });
    }
    return GAP_SHOCKS.map((s) => Math.round(gapPnl(shock, s) * scale));
  };

  const enter = (p: Extract<Pending, { type: 'enter' }>, m: MarketSnapshot, di: number) => {
    if (p.legs.some((l) => !m.quote(l)?.traded)) return void skipped.push({ date: m.date, reason: 'A chosen strike did not trade on the fill day' });
    const qty = p.legs[0].qty;
    const notional = m.spotPaise * qty;
    const o: Open = {
      pos: { legs: [], creditPaise: 0, realisedPaise: 0, adjustments: 0 },
      entryDate: m.date, entryIndex: di, spotEntry: m.spotPaise, qty, scale: cfg.todayNotionalPaise / notional, entryDelta: p.delta,
      fills: [], notes: [], slippage: 0, blocked: 0, settled: 0, last: new Map(), stress: null,
    };
    let credit = 0;
    for (const l of p.legs) {
      const px = fill(o, l, l.side, l.qty, m.quote(l)!.pricePaise, m.date, 'entry');
      o.pos.legs.push({ ...l, entryPaise: px });
      o.last.set(legKey(l), m.quote(l)!.pricePaise);
      credit += (l.side === 'SELL' ? 1 : -1) * l.qty * px;
    }
    if (credit <= 0) return void skipped.push({ date: m.date, reason: 'No net credit at entry' });
    o.pos.creditPaise = credit;
    o.stress = stressOf(m, o.pos.legs, o.scale);
    open = o;
  };

  const act = (o: Open, d: Exclude<Pending, { type: 'enter' }>, m: MarketSnapshot, di: number) => {
    if (d.type === 'exit') {
      o.notes.push(`${m.date}: ${d.why}`);
      exitAll(o, m, d.reason, di);
      return;
    }
    const legs = d.close.map((c) => o.pos.legs.find((l) => legKey(l) === legKey(c)));
    if (legs.some((l) => !l) || d.open.some((l) => !m.quote(l)?.traded)) { o.blocked++; return; } // a leg has gone, or a new one did not trade
    for (const leg of legs as SellLeg[]) closeLeg(o, leg, m, 'adjust');
    const gone = new Set(d.close.map(legKey));
    o.pos.legs = o.pos.legs.filter((l) => !gone.has(legKey(l)));
    for (const l of d.open) {
      const px = fill(o, l, l.side, l.qty, m.quote(l)!.pricePaise, m.date, 'adjust');
      o.pos.legs.push({ ...l, entryPaise: px });
      o.last.set(legKey(l), m.quote(l)!.pricePaise);
    }
    o.pos.adjustments++;
    o.notes.push(`${m.date}: ${d.why}`);
  };

  const settleExpired = (o: Open, m: MarketSnapshot, book: DayBook, di: number) => {
    const due = o.pos.legs.filter((l) => l.expiry <= m.date);
    if (!due.length) return;
    if (book.spotPaise == null) {
      skipped.push({ date: m.date, reason: 'Expiry day has no official index close; settled at last prices' });
      for (const leg of due) closeLeg(o, leg, m, 'exit');
    } else {
      for (const leg of due) {
        const intrinsic = Math.max(0, leg.kind === 'CE' ? book.spotPaise - leg.strikePaise : leg.strikePaise - book.spotPaise);
        const side = leg.side === 'SELL' ? 'BUY' : 'SELL';
        o.fills.push({ date: m.date, expiry: leg.expiry, strikePaise: leg.strikePaise, kind: leg.kind, side, qty: leg.qty, pricePaise: intrinsic, chargesPaise: leg.side === 'BUY' ? exerciseStt(leg.qty, intrinsic, m.date) : 0, stage: 'expiry' });
        o.pos.realisedPaise += (leg.side === 'SELL' ? 1 : -1) * leg.qty * (leg.entryPaise - intrinsic);
      }
    }
    const left = o.pos.legs.filter((l) => l.expiry > m.date);
    o.pos.legs = left;
    if (!left.length) finish(o, m.date, 'expiry', book.spotPaise ?? o.spotEntry, di);
  };

  const calendarDates = cfg.calendar ?? days.map((b) => b.date);
  const wantedExpiry = (m: MarketSnapshot) => m.expiries.find((e) => {
    if (entry.cycle !== 'weekly' && !monthly.has(e)) return false;
    if (entry.calendarDaysBefore == null) return indexOf.get(e) === indexOf.get(m.date)! + entry.daysBefore;
    const i = indexOf.get(m.date)!;
    return isFirstDayWithin(m.date, calendarDates[i - 1] ?? null, e, entry.calendarDaysBefore);
  });

  for (let di = 0; di < days.length; di++) {
    const book = days[di];
    const base = snapshotOf(book, monthly);
    const known = open;
    // A held contract missing from today's file keeps its last known price.
    const m: MarketSnapshot = !known ? base : { ...base, quote: (l) => base.quote(l) ?? (known.last.has(legKey(l)) ? { strikePaise: l.strikePaise, pricePaise: known.last.get(legKey(l))!, traded: false } : null) };
    let exitedToday = false;

    if (open) for (const l of open.pos.legs) { const q = base.quote(l); if (q) open.last.set(legKey(l), q.pricePaise); }

    // Expiring legs settle first: an order queued yesterday cannot beat NSE's settlement on the expiry day itself.
    if (open) { settleExpired(open, m, book, di); if (!open) exitedToday = true; }
    if (pending && book.spotPaise != null) {
      const p = pending;
      pending = null;
      if (p.type === 'enter') { if (!open) enter(p, base, di); }
      else if (open) { act(open, p, m, di); if (!open) exitedToday = true; }
    }

    if (open && book.spotPaise != null) {
      const o: Open = open;
      const ctx: DecideContext = {
        entryDelta: o.entryDelta, wingPct: entry.wingPct ?? ADDED_WING_PCT,
        fillCost: (side, qty, px) => charge(side, qty, px, m.date) + slip * qty,
      };
      const d = decide(o.pos, m, playbook, ctx);
      if (d.type === 'none') { if (d.blocked) o.blocked++; }
      else if (cfg.fill === 'same-close') { act(o, d, m, di); if (!open) exitedToday = true; }
      else pending = d;
    }

    if (!open && !pending && book.spotPaise != null && (reenter || !exitedToday)) {
      const expiry = wantedExpiry(base);
      if (expiry && (cfg.allowEntry?.(book.date) ?? true)) {
        const lot = book.lotByExpiry.get(expiry) ?? book.lotSize;
        if (!lot) skipped.push({ date: book.date, reason: 'Lot size could not be determined for this day' });
        else {
          const r = entryLegs(base, expiry, entry, lot, step);
          if ('skip' in r) skipped.push({ date: book.date, reason: r.skip });
          else if (cfg.fill === 'same-close') enter({ type: 'enter', expiry, ...r }, base, di);
          else pending = { type: 'enter', expiry, ...r };
        }
      }
    }

    const o = open as Open | null;
    const openPnl = o ? positionPnl(o.pos, (l) => o.last.get(legKey(l)) ?? l.entryPaise) - o.fills.reduce((s, f) => s + f.chargesPaise, 0) : 0;
    equity.push({ date: book.date, equityPaise: realised + openPnl, equityTodayPaise: realisedToday + Math.round(openPnl * (o?.scale ?? 1)) });
  }

  if (open) {
    const last = days[days.length - 1];
    exitAll(open, snapshotOf(last, monthly), 'end-of-data', days.length - 1);
    equity[equity.length - 1] = { date: last.date, equityPaise: realised, equityTodayPaise: realisedToday };
  }
  return { trades, equity, skipped };
}

// --- Tables -------------------------------------------------------------------------------------------------------

export type CrisisTag = { id: string; label: string; from: string; to: string };

/** Periods that moved on fear or shock, not rules. Shown apart, so one average can never hide them. */
export const CRISIS_TAGS: CrisisTag[] = [
  { id: 'demonetisation', label: 'Demonetisation, US election (Nov 2016)', from: '2016-11-08', to: '2016-11-30' },
  { id: 'tax-cut', label: 'Corporate tax cut jump (Sep 2019)', from: '2019-09-20', to: '2019-09-24' },
  { id: 'covid', label: 'COVID crash and rebound (Feb to May 2020)', from: '2020-02-20', to: '2020-05-29' },
  { id: 'budget-2021', label: 'Budget jump (Feb 2021)', from: '2021-02-01', to: '2021-02-05' },
  { id: 'ukraine', label: 'Russia invades Ukraine (Feb to Mar 2022)', from: '2022-02-21', to: '2022-03-11' },
  { id: 'election-2024', label: 'Election result (Jun 2024)', from: '2024-05-31', to: '2024-06-07' },
  { id: 'carry-2024', label: 'Global carry-trade unwind (Aug 2024)', from: '2024-08-02', to: '2024-08-09' },
  { id: 'tariffs-2025', label: 'US tariff shock (Apr 2025)', from: '2025-04-02', to: '2025-04-11' },
];

export type PeriodRow = { period: string; netPaise: number; trades: number; wins: number; worstDrawdownPaise: number };

export type SellingSummary = {
  trades: number; wins: number; winRatePct: number | null;
  netPaise: number; chargesPaise: number; slippagePaise: number;
  avgWinPaise: number | null; avgLossPaise: number | null; bestTradePaise: number | null; worstTradePaise: number | null;
  worstMonthPaise: number | null; worstMonth: string | null; worstYearPaise: number | null; worstYear: string | null;
  maxDrawdownPaise: number; longestUnderwaterDays: number;
  years: PeriodRow[]; months: PeriodRow[];
  crisis: { id: string; label: string; netPaise: number; worstDrawdownPaise: number }[];
  /** Up to and including 2022, used to choose; from 2023, used only to confirm. */
  chosenPeriodNetPaise: number; confirmPeriodNetPaise: number;
  reasons: Record<string, number>;
  adjustments: number; blockedAdjustments: number; settledFills: number; skipped: number;
  /** Worst and median model result of each gap across all entries. */
  stress: { gapPct: number; worstPaise: number; medianPaise: number }[];
};

/** All rupees here are at today's position size. Months and years use the daily mark-to-market, not only closed trades. */
export function summariseSelling(r: SellingResult, tags: CrisisTag[] = CRISIS_TAGS, splitYear = 2023): SellingSummary {
  const { trades, equity } = r;
  const net = (t: SellTrade) => t.netTodayPaise;
  const wins = trades.filter((t) => net(t) > 0), losses = trades.filter((t) => net(t) <= 0);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

  const period = (key: (date: string) => string) => {
    const rows = new Map<string, PeriodRow & { first: number; peak: number }>();
    let prev = 0;
    for (const e of equity) {
      const k = key(e.date);
      let row = rows.get(k);
      if (!row) { row = { period: k, netPaise: 0, trades: 0, wins: 0, worstDrawdownPaise: 0, first: prev, peak: prev }; rows.set(k, row); }
      row.peak = Math.max(row.peak, e.equityTodayPaise);
      row.worstDrawdownPaise = Math.max(row.worstDrawdownPaise, row.peak - e.equityTodayPaise);
      row.netPaise = e.equityTodayPaise - row.first;
      prev = e.equityTodayPaise;
    }
    for (const t of trades) {
      const row = rows.get(key(t.exitDate));
      if (row) { row.trades++; if (net(t) > 0) row.wins++; }
    }
    return [...rows.values()].map(({ first: _f, peak: _p, ...row }) => row);
  };
  const years = period((d) => d.slice(0, 4)), months = period((d) => d.slice(0, 7));
  const worst = (rows: PeriodRow[]) => rows.reduce<PeriodRow | null>((w, x) => (!w || x.netPaise < w.netPaise ? x : w), null);
  const wm = worst(months), wy = worst(years);

  let peak = 0, maxDd = 0, under = 0, longest = 0;
  for (const e of equity) {
    if (e.equityTodayPaise >= peak) { peak = e.equityTodayPaise; under = 0; } else { under++; longest = Math.max(longest, under); }
    maxDd = Math.max(maxDd, peak - e.equityTodayPaise);
  }

  const crisis = tags.flatMap((t) => {
    const inside = equity.filter((e) => e.date >= t.from && e.date <= t.to);
    if (!inside.length) return [];
    const idx = equity.indexOf(inside[0]);
    const start = idx > 0 ? equity[idx - 1].equityTodayPaise : 0;
    let p = start, dd = 0;
    for (const e of inside) { p = Math.max(p, e.equityTodayPaise); dd = Math.max(dd, p - e.equityTodayPaise); }
    return [{ id: t.id, label: t.label, netPaise: inside[inside.length - 1].equityTodayPaise - start, worstDrawdownPaise: dd }];
  });

  const reasons: Record<string, number> = {};
  for (const t of trades) reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1;
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const stressed = trades.flatMap((t) => (t.stressTodayPaise ? [t.stressTodayPaise] : []));
  const stress = GAP_SHOCKS.map((g, i) => ({ gapPct: g.gapPct, worstPaise: stressed.length ? Math.min(...stressed.map((s) => s[i])) : 0, medianPaise: median(stressed.map((s) => s[i])) }));

  const split = `${splitYear}-01-01`;
  return {
    trades: trades.length, wins: wins.length, winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    netPaise: sum(trades.map(net)),
    chargesPaise: Math.round(sum(trades.map((t) => t.chargesPaise * t.scale))), slippagePaise: Math.round(sum(trades.map((t) => t.slippagePaise * t.scale))),
    avgWinPaise: wins.length ? Math.round(sum(wins.map(net)) / wins.length) : null,
    avgLossPaise: losses.length ? Math.round(sum(losses.map(net)) / losses.length) : null,
    bestTradePaise: trades.length ? Math.max(...trades.map(net)) : null, worstTradePaise: trades.length ? Math.min(...trades.map(net)) : null,
    worstMonthPaise: wm?.netPaise ?? null, worstMonth: wm?.period ?? null, worstYearPaise: wy?.netPaise ?? null, worstYear: wy?.period ?? null,
    maxDrawdownPaise: maxDd, longestUnderwaterDays: longest,
    years, months, crisis,
    chosenPeriodNetPaise: sum(trades.filter((t) => t.exitDate < split).map(net)),
    confirmPeriodNetPaise: sum(trades.filter((t) => t.entryDate >= split).map(net)),
    reasons,
    adjustments: sum(trades.map((t) => t.adjustments)), blockedAdjustments: sum(trades.map((t) => t.blockedAdjustments)), settledFills: sum(trades.map((t) => t.settledFills)), skipped: r.skipped.length,
    stress,
  };
}

export type PassMark = { capitalPaise: number; worstMonthPct: number; worstYearPct: number; gapPct: number; gapLimitPct: number };
export type PassResult = { pass: boolean; checks: { label: string; ok: boolean; value: string }[] };

/** The agreed pass mark, one line per check, so a failure says exactly which test it was. */
export function passCheck(s: SellingSummary, p: PassMark): PassResult {
  const pct = (paise: number | null) => ((paise ?? 0) / p.capitalPaise) * 100;
  const full = s.years.filter((y) => y.trades > 0);
  const up = full.filter((y) => y.netPaise > 0).length;
  const gap = s.stress.filter((x) => Math.abs(x.gapPct) === p.gapPct);
  const gapWorst = gap.length ? Math.min(...gap.map((x) => x.worstPaise)) : 0;
  const checks = [
    { label: 'Profitable over the whole period', ok: s.netPaise > 0, value: `₹${Math.round(s.netPaise / 100).toLocaleString('en-IN')}` },
    { label: 'Profitable in most years', ok: up > full.length / 2, value: `${up} of ${full.length} years` },
    { label: 'Profitable in 2023 to today', ok: s.confirmPeriodNetPaise > 0, value: `₹${Math.round(s.confirmPeriodNetPaise / 100).toLocaleString('en-IN')}` },
    { label: `Worst month no worse than −${p.worstMonthPct}%`, ok: pct(s.worstMonthPaise) >= -p.worstMonthPct, value: `${pct(s.worstMonthPaise).toFixed(1)}% (${s.worstMonth})` },
    { label: `Worst year no worse than −${p.worstYearPct}%`, ok: pct(s.worstYearPaise) >= -p.worstYearPct, value: `${pct(s.worstYearPaise).toFixed(1)}% (${s.worstYear})` },
    { label: `Survives a ${p.gapPct}% gap within −${p.gapLimitPct}%`, ok: pct(gapWorst) >= -p.gapLimitPct, value: `${pct(gapWorst).toFixed(1)}%` },
  ];
  return { pass: checks.every((c) => c.ok), checks };
}
