// Option pricing models. These are MODEL outputs derived from real premiums (implied volatility) and are labelled as
// estimates in the UI; backtests never use model prices as fills.

export type Right = 'CE' | 'PE';

/** Standard normal CDF via erfc. Relative error below 1.2e-7: ample for model estimates (premiums to the paisa). */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}
export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

function erfc(x: number): number {
  // Numerical Recipes erfcc (Chebyshev fit): fractional error < 1.2e-7 everywhere.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Black-Scholes price with continuous rate r (no dividends). T in years, sigma annualised. */
export function bsPrice(right: Right, S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, right === 'CE' ? S - K : K - S);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / sq, d2 = d1 - sq;
  return right === 'CE' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/** Black-76 on the futures/forward price F, discounted at r. Standard for index options. */
export function black76(right: Right, F: number, K: number, T: number, r: number, sigma: number) {
  const df = Math.exp(-r * T);
  if (T <= 0 || sigma <= 0) {
    const intrinsic = Math.max(0, right === 'CE' ? F - K : K - F);
    return { price: df * intrinsic, delta: right === 'CE' ? (F > K ? df : 0) : (F < K ? -df : 0), gamma: 0, vega: 0, theta: 0 };
  }
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / sq, d2 = d1 - sq;
  const price = right === 'CE' ? df * (F * normCdf(d1) - K * normCdf(d2)) : df * (K * normCdf(-d2) - F * normCdf(-d1));
  const delta = right === 'CE' ? df * normCdf(d1) : -df * normCdf(-d1);
  const gamma = (df * normPdf(d1)) / (F * sq);
  const vega = (df * F * normPdf(d1) * Math.sqrt(T)) / 100; // per 1 vol point
  const theta = (-(df * F * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * price) / 365; // per calendar day
  return { price, delta, gamma, vega, theta };
}

/**
 * Implied volatility from a market premium by bisection on Black-76 (robust: price is monotonic in sigma).
 * Returns null when the premium is outside the no-arbitrage range (e.g. below intrinsic), instead of a fake number.
 */
export function impliedVol(right: Right, premium: number, F: number, K: number, T: number, r: number): number | null {
  if (!(premium > 0 && F > 0 && K > 0 && T > 0)) return null;
  const df = Math.exp(-r * T);
  const intrinsic = df * Math.max(0, right === 'CE' ? F - K : K - F);
  const upper = right === 'CE' ? df * F : df * K;
  if (premium < intrinsic - 1e-9 || premium >= upper) return null;
  let lo = 1e-4, hi = 5;
  if (black76(right, F, K, T, r, hi).price < premium) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (black76(right, F, K, T, r, mid).price > premium) hi = mid; else lo = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

/** Years to expiry, with expiry at 15:30 IST on the expiry date (calendar-day convention). */
export function yearsToExpiry(nowSec: number, expiryDate: string): number {
  const expirySec = Date.parse(`${expiryDate}T15:30:00Z`) / 1000 - 5.5 * 3600;
  return Math.max(0, (expirySec - nowSec) / (365 * 86400));
}
