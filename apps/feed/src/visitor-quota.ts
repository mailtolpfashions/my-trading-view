// The site is free. Visitors without an account get a few "runs" a day (backtests, studies, scans); signing in
// (Google, free) removes the limit. Counted in memory per visitor id (a long-lived cookie) and, more loosely, per IP
// so clearing cookies doesn't reset it. A restart forgets the counts, which only ever errs in the visitor's favour.

/** Routes that each count as one run. Everything else (charts, chains, margin) is unlimited. */
export const COUNTED_ROUTES = new Set(['/api/backtest', '/api/options-backtest', '/api/research/study', '/api/scan', '/api/options-sim']);

const IST = 5.5 * 3600_000;
/** The trading-day key in India, so the allowance resets at midnight IST. */
export const istDay = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10);

export class VisitorQuota {
  private day = '';
  private byVisitor = new Map<string, number>();
  private byIp = new Map<string, number>();

  /**
   * @param perVisitor runs a day for one visitor id
   * @param perIp runs a day from one IP address (looser: offices and mobile networks share addresses)
   */
  constructor(readonly perVisitor: number, readonly perIp: number) {}

  private roll(now: number) {
    const d = istDay(now);
    if (d !== this.day) { this.day = d; this.byVisitor.clear(); this.byIp.clear(); }
  }

  /** Runs left today for this visitor (the smaller of the two allowances). */
  remaining(visitor: string, ip: string, now = Date.now()): number {
    this.roll(now);
    return Math.max(0, Math.min(this.perVisitor - (this.byVisitor.get(visitor) ?? 0), this.perIp - (this.byIp.get(ip) ?? 0)));
  }

  /** Counts one run and returns what is left, or null (nothing counted) when the allowance is used up. */
  take(visitor: string, ip: string, now = Date.now()): number | null {
    const left = this.remaining(visitor, ip, now);
    if (left <= 0) return null;
    this.byVisitor.set(visitor, (this.byVisitor.get(visitor) ?? 0) + 1);
    this.byIp.set(ip, (this.byIp.get(ip) ?? 0) + 1);
    return left - 1;
  }
}
