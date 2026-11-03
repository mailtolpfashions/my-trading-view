import type { OptionLegSpec, OptionsBacktestResult, OptionsStrategy } from '@mtv/backtest';
import type { DataStatus } from '@mtv/shared';
import { FEED_URL, feedFetch } from './feed';

export type FnoCoverage = { savedDays: number; from: string | null; to: string | null; running: boolean };
export type OptionsBacktestResponse = { status: DataStatus; fno: FnoCoverage; result: OptionsBacktestResult };

export async function runOptionsBacktestApi(strategy: OptionsStrategy): Promise<OptionsBacktestResponse> {
  const res = await feedFetch(`${FEED_URL}/api/options-backtest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Options backtest failed');
  return body as OptionsBacktestResponse;
}

export async function fetchFnoCoverage(): Promise<FnoCoverage | null> {
  const res = await feedFetch(`${FEED_URL}/api/fno/status`).catch(() => null);
  return res?.ok ? res.json() : null;
}

const atm = (kind: 'CE' | 'PE', side: 'BUY' | 'SELL', expiry: OptionLegSpec['expiry'] = 'week0'): OptionLegSpec => ({ kind, side, lots: 1, strike: { by: 'moneyness', moneyness: 'ATM', steps: 0 }, expiry });
const otm = (kind: 'CE' | 'PE', side: 'BUY' | 'SELL', steps: number, expiry: OptionLegSpec['expiry'] = 'week0'): OptionLegSpec => ({ kind, side, lots: 1, strike: { by: 'moneyness', moneyness: 'OTM', steps }, expiry });

/** Starting points to edit, not recommendations. */
export const OPTION_PRESETS: OptionsStrategy[] = [
  { name: 'Friday short straddle (weekly, to expiry)', underlying: 'NIFTY', entry: { when: 'weekdays', days: [5] }, exit: {}, legs: [atm('CE', 'SELL'), atm('PE', 'SELL')] },
  { name: 'Iron condor 2 days before expiry', underlying: 'NIFTY', entry: { when: 'daysToExpiry', days: 2 }, exit: {}, legs: [otm('PE', 'SELL', 4), otm('PE', 'BUY', 8), otm('CE', 'SELL', 4), otm('CE', 'BUY', 8)] },
  { name: 'Short strangle with ₹3,000 stop', underlying: 'NIFTY', entry: { when: 'weekdays', days: [1] }, exit: { stopLossRupees: 3000 }, legs: [otm('CE', 'SELL', 6), otm('PE', 'SELL', 6)] },
  {
    name: 'RSI oversold → sell put spread', underlying: 'NIFTY', exit: { targetPct: 60 },
    entry: { when: 'signal', rules: { match: 'all', conditions: [{ left: { kind: 'indicator', name: 'RSI', params: [14] }, op: 'crossesAbove', right: { kind: 'number', value: 35 } }] } },
    legs: [otm('PE', 'SELL', 2, 'month0'), otm('PE', 'BUY', 8, 'month0')],
  },
  {
    name: 'Supertrend flip → buy ATM call (monthly)', underlying: 'BANKNIFTY', exit: { stopLossPct: 40, targetPct: 80 },
    entry: { when: 'signal', rules: { match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'indicator', name: 'SUPERTREND', params: [10, 3] } }] } },
    legs: [atm('CE', 'BUY', 'month0')],
  },
];

export const EXPIRY_LABEL: Record<OptionLegSpec['expiry'], string> = { week0: 'Current week', week1: 'Next week', month0: 'Current month', month1: 'Next month' };
