// The quant research report: the experiment registry and each experiment's settings, trades and curves from the feed.
import { feed } from './feed';

export type QuantExperiment = {
  id: string; ranAt: string; name: string; family: string; hypothesis: string; script: string;
  params: Record<string, unknown>; data: Record<string, unknown>; period: { from: string; to: string; role: string };
  costs: Record<string, unknown>; metrics: Record<string, unknown>; validation: Record<string, unknown>; caveats: string[]; verdict: string; notes?: string;
  details: string[];
};
export type QuantTrade = { entry: string; exit: string; net: number; worstMtm?: number; reason?: string; expiry?: string; symbol?: string; spotIn?: number; spotOut?: number; legs?: string[]; daily?: { date: string; mtm: number }[] };
export type QuantSetting = { index: number; id: string; params: Record<string, string | number | boolean>; skipped?: number; trades?: QuantTrade[]; curve?: [string, number][]; numbers?: Record<string, number> };
export type QuantDetail = { id: string; name: string; kind: 'settings' | 'curves' | 'trades' | 'combos' | 'curve'; settings: QuantSetting[] };

export type LeadBook = {
  id: string; name: string; lots: number; marginPct: number; what: string[]; risk: string;
  curve: [string, number][];
  yearly: { year: string; returnPct: number; net: number; unseen: boolean; trades: number; won: number }[];
  stats: { cagrPct: number; maxDdPct: number; worstMonthPct: number; worstDayPct: number; worstDayDate: string | null; sharpe: number | null; trades: number; wonPct: number | null; worstTrade: number | null; avgWin: number | null; avgLoss: number | null; losingYears: number; years: number };
  holdout: { cagrPct: number; maxDdPct: number; net: number };
};
export type Leads = { from: string; to: string; holdoutFrom: string; capital: number; books: LeadBook[]; nifty: { curve: [string, number][]; yearly: { year: string; returnPct: number }[]; cagrPct: number; maxDdPct: number; worstYearPct: number }; fd: { ratePct: number; curve: [string, number][] } };

export type StrategyGroup = 'monthly' | 'weekly-nifty' | 'weekly-bank' | 'stocks-breakout' | 'stocks-momentum';
export type Strategy = {
  key: string; group: StrategyGroup; title: string; plain: string;
  when: 'expensive' | 'always' | null; distance: 'at' | 'near' | 'medium' | 'far' | null; unit: 'option' | 'stock';
  period: { from: string; to: string }; trades: number; wonPct: number | null;
  perYearRs: number | null; perYearPct: number; worstTradeRs: number | null; worstOpenRs: number | null;
  maxDdPct: number; maxDdRs: number; goodYears: number; years: number;
  byYear: { year: string; value: number }[]; halves: { label: string; value: number }[];
  final: { perYearRs: number | null; perYearPct: number | null; trades: number; won: number } | null;
  nifty: { perYearPct: number; maxDdPct: number } | null;
  verdict: 'worked' | 'mixed' | 'failed'; reasons: string[];
};
export type TradeRow = { opened: string; closed: string; expiry: string | null; indexIn: number | null; indexOut: number | null; result: number; worstAlong: number | null; how: string };
export type StrategyDetail = Strategy & { curve: [string, number][]; niftyCurve: [string, number][]; tradeList: TradeRow[]; finalTrades: TradeRow[] };
export const GROUP_LABEL: Record<StrategyGroup, string> = {
  monthly: 'Monthly NIFTY options', 'weekly-nifty': 'Weekly NIFTY options', 'weekly-bank': 'Weekly Bank Nifty options', 'stocks-breakout': 'Stocks: 52-week high', 'stocks-momentum': 'Stocks: strongest stocks',
};

export const quantApi = {
  strategies: () => feed<{ strategies: Strategy[]; capital: number }>('quant/strategies'),
  strategy: (key: string) => feed<StrategyDetail>(`quant/strategy?key=${encodeURIComponent(key)}`),
  experiments: () => feed<{ experiments: QuantExperiment[] }>('quant/experiments'),
  detail: (id: string, name: string, setting?: number) => feed<QuantDetail>(`quant/detail/${encodeURIComponent(id)}/${encodeURIComponent(name)}${setting != null ? `?setting=${setting}` : ''}`),
};

export const FAMILY_LABEL: Record<string, string> = {
  P2: 'Regimes', A1: 'Monthly premium: walk-forward', A2: 'Monthly premium: sizing & stress', A3: 'Weekly premium', B9: 'Stock momentum', B10: '52-week-high breakout', P11: 'Sizing & combination', P12: 'Holdout (read once)',
};
export const VERDICT_LABEL: Record<string, string> = { pass: 'Meets the target', lead: 'Lead', fail: 'Does not meet the target', info: 'Information' };
