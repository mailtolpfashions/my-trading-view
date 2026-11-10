// Options simulator: a position built on a past day, followed day by day on NSE's official F&O data until its last
// leg expires (or the data ends). Rules, the same as the options backtester:
// - Each day an open leg is valued at NSE's close; a contract that did not trade that day at NSE's settlement price
//   (flagged).
// - On its expiry day a leg settles at intrinsic value against the index's official close (NSE's final settlement
//   rule) and stays fixed after that. Long in-the-money legs pay exercise STT (and any broker exercise brokerage).
// - "Exit today" = square off every open leg at that day's prices, paying that day's charges at the rates then in force.
// - A leg can be squared off early (`exits`), all of it or some lots: at the close of the chosen day those lots are
//   closed at that day's price (one exit order, that day's charges) and their P&L is fixed; the rest runs on.
// - Futures legs (kind FUT, strike 0) are valued at NSE's futures close and settle at the index's official close on
//   expiry, with futures charges (no exercise STT); their delta is 1 a unit.
// - IV and Greeks are Black-76 estimates from each day's prices and the forward implied by put-call parity at that
//   day's at-the-money strike. They never affect P&L.
// All money is integer paise.

import { black76, impliedVol, yearsToExpiry } from '@mtv/options';
import { computeFuturesCharges, computeOptionCharges, expirySettlementCharges, type BrokerProfile } from '@mtv/paper';
import { contractId, type ContractKey, type ContractQuote, type OptionsData } from './options';

export const SIM_RATE = 0.065; // matches the option chain's model rate; estimates only
export const SIM_MAX_LEGS = 10;
export const SIM_MAX_DAYS = 400;

/** A leg: an option (CE / PE) or a future (FUT, strike 0). */
export type SimLegInput = Omit<ContractKey, 'kind'> & { kind: 'CE' | 'PE' | 'FUT'; side: 'BUY' | 'SELL'; lots: number; entryPaise: number };
/** Square off `lots` of leg `leg` (its index; all its open lots when omitted) at the close of `date`. */
export type SimExit = { leg: number; date: string; lots?: number };
export type SimInput = { underlying: 'NIFTY' | 'BANKNIFTY'; entryDate: string; legs: SimLegInput[]; exits?: SimExit[]; broker?: BrokerProfile };

export type SimLegDay = {
  /** Value per unit used that day: close, settlement price (untraded), or intrinsic (expired). Null = no price at all. */
  pricePaise: number | null;
  /** Lots of this leg still open at that day's close (fewer than entered once some are squared off). */
  openLots: number;
  source: 'close' | 'settle' | 'expired' | 'squared' | 'missing';
  iv: number | null;
  delta: number | null;
  theta: number | null;
  vega: number | null;
  gamma: number | null;
};

export type SimDay = {
  date: string;
  spotPaise: number | null;
  legs: SimLegDay[];
  /** Mark-to-market P&L before charges, against the entry prices. */
  grossPaise: number;
  /** Entry charges + settlement charges of legs expired so far + squaring off the rest at today's prices. */
  chargesIfExitPaise: number;
  netIfExitPaise: number;
  /** Position Greeks (units, ₹/day, ₹ per vol point, units per ₹), over open legs with an IV. */
  delta: number;
  theta: number;
  vega: number;
  gamma: number;
  /** Open legs left out of the Greeks (no IV that day). */
  greeksMissing: number;
  openLegs: number;
};

export type SimResult = {
  underlying: string;
  entryDate: string;
  lotSize: number;
  legs: (SimLegInput & { qty: number; enteredUntraded: boolean })[];
  entryChargesPaise: number;
  days: SimDay[];
  /** Why the run stopped: every leg expired, or NSE data ends before the last expiry. */
  end: 'expired' | 'end-of-data';
  notes: string[];
};

export class SimError extends Error {}

const sign = (side: 'BUY' | 'SELL') => (side === 'BUY' ? 1 : -1);
const closeOf = (date: string) => Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600;
/** Value per unit at expiry: an option's intrinsic value; a future settles at the index close. */
const intrinsic = (k: { kind: SimLegInput['kind']; strikePaise: number }, spot: number) => (k.kind === 'FUT' ? spot : Math.max(0, k.kind === 'CE' ? spot - k.strikePaise : k.strikePaise - spot));
/** Charges for one order on a leg (`qty` units): futures or options rates. */
const tradeCharges = (l: SimLegInput, side: 'BUY' | 'SELL', qty: number, pricePaise: number, date: string, broker?: BrokerProfile) =>
  l.kind === 'FUT' ? computeFuturesCharges({ side, qty, pricePaise, date, broker }).total : computeOptionCharges({ side, qty, premiumPaise: pricePaise, date, broker }).total;
/** The data layer reads futures rows like any contract (strike 0). */
const asKey = (l: SimLegInput) => l as unknown as ContractKey;

/** Forward from put-call parity at the strike nearest spot where both sides traded: F = K + (C − P)·e^(rT). */
export function parityForward(calls: ContractQuote[], puts: ContractQuote[], spotPaise: number, T: number, r = SIM_RATE): number | null {
  const put = new Map(puts.filter((p) => p.traded).map((p) => [p.strikePaise, p]));
  let best: { k: number; c: number; p: number } | null = null;
  for (const c of calls) {
    const p = put.get(c.strikePaise);
    if (!c.traded || !p) continue;
    if (!best || Math.abs(c.strikePaise - spotPaise) < Math.abs(best.k - spotPaise)) best = { k: c.strikePaise, c: c.closePaise, p: p.closePaise };
  }
  return best ? best.k + (best.c - best.p) * Math.exp(r * T) : null;
}

export function validateSim(s: SimInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.entryDate)) return 'Pick an entry date';
  if (!Array.isArray(s.legs) || !s.legs.length) return 'Add at least one leg';
  if (s.legs.length > SIM_MAX_LEGS) return `At most ${SIM_MAX_LEGS} legs`;
  for (const l of s.legs) {
    if (!['CE', 'PE', 'FUT'].includes(l.kind) || !['BUY', 'SELL'].includes(l.side)) return 'Each leg needs CE/PE/FUT and BUY/SELL';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.expiry) || l.expiry < s.entryDate) return 'A leg expires before the entry date';
    if (!Number.isSafeInteger(l.strikePaise) || (l.kind === 'FUT' ? l.strikePaise !== 0 : l.strikePaise <= 0) || !Number.isSafeInteger(l.entryPaise) || l.entryPaise < 0) return 'Bad strike or price';
    if (!Number.isInteger(l.lots) || l.lots < 1 || l.lots > 1000) return 'Lots must be 1–1000';
  }
  const closing = new Map<number, number>();
  for (const x of s.exits ?? []) {
    if (!Number.isInteger(x.leg) || x.leg < 0 || x.leg >= s.legs.length) return 'A square-off names a leg that does not exist';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || x.date <= s.entryDate) return 'A leg can be squared off from the day after entry';
    if (x.lots != null && (!Number.isInteger(x.lots) || x.lots < 1)) return 'Square off at least one lot';
    closing.set(x.leg, (closing.get(x.leg) ?? 0) + (x.lots ?? s.legs[x.leg].lots));
    if (closing.get(x.leg)! > s.legs[x.leg].lots) return 'A leg cannot be squared off for more lots than it has';
  }
  return null;
}

export async function simulatePosition(s: SimInput, data: OptionsData): Promise<SimResult> {
  const invalid = validateSim(s);
  if (invalid) throw new SimError(invalid);
  const meta0 = await data.meta(s.underlying, s.entryDate);
  if (!meta0) throw new SimError(`No NSE F&O data for ${s.underlying} on ${s.entryDate}`);
  if (!meta0.lotSize) throw new SimError(`NSE's file for ${s.entryDate} does not give a clear lot size`);
  const lotSize = meta0.lotSize;
  const broker = s.broker;
  const lastExpiry = s.legs.reduce((m, l) => (l.expiry > m ? l.expiry : m), s.entryDate);
  const dates = (await data.tradingDates(s.underlying, s.entryDate, lastExpiry)).slice(0, SIM_MAX_DAYS);
  if (dates[0] !== s.entryDate) throw new SimError(`${s.entryDate} is not a trading day in NSE's F&O data`);

  const notes: string[] = [];
  const entryQuotes = await data.quotes(s.underlying, s.entryDate, s.legs.map(asKey));
  // Each leg's own expiry lot when known (they differ while NSE moves to a new lot size).
  const legLots = await Promise.all(s.legs.map((l) => data.lotFor?.(s.underlying, s.entryDate, l.expiry) ?? Promise.resolve(null)));
  const legs = s.legs.map((l, i) => {
    const q = entryQuotes.get(contractId(asKey(l)));
    if (!q) throw new SimError(`${l.kind === 'FUT' ? 'The future' : `${l.strikePaise / 100} ${l.kind}`} ${l.expiry} is not in NSE's file for ${s.entryDate}`);
    return { ...l, qty: l.lots * (legLots[i] ?? lotSize), enteredUntraded: !q.traded };
  });
  if (legs.some((l) => l.enteredUntraded)) notes.push('A leg did not trade on the entry day: its entry price is NSE\'s carried-forward close, not a traded price.');
  const entryChargesPaise = legs.reduce((sum, l) => sum + tradeCharges(l, l.side, l.qty, l.entryPaise, s.entryDate, broker), 0);
  // Square-offs per leg, earliest first; each is applied once, at the close of its day (or the next trading day).
  const pending = legs.map((_, i) => (s.exits ?? []).filter((x) => x.leg === i).sort((a, b) => (a.date < b.date ? -1 : 1)));
  const unit = legs.map((l) => l.qty / l.lots); // units in one lot of this leg
  const openLots = legs.map((l) => l.lots);
  const realized = legs.map(() => 0); // P&L fixed by square-offs and settlement, before charges

  const settled = new Map<number, number>(); // leg index → value per unit once no lot is open (last square-off or settlement)
  const squared = new Set<number>(); // legs whose last lots were squared off by the owner, rather than settled on expiry
  let settlementCharges = 0;
  const last: (number | null)[] = legs.map((l) => l.entryPaise);
  const days: SimDay[] = [];

  for (const date of dates) {
    const meta = date === s.entryDate ? meta0 : await data.meta(s.underlying, date);
    const spot = meta?.spotPaise ?? null;
    const quotes = await data.quotes(s.underlying, date, legs.map(asKey));
    // Forward per expiry still open today, for IV and Greeks.
    const forwards = new Map<string, { F: number; T: number } | null>();
    for (const exp of new Set(legs.filter((l) => l.expiry > date && l.kind !== 'FUT').map((l) => l.expiry))) {
      const T = yearsToExpiry(closeOf(date), exp);
      if (spot == null || T <= 0) { forwards.set(exp, null); continue; }
      const [calls, puts] = await Promise.all([data.chain(s.underlying, date, exp, 'CE'), data.chain(s.underlying, date, exp, 'PE')]);
      const F = parityForward(calls, puts, spot, T);
      forwards.set(exp, F == null ? null : { F, T });
    }

    const day: SimDay = { date, spotPaise: spot, legs: [], grossPaise: 0, chargesIfExitPaise: 0, netIfExitPaise: 0, delta: 0, theta: 0, vega: 0, gamma: 0, greeksMissing: 0, openLegs: 0 };
    let exitCharges = 0;
    legs.forEach((l, i) => {
      const empty = { iv: null, delta: null, theta: null, vega: null, gamma: null };
      if (settled.has(i)) return void day.legs.push({ pricePaise: settled.get(i)!, openLots: 0, source: squared.has(i) ? 'squared' : 'expired', ...empty });
      const q = quotes.get(contractId(asKey(l)));
      const price = q ? (q.traded ? q.closePaise : q.settlePaise) : null;
      if (price != null) last[i] = price;
      // Squared off by the owner: those lots close at today's price (before expiry), one exit order at today's charges.
      if (date < l.expiry) {
        while (pending[i].length && pending[i][0].date <= date) {
          const x = pending[i].shift()!;
          const lots = Math.min(openLots[i], x.lots ?? openLots[i]);
          if (!lots) continue;
          const at = price ?? last[i] ?? l.entryPaise, qty = lots * unit[i];
          realized[i] += sign(l.side) * qty * (at - l.entryPaise);
          settlementCharges += tradeCharges(l, l.side === 'BUY' ? 'SELL' : 'BUY', qty, at, date, broker);
          openLots[i] -= lots;
          if (!openLots[i]) { settled.set(i, at); squared.add(i); }
        }
        if (settled.has(i)) return void day.legs.push({ pricePaise: settled.get(i)!, openLots: 0, source: 'squared', ...empty });
      }
      const openQty = openLots[i] * unit[i];
      if (date >= l.expiry) {
        let v: number;
        if (spot == null) {
          notes.push(`${date}: no official index close on expiry, so ${l.kind === 'FUT' ? 'the future' : `${l.strikePaise / 100} ${l.kind}`} settles at its last price.`);
          v = last[i] ?? l.entryPaise;
        } else {
          v = intrinsic(l, spot);
          if (l.kind !== 'FUT') settlementCharges += expirySettlementCharges({ side: l.side, qty: openQty, intrinsicPaise: v, date, broker });
        }
        realized[i] += sign(l.side) * openQty * (v - l.entryPaise);
        openLots[i] = 0;
        settled.set(i, v);
        return void day.legs.push({ pricePaise: v, openLots: 0, source: 'expired', ...empty });
      }
      day.openLegs++;
      const used = price ?? last[i];
      if (used != null) exitCharges += tradeCharges(l, l.side === 'BUY' ? 'SELL' : 'BUY', openQty, used, date, broker);
      if (l.kind === 'FUT') { // a future moves one for one with its price: delta 1 a unit, no IV
        day.delta += sign(l.side) * openQty;
        return void day.legs.push({ pricePaise: price, openLots: openLots[i], source: q ? (q.traded ? 'close' : 'settle') : 'missing', iv: null, delta: 1, theta: 0, vega: 0, gamma: 0 });
      }
      const fw = forwards.get(l.expiry);
      const kind = l.kind as 'CE' | 'PE';
      const iv = fw && q?.traded ? impliedVol(kind, q.closePaise / 100, fw.F / 100, l.strikePaise / 100, fw.T, SIM_RATE) : null;
      if (iv == null || !fw) {
        day.greeksMissing++;
        return void day.legs.push({ pricePaise: price, openLots: openLots[i], source: q ? (q.traded ? 'close' : 'settle') : 'missing', ...empty });
      }
      const g = black76(kind, fw.F / 100, l.strikePaise / 100, fw.T, SIM_RATE, iv);
      const n = sign(l.side) * openQty;
      day.delta += n * g.delta; day.theta += n * g.theta; day.vega += n * g.vega; day.gamma += n * g.gamma;
      day.legs.push({ pricePaise: price, openLots: openLots[i], source: q!.traded ? 'close' : 'settle', iv, delta: g.delta, theta: g.theta, vega: g.vega, gamma: g.gamma });
    });
    if (day.legs.some((x) => x.source === 'missing')) notes.push(`${date}: a leg is missing from NSE's file; its last known price is used.`);
    // Fixed P&L of closed lots, plus open lots marked at today's (or the last known) price.
    day.grossPaise = legs.reduce((sum, l, i) => sum + realized[i] + sign(l.side) * openLots[i] * unit[i] * ((last[i] ?? l.entryPaise) - l.entryPaise), 0);
    day.chargesIfExitPaise = entryChargesPaise + settlementCharges + exitCharges;
    day.netIfExitPaise = day.grossPaise - day.chargesIfExitPaise;
    days.push(day);
    if (settled.size === legs.length) break;
  }
  return { underlying: s.underlying, entryDate: s.entryDate, lotSize, legs, entryChargesPaise, days, end: settled.size === legs.length ? 'expired' : 'end-of-data', notes: [...new Set(notes)] };
}
