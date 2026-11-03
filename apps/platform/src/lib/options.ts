import { FEED_URL, feedFetch } from './feed';

export type ChainSide = {
  closePaise: number; settlePaise: number; oi: number; volume: number; traded: boolean; iv: number | null; delta: number | null; theta: number | null; vega: number | null; gamma: number | null;
  /** Change in open interest from the previous trading day (same contract), null if not listed then. */
  oiChange?: number | null;
  prevClosePaise?: number | null;
};
export type ChainRow = { strikePaise: number; CE: ChainSide | null; PE: ChainSide | null };
export type Chain = {
  underlying: string;
  date: string;
  expiry: string;
  expiries: string[];
  lotSize: number | null;
  isIndex?: boolean;
  spotPaise: number | null;
  /** Previous trading day (base for OI change). */
  prevDate?: string | null;
  strikeStepPaise?: number | null;
  forwardPaise: number | null;
  atmStrikePaise: number | null;
  rows: ChainRow[];
};

/** The chain on `date` (the latest trading day on or before it; omitted = latest). */
export async function fetchChain(underlying: string, expiry?: string, date?: string): Promise<Chain> {
  const res = await feedFetch(`${FEED_URL}/api/fno/chain?underlying=${underlying}${expiry ? `&expiry=${expiry}` : ''}${date ? `&date=${date}` : ''}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Option chain unavailable');
  return body as Chain;
}

/** Per-unit Greeks of a contract, from the chain it was added from (legs can come from different expiries). */
export type LegGreeks = { delta: number; theta: number; vega: number };
/** A leg in the builder. Price defaults to the official close but can be edited (what-if). */
export type BuilderLeg = { id: string; kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; strikePaise: number; expiry: string; lots: number; pricePaise: number; iv: number | null; greeks: LegGreeks | null };

export const legGreeks = (q: ChainSide): LegGreeks | null => (q.delta == null || q.theta == null || q.vega == null ? null : { delta: q.delta, theta: q.theta, vega: q.vega });

/** Margin for a position from the feed (SPAN from NSE's start-of-day file + exposure margin). */
export type MarginResponse = {
  scanRiskPaise: number; spreadChargePaise: number; netOptionValuePaise: number; spanPaise: number; exposurePaise: number;
  premiumPaise: number; marginPaise: number; fundsPaise: number; withoutHedgePaise: number; hedgeBenefitPaise: number;
  missing: unknown[]; file: string; created: string; tradeDate: string;
  /** A past day's file (simulator): exposure and expiry-day rules are today's, not verified for that date. */
  historical?: boolean;
};
export async function fetchMargin(underlying: string, spotPaise: number, legs: { kind: 'CE' | 'PE'; expiry: string; strikePaise: number; qty: number; pricePaise: number }[], signal?: AbortSignal, date?: string): Promise<MarginResponse> {
  const res = await feedFetch(`${FEED_URL}/api/margin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ underlying, spotPaise, legs, date }), signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Margin unavailable');
  return body as MarginResponse;
}

/** Strikes are whole rupees: 22,550 rather than 22,550.00. */
export const fmtStrike = (paise: number) => (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const fmtDate =(d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Strategy templates relative to ATM (in strike steps); `expiryOffset` 1 = the expiry after the selected one; `lots`
 * defaults to 1 (ratio legs use 2). Grouped by the view each expresses, as they appear in the builder's menu.
 */
export type TemplateGroup = 'Bullish' | 'Bearish' | 'Neutral' | 'Volatile' | 'Calendar';
export const TEMPLATE_GROUPS: TemplateGroup[] = ['Bullish', 'Bearish', 'Neutral', 'Volatile', 'Calendar'];
type TemplateLeg = { kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; offset: number; expiryOffset?: number; lots?: number };
export const TEMPLATES: { id: string; name: string; group: TemplateGroup; legs: TemplateLeg[] }[] = [
  { id: 'bull-call', name: 'Bull call spread', group: 'Bullish', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'CE', side: 'SELL', offset: 4 }] },
  { id: 'bull-put', name: 'Bull put spread', group: 'Bullish', legs: [{ kind: 'PE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'BUY', offset: -4 }] },
  { id: 'call-ratio', name: 'Call ratio spread (1 × 2)', group: 'Bullish', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'CE', side: 'SELL', offset: 4, lots: 2 }] },
  { id: 'jade-lizard', name: 'Jade lizard', group: 'Bullish', legs: [{ kind: 'PE', side: 'SELL', offset: -4 }, { kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'CE', side: 'BUY', offset: 8 }] },
  { id: 'bear-put', name: 'Bear put spread', group: 'Bearish', legs: [{ kind: 'PE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'SELL', offset: -4 }] },
  { id: 'bear-call', name: 'Bear call spread', group: 'Bearish', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'CE', side: 'BUY', offset: 4 }] },
  { id: 'put-ratio', name: 'Put ratio spread (1 × 2)', group: 'Bearish', legs: [{ kind: 'PE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'SELL', offset: -4, lots: 2 }] },
  { id: 'reverse-jade-lizard', name: 'Reverse jade lizard', group: 'Bearish', legs: [{ kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'PE', side: 'SELL', offset: -4 }, { kind: 'PE', side: 'BUY', offset: -8 }] },
  { id: 'short-straddle', name: 'Short straddle', group: 'Neutral', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'SELL', offset: 0 }] },
  { id: 'short-strangle', name: 'Short strangle', group: 'Neutral', legs: [{ kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'PE', side: 'SELL', offset: -4 }] },
  { id: 'iron-condor', name: 'Iron condor', group: 'Neutral', legs: [{ kind: 'PE', side: 'SELL', offset: -4 }, { kind: 'PE', side: 'BUY', offset: -8 }, { kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'CE', side: 'BUY', offset: 8 }] },
  { id: 'iron-fly', name: 'Iron butterfly', group: 'Neutral', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'SELL', offset: 0 }, { kind: 'CE', side: 'BUY', offset: 6 }, { kind: 'PE', side: 'BUY', offset: -6 }] },
  { id: 'call-butterfly', name: 'Call butterfly', group: 'Neutral', legs: [{ kind: 'CE', side: 'BUY', offset: -4 }, { kind: 'CE', side: 'SELL', offset: 0, lots: 2 }, { kind: 'CE', side: 'BUY', offset: 4 }] },
  { id: 'batman', name: 'Batman (two ratio spreads)', group: 'Neutral', legs: [{ kind: 'CE', side: 'BUY', offset: 2 }, { kind: 'CE', side: 'SELL', offset: 5, lots: 2 }, { kind: 'PE', side: 'BUY', offset: -2 }, { kind: 'PE', side: 'SELL', offset: -5, lots: 2 }] },
  { id: 'long-straddle', name: 'Long straddle', group: 'Volatile', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'BUY', offset: 0 }] },
  { id: 'long-strangle', name: 'Long strangle', group: 'Volatile', legs: [{ kind: 'CE', side: 'BUY', offset: 4 }, { kind: 'PE', side: 'BUY', offset: -4 }] },
  { id: 'reverse-iron-condor', name: 'Reverse iron condor', group: 'Volatile', legs: [{ kind: 'PE', side: 'BUY', offset: -4 }, { kind: 'PE', side: 'SELL', offset: -8 }, { kind: 'CE', side: 'BUY', offset: 4 }, { kind: 'CE', side: 'SELL', offset: 8 }] },
  { id: 'call-calendar', name: 'Call calendar (sell this expiry, buy next)', group: 'Calendar', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'CE', side: 'BUY', offset: 0, expiryOffset: 1 }] },
  { id: 'put-calendar', name: 'Put calendar (sell this expiry, buy next)', group: 'Calendar', legs: [{ kind: 'PE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'BUY', offset: 0, expiryOffset: 1 }] },
  { id: 'call-diagonal', name: 'Call diagonal (sell OTM this expiry, buy ATM next)', group: 'Calendar', legs: [{ kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'CE', side: 'BUY', offset: 0, expiryOffset: 1 }] },
];

/**
 * IV smile of a chain: for each traded strike with volume, the IV of its out-of-the-money side (calls above the
 * forward, puts below), as the what-if models expect.
 */
export function buildSmile(c: Chain, minVolume = 100): { k: number; iv: number }[] {
  if (!c.forwardPaise) return [];
  const out: { k: number; iv: number }[] = [];
  for (const r of c.rows) {
    const s = r.strikePaise >= c.forwardPaise ? r.CE : r.PE;
    if (s?.traded && s.iv != null && s.volume >= minVolume) out.push({ k: r.strikePaise, iv: s.iv });
  }
  return out;
}

/** First and last day of NSE F&O data held. */
export async function fetchFnoRange(): Promise<{ from: string | null; to: string | null }> {
  const res = await feedFetch(`${FEED_URL}/api/fno/status`);
  const body = await res.json().catch(() => ({}));
  return { from: body.from ?? null, to: body.to ?? null };
}

// ---- options simulator (feed: /api/options-sim) ----
export type SimLegDay = { pricePaise: number | null; source: 'close' | 'settle' | 'expired' | 'missing'; iv: number | null; delta: number | null; theta: number | null; vega: number | null; gamma: number | null };
export type SimDay = { date: string; spotPaise: number | null; legs: SimLegDay[]; grossPaise: number; chargesIfExitPaise: number; netIfExitPaise: number; delta: number; theta: number; vega: number; gamma: number; greeksMissing: number; openLegs: number };
export type SimLeg = { expiry: string; strikePaise: number; kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; lots: number; entryPaise: number; qty: number; enteredUntraded: boolean };
export type SimResult = { underlying: string; entryDate: string; lotSize: number; legs: SimLeg[]; entryChargesPaise: number; days: SimDay[]; end: 'expired' | 'end-of-data'; notes: string[] };

export async function runSimulation(body: { underlying: string; entryDate: string; broker: string; legs: Omit<SimLeg, 'qty' | 'enteredUntraded'>[] }): Promise<SimResult> {
  const res = await feedFetch(`${FEED_URL}/api/options-sim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.message ?? 'Simulation failed');
  return out as SimResult;
}
