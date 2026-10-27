import type { Condition, Operand, RuleSet, Strategy } from '@mtv/backtest';
import { FEED_URL, feedFetch } from './feed';
import { INDICATOR_LABELS } from './backtest';

export type SignalStats = {
  signals: number; closed: number; open: number; wins: number;
  winRatePct: number | null; avgReturnPct: number | null; medianReturnPct: number | null;
  avgWinPct: number | null; avgLossPct: number | null; profitFactor: number | null;
  bestPct: number | null; worstPct: number | null; maxConsecutiveLosses: number; avgSessions: number | null;
  from: string | null; to: string | null;
};

export type StrategySummary = {
  id: string; slug: string; version: number; name: string; description: string;
  publishedAt: string | null; publishedDay: string | null; problem: string | null; computedFor: string | null;
  backtest: SignalStats | null; live: SignalStats | null; openPositions: number;
};

export type LatestSignal = { strategyId: string; strategy: string; symbol: string; action: 'ENTER' | 'EXIT'; close: number; issuedAt: string };

export type SignalTrade = {
  symbol: string; signalDate: string; entryDate: string; entryPrice: number;
  exitDate: string | null; exitPrice: number; exitReason: string; returnPct: number; sessions: number; live: boolean;
};

export type StrategyDetail = StrategySummary & {
  rules: Strategy; rulesHash: string; open: SignalTrade[]; recent: SignalTrade[];
  issues: { date: string; symbol: string; action: 'ENTER' | 'EXIT'; close: number; issuedAt: string }[];
};

export type ScanRow = { symbol: string; close: number; changePct: number | null; volume: number; valueCr: number; values: Record<string, number | null> };
export type ScanResult = { date: string | null; complete: boolean; scanned: number; matches: number; rows: ScanRow[] };

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? fallback);
  return body as T;
}

export const fetchSignals = async () => json<{ strategies: StrategySummary[]; date: string | null; signals: LatestSignal[] }>(await feedFetch(`${FEED_URL}/api/signals`), 'Signals are unavailable');
export const fetchSignal = async (id: string) => json<StrategyDetail>(await feedFetch(`${FEED_URL}/api/signals/${encodeURIComponent(id)}`), 'Signal strategy not found');
export const runScanApi = async (rules: RuleSet) =>
  json<ScanResult>(await feedFetch(`${FEED_URL}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) }), 'Scan failed');
export const fetchEodStatus = async () => json<{ savedDays: number; from: string | null; to: string | null; stocks: number; universe: number; running: boolean }>(await feedFetch(`${FEED_URL}/api/eod/status`), 'Status unavailable');

// ---- plain-language rules ----

const COMPARATOR_WORDS: Record<Condition['op'], string> = { crossesAbove: 'crosses above', crossesBelow: 'crosses below', '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below' };

export function describeOperand(o: Operand): string {
  if (o.kind === 'number') return o.value.toLocaleString('en-IN');
  if (o.kind === 'price') return o.field[0].toUpperCase() + o.field.slice(1);
  if (o.name === 'HIGHEST') return `highest high of the previous ${o.params[0]} sessions`;
  if (o.name === 'LOWEST') return `lowest low of the previous ${o.params[0]} sessions`;
  if (o.name === 'VOL_SMA') return `${o.params[0]}-session average volume`;
  if (o.name === 'VALUE_SMA') return `${o.params[0]}-session average traded value (₹ crore)`;
  return o.params.length ? `${INDICATOR_LABELS[o.name]} (${o.params.join(', ')})` : INDICATOR_LABELS[o.name];
}

export const describeCondition = (c: Condition) => `${describeOperand(c.left)} ${COMPARATOR_WORDS[c.op]} ${describeOperand(c.right)}`;

/** Column label for a scanner value key such as "RSI(14)" or "HIGHEST(252)". */
export function valueLabel(key: string): string {
  const m = /^([A-Z_]+)\(([^)]*)\)$/.exec(key);
  if (!m) return key[0].toUpperCase() + key.slice(1);
  const params = m[2] ? m[2].split(',').map(Number) : [];
  return describeOperand({ kind: 'indicator', name: m[1] as Extract<Operand, { kind: 'indicator' }>['name'], params });
}

// ---- scanner presets ----

const ind = (name: Extract<Operand, { kind: 'indicator' }>['name'], ...params: number[]): Operand => ({ kind: 'indicator', name, params });
const close: Operand = { kind: 'price', field: 'close' };
const volume: Operand = { kind: 'price', field: 'volume' };
const num = (value: number): Operand => ({ kind: 'number', value });
const cond = (left: Operand, op: Condition['op'], right: Operand): Condition => ({ left, op, right });
const LIQUID = [cond(ind('VALUE_SMA', 20), '>=', num(5))];

/** Starting points, not recommendations. All are evaluated at the latest NSE close. */
export const SCAN_PRESETS: { id: string; name: string; rules: RuleSet }[] = [
  { id: '52wh', name: 'New 52-week high', rules: { match: 'all', conditions: [cond(close, '>', ind('HIGHEST', 252)), ...LIQUID] } },
  { id: '52wl', name: 'New 52-week low', rules: { match: 'all', conditions: [cond(close, '<', ind('LOWEST', 252)), ...LIQUID] } },
  { id: 'breakout20', name: '20-day breakout on volume', rules: { match: 'all', conditions: [cond(close, '>', ind('HIGHEST', 20)), cond(volume, '>', ind('VOL_SMA', 20)), ...LIQUID] } },
  { id: 'gainers', name: 'Up 5% or more today', rules: { match: 'all', conditions: [cond(ind('CHANGE_PCT'), '>=', num(5)), ...LIQUID] } },
  { id: 'losers', name: 'Down 5% or more today', rules: { match: 'all', conditions: [cond(ind('CHANGE_PCT'), '<=', num(-5)), ...LIQUID] } },
  { id: 'golden', name: 'Golden cross (SMA 50 over SMA 200)', rules: { match: 'all', conditions: [cond(ind('SMA', 50), 'crossesAbove', ind('SMA', 200)), ...LIQUID] } },
  { id: 'rsi-os', name: 'RSI 14 below 30', rules: { match: 'all', conditions: [cond(ind('RSI', 14), '<', num(30)), ...LIQUID] } },
  { id: 'rsi-ob', name: 'RSI 14 above 70', rules: { match: 'all', conditions: [cond(ind('RSI', 14), '>', num(70)), ...LIQUID] } },
  { id: 'st-flip', name: 'Supertrend turned up', rules: { match: 'all', conditions: [cond(close, 'crossesAbove', ind('SUPERTREND', 10, 3)), ...LIQUID] } },
  { id: 'ema-cross', name: 'EMA 20 crossed above EMA 50', rules: { match: 'all', conditions: [cond(ind('EMA', 20), 'crossesAbove', ind('EMA', 50)), ...LIQUID] } },
];
