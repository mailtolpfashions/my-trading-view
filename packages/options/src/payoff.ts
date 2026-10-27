// Expiry payoff of a multi-leg position. Exact: every leg pays a piecewise-linear amount in the underlying price,
// so the total is piecewise linear with kinks only at strikes. Breakevens are solved exactly on each segment, and
// max profit / loss are found at the kinks or reported as unlimited from the slope beyond the last strike.
// Amounts are in paise; quantities are lots × lot size.

export type Leg = {
  kind: 'CE' | 'PE' | 'FUT';
  side: 'BUY' | 'SELL';
  /** Strike in paise (ignored for futures). */
  strikePaise: number;
  /** Entry price in paise: the premium for options, the traded price for futures. */
  pricePaise: number;
  /** Units = lots × lot size. */
  qty: number;
};

/** Expiry P&L of one leg at underlying price S (paise). */
export function legPayoff(l: Leg, S: number): number {
  const sign = l.side === 'BUY' ? 1 : -1;
  const value = l.kind === 'CE' ? Math.max(0, S - l.strikePaise) : l.kind === 'PE' ? Math.max(0, l.strikePaise - S) : S;
  return sign * l.qty * (value - l.pricePaise);
}

export const payoff = (legs: Leg[], S: number) => legs.reduce((sum, l) => sum + legPayoff(l, S), 0);

/** Slope (paise of P&L per paisa of underlying) as S → ∞. */
const upperSlope = (legs: Leg[]) => legs.reduce((s, l) => s + (l.kind === 'PE' ? 0 : (l.side === 'BUY' ? 1 : -1) * l.qty), 0);

export type PayoffSummary = {
  /** null = unlimited */
  maxProfitPaise: number | null;
  /** null = unlimited (a negative number otherwise) */
  maxLossPaise: number | null;
  /** Underlying prices (paise, may be fractional) where expiry P&L crosses zero. */
  breakevens: number[];
  /** Net premium: positive = you receive (credit), negative = you pay (debit). Options only. */
  netPremiumPaise: number;
};

export function summarise(legs: Leg[]): PayoffSummary {
  if (!legs.length) return { maxProfitPaise: 0, maxLossPaise: 0, breakevens: [], netPremiumPaise: 0 };
  const kinks = [...new Set(legs.filter((l) => l.kind !== 'FUT').map((l) => l.strikePaise))].sort((a, b) => a - b);
  // Evaluation points: 0, every strike, and one point past the last kink (or past the futures price).
  const top = Math.max(...kinks, ...legs.map((l) => l.pricePaise)) * 2 + 100;
  const points = [0, ...kinks, top];
  const values = points.map((S) => payoff(legs, S));
  const slope = upperSlope(legs);

  let maxProfit: number | null = Math.max(...values);
  let maxLoss: number | null = Math.min(...values);
  if (slope > 0) maxProfit = null;
  if (slope < 0) maxLoss = null;

  const breakevens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, x1, y0, y1] = [points[i], points[i + 1], values[i], values[i + 1]];
    if (y0 === 0 && (i === 0 || values[i - 1] !== 0)) breakevens.push(x0);
    if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) breakevens.push(x0 + (-y0 * (x1 - x0)) / (y1 - y0));
  }
  // Beyond the last point the line continues with `slope`.
  const yTop = values[values.length - 1];
  if (slope !== 0 && Math.sign(yTop) === Math.sign(slope) * -1) breakevens.push(top - yTop / slope);

  const netPremium = legs.filter((l) => l.kind !== 'FUT').reduce((s, l) => s + (l.side === 'SELL' ? 1 : -1) * l.qty * l.pricePaise, 0);
  return { maxProfitPaise: maxProfit, maxLossPaise: maxLoss == null ? null : Math.min(0, maxLoss), breakevens: breakevens.sort((a, b) => a - b), netPremiumPaise: netPremium };
}

/** Charges that keep growing past a strike although the gross P&L is flat there. */
export type ChargeGrowth = { strikePaise: number; chargeSlope: number };

export type NetSummary = {
  /** null = unlimited */
  maxProfitPaise: number | null;
  /** null = unlimited (a negative number otherwise) */
  maxLossPaise: number | null;
  breakevens: number[];
  /**
   * Set for a side where the gross P&L is flat beyond the outermost strike but settlement charges keep growing (exercise
   * STT on a long in-the-money option is a % of intrinsic value, so it grows without limit above a long call and down
   * to zero below a long put). Max profit/loss and breakevens then cover the range between the strikes, and the growth
   * is reported here: `chargeSlope` paise of extra charges per paisa the underlying moves past `strikePaise`.
   */
  chargesGrow?: { below?: ChargeGrowth; above?: ChargeGrowth };
};

/**
 * Expiry P&L after charges, held to expiry: gross payoff − entry charges − settlement charges, where `settle(leg, S)`
 * gives a leg's charges when it settles at underlying price S (for example exercise STT on a long in-the-money option).
 * Settlement charges are linear in S once a leg is in the money and may jump when it crosses its strike, so the net
 * curve is piecewise linear between the evaluation points {0, K, K + 1 paisa for every strike, a point past the last}.
 */
export function summariseNet(legs: Leg[], entryChargesPaise: number, settle: (l: Leg, S: number) => number): NetSummary {
  if (!legs.length) return { maxProfitPaise: 0, maxLossPaise: 0, breakevens: [] };
  const net = (S: number) => payoff(legs, S) - entryChargesPaise - legs.reduce((s, l) => s + settle(l, S), 0);
  const strikes = [...new Set(legs.filter((l) => l.kind !== 'FUT').map((l) => l.strikePaise))].sort((a, b) => a - b);
  const top = Math.max(...strikes, ...legs.map((l) => l.pricePaise)) * 2 + 100;
  const points = [...new Set([0, ...strikes.flatMap((k) => [k, k + 1]), top])].sort((a, b) => a - b);
  const values = points.map(net);
  const FAR = 1_000_000;
  const slope = (net(top + FAR) - values[values.length - 1]) / FAR; // net slope beyond the last point
  const kLo = strikes[0], kHi = strikes[strikes.length - 1];

  // A side whose gross P&L is flat but whose charges move is limited to the strikes, with the growth reported.
  const chargesGrow: NonNullable<NetSummary['chargesGrow']> = {};
  let lo = 0, hi = points.length - 1;
  if (strikes.length && kLo > 0) {
    const grossBelow = payoff(legs, kLo) - payoff(legs, 0), netBelow = net(kLo) - net(0);
    if (grossBelow === 0 && netBelow !== 0) { chargesGrow.below = { strikePaise: kLo, chargeSlope: netBelow / kLo }; lo = points.indexOf(kLo); }
  }
  if (strikes.length && payoff(legs, top + FAR) === payoff(legs, top) && slope !== 0) {
    chargesGrow.above = { strikePaise: kHi, chargeSlope: -slope };
    hi = points.indexOf(kHi + 1);
  }
  const inRange = values.slice(lo, hi + 1);
  let maxProfit: number | null = Math.max(...inRange);
  let maxLoss: number | null = Math.min(...inRange);
  if (!chargesGrow.above) {
    if (slope > 0) maxProfit = null;
    if (slope < 0) maxLoss = null;
  }

  const breakevens: number[] = [];
  for (let i = lo; i < hi; i++) {
    const [x0, x1, y0, y1] = [points[i], points[i + 1], values[i], values[i + 1]];
    if (y0 === 0 && (i === lo || values[i - 1] !== 0)) breakevens.push(x0);
    // A crossing inside a 1-paisa jump segment (K → K + 1) is a step, not a slope: report it at K + 1.
    if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) breakevens.push(x1 - x0 === 1 ? x1 : x0 + (-y0 * (x1 - x0)) / (y1 - y0));
  }
  const yTop = values[values.length - 1];
  if (!chargesGrow.above && slope !== 0 && Math.sign(yTop) === -Math.sign(slope)) breakevens.push(top - yTop / slope);
  return {
    maxProfitPaise: maxProfit, maxLossPaise: maxLoss == null ? null : Math.min(0, maxLoss), breakevens: breakevens.sort((a, b) => a - b),
    ...((chargesGrow.below || chargesGrow.above) && { chargesGrow }),
  };
}
