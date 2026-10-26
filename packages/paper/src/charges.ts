// Brokerage and statutory charges for NSE cash-market (equity) trades, as they appear on a contract note.
// Rates change; every rate lives here with its effective date so it can be checked and updated in one place.
// Statutory rates: SEBI/NSE/Government schedules effective 1 Oct 2024. Brokerage: Zerodha's published equity schedule.
// VERIFY against your broker's current schedule before relying on charge estimates.

import { applyRate, type Paise } from './money';

export type Side = 'BUY' | 'SELL';
/** CNC = delivery, MIS = intraday (squared off the same day). */
export type Product = 'CNC' | 'MIS';

export const CHARGE_RATES = {
  effectiveFrom: '2024-10-01',
  brokerage: { CNC: 0, MIS: { rate: 0.0003, capPaise: 20_00 } }, // intraday: 0.03% or ₹20 per executed order, whichever is lower
  stt: { CNC: { BUY: 0.001, SELL: 0.001 }, MIS: { BUY: 0, SELL: 0.00025 } }, // 0.1% both sides delivery; 0.025% sell intraday
  exchangeTxn: 0.0000297, // NSE equity: 0.00297% of turnover
  sebiFee: 0.000001, // ₹10 per crore
  stampDuty: { CNC: 0.00015, MIS: 0.00003 }, // buy side only: 0.015% delivery, 0.003% intraday
  gst: 0.18, // on brokerage + exchange transaction charges + SEBI fee
  dpChargePaise: 15_34, // depository charge per scrip per day on delivery sells (incl. GST)
} as const;

export type Charges = {
  brokerage: Paise;
  stt: Paise;
  exchangeTxn: Paise;
  sebiFee: Paise;
  stampDuty: Paise;
  gst: Paise;
  dpCharge: Paise;
  total: Paise;
};

/** Index options (NSE). Same effective date and source caveats as CHARGE_RATES. */
export const OPTION_CHARGE_RATES = {
  effectiveFrom: '2024-10-01',
  brokeragePerOrderPaise: 20_00, // flat ₹20 per executed order
  sttSell: 0.001, // 0.1% of premium, sell side
  sttExercise: 0.00125, // 0.125% of intrinsic value on options exercised at expiry (paid by the buyer)
  exchangeTxn: 0.0003503, // NSE options: 0.03503% of premium
  sebiFee: 0.000001,
  stampDutyBuy: 0.00003, // 0.003% of premium, buy side
  gst: 0.18,
} as const;

/** Charges for one executed option order. Premium turnover = qty × premium. */
export function computeOptionCharges(o: { side: Side; qty: number; premiumPaise: Paise }): Charges {
  const r = OPTION_CHARGE_RATES;
  const turnover = o.qty * o.premiumPaise;
  const brokerage = turnover > 0 ? r.brokeragePerOrderPaise : 0;
  const stt = o.side === 'SELL' ? applyRate(turnover, r.sttSell) : 0;
  const exchangeTxn = applyRate(turnover, r.exchangeTxn);
  const sebiFee = applyRate(turnover, r.sebiFee);
  const stampDuty = o.side === 'BUY' ? applyRate(turnover, r.stampDutyBuy) : 0;
  const gst = applyRate(brokerage + exchangeTxn + sebiFee, r.gst);
  return { brokerage, stt, exchangeTxn, sebiFee, stampDuty, gst, dpCharge: 0, total: brokerage + stt + exchangeTxn + sebiFee + stampDuty + gst };
}

/** STT when a long in-the-money option is exercised at expiry: 0.125% of qty × intrinsic value. */
export const exerciseStt = (qty: number, intrinsicPaise: Paise) => (intrinsicPaise > 0 ? applyRate(qty * intrinsicPaise, OPTION_CHARGE_RATES.sttExercise) : 0);

/**
 * Charges for one executed order. `firstDeliverySellToday` adds the DP charge, which brokers levy once per scrip
 * per day when shares leave your demat account. Each component is rounded to the paisa.
 * (Contract notes may round STT to the nearest rupee per scrip; estimates here keep paise.)
 */
export function computeCharges(o: { side: Side; product: Product; qty: number; pricePaise: Paise; firstDeliverySellToday?: boolean }): Charges {
  const turnover = o.qty * o.pricePaise;
  const r = CHARGE_RATES;
  const brokerage = o.product === 'CNC' ? 0 : Math.min(applyRate(turnover, r.brokerage.MIS.rate), r.brokerage.MIS.capPaise);
  const stt = applyRate(turnover, r.stt[o.product][o.side]);
  const exchangeTxn = applyRate(turnover, r.exchangeTxn);
  const sebiFee = applyRate(turnover, r.sebiFee);
  const stampDuty = o.side === 'BUY' ? applyRate(turnover, r.stampDuty[o.product]) : 0;
  const gst = applyRate(brokerage + exchangeTxn + sebiFee, r.gst);
  const dpCharge = o.product === 'CNC' && o.side === 'SELL' && o.firstDeliverySellToday ? r.dpChargePaise : 0;
  return { brokerage, stt, exchangeTxn, sebiFee, stampDuty, gst, dpCharge, total: brokerage + stt + exchangeTxn + sebiFee + stampDuty + gst + dpCharge };
}
