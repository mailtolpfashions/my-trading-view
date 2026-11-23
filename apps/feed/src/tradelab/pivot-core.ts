// The option pivot rule (the user's own, 2026-11-24), as one pure engine used by both the live paper test and the
// backtest on recorded option minutes, so the two cannot disagree.
//   Levels: TradingView "Pivots Standard", Traditional, daily: worked out on the OPTION's own previous-day high, low and
//   close (P, R1–R5, S1–S5; levels at or below 0 dropped).
//   Entry: the premium crosses above a level (from below it on the previous price to at or above it now), inside the
//   entry window. Fill: the ask (live) or the level plus half the recorded spread (minute bars; the open if it gapped).
//   Version "fixed": target +targetPts, stop -stopPts on the premium (user: 15 / 20).
//   Version "ladder": stop at the level below the entry level; the stop climbs to one level below the highest level
//   reached (T1 reached -> stop at the entry level, T2 -> T1, T3 -> T2 ...). No target: out by the stop or the exit time.
//   Everything still open is sold at the exit time. A new entry needs a fresh cross, up to maxTrades a day.
//   On minute bars the order inside a bar is unknown: a bar that touches both the stop and the target counts as the stop,
//   and the bar of the entry is not checked for an exit (its low or high may have come before the entry).
// Money: paise, integers.

export type Level = { name: string; paise: number };
export type PivotCfg = { targetPts: number; stopPts: number; maxTrades: number; entryFrom: number; entryTo: number; exitAt: number };
export type Version = 'fixed' | 'ladder';
export type PivotTrade = {
  version: Version; level: string; entryAt: number; entryPaise: number;
  exitAt: number | null; exitPaise: number | null; why: 'target' | 'stop' | 'trail' | 'time' | null;
  /** Highest level reached (ladder) as a name, e.g. "R2". */
  reached: string | null;
};
export type SimState = { version: Version; lastPaise: number | null; open: (PivotTrade & { stopPaise: number; targetPaise: number | null; entryIdx: number; highIdx: number; bar: number }) | null; trades: PivotTrade[]; bars: number };
/** One price update: a tick (open = high = low = last) or a closed minute bar. Spread = ask - bid when known. */
export type Point = { time: number; minute: number; open: number; high: number; low: number; last: number; bid?: number; ask?: number; tick: boolean };

export const DEFAULT_PIVOT_CFG: PivotCfg = { targetPts: 15, stopPts: 20, maxTrades: 3, entryFrom: 9 * 60 + 30, entryTo: 15 * 60, exitAt: 15 * 60 };

/** TradingView Traditional pivots from one period's high, low and close (paise in, paise out, rounded). */
export function pivotLevels(h: number, l: number, c: number): Level[] {
  const p = (h + l + c) / 3;
  const all: [string, number][] = [
    ['S5', p * 4 - (4 * h - l)], ['S4', p * 3 - (3 * h - l)], ['S3', l - 2 * (h - p)], ['S2', p - (h - l)], ['S1', 2 * p - h], ['P', p],
    ['R1', 2 * p - l], ['R2', p + (h - l)], ['R3', h + 2 * (p - l)], ['R4', p * 3 + (h - 3 * l)], ['R5', p * 4 + (h - 4 * l)],
  ];
  return all.map(([name, v]) => ({ name, paise: Math.round(v) })).filter((x) => x.paise > 0).sort((a, b) => a.paise - b.paise);
}

export const newSim = (version: Version): SimState => ({ version, lastPaise: null, open: null, trades: [], bars: 0 });

const halfSpread = (pt: Point) => (pt.bid != null && pt.ask != null && pt.ask > pt.bid && pt.bid > 0 ? Math.round((pt.ask - pt.bid) / 2) : 0);
const buyAt = (pt: Point, level: number) => (pt.tick ? (pt.ask && pt.ask > 0 ? pt.ask : pt.last) : Math.max(pt.open, level) + halfSpread(pt));
const sellAt = (pt: Point, level: number | null, gapDown: boolean) => (pt.tick ? (pt.bid && pt.bid > 0 ? pt.bid : pt.last) : (level == null ? pt.last : gapDown ? pt.open : level) - halfSpread(pt));

/** Feeds one price update into a simulation. Returns true when something happened (an entry or an exit). */
export function stepSim(s: SimState, levels: Level[], cfg: PivotCfg, pt: Point): boolean {
  s.bars++;
  let changed = false;
  const o = s.open;
  if (o) {
    const close = (paise: number, why: PivotTrade['why']) => {
      s.trades.push({ version: o.version, level: o.level, entryAt: o.entryAt, entryPaise: o.entryPaise, exitAt: pt.time, exitPaise: Math.max(5, paise), why, reached: o.reached });
      s.open = null; changed = true;
    };
    if (pt.minute >= cfg.exitAt) close(sellAt(pt, null, false), 'time');
    else if (pt.tick || o.bar !== s.bars) { // a minute bar of the entry is not checked (see the header)
      if (pt.low <= o.stopPaise) close(sellAt(pt, o.stopPaise, pt.open <= o.stopPaise), o.version === 'ladder' && o.highIdx > o.entryIdx ? 'trail' : 'stop');
      else if (o.targetPaise != null && pt.high >= o.targetPaise) close(pt.tick ? sellAt(pt, null, false) : Math.max(pt.open, o.targetPaise) - halfSpread(pt), 'target');
      else if (o.version === 'ladder') {
        let h = o.highIdx;
        while (h + 1 < levels.length && levels[h + 1].paise <= pt.high) h++;
        if (h > o.highIdx) { o.highIdx = h; o.reached = levels[h].name; o.stopPaise = Math.max(o.stopPaise, levels[h - 1].paise); }
      }
    }
  }
  // Entry: a fresh cross above a level, inside the window, while flat, trades left.
  if (!s.open && s.lastPaise != null && pt.minute >= cfg.entryFrom && pt.minute < cfg.entryTo && s.trades.length < cfg.maxTrades) {
    const prev = s.lastPaise;
    const idx = levels.findIndex((l) => prev < l.paise && pt.high >= l.paise);
    if (idx >= 0) {
      const lv = levels[idx];
      const entry = buyAt(pt, lv.paise);
      const ladderStop = idx > 0 ? levels[idx - 1].paise : entry - cfg.stopPts * 100; // no level below: the fixed stop
      s.open = {
        version: s.version, level: lv.name, entryAt: pt.time, entryPaise: entry, exitAt: null, exitPaise: null, why: null, reached: lv.name,
        stopPaise: s.version === 'fixed' ? entry - cfg.stopPts * 100 : ladderStop,
        targetPaise: s.version === 'fixed' ? entry + cfg.targetPts * 100 : null,
        entryIdx: idx, highIdx: idx, bar: s.bars,
      };
      changed = true;
    }
  }
  s.lastPaise = pt.last;
  return changed;
}

/** Closes an open trade at a given price (end of data, or the app was off at the exit time). */
export function forceClose(s: SimState, time: number, paise: number, why: PivotTrade['why'] = 'time') {
  const o = s.open;
  if (!o) return;
  s.trades.push({ version: o.version, level: o.level, entryAt: o.entryAt, entryPaise: o.entryPaise, exitAt: time, exitPaise: paise, why, reached: o.reached });
  s.open = null;
}
