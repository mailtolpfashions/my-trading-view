// Types for the intraday option-selling engine (the user's "NIFTY 50 Intraday Option-Selling Engine v14").
// Everything here is plain data so the same engine runs live, in a replay of a recorded day, and in the studies.

/** One completed minute bar. `time` = epoch seconds (UTC) of the minute's start. */
export type Minute = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** One option contract on the chain, as known at the snapshot time. Null = not known (never guessed). */
export type ChainRow = {
  strike: number; right: 'CE' | 'PE';
  ltp: number | null; bid: number | null; ask: number | null;
  /** Open interest now, at the session's first recorded minute, and today's high / low so far */
  oi: number | null; oiOpen: number | null; oiDayHigh: number | null; oiDayLow: number | null;
  /** Contracts traded today so far */
  volume: number | null;
};

export type Snapshot = {
  /** Epoch seconds of the analysis moment (minutes before it count as completed) */
  now: number;
  /** False when live data is not available: the engine then stops (spec step 0) */
  live: boolean;
  /** 'live' or 'replay of YYYY-MM-DD' — shown, never changes the logic */
  source: string;
  nifty: Minute[];
  /** Previous session's last-minute close (15:29) and NSE's official close of that session */
  refClose: number | null;
  officialPrevClose: number | null;
  /** ATR(14), Wilder, from daily bars before today; note says how it was seeded */
  atr: number | null;
  atrNote: string;
  vix: number | null;
  vixNote: string;
  /** Closes of the last completed 15-minute candles of earlier sessions, oldest first (for RSI(14) on 15m) */
  prev15Closes: number[];
  bank: { minutes: Minute[]; refClose: number | null } | null;
  heavy: { symbol: string; minutes: Minute[]; refClose: number | null }[];
  chain: { expiry: string; lotSize: number | null; rows: ChainRow[] } | null;
  /** Inputs the spec asks for that this app cannot supply (always reported as UNKNOWN) */
  unknown: string[];
};

export type CheckId = 'refClose' | 'vwap' | 'structure' | 'rsi' | 'opening' | 'heavyGreen' | 'heavyVwap' | 'oiShift' | 'bank' | 'drift';
export type Side = 1 | -1 | 0;

/** Measured evidence the engine weighs its checks and odds with (built by apps/feed/scripts/research/seller-v14-evidence.ts). */
export type Evidence = {
  built: string; sessions: number; from: string; to: string;
  /** Decision times (IST minutes of the day) the tables are measured at */
  times: number[];
  /** Hit rate of each check to 15:30, per decision time ('HH:MM'); missing = not measured */
  checks: Partial<Record<CheckId, Record<string, { hit: number | null; n: number }>>>;
  /** E4: share of sessions NIFTY stayed within ±0.25×ATR of the spot at that time until 15:30 */
  e4: Record<string, { stay: number; n: number }>;
  /** Share of sessions price went beyond the day's high (or low) so far by k×ATR before 15:30, per time, per k */
  breach: Record<string, { n: number; high: Record<string, number>; low: Record<string, number> }>;
  /** Base rates for display: label → k of n, dates */
  baseRates: { label: string; k: number; n: number; dates: string }[];
  notes: string[];
};

export type Grade = 'strong' | 'mixed' | 'weak' | 'unknown';
export type Label = 'VALIDATED' | 'JUDGMENT' | 'UNKNOWN' | 'MEASURED';

export type CheckResult = { id: CheckId; label: string; side: Side | null; weight: number; weightBasis: string; detail: string };

export type Candidate = {
  strike: number; right: 'CE' | 'PE';
  premium: number | null; bid: number | null; ask: number | null; spreadPct: number | null;
  oi: number | null; oiRatio: number | null; volume: number | null; volRatio: number | null; oiChangePct: number | null;
  distSpot: number; beyond: number; beyondAtr: number | null;
  breakeven: number | null; beRoom: number | null;
  breachOdds: number | null;
  gamma: 'OK' | 'WARNING';
  pass: boolean; fails: string[]; flags: string[];
};

export type Wall = { strike: number; oi: number; strength: number; tests: number; broken: boolean; unwindPct: number | null; status: 'STRONG' | 'REFERENCE ONLY' };

export type SideView = {
  right: 'CE' | 'PE';
  candidates: Candidate[];
  chosen: Candidate | null;
  /** The strike the comparison is graded on: the chosen one, else the nearest one beyond the day's extreme */
  graded: Candidate | null;
  grades: Record<string, { grade: Grade; note: string }>;
  verdict: 'STRONGER SELLER STRUCTURE' | 'WEAKER SELLER STRUCTURE' | 'COMPARABLE' | 'INVALID' | 'UNKNOWN';
  scanned: number;
};

export type View = {
  header: { time: string; minutesLeft: number; phase: string; candles: number; gate: 'DIRECTION ISSUED' | 'DIRECTION NOT ISSUED'; line: string };
  stop: string | null;
  source: string;
  direction: 'UP' | 'DOWN' | 'NOT CLEAR' | 'TWO-SIDED' | 'NOT ISSUED';
  strength: 'Strong' | 'Moderate' | null;
  sellerView: 'CALL SIDE STRONGER' | 'PUT SIDE STRONGER' | 'BOTH COMPARABLE' | 'NONE';
  mode: 'DIRECTIONAL' | 'NON-DIRECTIONAL' | 'TWO-SIDED' | 'NONE';
  why: string[];
  notice: string | null;
  setup: null | {
    side: 'CALL SELL' | 'PUT SELL'; strike: number; expiry: string; premium: number; lotSize: number | null; lotValue: number | null;
    breakeven: number; distSpot: number; distExtreme: number; oi: number | null; volume: number | null; spreadPct: number | null;
    breachOdds: number | null; invalidation: { level: number; text: string }; premiumAtInvalidation: number | null;
    gamma: 'OK' | 'WARNING'; flags: string[];
  };
  comparison: { factor: string; call: { grade: Grade; note: string }; put: { grade: Grade; note: string } }[];
  sides: { call: SideView | null; put: SideView | null };
  twoSided: { offered: boolean; failed: string[] };
  triggers: string[];
  expiresAt: string;
  audit: {
    spot: number | null; refClose: number | null; officialPrevClose: number | null; reference: string;
    atr: number | null; atrNote: string; vix: number | null; vixNote: string; vixMovePts: number | null;
    dayHigh: number | null; dayLow: number | null; dayRangeAtr: number | null; openingRange: { high: number; low: number } | null;
    opening: string; gap: { pts: number; atr: number | null; behaviour: string } | null;
    checks: CheckResult[]; redundancy: string | null; conflicts: string[]; pressure: number | null; pressureNote: string;
    confidence: number | null; capacity: { score: number | null; note: string };
    walls: { call: Wall | null; put: Wall | null }; pcr: number | null; flows: string[];
    e4: { value: number | null; n: number; boundary: [number, number] | null; note: string };
    window: string; unknown: string[]; labels: { item: string; label: Label }[]; evidence: string;
  };
  log: string;
};
