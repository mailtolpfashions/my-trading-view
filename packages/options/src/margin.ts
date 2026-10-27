// Margin for an F&O position on one underlying: SPAN from NSE Clearing's risk parameter file, plus exposure margin.
// Verified against Zerodha Kite's basket margins (apps/feed/scripts/check-margin.ts): futures and single options to
// the paisa; multi-leg baskets within about ₹1, because NSE's file rounds each risk array value to the paisa.
//
// SPAN, as NSE applies it:
// - Scanning risk: each contract has a 16-scenario risk array (loss per unit for a long position, rupees; negative =
//   gain). A portfolio's loss in a scenario is Σ signed qty × value; scanning risk is the worst scenario (≥ 0). Hedges
//   lower it because the legs share the scenarios.
// - Calendar spread charge: scanning treats expiries as perfectly correlated, so SPAN charges per unit of delta that
//   is long in one expiry and short in another, spread by spread in the file's priority order.
// - Expiry day (SEBI, Feb 2025): contracts expiring today get no offset from other expiries. They are scanned as a
//   separate group and take no part in calendar spreads.
// - Net option value: SPAN = max(scanning risk + spread charge − Σ signed qty × option price, short option minimum, 0).
//   A short option's premium value is added and a long option's is credited; long options alone therefore need no
//   SPAN, only their premium.
// Exposure margin (NSE, index derivatives): 2% of notional on futures and short options (notional = qty × futures
// price for futures, qty × underlying price for options), plus 2% more on short options on their expiry day
// (SEBI circular of 1 Oct 2024). Long options carry none.
// Amounts are in paise; quantities are signed units (lots × lot size, + long, − short).

export type SpanContract = { ra: number[]; delta: number; price: number };
export type SpanSpread = { rate: number; legs: { pe: string; side: 'A' | 'B'; ratio: number }[] };
export type SpanUnderlying = {
  underlying: string;
  /** The file these figures came from, e.g. "nsccl.20261027.i01.spn", and when NSE created it (IST, YYYYMMDDhhmm). */
  file: string;
  created: string;
  /** Underlying (index) price in the file, rupees. */
  spot: number;
  futures: Record<string, SpanContract>; // by expiry YYYYMMDD
  options: Record<string, SpanContract>; // by optionKey
  spreads: SpanSpread[];
  /** Short option minimum per short option unit, rupees. */
  somRate: number;
};

export const EXPOSURE_RATE = 0.02;
export const EXPIRY_DAY_EXTRA_RATE = 0.02;

export const optionKey = (pe: string, right: 'CE' | 'PE', strike: number) => `${pe}|${right === 'CE' ? 'C' : 'P'}|${strike.toFixed(2)}`;

/** A leg for margin. `expiry` YYYY-MM-DD, `strike` rupees, `qty` signed units, `pricePaise` the trade price (premium or futures price). */
export type MarginLeg = { kind: 'FUT' | 'CE' | 'PE'; expiry: string; strike: number; qty: number; pricePaise?: number };

export type SpanResult = {
  scanRiskPaise: number;
  spreadChargePaise: number;
  /** Σ signed qty × option price in the SPAN file (positive = net long option value, credited). */
  netOptionValuePaise: number;
  somPaise: number;
  spanPaise: number;
  /** Legs not found in the file (expired, or a strike not in today's file). */
  missing: MarginLeg[];
};

const toPaise = (rupees: number) => Math.round(rupees * 100);
const pe = (expiry: string) => expiry.replaceAll('-', '');

function contractFor(d: SpanUnderlying, l: MarginLeg): SpanContract | undefined {
  return l.kind === 'FUT' ? d.futures[pe(l.expiry)] : d.options[optionKey(pe(l.expiry), l.kind, l.strike)];
}

/** SPAN requirement for a position. `tradeDate` (YYYY-MM-DD) applies the expiry-day rule to contracts expiring that day. */
export function spanMargin(d: SpanUnderlying, legs: MarginLeg[], tradeDate?: string): SpanResult {
  const missing: MarginLeg[] = [];
  const groups = new Map<string, number[]>(); // 'today' (expiring on tradeDate) and 'rest'
  const deltaByExpiry = new Map<string, number>();
  let shortOptions = 0, nov = 0;
  for (const l of legs) {
    const c = contractFor(d, l);
    if (!c) { missing.push(l); continue; }
    const g = tradeDate && l.expiry === tradeDate ? 'today' : 'rest';
    const v = groups.get(g) ?? new Array<number>(16).fill(0);
    for (let s = 0; s < 16; s++) v[s] += l.qty * c.ra[s];
    groups.set(g, v);
    if (g === 'rest') deltaByExpiry.set(pe(l.expiry), (deltaByExpiry.get(pe(l.expiry)) ?? 0) + l.qty * c.delta);
    if (l.kind !== 'FUT') { nov += l.qty * c.price; if (l.qty < 0) shortOptions += -l.qty; }
  }
  let scanRisk = 0;
  for (const v of groups.values()) scanRisk += Math.max(0, ...v);

  let spreadCharge = 0;
  for (const sp of d.spreads) {
    if (sp.legs.length !== 2) continue;
    const [a, b] = sp.legs;
    const da = deltaByExpiry.get(a.pe) ?? 0, db = deltaByExpiry.get(b.pe) ?? 0;
    const formed = a.side !== b.side ? Math.sign(da) === -Math.sign(db) : Math.sign(da) === Math.sign(db);
    if (!da || !db || !formed) continue;
    const n = Math.min(Math.abs(da) / a.ratio, Math.abs(db) / b.ratio);
    spreadCharge += n * sp.rate;
    deltaByExpiry.set(a.pe, da - Math.sign(da) * n * a.ratio);
    deltaByExpiry.set(b.pe, db - Math.sign(db) * n * b.ratio);
  }
  const scanRiskPaise = toPaise(scanRisk), spreadChargePaise = toPaise(spreadCharge), netOptionValuePaise = toPaise(nov), somPaise = toPaise(shortOptions * d.somRate);
  return { scanRiskPaise, spreadChargePaise, netOptionValuePaise, somPaise, spanPaise: Math.max(0, scanRiskPaise + spreadChargePaise - netOptionValuePaise, somPaise), missing };
}

/** Exposure margin: futures and short options, at `spotPaise` for options and each future's trade price. */
export function exposureMargin(legs: MarginLeg[], spotPaise: number, tradeDate?: string): number {
  let total = 0;
  for (const l of legs) {
    if (l.kind === 'FUT') total += Math.abs(l.qty) * (l.pricePaise ?? spotPaise) * EXPOSURE_RATE;
    else if (l.qty < 0) total += -l.qty * spotPaise * (EXPOSURE_RATE + (tradeDate && l.expiry === tradeDate ? EXPIRY_DAY_EXTRA_RATE : 0));
  }
  return Math.round(total);
}

export type MarginResult = SpanResult & {
  exposurePaise: number;
  /** Net option premium at the trade prices: positive = you pay, negative = you receive. */
  premiumPaise: number;
  /** SPAN + exposure: the margin blocked. */
  marginPaise: number;
  /** Funds needed to take the position: margin + premium paid − premium received (as brokers show it). */
  fundsPaise: number;
  /** Margin (SPAN + exposure) if each leg were margined on its own, with no offsets between legs; and the saving. */
  withoutHedgePaise: number;
  hedgeBenefitPaise: number;
};

/** Margin for a position, and what each leg would need on its own. */
export function positionMargin(d: SpanUnderlying, legs: MarginLeg[], spotPaise: number, tradeDate?: string): MarginResult {
  const one = (ls: MarginLeg[]) => {
    const s = spanMargin(d, ls, tradeDate);
    const exposurePaise = exposureMargin(ls, spotPaise, tradeDate);
    const premiumPaise = ls.reduce((sum, l) => sum + (l.kind === 'FUT' ? 0 : l.qty * (l.pricePaise ?? 0)), 0);
    return { ...s, exposurePaise, premiumPaise, marginPaise: s.spanPaise + exposurePaise, fundsPaise: s.spanPaise + exposurePaise + premiumPaise };
  };
  const all = one(legs);
  const withoutHedgePaise = legs.reduce((sum, l) => sum + one([l]).marginPaise, 0);
  return { ...all, withoutHedgePaise, hedgeBenefitPaise: Math.max(0, withoutHedgePaise - all.marginPaise) };
}
