import { FEED_URL, feedFetch } from './feed';

export type ChainSide = { closePaise: number; settlePaise: number; oi: number; volume: number; traded: boolean; iv: number | null; delta: number | null; theta: number | null; vega: number | null; gamma: number | null };
export type ChainRow = { strikePaise: number; CE: ChainSide | null; PE: ChainSide | null };
export type Chain = {
  underlying: 'NIFTY' | 'BANKNIFTY';
  date: string;
  expiry: string;
  expiries: string[];
  lotSize: number | null;
  spotPaise: number | null;
  forwardPaise: number | null;
  atmStrikePaise: number | null;
  rows: ChainRow[];
};

export async function fetchChain(underlying: string, expiry?: string): Promise<Chain> {
  const res = await feedFetch(`${FEED_URL}/api/fno/chain?underlying=${underlying}${expiry ? `&expiry=${expiry}` : ''}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Option chain unavailable');
  return body as Chain;
}

export class ChainAccessError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

/** Live chain (price = last traded, settlePaise = previous close). Throws ChainAccessError when the plan or source can't have it. */
export async function fetchLiveChain(underlying: string, expiry?: string): Promise<Chain & { live: true; asOf: number }> {
  const res = await feedFetch(`${FEED_URL}/api/option-chain?underlying=${underlying}${expiry ? `&expiry=${expiry}` : ''}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ChainAccessError(body.message ?? 'Live option chain unavailable', body.error ?? 'failed');
  return body;
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
};
export async function fetchMargin(underlying: string, spotPaise: number, legs: { kind: 'CE' | 'PE'; expiry: string; strikePaise: number; qty: number; pricePaise: number }[], signal?: AbortSignal): Promise<MarginResponse> {
  const res = await feedFetch(`${FEED_URL}/api/margin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ underlying, spotPaise, legs }), signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? 'Margin unavailable');
  return body as MarginResponse;
}

/** Strikes are whole rupees: 22,550 rather than 22,550.00. */
export const fmtStrike = (paise: number) => (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const fmtDate =(d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Strategy templates relative to ATM (in strike steps); `expiryOffset` 1 = the expiry after the selected one. */
export const TEMPLATES: { id: string; name: string; legs: { kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; offset: number; expiryOffset?: number }[] }[] = [
  { id: 'short-straddle', name: 'Short straddle', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'SELL', offset: 0 }] },
  { id: 'long-straddle', name: 'Long straddle', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'BUY', offset: 0 }] },
  { id: 'short-strangle', name: 'Short strangle', legs: [{ kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'PE', side: 'SELL', offset: -4 }] },
  { id: 'iron-condor', name: 'Iron condor', legs: [{ kind: 'PE', side: 'SELL', offset: -4 }, { kind: 'PE', side: 'BUY', offset: -8 }, { kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'CE', side: 'BUY', offset: 8 }] },
  { id: 'iron-fly', name: 'Iron butterfly', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'SELL', offset: 0 }, { kind: 'CE', side: 'BUY', offset: 6 }, { kind: 'PE', side: 'BUY', offset: -6 }] },
  { id: 'bull-call', name: 'Bull call spread', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'CE', side: 'SELL', offset: 4 }] },
  { id: 'bear-put', name: 'Bear put spread', legs: [{ kind: 'PE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'SELL', offset: -4 }] },
  { id: 'call-calendar', name: 'Call calendar (sell this expiry, buy next)', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'CE', side: 'BUY', offset: 0, expiryOffset: 1 }] },
  { id: 'put-calendar', name: 'Put calendar (sell this expiry, buy next)', legs: [{ kind: 'PE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'BUY', offset: 0, expiryOffset: 1 }] },
  { id: 'call-diagonal', name: 'Call diagonal (sell OTM this expiry, buy ATM next)', legs: [{ kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'CE', side: 'BUY', offset: 0, expiryOffset: 1 }] },
];
