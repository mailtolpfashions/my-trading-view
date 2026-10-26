import type { Timeframe } from '@mtv/shared';

const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian digit grouping with two decimals: 24,872.35 / 1,23,456.00 */
export const fmt = (n: number) => nf.format(n);

export const signed = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

export const tfLabel = (tf: Timeframe) => (tf === 'D' ? '1D' : tf === 'W' ? '1W' : tf === '60' ? '1h' : `${tf}m`);
