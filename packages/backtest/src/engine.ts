// Bar-by-bar backtester. Rules that keep results honest:
// - Conditions are evaluated at a bar's close; orders execute at the NEXT bar's open (no look-ahead).
// - Stop loss / target are checked inside each bar using its high/low. If one bar touches both, the stop is assumed
//   to hit first. If the bar opens beyond a level (a gap), the fill is at the open, not the level.
// - Stop and target prices are rounded against the trader (long stop down, long target up; reverse for shorts).
// - Intraday (MIS): no new entries at or after 15:15 IST; open positions exit at the close of the last bar that
//   starts before 15:20 IST, so nothing is carried overnight.
// - Every fill pays the same itemised charges as paper trading. All money is integer paise.

import { computeCharges, istToday } from '@mtv/paper';
import type { Candle, Timeframe } from '@mtv/shared';
import { evalCondition, operandKey, operandSeries, validateStrategy, type Operand, type RuleSet, type Strategy } from './strategy';

export type ExitReason = 'stop' | 'target' | 'signal' | 'time' | 'square-off' | 'end-of-data';

export type BacktestTrade = {
  side: 'LONG' | 'SHORT';
  qty: number;
  entryTime: number;
  entryPricePaise: number;
  exitTime: number;
  exitPricePaise: number;
  exitReason: ExitReason;
  grossPaise: number;
  chargesPaise: number;
  netPaise: number;
  bars: number;
};

export type BacktestResult = {
  trades: BacktestTrade[];
  /**
   * What the strategy does at the open after the last bar, decided at that bar's close: a fresh signal. A position
   * still open at the end appears in `trades` with exitReason 'end-of-data' (marked at the last close).
   */
  nextAction: 'enter' | 'exit' | null;
  equity: { time: number; equityPaise: number }[];
  metrics: {
    initialCapitalPaise: number;
    finalEquityPaise: number;
    netPaise: number;
    grossPaise: number;
    chargesPaise: number;
    returnPct: number;
    trades: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
    avgWinPaise: number | null;
    avgLossPaise: number | null;
    profitFactor: number | null;
    largestWinPaise: number | null;
    largestLossPaise: number | null;
    maxConsecutiveLosses: number;
    maxDrawdownPaise: number;
    maxDrawdownPct: number;
    exposurePct: number;
    buyHoldReturnPct: number | null;
    skippedEntries: number;
    bars: number;
    from: number | null;
    to: number | null;
  };
};

const IST = 5.5 * 3600;
const minuteOfDay = (t: number) => Math.floor(((t + IST) % 86400) / 60);
const dayOf = (t: number) => Math.floor((t + IST) / 86400);
const NO_ENTRY_FROM = 15 * 60 + 15;
const SQUARE_OFF = 15 * 60 + 20;
const toPaise = (rupees: number) => Math.round(rupees * 100);

export class BacktestError extends Error {}

export function runBacktest(candles: Candle[], tf: Timeframe, s: Strategy): BacktestResult {
  const intraday = tf !== 'D' && tf !== 'W';
  const invalid = validateStrategy(s, intraday);
  if (invalid) throw new BacktestError(invalid);
  if (candles.length < 2) throw new BacktestError('Not enough bars to backtest');

  // Indicator series are computed once per distinct operand.
  const cache = new Map<string, (number | null)[]>();
  const series = (o: Operand) => {
    const k = operandKey(o);
    if (!cache.has(k)) cache.set(k, operandSeries(o, candles));
    return cache.get(k)!;
  };
  const rulesHold = (rs: RuleSet, i: number) => {
    const results = rs.conditions.map((c) => evalCondition(c, series(c.left), series(c.right), i));
    return rs.match === 'all' ? results.every(Boolean) : results.some(Boolean);
  };

  const long = s.direction === 'LONG';
  const n = candles.length;
  const trades: BacktestTrade[] = [];
  const equity: BacktestResult['equity'] = [];
  let cash = s.initialCapitalPaise;
  type OpenPosition = { qty: number; entryPrice: number; entryTime: number; entryIndex: number; entryCharges: number; stop: number | null; target: number | null };
  let pos = null as OpenPosition | null;
  let pendingEntry = false, pendingExit: ExitReason | null = null, skipped = 0, barsInMarket = 0;
  let nextAction: BacktestResult['nextAction'] = null;

  /** Charges at the rates in force on the bar's date. */
  const charges = (side: 'BUY' | 'SELL', qty: number, price: number, time: number) =>
    computeCharges({ side, product: s.product, qty, pricePaise: price, firstDeliverySellToday: s.product === 'CNC' && side === 'SELL', date: istToday(time * 1000) }).total;

  const enter = (i: number, price: number) => {
    const qty = s.sizing.mode === 'qty' ? s.sizing.qty : Math.floor((cash * s.sizing.pct) / 100 / price);
    if (qty <= 0) { skipped++; return; }
    const ch = charges(long ? 'BUY' : 'SELL', qty, price, candles[i].time);
    cash += long ? -qty * price - ch : qty * price - ch;
    const sl = s.stopLossPct, tp = s.targetPct;
    pos = {
      qty, entryPrice: price, entryTime: candles[i].time, entryIndex: i, entryCharges: ch,
      stop: sl ? (long ? Math.floor(price * (1 - sl / 100)) : Math.ceil(price * (1 + sl / 100))) : null,
      target: tp ? (long ? Math.ceil(price * (1 + tp / 100)) : Math.floor(price * (1 - tp / 100))) : null,
    };
  };

  const exit = (i: number, price: number, reason: ExitReason) => {
    const p = pos!;
    const ch = charges(long ? 'SELL' : 'BUY', p.qty, price, candles[i].time);
    cash += long ? p.qty * price - ch : -p.qty * price - ch;
    const gross = (long ? price - p.entryPrice : p.entryPrice - price) * p.qty;
    trades.push({
      side: s.direction, qty: p.qty, entryTime: p.entryTime, entryPricePaise: p.entryPrice, exitTime: candles[i].time, exitPricePaise: price,
      exitReason: reason, grossPaise: gross, chargesPaise: p.entryCharges + ch, netPaise: gross - p.entryCharges - ch, bars: i - p.entryIndex + 1,
    });
    pos = null;
  };

  /** Stop/target inside bar i. Gaps fill at the open; if both levels are inside the bar, the stop wins. */
  const checkLevels = (i: number) => {
    const p = pos!;
    const o = toPaise(candles[i].open), h = toPaise(candles[i].high), l = toPaise(candles[i].low);
    const stopHit = (px: number) => p.stop != null && (long ? px <= p.stop : px >= p.stop);
    const targetHit = (px: number) => p.target != null && (long ? px >= p.target : px <= p.target);
    if (i > p.entryIndex) { // the entry bar opened at the entry price, so it cannot gap past its own levels
      if (stopHit(o)) return exit(i, o, 'stop');
      if (targetHit(o)) return exit(i, o, 'target');
    }
    if (stopHit(long ? l : h)) return exit(i, p.stop!, 'stop');
    if (targetHit(long ? h : l)) return exit(i, p.target!, 'target');
  };

  // When the data simply ends (e.g. mid-session today) that is 'end-of-data', not a square-off.
  const isSquareOffBar = (i: number) => {
    if (minuteOfDay(candles[i].time) >= SQUARE_OFF) return true;
    const next = candles[i + 1];
    return !!next && (dayOf(next.time) !== dayOf(candles[i].time) || minuteOfDay(next.time) >= SQUARE_OFF);
  };

  for (let i = 0; i < n; i++) {
    const bar = candles[i];
    if (pendingExit && pos) exit(i, toPaise(bar.open), pendingExit);
    pendingExit = null;
    if (pendingEntry && !pos) enter(i, toPaise(bar.open));
    pendingEntry = false;

    if (pos) checkLevels(i);
    if (pos && s.product === 'MIS' && isSquareOffBar(i)) exit(i, toPaise(bar.close), 'square-off');
    if (pos) barsInMarket++;

    // Decide at this bar's close; act at the next bar's open.
    const next = candles[i + 1];
    const held = pos ? i - pos.entryIndex + 1 : 0;
    const exitNow: ExitReason | null = !pos ? null
      : s.exit?.conditions.length && rulesHold(s.exit, i) ? 'signal'
      : s.maxBars != null && held >= s.maxBars ? 'time'
      : null;
    if (next) {
      if (exitNow) pendingExit = exitNow;
      else if (!pos && rulesHold(s.entry, i)) {
        const entryAllowed = s.product !== 'MIS' || (dayOf(next.time) === dayOf(bar.time) && minuteOfDay(next.time) < NO_ENTRY_FROM);
        if (entryAllowed) pendingEntry = true;
      }
    } else if (s.product !== 'MIS') {
      // Last bar: the decision for the next session's open (intraday strategies cannot carry one overnight).
      nextAction = exitNow ? 'exit' : !pos && rulesHold(s.entry, i) ? 'enter' : null;
    }

    const p = pos as OpenPosition | null; // the helpers above reassign `pos`, which TypeScript's narrowing can't see
    const mark = p ?(long ? p.qty * toPaise(bar.close) : -p.qty * toPaise(bar.close)) : 0;
    equity.push({ time: bar.time, equityPaise: cash + mark });
  }
  if (pos) exit(n - 1, toPaise(candles[n - 1].close), 'end-of-data');
  if (equity.length) equity[equity.length - 1].equityPaise = cash;

  return { trades, nextAction, equity, metrics: metrics(trades, equity, s.initialCapitalPaise, candles, barsInMarket, skipped) };
}

function metrics(trades: BacktestTrade[], equity: BacktestResult['equity'], initial: number, candles: Candle[], barsInMarket: number, skipped: number): BacktestResult['metrics'] {
  const wins = trades.filter((t) => t.netPaise > 0), losses = trades.filter((t) => t.netPaise <= 0);
  const sum = (a: BacktestTrade[], k: 'netPaise' | 'grossPaise' | 'chargesPaise') => a.reduce((s, t) => s + t[k], 0);
  let peak = initial, maxDd = 0, maxDdPct = 0, streak = 0, maxStreak = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.equityPaise);
    const dd = peak - e.equityPaise;
    if (dd > maxDd) maxDd = dd;
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
  }
  for (const t of trades) { streak = t.netPaise <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const final = equity.at(-1)?.equityPaise ?? initial;
  const winSum = sum(wins, 'netPaise'), lossSum = sum(losses, 'netPaise');
  const first = candles[0], last = candles.at(-1)!;
  return {
    initialCapitalPaise: initial,
    finalEquityPaise: final,
    netPaise: sum(trades, 'netPaise'),
    grossPaise: sum(trades, 'grossPaise'),
    chargesPaise: sum(trades, 'chargesPaise'),
    returnPct: ((final - initial) / initial) * 100,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    avgWinPaise: wins.length ? Math.round(winSum / wins.length) : null,
    avgLossPaise: losses.length ? Math.round(lossSum / losses.length) : null,
    profitFactor: lossSum < 0 ? winSum / -lossSum : null,
    largestWinPaise: wins.length ? Math.max(...wins.map((t) => t.netPaise)) : null,
    largestLossPaise: losses.length ? Math.min(...losses.map((t) => t.netPaise)) : null,
    maxConsecutiveLosses: maxStreak,
    maxDrawdownPaise: maxDd,
    maxDrawdownPct: maxDdPct,
    exposurePct: candles.length ? (barsInMarket / candles.length) * 100 : 0,
    buyHoldReturnPct: first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null,
    skippedEntries: skipped,
    bars: candles.length,
    from: first?.time ?? null,
    to: last?.time ?? null,
  };
}
