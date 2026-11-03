// Portfolio backtest of one equity strategy over many stocks, with shared capital. Rules that keep it honest:
// - Signals are read at a bar's close and act at that stock's NEXT bar (no look-ahead). Order size is decided at the
//   signal close too (the opening price is not known when the order is placed); the fill uses the real next bar.
// - Market orders fill at the open. A limit buy fills only if the bar trades down to it (at the open if it opened
//   below); a stop buy only if the bar trades up to it (at the open if it gapped above). Unfilled orders lapse.
// - Stops and targets are checked inside each bar with its high and low: a gap through a level fills at the open, and
//   when one bar touches both the stop is assumed to come first. A trailing stop moves only at a bar's close and is
//   used from the next bar. Slippage is applied against the trader on every fill.
// - When more stocks signal than there are free slots, the ones with the highest `rank` value are taken.
// - Itemised NSE charges at the rates in force on each date; a stop-out on the entry day is charged as intraday.
// - Money is integer paise. Prices are split / bonus adjusted, so quantities before an action are in today's shares.
// Short selling overnight is not possible in the cash market: short strategies need intraday data or futures.

import { Evaluator, checkTimeframes, lookback, parseFormula, resample, type Node, type Tf } from '@mtv/rules';
import { brokerById, computeCharges, istToday, type BrokerProfile } from '@mtv/paper';
import { atr, type Series } from '@mtv/indicators';
import type { Candle } from '@mtv/shared';

export type StopSpec =
  | { kind: 'none' }
  | { kind: 'pct'; value: number }
  | { kind: 'points'; value: number }
  | { kind: 'atr'; mult: number; length: number }
  /** A price level from a formula, re-read at every close, e.g. SUPERTREND(10, 3) or LOWEST(LOW, 10)[1]. */
  | { kind: 'formula'; formula: string };
export type TargetSpec = { kind: 'none' } | { kind: 'pct'; value: number } | { kind: 'points'; value: number } | { kind: 'rr'; value: number };
export type TrailSpec = { kind: 'none' } | { kind: 'pct'; value: number } | { kind: 'points'; value: number } | { kind: 'atr'; mult: number; length: number };
export type Sizing = { mode: 'qty'; qty: number } | { mode: 'amount'; rupees: number } | { mode: 'percent'; pct: number } | { mode: 'risk'; pct: number };
export type OrderSpec = { type: 'market' } | { type: 'limit'; offsetPct: number } | { type: 'stop'; offsetPct: number };

export type EquityStrategy = {
  tf: 'D' | 'W' | 'M';
  side: 'LONG';
  entry: string;
  exit?: string;
  order: OrderSpec;
  stop: StopSpec;
  target: TargetSpec;
  trail: TrailSpec;
  /** Leave after this many bars in the trade (at the next open). */
  maxBars?: number;
  sizing: Sizing;
  /** Open positions at once across all stocks. */
  maxOpen: number;
  /** Entries allowed in one stock at the same time (1 = no pyramiding). */
  pyramid: number;
  /** Bars to wait after an exit before entering the same stock again. */
  cooldownBars: number;
  /** New entries allowed on one bar across all stocks. */
  maxEntriesPerBar: number;
  /** Formula; when more stocks signal than there are free slots, higher values are taken first. */
  rank: string;
  /** Skip a signal when the stock's 20-bar average traded value is below this, ₹ crore. */
  minAvgValueCr: number;
  capitalRupees: number;
  /** Size from current equity (true) or from the starting capital (false). */
  reinvest: boolean;
  slippagePct: number;
  broker: string;
  charges: boolean;
  /** Test window, YYYY-MM-DD; indicators use all earlier history. */
  from: string;
  to: string;
  /** Annual risk-free rate for Sharpe and Sortino, %. */
  riskFreePct: number;
};

export type Instrument = { symbol: string; daily: Candle[]; breaks?: string[] };

export type PortfolioExitReason = 'signal' | 'stop' | 'trail' | 'target' | 'time' | 'end-of-test' | 'data-ended';
export type PortfolioTrade = {
  symbol: string;
  qty: number;
  entryTime: number;
  entryPricePaise: number;
  exitTime: number;
  exitPricePaise: number;
  exitReason: PortfolioExitReason;
  grossPaise: number;
  chargesPaise: number;
  netPaise: number;
  /** Net P&L as % of the money put in. */
  returnPct: number;
  bars: number;
  /** Worst and best price move while held, % from entry (from bar highs and lows). */
  maePct: number;
  mfePct: number;
  /** A corporate action we could not adjust for falls inside the trade. */
  dataBreak: boolean;
  /** Still open when the test ended (valued at the last close). */
  open: boolean;
};

export class StrategyError extends Error {}

const IST = 5.5 * 3600;
const toPaise = (r: number) => Math.round(r * 100);
const dateOf = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const dayNo = (t: number) => Math.floor((t + IST) / 86400);

function compile(formula: string, want: 'bool' | 'num', label: string): Node {
  const p = parseFormula(formula);
  if (!p.ok) throw new StrategyError(`${label}: ${p.error}`);
  if (p.type !== want) throw new StrategyError(want === 'bool' ? `${label} must be a condition, e.g. ${p.formula} > 50` : `${label} must be a value (a price level), not a condition`);
  try { checkTimeframes(p.node); } catch (e) { throw new StrategyError(`${label}: ${(e as Error).message}`); }
  return p.node;
}

export function validateEquityStrategy(s: EquityStrategy): string | null {
  if (!s.entry?.trim()) return 'Add at least one entry condition';
  if (s.side !== 'LONG') return 'Short selling overnight is not possible in the cash market. Short strategies need intraday data or futures (a later step).';
  if (!(s.capitalRupees >= 1000)) return 'Starting capital must be at least ₹1,000';
  if (!(Number.isInteger(s.maxOpen) && s.maxOpen >= 1 && s.maxOpen <= 500)) return 'Open positions must be 1 to 500';
  if (!(Number.isInteger(s.pyramid) && s.pyramid >= 1 && s.pyramid <= 10)) return 'Entries per stock must be 1 to 10';
  if (!(Number.isInteger(s.cooldownBars) && s.cooldownBars >= 0)) return 'Re-entry wait must be 0 or more bars';
  if (!(Number.isInteger(s.maxEntriesPerBar) && s.maxEntriesPerBar >= 1)) return 'Entries per bar must be at least 1';
  if (s.maxBars != null && !(Number.isInteger(s.maxBars) && s.maxBars >= 1)) return 'Maximum holding must be a whole number of bars';
  if (!(s.slippagePct >= 0 && s.slippagePct < 5)) return 'Slippage must be 0 to 5%';
  const sz = s.sizing;
  if (sz.mode === 'qty' && !(Number.isInteger(sz.qty) && sz.qty > 0)) return 'Quantity must be a whole number above zero';
  if (sz.mode === 'amount' && !(sz.rupees > 0)) return 'Amount per trade must be above zero';
  if (sz.mode === 'percent' && !(sz.pct > 0 && sz.pct <= 100)) return 'Capital per trade must be above 0 and at most 100%';
  if (sz.mode === 'risk' && !(sz.pct > 0 && sz.pct <= 10)) return 'Risk per trade must be above 0 and at most 10%';
  if (sz.mode === 'risk' && s.stop.kind === 'none') return 'Risk-based sizing needs a stop loss';
  if (s.target.kind === 'rr' && s.stop.kind === 'none') return 'A risk/reward target needs a stop loss';
  for (const [v, l] of [[s.stop, 'Stop loss'], [s.target, 'Target'], [s.trail, 'Trailing stop']] as const) {
    if ((v.kind === 'pct' || v.kind === 'points' || v.kind === 'rr') && !(v.value > 0 && (v.kind !== 'pct' || v.value < 100))) return `${l} must be above zero${v.kind === 'pct' ? ' and below 100%' : ''}`;
    if (v.kind === 'atr' && !(v.mult > 0 && Number.isInteger(v.length) && v.length >= 1)) return `${l}: ATR multiple and length must be above zero`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.from) || !/^\d{4}-\d{2}-\d{2}$/.test(s.to) || s.from > s.to) return 'Pick a start date before the end date';
  return null;
}

type Prepared = {
  symbol: string; bars: Candle[]; index: Map<number, number>; entry: Series; exit: Series | null; rank: Series;
  stopLevel: Series | null; atrStop: Series | null; atrTrail: Series | null; avgValue: Series; breaks: string[];
};

function prepare(ins: Instrument, s: EquityStrategy, nodes: { entry: Node; exit: Node | null; rank: Node; stop: Node | null }, fromT: number): Prepared | null {
  if (ins.daily.length < 2) return null;
  const bySrc = new Map<Tf, Candle[]>([['D', ins.daily]]);
  const source = (tf: Tf) => {
    if (!bySrc.has(tf)) bySrc.set(tf, tf === 'W' || tf === 'M' ? resample(ins.daily, tf) : []);
    return bySrc.get(tf)!.length ? bySrc.get(tf)! : null;
  };
  const bars = source(s.tf);
  if (!bars || bars.length < 2) return null;
  // Exact values are needed from the start of the test, less what the conditions look back on.
  const first = bars.findIndex((b) => b.time >= fromT);
  if (first < 0) return null;
  const back = Math.max(...[nodes.entry, nodes.exit, nodes.rank, nodes.stop].filter((n): n is Node => !!n).map(lookback));
  const ev = new Evaluator(source, Number.isFinite(back) ? Math.max(0, first - back - 1) : 0);
  return {
    symbol: ins.symbol, bars, index: new Map(bars.map((b, i) => [b.time, i])),
    entry: ev.series(nodes.entry, s.tf),
    exit: nodes.exit ? ev.series(nodes.exit, s.tf) : null,
    rank: ev.series(nodes.rank, s.tf),
    stopLevel: nodes.stop ? ev.series(nodes.stop, s.tf) : null,
    atrStop: s.stop.kind === 'atr' ? atr(bars, s.stop.length) : null,
    atrTrail: s.trail.kind === 'atr' ? atr(bars, s.trail.length) : null,
    avgValue: ev.series(compile('AVG_TURNOVER(20)', 'num', 'Liquidity'), s.tf).map((v) => (v == null ? null : v / 1e7)),
    breaks: ins.breaks ?? [],
  };
}

type Lot = {
  p: Prepared; qty: number; entryIndex: number; entryTime: number; entryPrice: number; entryCharges: number;
  stop: number | null; target: number | null; trail: number | null; best: number; worst: number;
};
type Order = { p: Prepared; signalIndex: number; qty: number; limit: number | null; trigger: number | null; stopAt: number | null };

export type PortfolioResult = ReturnType<typeof summarise> & { trades: PortfolioTrade[] };

export function runPortfolio(instruments: Instrument[], s: EquityStrategy, benchmark: Candle[] | null): PortfolioResult {
  const bad = validateEquityStrategy(s);
  if (bad) throw new StrategyError(bad);
  const nodes = {
    entry: compile(s.entry, 'bool', 'Entry'),
    exit: s.exit?.trim() ? compile(s.exit, 'bool', 'Exit') : null,
    rank: compile(s.rank?.trim() || 'AVG_TURNOVER(20)', 'num', 'Ranking'),
    stop: s.stop.kind === 'formula' ? compile(s.stop.formula, 'num', 'Stop level') : null,
  };
  const fromT = Date.parse(`${s.from}T00:00:00+05:30`) / 1000, toT = Date.parse(`${s.to}T23:59:59+05:30`) / 1000;
  const broker: BrokerProfile = brokerById(s.broker);
  const prepared = instruments.map((i) => prepare(i, s, nodes, fromT)).filter((p): p is Prepared => !!p);
  if (!prepared.length) throw new StrategyError('None of these stocks has history in the test period');

  // One timeline: every bar time of any stock inside the test window.
  const times = [...new Set(prepared.flatMap((p) => p.bars.filter((b) => b.time >= fromT && b.time <= toT).map((b) => b.time)))].sort((a, b) => a - b);
  if (!times.length) throw new StrategyError('No bars in the test period');

  const initial = toPaise(s.capitalRupees);
  let cash = initial;
  const lots: Lot[] = [];
  const pendingExit = new Map<Lot, PortfolioExitReason>();
  let orders: Order[] = [];
  const lastExit = new Map<string, number>();
  const lastClose = new Map<string, number>();
  const trades: PortfolioTrade[] = [];
  const equity: { time: number; equityPaise: number; open: number }[] = [];
  const counts: Counts = { signals: 0, skippedSlots: 0, skippedCash: 0, unfilled: 0, illiquid: 0 };

  const slip = (price: number, buy: boolean) => (buy ? Math.ceil(price * (1 + s.slippagePct / 100)) : Math.floor(price * (1 - s.slippagePct / 100)));
  const charge = (side: 'BUY' | 'SELL', qty: number, price: number, time: number, product: 'CNC' | 'MIS' = 'CNC') =>
    s.charges ? computeCharges({ side, product, qty, pricePaise: price, firstDeliverySellToday: product === 'CNC' && side === 'SELL', date: istToday(time * 1000), broker }).total : 0;
  const markedEquity = () => cash + lots.reduce((a, l) => a + l.qty * (lastClose.get(l.p.symbol) ?? l.entryPrice), 0);

  const close = (l: Lot, i: number, price: number, reason: PortfolioExitReason) => {
    const t = l.p.bars[i].time;
    const fill = reason === 'end-of-test' || reason === 'data-ended' ? price : slip(price, false);
    let ch = charge('SELL', l.qty, fill, t);
    // Bought and sold the same day: the exchange treats it as an intraday trade.
    if (dayNo(t) === dayNo(l.entryTime) && reason !== 'end-of-test') ch = charge('SELL', l.qty, fill, t, 'MIS') + charge('BUY', l.qty, l.entryPrice, l.entryTime, 'MIS') - l.entryCharges;
    cash += l.qty * fill - ch;
    const gross = (fill - l.entryPrice) * l.qty, chargesPaise = l.entryCharges + ch;
    const entryDate = dateOf(l.entryTime), exitDate = dateOf(t);
    trades.push({
      symbol: l.p.symbol, qty: l.qty, entryTime: l.entryTime, entryPricePaise: l.entryPrice, exitTime: t, exitPricePaise: fill, exitReason: reason,
      grossPaise: gross, chargesPaise, netPaise: gross - chargesPaise, returnPct: ((gross - chargesPaise) / (l.entryPrice * l.qty)) * 100,
      bars: i - l.entryIndex + 1, maePct: ((l.worst - l.entryPrice) / l.entryPrice) * 100, mfePct: ((l.best - l.entryPrice) / l.entryPrice) * 100,
      dataBreak: l.p.breaks.some((d) => d > entryDate && d <= exitDate), open: reason === 'end-of-test',
    });
    lots.splice(lots.indexOf(l), 1);
    pendingExit.delete(l);
    lastExit.set(l.p.symbol, i);
  };

  const levelsAtEntry = (o: Order, fill: number) => {
    const sp = s.stop, i = o.signalIndex;
    let stop: number | null = null;
    if (sp.kind === 'pct') stop = Math.floor(fill * (1 - sp.value / 100));
    if (sp.kind === 'points') stop = fill - toPaise(sp.value);
    if (sp.kind === 'atr' && o.p.atrStop![i] != null) stop = fill - toPaise(sp.mult * o.p.atrStop![i]!);
    if (sp.kind === 'formula' && o.stopAt != null) stop = o.stopAt;
    const risk = stop != null ? fill - stop : null;
    const tg = s.target;
    const target = tg.kind === 'pct' ? Math.ceil(fill * (1 + tg.value / 100)) : tg.kind === 'points' ? fill + toPaise(tg.value)
      : tg.kind === 'rr' && risk != null && risk > 0 ? Math.ceil(fill + tg.value * risk) : null;
    return { stop, target };
  };

  const trailDistance = (l: Lot, i: number): number | null => {
    const tr = s.trail;
    if (tr.kind === 'pct') return Math.ceil(l.best * (tr.value / 100));
    if (tr.kind === 'points') return toPaise(tr.value);
    if (tr.kind === 'atr') { const a = l.p.atrTrail![i]; return a == null ? null : toPaise(tr.mult * a); }
    return null;
  };

  for (let k = 0; k < times.length; k++) {
    const t = times[k];
    const here = prepared.filter((p) => p.index.has(t));

    // ---- the open: pending exits, then orders placed at the previous close ----
    for (const [l, reason] of [...pendingExit]) {
      const i = l.p.index.get(t);
      if (i != null) close(l, i, toPaise(l.p.bars[i].open), reason);
    }
    const nextOrders: Order[] = [];
    for (const o of orders) {
      const i = o.p.index.get(t);
      if (i == null) { nextOrders.push(o); continue; } // that stock has no bar now: the order waits for its next bar
      const b = o.p.bars[i], open = toPaise(b.open), high = toPaise(b.high), low = toPaise(b.low);
      let price: number | null = open;
      if (o.limit != null) price = low <= o.limit ? Math.min(open, o.limit) : null;
      if (o.trigger != null) price = high >= o.trigger ? Math.max(open, o.trigger) : null;
      if (price == null) { counts.unfilled++; continue; }
      const fill = slip(price, true);
      let qty = o.qty;
      const ch0 = charge('BUY', qty, fill, b.time);
      if (qty * fill + ch0 > cash) qty = Math.floor((cash * 0.999) / fill); // only what the cash pays for
      if (qty <= 0) { counts.skippedCash++; continue; }
      const ch = charge('BUY', qty, fill, b.time);
      cash -= qty * fill + ch;
      const { stop, target } = levelsAtEntry(o, fill);
      lots.push({ p: o.p, qty, entryIndex: i, entryTime: b.time, entryPrice: fill, entryCharges: ch, stop, target, trail: null, best: fill, worst: fill });
    }
    orders = nextOrders;

    // ---- inside the bar: stops and targets ----
    for (const l of [...lots]) {
      const i = l.p.index.get(t);
      if (i == null) continue;
      const b = l.p.bars[i], open = toPaise(b.open), high = toPaise(b.high), low = toPaise(b.low);
      const formula = s.stop.kind === 'formula' && i > l.entryIndex && l.p.stopLevel![i - 1] != null ? toPaise(l.p.stopLevel![i - 1]!) : null;
      const levels = [l.stop, l.trail, formula].filter((x): x is number => x != null);
      const stop = levels.length ? Math.max(...levels) : null;
      const stopReason: PortfolioExitReason = stop != null && l.trail != null && stop === l.trail && (l.stop == null || l.trail > l.stop) ? 'trail' : 'stop';
      l.worst = Math.min(l.worst, low);
      l.best = Math.max(l.best, high);
      if (i > l.entryIndex) { // the entry bar opened at the entry price, so it cannot gap past its own levels
        if (stop != null && open <= stop) { close(l, i, open, stopReason); continue; }
        if (l.target != null && open >= l.target) { close(l, i, open, 'target'); continue; }
      }
      if (stop != null && low <= stop) { close(l, i, stop, stopReason); continue; }
      if (l.target != null && high >= l.target) { close(l, i, l.target, 'target'); continue; }
    }

    // ---- the close: trailing stops, exit signals, new signals ----
    for (const p of here) lastClose.set(p.symbol, toPaise(p.bars[p.index.get(t)!].close));
    for (const l of [...lots]) {
      const i = l.p.index.get(t);
      if (i == null) continue;
      const lastBarOfStock = i === l.p.bars.length - 1;
      if (lastBarOfStock && t < toT && k < times.length - 1) { close(l, i, toPaise(l.p.bars[i].close), 'data-ended'); continue; }
      const d = trailDistance(l, i);
      if (d != null) l.trail = Math.max(l.trail ?? -Infinity, l.best - d);
      if (pendingExit.has(l)) continue;
      if (l.p.exit?.[i] === 1) pendingExit.set(l, 'signal');
      else if (s.maxBars != null && i - l.entryIndex + 1 >= s.maxBars) pendingExit.set(l, 'time');
    }

    if (k < times.length - 1) {
      const candidates = here.filter((p) => {
        const i = p.index.get(t)!;
        if (p.entry[i] !== 1 || i >= p.bars.length - 1) return false;
        counts.signals++;
        if (lots.filter((l) => l.p === p).length + orders.filter((o) => o.p === p).length >= s.pyramid) return false;
        const le = lastExit.get(p.symbol);
        if (le != null && i - le <= s.cooldownBars) return false;
        if (s.minAvgValueCr > 0 && !((p.avgValue[i] ?? 0) >= s.minAvgValueCr)) { counts.illiquid++; return false; }
        return true;
      }).sort((a, b) => {
        // Higher rank first; stocks without a rank value last.
        const x = a.rank[a.index.get(t)!], y = b.rank[b.index.get(t)!];
        return x == null ? (y == null ? 0 : 1) : y == null ? -1 : y - x;
      });
      const free = Math.max(0, s.maxOpen - lots.length - orders.length);
      const take = candidates.slice(0, Math.min(free, s.maxEntriesPerBar));
      counts.skippedSlots += candidates.length - take.length;
      const basis = s.reinvest ? markedEquity() : initial;
      for (const p of take) {
        const i = p.index.get(t)!, b = p.bars[i], estimate = toPaise(b.close);
        const stopAt = s.stop.kind === 'formula' && p.stopLevel![i] != null ? toPaise(p.stopLevel![i]!) : null;
        const sz = s.sizing;
        let qty = 0;
        if (sz.mode === 'qty') qty = sz.qty;
        if (sz.mode === 'amount') qty = Math.floor(toPaise(sz.rupees) / estimate);
        if (sz.mode === 'percent') qty = Math.floor((basis * sz.pct) / 100 / estimate);
        if (sz.mode === 'risk') {
          const o: Order = { p, signalIndex: i, qty: 0, limit: null, trigger: null, stopAt };
          const risk = estimate - (levelsAtEntry(o, estimate).stop ?? estimate);
          qty = risk > 0 ? Math.floor((basis * sz.pct) / 100 / risk) : 0;
        }
        if (qty <= 0) { counts.skippedCash++; continue; }
        const od = s.order;
        orders.push({
          p, signalIndex: i, qty, stopAt,
          limit: od.type === 'limit' ? Math.floor(estimate * (1 - od.offsetPct / 100)) : null,
          trigger: od.type === 'stop' ? Math.ceil(toPaise(b.high) * (1 + od.offsetPct / 100)) : null,
        });
      }
    }
    equity.push({ time: t, equityPaise: markedEquity(), open: lots.length });
  }

  // Positions still open are valued at their last close.
  for (const l of [...lots]) close(l, maxIndexAtOrBefore(l.p, times.at(-1)!), lastClose.get(l.p.symbol) ?? l.entryPrice, 'end-of-test');
  if (equity.length) equity[equity.length - 1].equityPaise = cash;

  trades.sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol));
  return { trades, ...summarise(trades, equity, initial, s, benchmark, counts) };
}

function maxIndexAtOrBefore(p: Prepared, t: number): number {
  let i = p.bars.length - 1;
  while (i > 0 && p.bars[i].time > t) i--;
  return i;
}

// ---- metrics ----

/** Signals seen, and why some did not become trades. */
type Counts = { signals: number; skippedSlots: number; skippedCash: number; unfilled: number; illiquid: number };

const PERIODS_PER_YEAR = { D: 252, W: 52, M: 12 } as const;

function drawdown(values: number[]) {
  let peak = values[0] ?? 0, maxDd = 0, maxDdPct = 0, peakAt = 0, ddFrom = 0, ddTo = 0;
  values.forEach((v, i) => {
    if (v > peak) { peak = v; peakAt = i; }
    const dd = peak - v;
    if (dd > maxDd) { maxDd = dd; ddFrom = peakAt; ddTo = i; }
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
  });
  return { maxDd, maxDdPct, ddFrom, ddTo };
}

function summarise(trades: PortfolioTrade[], equity: { time: number; equityPaise: number; open: number }[], initial: number, s: EquityStrategy, benchmark: Candle[] | null, counts: Counts) {
  const closed = trades;
  const wins = closed.filter((t) => t.netPaise > 0), losses = closed.filter((t) => t.netPaise <= 0);
  const sum = (a: PortfolioTrade[], f: (t: PortfolioTrade) => number) => a.reduce((x, t) => x + f(t), 0);
  const winSum = sum(wins, (t) => t.netPaise), lossSum = sum(losses, (t) => t.netPaise);
  let w = 0, l = 0, maxW = 0, maxL = 0;
  for (const t of closed) { if (t.netPaise > 0) { w++; l = 0; } else { l++; w = 0; } maxW = Math.max(maxW, w); maxL = Math.max(maxL, l); }

  const values = equity.map((e) => e.equityPaise);
  const final = values.at(-1) ?? initial;
  const dd = drawdown([initial, ...values]);
  const first = equity[0]?.time ?? 0, last = equity.at(-1)?.time ?? 0;
  const years = Math.max((last - first) / (365.25 * 86400), 1 / 365.25);
  const cagr = final > 0 ? (Math.pow(final / initial, 1 / years) - 1) * 100 : -100;

  // Sharpe and Sortino from bar-to-bar equity returns, annualised; risk-free rate per bar from the annual rate.
  const ppy = PERIODS_PER_YEAR[s.tf];
  const rets = values.map((v, i) => (i ? v / values[i - 1] - 1 : initial ? v / initial - 1 : 0));
  const rf = Math.pow(1 + s.riskFreePct / 100, 1 / ppy) - 1;
  const ex = rets.map((r) => r - rf);
  const mean = ex.reduce((a, b) => a + b, 0) / (ex.length || 1);
  const sd = Math.sqrt(ex.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ex.length - 1));
  const dsd = Math.sqrt(ex.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / (ex.length || 1));
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(ppy) : null;
  const sortino = dsd > 0 ? (mean / dsd) * Math.sqrt(ppy) : null;

  // Month and year returns from equity at each period's last bar.
  const monthEnd = new Map<string, number>();
  for (const e of equity) monthEnd.set(dateOf(e.time).slice(0, 7), e.equityPaise);
  const months: { month: string; returnPct: number }[] = [];
  let prev = initial;
  for (const [m, v] of monthEnd) { months.push({ month: m, returnPct: (v / prev - 1) * 100 }); prev = v; }
  const yearEnd = new Map<string, number>();
  for (const e of equity) yearEnd.set(dateOf(e.time).slice(0, 4), e.equityPaise);
  const yearsOut: { year: string; returnPct: number; trades: number; net: number }[] = [];
  prev = initial;
  for (const [y, v] of yearEnd) {
    const ty = closed.filter((t) => dateOf(t.exitTime).startsWith(y));
    yearsOut.push({ year: y, returnPct: (v / prev - 1) * 100, trades: ty.length, net: sum(ty, (t) => t.netPaise) });
    prev = v;
  }
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((name, d) => {
    const tw = closed.filter((t) => new Date((t.entryTime + IST) * 1000).getUTCDay() === d + 1);
    return { day: name, trades: tw.length, winRatePct: tw.length ? (tw.filter((t) => t.netPaise > 0).length / tw.length) * 100 : null, netPaise: sum(tw, (t) => t.netPaise) };
  });
  const byReason = [...new Set(closed.map((t) => t.exitReason))].map((r) => {
    const tr = closed.filter((t) => t.exitReason === r);
    return { reason: r, trades: tr.length, netPaise: sum(tr, (t) => t.netPaise) };
  });

  // Benchmark: buy and hold over the same bars, scaled to the starting capital.
  let bench: { returnPct: number; cagrPct: number; maxDrawdownPct: number; curve: { time: number; equityPaise: number }[] } | null = null;
  if (benchmark?.length && equity.length) {
    const b = s.tf === 'D' ? benchmark : resample(benchmark, s.tf);
    const byTime = new Map(b.map((x) => [x.time, x.close]));
    let lastPx: number | null = null, basePx: number | null = null;
    const curve: { time: number; equityPaise: number }[] = [];
    for (const e of equity) {
      lastPx = byTime.get(e.time) ?? lastPx;
      if (lastPx == null) continue;
      basePx ??= lastPx;
      curve.push({ time: e.time, equityPaise: Math.round((initial * lastPx) / basePx) });
    }
    if (curve.length) {
      const endV = curve.at(-1)!.equityPaise;
      bench = { returnPct: (endV / initial - 1) * 100, cagrPct: (Math.pow(endV / initial, 1 / years) - 1) * 100, maxDrawdownPct: drawdown(curve.map((c) => c.equityPaise)).maxDdPct, curve };
    }
  }

  const holdDays = closed.map((t) => (t.exitTime - t.entryTime) / 86400);
  const netPaise = final - initial;
  return {
    equity,
    benchmark: bench,
    metrics: {
      initialCapitalPaise: initial, finalEquityPaise: final, netPaise, returnPct: (final / initial - 1) * 100, cagrPct: cagr,
      trades: closed.length, wins: wins.length, losses: losses.length, winRatePct: closed.length ? (wins.length / closed.length) * 100 : null,
      grossPaise: sum(closed, (t) => t.grossPaise), chargesPaise: sum(closed, (t) => t.chargesPaise),
      avgWinPaise: wins.length ? Math.round(winSum / wins.length) : null, avgLossPaise: losses.length ? Math.round(lossSum / losses.length) : null,
      largestWinPaise: wins.length ? Math.max(...wins.map((t) => t.netPaise)) : null, largestLossPaise: losses.length ? Math.min(...losses.map((t) => t.netPaise)) : null,
      profitFactor: lossSum < 0 ? winSum / -lossSum : null,
      expectancyPaise: closed.length ? Math.round(sum(closed, (t) => t.netPaise) / closed.length) : null,
      avgTradeReturnPct: closed.length ? sum(closed, (t) => t.returnPct) / closed.length : null,
      maxDrawdownPaise: dd.maxDd, maxDrawdownPct: dd.maxDdPct,
      drawdownFrom: equity[Math.max(0, dd.ddFrom - 1)]?.time ?? null, drawdownTo: equity[Math.max(0, dd.ddTo - 1)]?.time ?? null,
      recoveryFactor: dd.maxDd > 0 ? netPaise / dd.maxDd : null,
      sharpe, sortino,
      exposurePct: equity.length ? (equity.filter((e) => e.open > 0).length / equity.length) * 100 : 0,
      maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL,
      avgHoldingBars: closed.length ? sum(closed, (t) => t.bars) / closed.length : null,
      avgHoldingDays: holdDays.length ? holdDays.reduce((a, b) => a + b, 0) / holdDays.length : null,
      avgMaePct: closed.length ? sum(closed, (t) => t.maePct) / closed.length : null,
      avgMfePct: closed.length ? sum(closed, (t) => t.mfePct) / closed.length : null,
      from: first, to: last,
      ...counts,
      openAtEnd: closed.filter((t) => t.open).length,
      dataBreakTrades: closed.filter((t) => t.dataBreak).length,
    },
    months, years: yearsOut, weekdays, byReason,
  };
}
