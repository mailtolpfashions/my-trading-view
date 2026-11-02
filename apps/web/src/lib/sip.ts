// SIP arithmetic: step-up instalments, growth at an assumed return, and XIRR of dated cash flows.

/** Monthly amount for month i (0-based), raised by `stepUp` % every 12 months. */
export const amountAt = (monthly: number, stepUp: number, i: number) => monthly * (1 + stepUp / 100) ** Math.floor(i / 12);

/** Annualised return of dated cash flows (invested negative, final value positive); null if it can't be solved. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  const t0 = Date.parse(flows[0].date);
  const yrs = flows.map((f) => (Date.parse(f.date) - t0) / (365 * 86400_000));
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / (1 + r) ** yrs[i], 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Invested and value at the end of each year: instalments at the start of each month, compounding monthly at the rate equal to `annualPct` a year. */
export function assumedGrowth(monthly: number, years: number, annualPct: number, stepUpPct: number): { year: number; invested: number; value: number }[] {
  const r = (1 + annualPct / 100) ** (1 / 12) - 1;
  let value = 0, invested = 0;
  const out: { year: number; invested: number; value: number }[] = [];
  for (let i = 0; i < years * 12; i++) {
    const a = amountAt(monthly, stepUpPct, i);
    invested += a;
    value = (value + a) * (1 + r);
    if ((i + 1) % 12 === 0) out.push({ year: (i + 1) / 12, invested, value });
  }
  return out;
}
