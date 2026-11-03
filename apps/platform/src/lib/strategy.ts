// Equity strategies: the settings the backtest engine takes (packages/backtest EquityStrategy), defaults, templates
// and the data service calls.

import type { Candle } from '@mtv/shared';
import { feed } from './feed';
import type { UniverseSpec } from './screener';

export type StopSpec = { kind: 'none' } | { kind: 'pct'; value: number } | { kind: 'points'; value: number } | { kind: 'atr'; mult: number; length: number } | { kind: 'formula'; formula: string };
export type TargetSpec = { kind: 'none' } | { kind: 'pct'; value: number } | { kind: 'points'; value: number } | { kind: 'rr'; value: number };
export type TrailSpec = { kind: 'none' } | { kind: 'pct'; value: number } | { kind: 'points'; value: number } | { kind: 'atr'; mult: number; length: number };
export type Sizing = { mode: 'qty'; qty: number } | { mode: 'amount'; rupees: number } | { mode: 'percent'; pct: number } | { mode: 'risk'; pct: number };
export type OrderSpec = { type: 'market' } | { type: 'limit'; offsetPct: number } | { type: 'stop'; offsetPct: number };

export type StrategyTf = 'D' | 'W' | 'M' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h';
export const isIntradayTf = (tf: string) => !['D', 'W', 'M'].includes(tf);
/** Intraday session rules (HH:MM, IST): entries from firstEntry, none from lastEntry, everything out at squareOff. */
export type IntradayRules = { firstEntry?: string; lastEntry: string; squareOff: string };
export const DEFAULT_INTRADAY: IntradayRules = { firstEntry: '09:15', lastEntry: '15:00', squareOff: '15:15' };

export type EquityStrategy = {
  tf: StrategyTf; intraday?: IntradayRules; side: 'LONG'; entry: string; exit?: string; order: OrderSpec;
  stop: StopSpec; target: TargetSpec; trail: TrailSpec; maxBars?: number; sizing: Sizing;
  maxOpen: number; pyramid: number; cooldownBars: number; maxEntriesPerBar: number; rank: string; minAvgValueCr: number;
  capitalRupees: number; reinvest: boolean; slippagePct: number; broker: string; charges: boolean;
  from: string; to: string; riskFreePct: number;
};

export type StrategyDoc = { id?: string; name: string; description: string; style: 'intraday' | 'swing' | 'positional'; strategy: EquityStrategy; universe: UniverseSpec };

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
/** A year back: about all the minute data there is. */
const yearAgo = () => new Date(Date.now() + 5.5 * 3600_000 - 365 * 86400_000).toISOString().slice(0, 10);

export const DEFAULT_STRATEGY: EquityStrategy = {
  tf: 'D', side: 'LONG', entry: '', exit: '', order: { type: 'market' },
  stop: { kind: 'pct', value: 2 }, target: { kind: 'pct', value: 5 }, trail: { kind: 'none' },
  sizing: { mode: 'percent', pct: 10 }, maxOpen: 10, pyramid: 1, cooldownBars: 0, maxEntriesPerBar: 5,
  rank: 'AVG_TURNOVER(20)', minAvgValueCr: 5, capitalRupees: 1000000, reinvest: true,
  slippagePct: 0.05, broker: 'zerodha', charges: true, from: '2023-01-01', to: today(), riskFreePct: 6,
};

export const NEW_DOC: StrategyDoc = { name: 'Untitled strategy', description: '', style: 'swing', strategy: DEFAULT_STRATEGY, universe: { kind: 'index', name: 'NIFTY 100' } };

export type Template = { id: string; name: string; about: string; style: 'intraday' | 'swing' | 'positional'; patch: Partial<EquityStrategy> };

/** Ready-made equity strategies (spec 11). Each one is an ordinary strategy: open it, read it, change it, test it. */
export const TEMPLATES: Template[] = [
  { id: 'ema-cross-rsi', name: 'EMA crossover with RSI', style: 'swing', about: 'Buy when EMA 20 crosses above EMA 50 with RSI(14) above 55 on 1.5× volume; 2% stop, 5% target, out when the EMAs cross back.',
    patch: { entry: 'CROSSOVER(EMA(CLOSE, 20), EMA(CLOSE, 50)) AND RSI(CLOSE, 14) > 55 AND VOLUME > 1.5 * AVG_VOLUME(20)[1]', exit: 'CROSSUNDER(EMA(CLOSE, 20), EMA(CLOSE, 50))', stop: { kind: 'pct', value: 2 }, target: { kind: 'pct', value: 5 } } },
  { id: 'rsi-reversal', name: 'RSI reversal', style: 'swing', about: 'Buy when RSI(14) climbs back above 30 while the stock is above its 200-day average; sell when RSI passes 60. ATR stop.',
    patch: { entry: 'CROSSOVER(RSI(CLOSE, 14), 30) AND CLOSE > SMA(CLOSE, 200)', exit: 'RSI(CLOSE, 14) > 60', stop: { kind: 'atr', mult: 2, length: 14 }, target: { kind: 'none' } } },
  { id: 'macd-momentum', name: 'MACD momentum', style: 'swing', about: 'Buy on a MACD signal crossover above the zero line; sell on the reverse crossover. 3% stop.',
    patch: { entry: 'CROSSOVER(MACD_LINE(CLOSE, 12, 26, 9), MACD_SIGNAL(CLOSE, 12, 26, 9)) AND MACD_LINE(CLOSE, 12, 26, 9) > 0', exit: 'CROSSUNDER(MACD_LINE(CLOSE, 12, 26, 9), MACD_SIGNAL(CLOSE, 12, 26, 9))', stop: { kind: 'pct', value: 3 }, target: { kind: 'none' } } },
  { id: 'supertrend', name: 'Supertrend trend following', style: 'positional', about: 'Buy when Supertrend (10, 3) turns bullish with ADX above 20; the Supertrend line is the trailing stop.',
    patch: { entry: 'SUPERTREND_DIR(10, 3) = 1 AND SUPERTREND_DIR(10, 3)[1] = -1 AND ADX(14, 14) > 20', exit: '', stop: { kind: 'formula', formula: 'SUPERTREND(10, 3)' }, target: { kind: 'none' } } },
  { id: 'bollinger-reversal', name: 'Bollinger Band reversal', style: 'swing', about: 'Buy when the close crosses back above the lower band (20, 2); sell at the middle band. 4% stop.',
    patch: { entry: 'CROSSOVER(CLOSE, BB_LOWER(CLOSE, 20, 2))', exit: 'CLOSE > BB_MIDDLE(CLOSE, 20, 2)', stop: { kind: 'pct', value: 4 }, target: { kind: 'none' } } },
  { id: '52w-breakout', name: '52-week high breakout', style: 'positional', about: 'Buy a close above the previous 252-day high on 2× volume; trail 10% below the highest high.',
    patch: { entry: 'CLOSE > HIGHEST(HIGH, 252)[1] AND RVOL(20) > 2', exit: '', stop: { kind: 'pct', value: 8 }, target: { kind: 'none' }, trail: { kind: 'pct', value: 10 } } },
  { id: 'st-rsi-15m', name: 'Supertrend + RSI, 15 minutes', style: 'intraday', about: 'Intraday, 15-minute candles from 09:20: buy while Supertrend (10, 3) is bullish and RSI (14) is above 70; the stop follows the Supertrend line; squared off at 15:15.',
    patch: { tf: '15m', intraday: { firstEntry: '09:20', lastEntry: '15:00', squareOff: '15:15' }, entry: 'SUPERTREND_DIR(10, 3) = 1 AND RSI(CLOSE, 14) > 70', exit: '', stop: { kind: 'formula', formula: 'SUPERTREND(10, 3)' }, target: { kind: 'none' }, trail: { kind: 'none' }, maxOpen: 1, pyramid: 1, cooldownBars: 0, sizing: { mode: 'percent', pct: 100 }, from: yearAgo() } },
  { id: 'vwap-breakout', name: 'VWAP breakout', style: 'intraday', about: 'Intraday, 5-minute bars: buy a close back above VWAP on 1.5× the usual volume for the time of day; out below VWAP. 1% stop, 2% target, squared off at 15:15.',
    patch: { tf: '5m', entry: 'CROSSOVER(CLOSE, VWAP) AND RVOL_TOD(20) > 1.5', exit: 'CROSSUNDER(CLOSE, VWAP)', stop: { kind: 'pct', value: 1 }, target: { kind: 'pct', value: 2 }, maxOpen: 5, sizing: { mode: 'percent', pct: 20 }, minAvgValueCr: 20, from: yearAgo() } },
  { id: 'orb', name: 'Opening range breakout', style: 'intraday', about: 'Intraday, 5-minute bars: buy a close above the first 15 minutes\' high on busier-than-usual volume; stop at the range low, target 2× the risk, squared off at 15:15.',
    patch: { tf: '5m', entry: 'CLOSE > OR_HIGH(15) AND RVOL_CUM(20) > 1.5', exit: '', stop: { kind: 'formula', formula: 'OR_LOW(15)' }, target: { kind: 'rr', value: 2 }, maxOpen: 5, pyramid: 1, cooldownBars: 100, sizing: { mode: 'percent', pct: 20 }, minAvgValueCr: 20, from: yearAgo() } },
];

// ---- results ----

export type Trade = {
  symbol: string; qty: number; entryTime: number; entryPricePaise: number; exitTime: number; exitPricePaise: number;
  exitReason: 'signal' | 'stop' | 'trail' | 'target' | 'time' | 'square-off' | 'end-of-test' | 'data-ended';
  grossPaise: number; chargesPaise: number; netPaise: number; returnPct: number; bars: number; maePct: number; mfePct: number; dataBreak: boolean; open: boolean;
};
export type BacktestResult = {
  trades: Trade[]; tradesTruncated: boolean; stocks: number; warnings: string[];
  /** Symbols that took no part, by reason (at most 50 named per reason). */
  excluded?: { reason: string; count: number; symbols: string[] }[]; ms: number;
  equity: { time: number; equityPaise: number; open: number }[];
  benchmark: { returnPct: number; cagrPct: number; maxDrawdownPct: number; curve: { time: number; equityPaise: number }[] } | null;
  metrics: {
    initialCapitalPaise: number; finalEquityPaise: number; netPaise: number; returnPct: number; cagrPct: number;
    trades: number; wins: number; losses: number; winRatePct: number | null; grossPaise: number; chargesPaise: number;
    avgWinPaise: number | null; avgLossPaise: number | null; largestWinPaise: number | null; largestLossPaise: number | null;
    profitFactor: number | null; expectancyPaise: number | null; avgTradeReturnPct: number | null;
    maxDrawdownPaise: number; maxDrawdownPct: number; drawdownFrom: number | null; drawdownTo: number | null; recoveryFactor: number | null;
    sharpe: number | null; sortino: number | null; exposurePct: number; maxConsecutiveWins: number; maxConsecutiveLosses: number;
    avgHoldingBars: number | null; avgHoldingDays: number | null; avgMaePct: number | null; avgMfePct: number | null;
    from: number; to: number; signals: number; skippedSlots: number; skippedCash: number; unfilled: number; illiquid: number; lateEntry: number; earlyEntry?: number; openAtEnd: number; dataBreakTrades: number;
  };
  months: { month: string; returnPct: number }[];
  years: { year: string; returnPct: number; trades: number; net: number }[];
  weekdays: { day: string; trades: number; winRatePct: number | null; netPaise: number }[];
  byReason: { reason: string; trades: number; netPaise: number }[];
};

export type SavedStrategy = {
  id: string; name: string; description: string; strategy: EquityStrategy & { style?: 'swing' | 'positional' }; universe: UniverseSpec; createdAt: string; updatedAt: string;
  backtests: { at: string; from: string; to: string; trades: number; returnPct: number; cagrPct: number; maxDrawdownPct: number; winRatePct: number | null }[];
};

export const strategyApi = {
  list: () => feed<SavedStrategy[]>('user/strategies'),
  save: (d: StrategyDoc) => feed<SavedStrategy>('user/strategies', { id: d.id, name: d.name, description: d.description, strategy: { ...d.strategy, style: d.style }, universe: d.universe }),
  remove: (id: string) => feed<{ ok: true }>('user/strategies/delete', { id }),
  backtest: (d: StrategyDoc) => feed<BacktestResult>('strategy/backtest', { strategy: d.strategy, universe: d.universe, strategyId: d.id }),
};

export function fromSaved(s: SavedStrategy): StrategyDoc {
  const { style, ...strategy } = s.strategy;
  return { id: s.id, name: s.name, description: s.description, style: style ?? 'swing', strategy: { ...DEFAULT_STRATEGY, ...strategy }, universe: s.universe };
}

/** ₹1,23,456 or −₹1,23,456 (the sign before the symbol). */
export const rupees = (paise: number | null | undefined, d = 0) => (paise == null ? '–' : `${paise < 0 ? '−' : ''}₹${Math.abs(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
export type { Candle };
