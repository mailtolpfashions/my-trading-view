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

/** A leg in the builder. Price defaults to the official close but can be edited (what-if). */
export type BuilderLeg = { id: string; kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; strikePaise: number; expiry: string; lots: number; pricePaise: number; iv: number | null };

/** Strikes are whole rupees: 22,550 rather than 22,550.00. */
export const fmtStrike = (paise: number) => (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const fmtDate =(d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Strategy templates relative to ATM (in strike steps). */
export const TEMPLATES: { id: string; name: string; legs: { kind: 'CE' | 'PE'; side: 'BUY' | 'SELL'; offset: number }[] }[] = [
  { id: 'short-straddle', name: 'Short straddle', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'SELL', offset: 0 }] },
  { id: 'long-straddle', name: 'Long straddle', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'BUY', offset: 0 }] },
  { id: 'short-strangle', name: 'Short strangle', legs: [{ kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'PE', side: 'SELL', offset: -4 }] },
  { id: 'iron-condor', name: 'Iron condor', legs: [{ kind: 'PE', side: 'SELL', offset: -4 }, { kind: 'PE', side: 'BUY', offset: -8 }, { kind: 'CE', side: 'SELL', offset: 4 }, { kind: 'CE', side: 'BUY', offset: 8 }] },
  { id: 'iron-fly', name: 'Iron butterfly', legs: [{ kind: 'CE', side: 'SELL', offset: 0 }, { kind: 'PE', side: 'SELL', offset: 0 }, { kind: 'CE', side: 'BUY', offset: 6 }, { kind: 'PE', side: 'BUY', offset: -6 }] },
  { id: 'bull-call', name: 'Bull call spread', legs: [{ kind: 'CE', side: 'BUY', offset: 0 }, { kind: 'CE', side: 'SELL', offset: 4 }] },
  { id: 'bear-put', name: 'Bear put spread', legs: [{ kind: 'PE', side: 'BUY', offset: 0 }, { kind: 'PE', side: 'SELL', offset: -4 }] },
];
