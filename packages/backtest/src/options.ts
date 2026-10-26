// End-of-day options backtester (StockMock-style legs) on NSE's official F&O data. Rules that keep it honest:
// - Entries and exits happen at a day's official close. A leg whose contract did not trade that day cannot be entered:
//   the entry is skipped and reported. While held, an untraded day is valued at NSE's settlement price (counted).
// - On expiry, options settle at intrinsic value against the index's official close (NSE's final settlement rule);
//   long in-the-money options pay STT on exercise. Other exits pay itemised option charges.
// - Indicator signals on the underlying are evaluated at day t's close and acted on at day t+1's close (no look-ahead).
// - Stop loss / target are checked at the daily close only. Intraday breaches need minute data.
// All money is integer paise.

import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import type { Candle } from '@mtv/shared';
import { evalCondition, operandKey, operandSeries, type Operand, type RuleSet } from './strategy';

export type ExpiryPick = 'week0' | 'week1' | 'month0' | 'month1';
export type StrikePick = { by: 'moneyness'; moneyness: 'ATM' | 'OTM' | 'ITM'; steps: number } | { by: 'premium'; premium: number };
export type OptionLegSpec = { kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; lots: number; strike: StrikePick; expiry: ExpiryPick };

export type OptionsStrategy = {
  name: string;
  underlying: 'NIFTY' | 'BANKNIFTY';
  legs: OptionLegSpec[];
  entry: { when: 'daily' } | { when: 'weekdays'; days: number[] } | { when: 'daysToExpiry'; days: number } | { when: 'signal'; rules: RuleSet };
  exit: { holdDays?: number; stopLossRupees?: number; targetRupees?: number; stopLossPct?: number; targetPct?: number; signal?: RuleSet };
  from?: string;
  to?: string;
};

export type ContractQuote = { strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
export type ContractKey = { expiry: string; strikePaise: number; kind: 'CE' | 'PE' };

/** Data the engine needs; the feed implements it over Postgres, tests over memory. */
export interface OptionsData {
  tradingDates(underlying: string, from: string, to: string): Promise<string[]>;
  meta(underlying: string, date: string): Promise<{ spotPaise: number | null; lotSize: number | null } | null>;
  expiries(underlying: string, date: string): Promise<string[]>;
  chain(underlying: string, date: string, expiry: string, kind: 'CE' | 'PE'): Promise<ContractQuote[]>;
  quotes(underlying: string, date: string, contracts: ContractKey[]): Promise<Map<string, ContractQuote>>;
}

export const contractId = (c: ContractKey) => `${c.expiry}|${c.strikePaise}|${c.kind}`;
export const STRIKE_STEP_PAISE: Record<string, number> = { NIFTY: 50_00, BANKNIFTY: 100_00 };

export type OptionsTradeLeg = ContractKey & { side: 'BUY' | 'SELL'; qty: number; entryPaise: number; exitPaise: number; settledDays: number };
export type OptionsExitReason = 'expiry' | 'stop' | 'target' | 'time' | 'signal' | 'end-of-data';
export type OptionsTrade = {
  entryDate: string;
  exitDate: string;
  exitReason: OptionsExitReason;
  spotEntryPaise: number;
  spotExitPaise: number;
  legs: OptionsTradeLeg[];
  grossPaise: number;
  chargesPaise: number;
  netPaise: number;
  tradingDays: number;
};

export type OptionsBacktestResult = {
  trades: OptionsTrade[];
  equity: { date: string; equityPaise: number }[];
  skipped: { date: string; reason: string }[];
  metrics: {
    trades: number; wins: number; losses: number; winRatePct: number | null;
    netPaise: number; grossPaise: number; chargesPaise: number;
    avgWinPaise: number | null; avgLossPaise: number | null; profitFactor: number | null;
    largestWinPaise: number | null; largestLossPaise: number | null; maxDrawdownPaise: number; maxConsecutiveLosses: number;
    monthly: Record<string, number>;
    byWeekday: Record<string, number>;
    settledLegDays: number;
    from: string | null; to: string | null; days: number;
  };
};

export class OptionsBacktestError extends Error {}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const IST = 5.5 * 3600;
const istDate = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);

export function validateOptionsStrategy(s: OptionsStrategy): string | null {
  if (!s.legs.length) return 'Add at least one leg';
  if (s.legs.length > 6) return 'At most 6 legs';
  for (const l of s.legs) {
    if (!Number.isSafeInteger(l.lots) || l.lots < 1) return 'Lots must be a whole number of 1 or more';
    if (l.strike.by === 'moneyness' && (!Number.isSafeInteger(l.strike.steps) || l.strike.steps < 0 || (l.strike.moneyness === 'ATM' && l.strike.steps !== 0))) return 'Strike steps must be a whole number (0 for ATM)';
    if (l.strike.by === 'premium' && !(l.strike.premium > 0)) return 'Target premium must be above zero';
  }
  if (s.entry.when === 'weekdays' && !s.entry.days.length) return 'Pick at least one entry weekday';
  if (s.entry.when === 'daysToExpiry' && !(Number.isSafeInteger(s.entry.days) && s.entry.days >= 1)) return 'Days before expiry must be 1 or more';
  if (s.entry.when === 'signal' && !s.entry.rules.conditions.length) return 'Add an entry signal condition';
  for (const v of [s.exit.stopLossRupees, s.exit.targetRupees, s.exit.stopLossPct, s.exit.targetPct, s.exit.holdDays]) if (v != null && !(v > 0)) return 'Exit values must be above zero';
  return null;
}

/** Monthly expiries are the last listed expiry of each calendar month. */
export function pickExpiry(expiries: string[], date: string, pick: ExpiryPick): string | null {
  const after = [...new Set(expiries)].filter((e) => e > date).sort();
  if (pick === 'week0') return after[0] ?? null;
  if (pick === 'week1') return after[1] ?? null;
  const monthly = after.filter((e, i) => after[i + 1]?.slice(0, 7) !== e.slice(0, 7));
  return (pick === 'month0' ? monthly[0] : monthly[1]) ?? null;
}

/** Strike for a moneyness pick. OTM moves up for calls and down for puts; ITM the opposite. */
export function moneynessStrike(spotPaise: number, step: number, kind: 'CE' | 'PE', m: 'ATM' | 'OTM' | 'ITM', steps: number): number {
  const atm = Math.round(spotPaise / step) * step;
  if (m === 'ATM') return atm;
  const dir = (m === 'OTM' ? 1 : -1) * (kind === 'CE' ? 1 : -1);
  return atm + dir * steps * step;
}

export async function runOptionsBacktest(s: OptionsStrategy, data: OptionsData, underlyingDaily: Candle[] = []): Promise<OptionsBacktestResult> {
  const invalid = validateOptionsStrategy(s);
  if (invalid) throw new OptionsBacktestError(invalid);
  const dates = await data.tradingDates(s.underlying, s.from ?? '0000-01-01', s.to ?? '9999-12-31');
  if (dates.length < 2) throw new OptionsBacktestError('Not enough F&O history in this period');
  const step = STRIKE_STEP_PAISE[s.underlying];

  // Indicator rules on the underlying's daily candles, indexed by IST date.
  const candleIndex = new Map(underlyingDaily.map((c, i) => [istDate(c.time), i]));
  const cache = new Map<string, (number | null)[]>();
  const series = (o: Operand) => { const k = operandKey(o); if (!cache.has(k)) cache.set(k, operandSeries(o, underlyingDaily)); return cache.get(k)!; };
  const signal = (rules: RuleSet, date: string) => {
    const i = candleIndex.get(date);
    if (i == null) return false;
    const r = rules.conditions.map((c) => evalCondition(c, series(c.left), series(c.right), i));
    return rules.match === 'all' ? r.every(Boolean) : r.some(Boolean);
  };
  if ((s.entry.when === 'signal' || s.exit.signal) && !underlyingDaily.length) throw new OptionsBacktestError('Indicator signals need the underlying\'s daily candles');

  type Open = { entryDate: string; entryIndex: number; spotEntry: number; expiry: string; legs: OptionsTradeLeg[]; entryCharges: number; last: Map<string, number>; basis: number };
  let pos = null as Open | null; // reassigned inside helpers, which TypeScript's narrowing cannot follow
  let realised = 0;
  let pendingEntry = false, pendingExit = false;
  const trades: OptionsTrade[] = [], equity: OptionsBacktestResult['equity'] = [], skipped: OptionsBacktestResult['skipped'] = [];

  const mtm = (p: Open) => p.legs.reduce((sum, l) => sum + (l.side === 'BUY' ? 1 : -1) * l.qty * ((p.last.get(contractId(l)) ?? l.entryPaise) - l.entryPaise), 0);

  const close = (p: Open, date: string, index: number, reason: OptionsExitReason, spot: number, settleAtExpiry: boolean) => {
    let exitCharges = 0;
    for (const l of p.legs) {
      if (settleAtExpiry) {
        const intrinsic = Math.max(0, l.kind === 'CE' ? spot - l.strikePaise : l.strikePaise - spot);
        l.exitPaise = intrinsic;
        if (l.side === 'BUY') exitCharges += exerciseStt(l.qty, intrinsic);
      } else {
        l.exitPaise = p.last.get(contractId(l)) ?? l.entryPaise;
        exitCharges += computeOptionCharges({ side: l.side === 'BUY' ? 'SELL' : 'BUY', qty: l.qty, premiumPaise: l.exitPaise }).total;
      }
    }
    const gross = p.legs.reduce((sum, l) => sum + (l.side === 'BUY' ? 1 : -1) * l.qty * (l.exitPaise - l.entryPaise), 0);
    const charges = p.entryCharges + exitCharges;
    trades.push({ entryDate: p.entryDate, exitDate: date, exitReason: reason, spotEntryPaise: p.spotEntry, spotExitPaise: spot, legs: p.legs, grossPaise: gross, chargesPaise: charges, netPaise: gross - charges, tradingDays: index - p.entryIndex });
    realised += gross - charges;
  };

  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const meta = await data.meta(s.underlying, date);
    const spot = meta?.spotPaise ?? null;
    let exitedToday = false;

    if (pos) {
      const q = await data.quotes(s.underlying, date, pos.legs);
      for (const l of pos.legs) {
        const c = q.get(contractId(l));
        if (!c) continue; // keep the last known price
        if (!c.traded) l.settledDays++;
        pos.last.set(contractId(l), c.traded ? c.closePaise : c.settlePaise);
      }
      const pnl = mtm(pos);
      let reason: OptionsExitReason | null = null;
      if (date >= pos.expiry) reason = 'expiry';
      else if ((s.exit.stopLossRupees && pnl <= -s.exit.stopLossRupees * 100) || (s.exit.stopLossPct && pnl <= -(pos.basis * s.exit.stopLossPct) / 100)) reason = 'stop';
      else if ((s.exit.targetRupees && pnl >= s.exit.targetRupees * 100) || (s.exit.targetPct && pnl >= (pos.basis * s.exit.targetPct) / 100)) reason = 'target';
      else if (s.exit.holdDays && di - pos.entryIndex >= s.exit.holdDays) reason = 'time';
      else if (pendingExit) reason = 'signal';
      if (reason) {
        if (reason === 'expiry' && spot == null) skipped.push({ date, reason: 'Expiry day has no official index close; settled at last prices' });
        close(pos, date, di, reason, spot ?? pos.spotEntry, reason === 'expiry' && spot != null);
        pos = null;
        exitedToday = true;
      }
    }
    pendingExit = false;

    if (!pos && !exitedToday) {
      const e = s.entry;
      const wantEntry = e.when === 'daily' || (e.when === 'weekdays' && e.days.includes(weekday(date))) || (e.when === 'signal' && pendingEntry) || (e.when === 'daysToExpiry' && await daysToExpiryMatches(date, di));
      if (wantEntry) await tryEnter(date, di);
    }
    pendingEntry = false;

    // Decide at today's close; act at the next day's close.
    if (s.entry.when === 'signal' && !pos) pendingEntry = signal(s.entry.rules, date);
    if (s.exit.signal && pos) pendingExit = signal(s.exit.signal, date);

    equity.push({ date, equityPaise: realised + (pos ? mtm(pos) - pos.entryCharges : 0) });
  }
  if (pos) {
    const last = dates[dates.length - 1];
    close(pos, last, dates.length - 1, 'end-of-data', (await data.meta(s.underlying, last))?.spotPaise ?? pos.spotEntry, false);
    pos = null;
    equity[equity.length - 1].equityPaise = realised;
  }

  async function daysToExpiryMatches(date: string, di: number) {
    const exp = pickExpiry(await data.expiries(s.underlying, date), date, s.legs[0].expiry);
    if (!exp) return false;
    const ei = dates.indexOf(exp);
    return ei > di && ei - di === (s.entry as { days: number }).days;
  }

  async function tryEnter(date: string, di: number) {
    const meta = await data.meta(s.underlying, date);
    if (!meta?.spotPaise) return void skipped.push({ date, reason: 'No official index close' });
    if (!meta.lotSize) return void skipped.push({ date, reason: 'Lot size could not be determined for this day' });
    const expiries = await data.expiries(s.underlying, date);
    const legs: OptionsTradeLeg[] = [];
    for (const spec of s.legs) {
      const expiry = pickExpiry(expiries, date, spec.expiry);
      if (!expiry) return void skipped.push({ date, reason: `No ${spec.expiry} expiry listed` });
      const chain = (await data.chain(s.underlying, date, expiry, spec.kind)).filter((c) => c.traded && c.closePaise > 0);
      let pick: ContractQuote | undefined;
      if (spec.strike.by === 'moneyness') {
        const k = moneynessStrike(meta.spotPaise, step, spec.kind, spec.strike.moneyness, spec.strike.steps);
        pick = chain.find((c) => c.strikePaise === k);
        if (!pick) return void skipped.push({ date, reason: `${k / 100} ${spec.kind} (${expiry}) did not trade` });
      } else {
        const target = Math.round(spec.strike.premium * 100);
        pick = [...chain].sort((a, b) => Math.abs(a.closePaise - target) - Math.abs(b.closePaise - target) || (spec.kind === 'CE' ? b.strikePaise - a.strikePaise : a.strikePaise - b.strikePaise))[0];
        if (!pick) return void skipped.push({ date, reason: `No traded ${spec.kind} for ${expiry}` });
      }
      legs.push({ expiry, strikePaise: pick.strikePaise, kind: spec.kind, side: spec.side, qty: spec.lots * meta.lotSize, entryPaise: pick.closePaise, exitPaise: 0, settledDays: 0 });
    }
    const entryCharges = legs.reduce((sum, l) => sum + computeOptionCharges({ side: l.side, qty: l.qty, premiumPaise: l.entryPaise }).total, 0);
    const basis = Math.abs(legs.reduce((sum, l) => sum + (l.side === 'SELL' ? 1 : -1) * l.qty * l.entryPaise, 0));
    pos = { entryDate: date, entryIndex: di, spotEntry: meta.spotPaise, expiry: legs.map((l) => l.expiry).sort()[0], legs, entryCharges, last: new Map(legs.map((l) => [contractId(l), l.entryPaise])), basis };
  }

  return { trades, equity, skipped, metrics: optionsMetrics(trades, equity, dates) };
}

function optionsMetrics(trades: OptionsTrade[], equity: OptionsBacktestResult['equity'], dates: string[]): OptionsBacktestResult['metrics'] {
  const wins = trades.filter((t) => t.netPaise > 0), losses = trades.filter((t) => t.netPaise <= 0);
  const sum = (a: OptionsTrade[], k: 'netPaise' | 'grossPaise' | 'chargesPaise') => a.reduce((s, t) => s + t[k], 0);
  let peak = 0, maxDd = 0, streak = 0, maxStreak = 0;
  for (const e of equity) { peak = Math.max(peak, e.equityPaise); maxDd = Math.max(maxDd, peak - e.equityPaise); }
  for (const t of trades) { streak = t.netPaise <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const monthly: Record<string, number> = {}, byWeekday: Record<string, number> = {};
  for (const t of trades) {
    monthly[t.exitDate.slice(0, 7)] = (monthly[t.exitDate.slice(0, 7)] ?? 0) + t.netPaise;
    const wd = WEEKDAYS[weekday(t.entryDate)];
    byWeekday[wd] = (byWeekday[wd] ?? 0) + t.netPaise;
  }
  const winSum = sum(wins, 'netPaise'), lossSum = sum(losses, 'netPaise');
  return {
    trades: trades.length, wins: wins.length, losses: losses.length, winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    netPaise: sum(trades, 'netPaise'), grossPaise: sum(trades, 'grossPaise'), chargesPaise: sum(trades, 'chargesPaise'),
    avgWinPaise: wins.length ? Math.round(winSum / wins.length) : null, avgLossPaise: losses.length ? Math.round(lossSum / losses.length) : null,
    profitFactor: lossSum < 0 ? winSum / -lossSum : null,
    largestWinPaise: wins.length ? Math.max(...wins.map((t) => t.netPaise)) : null, largestLossPaise: losses.length ? Math.min(...losses.map((t) => t.netPaise)) : null,
    maxDrawdownPaise: maxDd, maxConsecutiveLosses: maxStreak, monthly, byWeekday,
    settledLegDays: trades.reduce((s, t) => s + t.legs.reduce((a, l) => a + l.settledDays, 0), 0),
    from: dates[0] ?? null, to: dates.at(-1) ?? null, days: dates.length,
  };
}
