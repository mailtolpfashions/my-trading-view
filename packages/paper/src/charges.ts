// Brokerage and statutory charges for NSE trades (equity, futures, options), as they appear on a contract note.
//
// Statutory charges (STT, exchange transaction charges, IPFT, SEBI fee, stamp duty, GST) are dated schedules, picked
// by trade date, so a backtest of 2025 pays 2025's STT and a trade today pays today's. Brokerage is per broker
// (profiles below); paper trading and the defaults use Zerodha's.
//
// Sources, checked 27 Oct 2026:
// - STT from 1 Apr 2026: Finance Act 2026; NSE circular FATAX73524 (futures 0.05%, option sale 0.15% of premium,
//   exercised options 0.15% of intrinsic value). https://nsearchives.nseindia.com/content/circulars/FATAX73524.pdf
// - Exchange transaction charges and IPFT from 1 Mar 2026: NSE circular NSE/FA/73061 (IPFT back to ₹0.01/crore,
//   transaction charges raised by the same amount). Rates as published on https://zerodha.com/charges.
// - 1 Oct 2024 to 28 Feb 2026: SEBI "true to label" flat exchange charges; IPFT ₹10/crore.
// - Brokerage: each broker's own pricing page (URL in its profile).

import { applyRate, type Paise } from './money';

export type Side = 'BUY' | 'SELL';
/** CNC = delivery, MIS = intraday (squared off the same day). */
export type Product = 'CNC' | 'MIS';
export type Segment = 'EQ_DELIVERY' | 'EQ_INTRADAY' | 'FUT' | 'OPT';

type Statutory = {
  effectiveFrom: string;
  /** STT by segment and side. Options: on premium; exercise: on intrinsic value, paid by the buyer. */
  stt: Record<Segment, Record<Side, number>> & { exercise: number };
  exchangeTxn: { EQ: number; FUT: number; OPT: number };
  /** NSE Investor Protection Fund Trust charge, on turnover (premium for options); GST applies. */
  ipft: number;
  sebiFee: number;
  /** Buy side only. */
  stampDuty: Record<Segment, number>;
  gst: number;
};

const STT_2024 = {
  EQ_DELIVERY: { BUY: 0.001, SELL: 0.001 },
  EQ_INTRADAY: { BUY: 0, SELL: 0.00025 },
  FUT: { BUY: 0, SELL: 0.0002 },
  OPT: { BUY: 0, SELL: 0.001 },
  exercise: 0.00125,
};
const STAMP = { EQ_DELIVERY: 0.00015, EQ_INTRADAY: 0.00003, FUT: 0.00002, OPT: 0.00003 };

/** Statutory schedules, oldest first. */
export const STATUTORY_SCHEDULES: readonly Statutory[] = [
  { effectiveFrom: '2024-10-01', stt: STT_2024, exchangeTxn: { EQ: 0.0000297, FUT: 0.0000173, OPT: 0.0003503 }, ipft: 0.000001, sebiFee: 0.000001, stampDuty: STAMP, gst: 0.18 },
  { effectiveFrom: '2026-03-01', stt: STT_2024, exchangeTxn: { EQ: 0.0000307, FUT: 0.0000183, OPT: 0.0003553 }, ipft: 0.000000001, sebiFee: 0.000001, stampDuty: STAMP, gst: 0.18 },
  {
    effectiveFrom: '2026-04-01',
    stt: { ...STT_2024, FUT: { BUY: 0, SELL: 0.0005 }, OPT: { BUY: 0, SELL: 0.0015 }, exercise: 0.0015 },
    exchangeTxn: { EQ: 0.0000307, FUT: 0.0000183, OPT: 0.0003553 }, ipft: 0.000000001, sebiFee: 0.000001, stampDuty: STAMP, gst: 0.18,
  },
];

/** Today's date in India (YYYY-MM-DD). */
export const istToday = (nowMs = Date.now()) => new Date(nowMs + 5.5 * 3600_000).toISOString().slice(0, 10);

/** The statutory schedule in force on a trade date (YYYY-MM-DD, India). Dates before the first schedule use the first. */
export function statutoryOn(date: string = istToday()): Statutory {
  let s = STATUTORY_SCHEDULES[0];
  for (const x of STATUTORY_SCHEDULES) if (x.effectiveFrom <= date) s = x;
  return s;
}

/** Brokerage for one executed order: `flat`, or the lower of `flat` and `rate` × turnover, never below `min`. */
type Brokerage = { flatPaise: number; rate?: number; minPaise?: number };
export type BrokerProfile = {
  id: string;
  name: string;
  brokerage: Record<Segment, Brokerage>;
  /** Depository charge per scrip per day on delivery sells, GST included. */
  dpChargePaise: number;
  /** The broker also charges brokerage when an option is exercised or assigned at expiry. */
  exerciseBrokerage: boolean;
  source: string;
};

const flat20: Brokerage = { flatPaise: 20_00 };
const capped = (rate: number): Brokerage => ({ flatPaise: 20_00, rate });
const withGst = (p: number) => Math.round(p * 1.18);

export const BROKERS: readonly BrokerProfile[] = [
  { id: 'zerodha', name: 'Zerodha', brokerage: { EQ_DELIVERY: { flatPaise: 0 }, EQ_INTRADAY: capped(0.0003), FUT: capped(0.0003), OPT: flat20 }, dpChargePaise: 15_34, exerciseBrokerage: false, source: 'https://zerodha.com/charges' },
  { id: 'upstox', name: 'Upstox', brokerage: { EQ_DELIVERY: flat20, EQ_INTRADAY: capped(0.001), FUT: capped(0.0005), OPT: flat20 }, dpChargePaise: withGst(20_00), exerciseBrokerage: false, source: 'https://upstox.com/brokerage-charges/' },
  { id: 'fyers', name: 'FYERS', brokerage: { EQ_DELIVERY: capped(0.003), EQ_INTRADAY: capped(0.0003), FUT: capped(0.0003), OPT: flat20 }, dpChargePaise: 0, exerciseBrokerage: false, source: 'https://fyers.in/pricing/' },
  { id: 'angelone', name: 'Angel One', brokerage: { EQ_DELIVERY: { flatPaise: 20_00, rate: 0.001, minPaise: 5_00 }, EQ_INTRADAY: capped(0.001), FUT: flat20, OPT: flat20 }, dpChargePaise: withGst(20_00), exerciseBrokerage: true, source: 'https://www.angelone.in/exchange-transaction-charges' },
  { id: 'dhan', name: 'Dhan', brokerage: { EQ_DELIVERY: { flatPaise: 0 }, EQ_INTRADAY: capped(0.0003), FUT: flat20, OPT: flat20 }, dpChargePaise: withGst(12_50), exerciseBrokerage: true, source: 'https://dhan.co/pricing/' },
];
export const DEFAULT_BROKER = BROKERS[0];
export const brokerById = (id: string | undefined) => BROKERS.find((b) => b.id === id) ?? DEFAULT_BROKER;

export type Charges = {
  brokerage: Paise;
  stt: Paise;
  exchangeTxn: Paise;
  /** Absent on trades stored before IPFT was itemised. */
  ipft?: Paise;
  sebiFee: Paise;
  stampDuty: Paise;
  gst: Paise;
  dpCharge: Paise;
  total: Paise;
};

function brokerageFor(b: Brokerage, turnover: Paise): Paise {
  if (turnover <= 0) return 0;
  let p = b.rate == null ? b.flatPaise : Math.min(applyRate(turnover, b.rate), b.flatPaise);
  if (b.minPaise != null) p = Math.max(p, b.minPaise);
  return p;
}

/**
 * Charges for one executed order. Turnover = qty × price (the premium, for options). Each component is rounded to the
 * paisa. `firstDeliverySellToday` adds the DP charge, which brokers levy once per scrip per day on delivery sells.
 * (Contract notes may round STT to the nearest rupee per scrip; estimates here keep paise.)
 */
export function computeTradeCharges(o: { segment: Segment; side: Side; qty: number; pricePaise: Paise; date?: string; broker?: BrokerProfile; firstDeliverySellToday?: boolean }): Charges {
  const r = statutoryOn(o.date);
  const broker = o.broker ?? DEFAULT_BROKER;
  const turnover = o.qty * o.pricePaise;
  const brokerage = brokerageFor(broker.brokerage[o.segment], turnover);
  const stt = applyRate(turnover, r.stt[o.segment][o.side]);
  const exchangeTxn = applyRate(turnover, r.exchangeTxn[o.segment === 'FUT' ? 'FUT' : o.segment === 'OPT' ? 'OPT' : 'EQ']);
  const ipft = applyRate(turnover, r.ipft);
  const sebiFee = applyRate(turnover, r.sebiFee);
  const stampDuty = o.side === 'BUY' ? applyRate(turnover, r.stampDuty[o.segment]) : 0;
  const gst = applyRate(brokerage + exchangeTxn + ipft + sebiFee, r.gst);
  const dpCharge = o.segment === 'EQ_DELIVERY' && o.side === 'SELL' && o.firstDeliverySellToday ? broker.dpChargePaise : 0;
  return { brokerage, stt, exchangeTxn, ipft, sebiFee, stampDuty, gst, dpCharge, total: brokerage + stt + exchangeTxn + ipft + sebiFee + stampDuty + gst + dpCharge };
}

/** Equity order (delivery or intraday). */
export const computeCharges = (o: { side: Side; product: Product; qty: number; pricePaise: Paise; firstDeliverySellToday?: boolean; date?: string; broker?: BrokerProfile }) =>
  computeTradeCharges({ ...o, segment: o.product === 'CNC' ? 'EQ_DELIVERY' : 'EQ_INTRADAY' });

/** Option order. Turnover = qty × premium. */
export const computeOptionCharges = (o: { side: Side; qty: number; premiumPaise: Paise; date?: string; broker?: BrokerProfile }) =>
  computeTradeCharges({ segment: 'OPT', side: o.side, qty: o.qty, pricePaise: o.premiumPaise, date: o.date, broker: o.broker });

/** Futures order. Turnover = qty × price. */
export const computeFuturesCharges = (o: { side: Side; qty: number; pricePaise: Paise; date?: string; broker?: BrokerProfile }) =>
  computeTradeCharges({ segment: 'FUT', ...o });

/** STT when a long in-the-money option is exercised at expiry: the exercise rate × qty × intrinsic value. */
export const exerciseStt = (qty: number, intrinsicPaise: Paise, date?: string) =>
  (intrinsicPaise > 0 ? applyRate(qty * intrinsicPaise, statutoryOn(date).stt.exercise) : 0);

/**
 * Everything charged when an option is settled at expiry: exercise STT on a long in-the-money option, plus brokerage
 * (with GST) at brokers that charge it on exercise and assignment. Out-of-the-money options expire with no charges.
 */
export function expirySettlementCharges(o: { side: Side; qty: number; intrinsicPaise: Paise; date?: string; broker?: BrokerProfile }): Paise {
  if (o.intrinsicPaise <= 0) return 0;
  const broker = o.broker ?? DEFAULT_BROKER;
  const stt = o.side === 'BUY' ? exerciseStt(o.qty, o.intrinsicPaise, o.date) : 0;
  const brokerage = broker.exerciseBrokerage ? broker.brokerage.OPT.flatPaise : 0;
  return stt + brokerage + applyRate(brokerage, statutoryOn(o.date).gst);
}
