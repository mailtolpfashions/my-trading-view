// All money is integer paise. Rupee floats only exist at the edges (input parsing and display),
// so sums never pick up binary floating-point error (0.1 + 0.2 !== 0.3).

export type Paise = number;

/** Parses a rupee amount with at most two decimals into paise. Throws on anything else (no silent rounding of input). */
export function toPaise(rupees: number | string): Paise {
  const s = typeof rupees === 'number' ? rupees.toFixed(10) : rupees.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: ${rupees}`);
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > 2) throw new Error(`Amount has more than two decimals: ${rupees}`);
  const p = Number(m[2]) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(p)) throw new Error(`Amount too large: ${rupees}`);
  return m[1] ? -p : p;
}

export const fromPaise = (p: Paise) => p / 100;

/** value × rate, rounded half-up to the nearest paisa. Rates are fractions (0.001 = 0.1%). */
export function applyRate(value: Paise, rate: number): Paise {
  // Rates are held as integer nano-units and multiplied in BigInt: exact for any order size,
  // with no representation error from rates like 0.00297%.
  const nano = BigInt(Math.round(rate * 1e9));
  const v = BigInt(Math.abs(value));
  const rounded = (v * nano * 2n + 1_000_000_000n) / 2_000_000_000n; // half-up
  return Math.sign(value) * Number(rounded);
}

export const formatRupees = (p: Paise) =>
  (p < 0 ? '−₹' : '₹') + (Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
