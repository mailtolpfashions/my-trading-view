// The intraday option-selling engine (user's spec v14): live snapshot + measured evidence → one view.
// Hierarchy (spec step 23): live data → reference check → candle gate → directional pressure → direction valid?
// → directional selling, or non-directional seller analysis (CALL vs PUT) → ATM-first strike → filters → invalidation.
// Pure: no I/O. Every threshold the spec leaves open is fixed in THRESHOLDS and labelled JUDGMENT in the audit.
import { CHECK_LABELS, GROUPS, OPEN, CLOSE, PRICE_CHECKS, candles15, completed, evidenceTime, hhmm, istMinute, openingRange, phaseOf, scoreChecks } from './checks';
import type { Candidate, CheckResult, ChainRow, Evidence, Grade, Label, SideView, Snapshot, View, Wall } from './types';

export const THRESHOLDS = {
  disputeAtr: 0.15, // spec 1A
  wallTestAtr: 0.10, // spec 6: "came within 0.10 × ATR"
  wallRejectAtr: 0.25, // JUDGMENT: a test counts once price then moves this far back away
  wallStrength: 2.0, wallUnwind: 0.2, // spec 6
  gammaAtr: 0.25, // spec 9C
  spreadMax: 0.02, // spec 11
  nonDir: { oi: 1.5, vol: 0.4 }, dir: { oi: 1.0, vol: 0.25 }, // spec 11
  breachStrong: 0.15, breachMax: 0.30, // JUDGMENT: measured odds of price passing the strike's distance beyond the extreme
  pressureMin: 0.3, pressureStrong: 0.5, confidenceMin: 50, earlyCap: 0.55, earlyConfidenceCap: 55, // spec 4 / 8
  conflictPenalty: 15, // JUDGMENT
  e4TwoSided: 0.6, // spec 8C
  expiryMinutes: 45, // spec 17
  oiShiftPct: 0.02, // JUDGMENT (in checks.ts)
};

const fmt = (v: number, d = 0) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Interpolated measured odds of price going `k`×ATR beyond the day's high (or low) from this time to 15:30. */
export function breachOdds(ev: Evidence, time: string | null, side: 'high' | 'low', k: number): number | null {
  const row = time ? ev.breach[time] : undefined;
  if (!row) return null;
  const grid = Object.keys(row[side]).map(Number).sort((a, b) => a - b);
  if (!grid.length || k < 0) return null;
  if (k >= grid.at(-1)!) return row[side][String(grid.at(-1)!)];
  for (let i = 1; i < grid.length; i++) if (k <= grid[i]) {
    const a = grid[i - 1], b = grid[i], pa = row[side][String(a)], pb = row[side][String(b)];
    return pa + ((pb - pa) * (k - a)) / (b - a);
  }
  return row[side][String(grid[0])];
}

/** A call (or put) wall: the biggest OI at or beyond the spot on that side, with tests, breaks and unwind. */
function wallOf(rows: ChainRow[], right: 'CE' | 'PE', spot: number, atr: number, bars: { high: number; low: number; close: number }[]): Wall | null {
  const side = rows.filter((r) => r.right === right && r.oi != null && (right === 'CE' ? r.strike >= spot : r.strike <= spot));
  const all = rows.filter((r) => r.right === right && r.oi != null);
  if (!side.length || !all.length) return null;
  const top = side.reduce((a, b) => (b.oi! > a.oi! ? b : a));
  const mean = all.reduce((a, r) => a + r.oi!, 0) / all.length;
  // Tests: price comes within 0.10×ATR of the wall, then moves back 0.25×ATR away without closing through it.
  let tests = 0, near = false, broken = false;
  for (const b of bars) {
    const reach = right === 'CE' ? b.high >= top.strike - THRESHOLDS.wallTestAtr * atr : b.low <= top.strike + THRESHOLDS.wallTestAtr * atr;
    const through = right === 'CE' ? b.close > top.strike + THRESHOLDS.wallTestAtr * atr : b.close < top.strike - THRESHOLDS.wallTestAtr * atr;
    const away = right === 'CE' ? b.close <= top.strike - THRESHOLDS.wallRejectAtr * atr : b.close >= top.strike + THRESHOLDS.wallRejectAtr * atr;
    if (through) { broken = true; near = false; continue; }
    if (reach) near = true;
    else if (near && away) { tests++; near = false; }
  }
  const unwindPct = top.oiDayHigh ? (top.oiDayHigh - top.oi!) / top.oiDayHigh : null;
  const strength = mean ? top.oi! / mean : 0;
  const strong = strength >= THRESHOLDS.wallStrength && tests >= 1 && !broken && unwindPct != null && unwindPct < THRESHOLDS.wallUnwind;
  return { strike: top.strike, oi: top.oi!, strength, tests, broken, unwindPct, status: strong ? 'STRONG' : 'REFERENCE ONLY' };
}

/** Every strike of one side, ATM-first (nearest to spot first), with its metrics and mandatory-filter result. */
function sideView(rows: ChainRow[], right: 'CE' | 'PE', ctx: { spot: number; atr: number; dayHigh: number; dayLow: number; time: string | null; ev: Evidence; candles: number; directional: boolean; window: number }): SideView {
  const scan = rows.filter((r) => r.right === right && Math.abs(r.strike - ctx.spot) <= ctx.window);
  const meanOi = avg(scan.map((r) => r.oi)), meanVol = avg(scan.map((r) => r.volume));
  const lim = ctx.directional ? THRESHOLDS.dir : THRESHOLDS.nonDir;
  const order = [...scan].sort((a, b) => Math.abs(a.strike - ctx.spot) - Math.abs(b.strike - ctx.spot) || liquidity(b) - liquidity(a));
  const candidates: Candidate[] = order.map((r) => {
    const mid = r.bid && r.ask ? (r.bid + r.ask) / 2 : null;
    const premium = r.ltp ?? mid;
    const spreadPct = r.bid && r.ask && mid ? (r.ask - r.bid) / mid : null;
    const distSpot = right === 'CE' ? r.strike - ctx.spot : ctx.spot - r.strike;
    const beyond = right === 'CE' ? r.strike - ctx.dayHigh : ctx.dayLow - r.strike;
    const beyondAtr = ctx.atr ? beyond / ctx.atr : null;
    const breakeven = premium == null ? null : right === 'CE' ? r.strike + premium : r.strike - premium;
    const beRoom = breakeven == null ? null : right === 'CE' ? breakeven - ctx.dayHigh : ctx.dayLow - breakeven;
    const odds = beyondAtr != null && beyondAtr >= 0 ? breachOdds(ctx.ev, ctx.time, right === 'CE' ? 'high' : 'low', beyondAtr) : null;
    const oiRatio = r.oi != null && meanOi ? r.oi / meanOi : null, volRatio = r.volume != null && meanVol ? r.volume / meanVol : null;
    const fails: string[] = [], flags: string[] = [];
    if (premium == null) fails.push('premium UNKNOWN');
    if (spreadPct == null) fails.push('bid/ask UNKNOWN'); else if (spreadPct > THRESHOLDS.spreadMax) fails.push(`spread ${(spreadPct * 100).toFixed(1)}% > 2%`);
    if (oiRatio == null) fails.push('OI UNKNOWN'); else if (oiRatio < lim.oi) fails.push(`OI ${oiRatio.toFixed(2)}× mean < ${lim.oi}×`);
    if (volRatio == null) fails.push('volume UNKNOWN'); else if (volRatio < lim.vol) fails.push(`volume ${pct(volRatio)} of mean < ${pct(lim.vol)}`);
    if (beyond <= 0) fails.push(`not beyond the day's ${right === 'CE' ? 'high' : 'low'}`);
    else if (odds == null) fails.push('breach odds UNKNOWN at this time');
    else if (odds > THRESHOLDS.breachMax) fails.push(`price went this far past the day's ${right === 'CE' ? 'high' : 'low'} on ${pct(odds)} of past sessions (> ${pct(THRESHOLDS.breachMax)})`);
    else if (odds > THRESHOLDS.breachStrong) flags.push(ctx.candles < 4 ? 'DAY-EXTREME FILTER WEAK — EARLY SESSION' : 'DAY-EXTREME FILTER WEAK');
    const gamma = ctx.atr && Math.abs(r.strike - ctx.spot) < THRESHOLDS.gammaAtr * ctx.atr ? 'WARNING' : 'OK';
    if (gamma === 'WARNING') flags.push('GAMMA WARNING');
    if (ctx.candles < 4 && beyondAtr != null && Math.abs(beyondAtr) < THRESHOLDS.wallTestAtr) flags.push('EARLY-SESSION ATM RISK');
    const oiChangePct = r.oi != null && r.oiOpen ? (r.oi - r.oiOpen) / r.oiOpen : null;
    return { strike: r.strike, right, premium, bid: r.bid, ask: r.ask, spreadPct, oi: r.oi, oiRatio, volume: r.volume, volRatio, oiChangePct, distSpot, beyond, beyondAtr, breakeven, beRoom, breachOdds: odds, gamma, pass: !fails.length, fails, flags };
  });
  const chosen = candidates.find((c) => c.pass) ?? null;
  const graded = chosen ?? candidates.find((c) => c.beyond > 0) ?? candidates[0] ?? null;
  return { right, candidates, chosen, graded, grades: {}, verdict: chosen ? 'COMPARABLE' : 'INVALID', scanned: scan.length };
}
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const liquidity = (r: ChainRow) => (r.oi ?? 0) + (r.volume ?? 0) * 10;

/** Grades of one side's graded strike (spec 7A/7B factors that can be measured; no numeric score is shown). */
function gradeSide(v: SideView, wall: Wall | null, other: SideView | null, atr: number): void {
  const c = v.graded;
  const g = (grade: Grade, note: string) => ({ grade, note });
  if (!c) { v.grades = {}; return; }
  const extreme = v.right === 'CE' ? 'high' : 'low';
  v.grades = {
    'Distance safety': c.breachOdds == null ? g('unknown', c.beyond <= 0 ? `inside the day's ${extreme}` : 'odds not measured at this time') : g(c.breachOdds <= THRESHOLDS.breachStrong ? 'strong' : c.breachOdds <= THRESHOLDS.breachMax ? 'mixed' : 'weak', `past sessions went this far past the ${extreme}: ${pct(c.breachOdds)}`),
    'Beyond day extreme': g(c.beyond <= 0 ? 'weak' : c.beyondAtr != null && c.beyondAtr >= 0.25 ? 'strong' : 'mixed', `${fmt(c.beyond)} pts (${c.beyondAtr == null ? '–' : c.beyondAtr.toFixed(2)} ATR) beyond the day's ${extreme}`),
    'OI support': c.oiRatio == null ? g('unknown', 'OI UNKNOWN') : g(c.oiRatio >= 1.5 ? 'strong' : c.oiRatio >= 1 ? 'mixed' : 'weak', `${c.oiRatio.toFixed(2)}× the scanned mean`),
    'OI change': c.oiChangePct == null ? g('unknown', 'no opening OI') : g(c.oiChangePct > 0.05 ? 'strong' : c.oiChangePct >= -0.05 ? 'mixed' : 'weak', `${c.oiChangePct >= 0 ? '+' : ''}${(c.oiChangePct * 100).toFixed(0)}% since the open`),
    'Wall strength': wall ? g(wall.status === 'STRONG' ? 'strong' : wall.strength >= THRESHOLDS.wallStrength ? 'mixed' : 'weak', `${v.right === 'CE' ? 'call' : 'put'} wall ${fmt(wall.strike)}: ${wall.strength.toFixed(1)}× mean, ${wall.status.toLowerCase()}`) : g('unknown', 'no wall found'),
    'Wall test': wall ? g(wall.broken ? 'weak' : wall.tests >= 1 ? 'strong' : 'mixed', wall.broken ? 'broken today' : `${wall.tests} test${wall.tests === 1 ? '' : 's'} held`) : g('unknown', 'no wall'),
    'Unwind risk': wall?.unwindPct == null ? g('unknown', 'OI day high unknown') : g(wall.unwindPct < 0.2 ? 'strong' : wall.unwindPct < 0.4 ? 'mixed' : 'weak', `${pct(wall.unwindPct)} off today's OI high`),
    Volume: c.volRatio == null ? g('unknown', 'volume UNKNOWN') : g(c.volRatio >= 0.4 ? 'strong' : c.volRatio >= 0.25 ? 'mixed' : 'weak', `${pct(c.volRatio)} of the scanned mean`),
    Spread: c.spreadPct == null ? g('unknown', 'bid/ask UNKNOWN') : g(c.spreadPct <= 0.01 ? 'strong' : c.spreadPct <= THRESHOLDS.spreadMax ? 'mixed' : 'weak', `${(c.spreadPct * 100).toFixed(1)}%`),
    Premium: c.premium == null ? g('unknown', 'premium UNKNOWN') : premiumGrade(c, other?.graded ?? null, atr),
    'Breakeven room': c.beRoom == null ? g('unknown', 'premium UNKNOWN') : g(c.beRoom >= 0.5 * atr ? 'strong' : c.beRoom >= 0.25 * atr ? 'mixed' : 'weak', `${fmt(c.beRoom)} pts past the day's ${extreme}`),
    Gamma: g(c.gamma === 'OK' ? 'strong' : 'weak', c.gamma === 'OK' ? `${fmt(Math.abs(c.distSpot))} pts from spot` : `within 0.25 ATR of spot`),
  };
}
/** Premium efficiency (premium per ATR of distance from spot), graded against the other side's graded strike. */
function premiumGrade(c: Candidate, o: Candidate | null, atr: number): { grade: Grade; note: string } {
  const eff = (x: Candidate) => (x.premium ?? 0) / Math.max(0.05, Math.abs(x.distSpot) / atr);
  const note = `₹${fmt(c.premium!, 2)}, ₹${fmt(eff(c), 1)} per ATR of distance`;
  if (!o || o.premium == null) return { grade: 'mixed', note };
  const a = eff(c), b = eff(o);
  return { grade: a > b * 1.1 ? 'strong' : a < b / 1.1 ? 'weak' : 'mixed', note };
}

const COMPARE = ['Distance safety', 'Beyond day extreme', 'OI support', 'OI change', 'Wall strength', 'Wall test', 'Unwind risk', 'Volume', 'Spread', 'Premium', 'Breakeven room', 'Gamma'];
/** JUDGMENT: a side is stronger when its (strong − weak) count beats the other's by 2 or more and its strike passes. */
function compareSides(call: SideView, put: SideView) {
  const net = (v: SideView) => Object.values(v.grades).reduce((a, x) => a + (x.grade === 'strong' ? 1 : x.grade === 'weak' ? -1 : 0), 0);
  const unknownKey = (v: SideView) => ['Spread', 'OI support', 'Volume'].some((k) => v.grades[k]?.grade === 'unknown');
  for (const v of [call, put]) if (!v.chosen) v.verdict = unknownKey(v) ? 'UNKNOWN' : 'INVALID';
  if (call.chosen && put.chosen) {
    const d = net(call) - net(put);
    call.verdict = d >= 2 ? 'STRONGER SELLER STRUCTURE' : d <= -2 ? 'WEAKER SELLER STRUCTURE' : 'COMPARABLE';
    put.verdict = d <= -2 ? 'STRONGER SELLER STRUCTURE' : d >= 2 ? 'WEAKER SELLER STRUCTURE' : 'COMPARABLE';
  } else if (call.chosen) call.verdict = 'STRONGER SELLER STRUCTURE';
  else if (put.chosen) put.verdict = 'STRONGER SELLER STRUCTURE';
}

/** Premium of a strike at the same moneyness after spot moves to `level` (equal-moneyness interpolation from the live chain). */
function premiumAt(rows: ChainRow[], right: 'CE' | 'PE', strike: number, spot: number, level: number): number | null {
  const target = spot + (strike - level); // strike with the same distance from today's spot
  const pts = rows.filter((r) => r.right === right && r.ltp != null).sort((a, b) => a.strike - b.strike);
  for (let i = 1; i < pts.length; i++) if (pts[i - 1].strike <= target && target <= pts[i].strike) {
    const a = pts[i - 1], b = pts[i], f = (target - a.strike) / (b.strike - a.strike);
    return a.ltp! + (b.ltp! - a.ltp!) * f;
  }
  return null;
}

export function analyze(s: Snapshot, ev: Evidence): View {
  const nowMin = istMinute(s.now), time = evidenceTime(ev, nowMin);
  const bars = completed(s.nifty, s.now);
  const spot = bars.at(-1)?.close ?? null;
  const c15 = candles15(bars, nowMin);
  const candles = c15.length, minutesLeft = Math.max(0, CLOSE - nowMin), phase = phaseOf(nowMin);
  const gateOpen = candles >= 4;
  const header = { time: hhmm(nowMin), minutesLeft, phase, candles, gate: (gateOpen ? 'DIRECTION ISSUED' : 'DIRECTION NOT ISSUED') as View['header']['gate'], line: '' };
  const labels: { item: string; label: Label }[] = [];
  const unknown = [...s.unknown];
  const base: View = {
    header, stop: null, source: s.source, direction: 'NOT ISSUED', strength: null, sellerView: 'NONE', mode: 'NONE', why: [], notice: null, setup: null,
    comparison: [], sides: { call: null, put: null }, twoSided: { offered: false, failed: [] }, triggers: [], expiresAt: hhmm(Math.min(CLOSE, nowMin + THRESHOLDS.expiryMinutes)),
    audit: { spot, refClose: s.refClose, officialPrevClose: s.officialPrevClose, reference: '', atr: s.atr, atrNote: s.atrNote, vix: s.vix, vixNote: s.vixNote, vixMovePts: null, dayHigh: null, dayLow: null, dayRangeAtr: null, openingRange: null, opening: 'Pending', gap: null, checks: [], redundancy: null, conflicts: [], pressure: null, pressureNote: '', confidence: null, capacity: { score: null, note: '' }, walls: { call: null, put: null }, pcr: null, flows: [], e4: { value: null, n: 0, boundary: null, note: '' }, window: windowFocus(nowMin), unknown, labels, evidence: `${ev.sessions} sessions ${ev.from} → ${ev.to}` },
    log: '',
  };
  const finish = (v: View) => { v.header.gate = v.direction === 'NOT ISSUED' ? 'DIRECTION NOT ISSUED' : 'DIRECTION ISSUED'; v.header.line = `${v.header.time} · ${minutesLeft} min left · ${phase} · ${candles} completed 15-min candles → GATE: ${v.header.gate}`; v.log = logLine(s, v); return v; };

  // Step 0 — live data
  if (!s.live || spot == null) { base.stop = 'STOP — LIVE DATA NOT AVAILABLE — NO TRADE'; base.why = ['Live NIFTY data is not available, so nothing can be analysed.']; return finish(base); }
  if (nowMin < OPEN || nowMin >= CLOSE) { base.stop = 'Market closed — no analysis'; base.why = ['The market is closed.']; return finish(base); }

  // Steps 1A–3 — reference, ATR, range, opening
  const atr = s.atr;
  if (atr == null) unknown.push('ATR');
  const dayHigh = Math.max(...bars.map((b) => b.high)), dayLow = Math.min(...bars.map((b) => b.low));
  Object.assign(base.audit, { dayHigh, dayLow, dayRangeAtr: atr ? (dayHigh - dayLow) / atr : null, openingRange: openingRange(bars, nowMin) });
  const disputed = s.refClose != null && s.officialPrevClose != null && atr != null && Math.abs(s.refClose - s.officialPrevClose) > THRESHOLDS.disputeAtr * atr;
  base.audit.reference = s.refClose == null ? 'UNKNOWN' : disputed ? `DISPUTED: last traded ${fmt(s.refClose, 2)} vs official close ${fmt(s.officialPrevClose!, 2)}` : 'OK';
  const open = bars[0].open;
  if (s.refClose != null) {
    const gap = open - s.refClose, filled = gap > 0 ? dayLow <= s.refClose : gap < 0 ? dayHigh >= s.refClose : true;
    base.audit.gap = { pts: gap, atr: atr ? Math.abs(gap) / atr : null, behaviour: candles < 1 ? 'Pending' : filled ? 'Fill' : 'Hold' };
  }
  const orb = base.audit.openingRange;
  base.audit.opening = !orb || candles < 2 ? 'Pending' : spot > orb.high ? 'Acceptance above the opening range' : spot < orb.low ? 'Acceptance below the opening range' : (dayHigh > orb.high || dayLow < orb.low) ? 'Rejection (broke out, back inside)' : 'Inside the opening range';
  if (s.vix != null) base.audit.vixMovePts = spot * (s.vix / 100) * Math.sqrt(1 / 252);
  labels.push({ item: 'Opening classification (acceptance / rejection / inside)', label: 'JUDGMENT' });

  // Step 4 — directional pressure (only scored once the gate opens; seller analysis runs regardless)
  let checks = scoreChecks(s, ev);
  base.audit.checks = checks;
  let pressure: number | null = null, confidence: number | null = null;
  if (gateOpen) {
    const pr = (list: CheckResult[]) => {
      let use = list.filter((c) => c.side != null);
      if (candles < 6) { // 4A redundancy collapse
        const price = use.filter((c) => PRICE_CHECKS.includes(c.id));
        if (price.length > 1) {
          const w = Math.max(...price.map((c) => c.weight)), sum = price.reduce((a, c) => a + c.side! * c.weight, 0);
          base.audit.redundancy = `REDUNDANCY COLLAPSE — ${price.length} checks represent one underlying price observation.`;
          use = [...use.filter((c) => !PRICE_CHECKS.includes(c.id)), { ...price[0], id: 'refClose', label: 'Price (collapsed)', side: (sum > 0 ? 1 : sum < 0 ? -1 : 0), weight: w }];
        }
      }
      const den = use.reduce((a, c) => a + c.weight, 0), num = use.reduce((a, c) => a + c.side! * c.weight, 0);
      // Spec rule 6: an unmeasured check (±0.5, hit rate UNKNOWN) may add to a reading, never form one on its own.
      const measured = use.filter((c) => c.weight > 0 && !/UNKNOWN/.test(c.weightBasis));
      if (!den || !measured.length) return null;
      const cap = candles < 8 ? THRESHOLDS.earlyCap : 1;
      return Math.max(-cap, Math.min(cap, num / den));
    };
    pressure = pr(checks);
    if (disputed && pressure != null) {
      const alt = checks.map((c) => (c.id === 'refClose' ? { ...c, side: (Math.sign(spot - s.officialPrevClose!) as 1 | -1 | 0) } : c));
      const p2 = pr(alt);
      if (p2 == null || Math.sign(p2) !== Math.sign(pressure) || (Math.abs(p2) >= THRESHOLDS.pressureMin) !== (Math.abs(pressure) >= THRESHOLDS.pressureMin)) { base.audit.reference += ' → not robust'; pressure = null; base.audit.pressureNote = 'Reference disputed and the two runs disagree: direction not issued.'; }
      else base.audit.reference += ' → ROBUST';
    }
    // 4B conflicts
    const groupSide = (ids: string[]) => { const v = checks.filter((c) => ids.includes(c.id) && c.side != null && c.weight > 0).reduce((a, c) => a + c.side! * c.weight, 0); return Math.sign(v); };
    const gs = Object.entries(GROUPS).map(([k, ids]) => [k, groupSide(ids)] as const);
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) if (gs[i][1] && gs[j][1] && gs[i][1] !== gs[j][1]) base.audit.conflicts.push(`CONFLICT: ${gs[i][0]} vs ${gs[j][0]}`);
    if (pressure != null) confidence = Math.max(0, Math.min(candles < 8 ? THRESHOLDS.earlyConfidenceCap : 100, Math.round(Math.abs(pressure) * 100) - THRESHOLDS.conflictPenalty * base.audit.conflicts.length));
    if (!base.audit.pressureNote) base.audit.pressureNote = pressure == null ? 'No check has a measured edge at this time (every measured weight is 0; unmeasured checks cannot form a reading alone), so the Pressure Ratio cannot be formed.' : `Pressure Ratio ${pressure.toFixed(2)}${candles < 8 ? ' (capped at ±0.55 before 8 candles)' : ''}`;
    labels.push({ item: 'Pressure thresholds, confidence formula (|PR|×100 − 15 per conflict)', label: 'JUDGMENT' });
  } else base.audit.pressureNote = `Fewer than 4 completed 15-minute candles (${candles}): direction is not issued.`;
  base.audit.pressure = pressure; base.audit.confidence = confidence;

  // Step 5 — capacity (direction-agnostic), from the measured extension odds
  const ext = time && ev.breach[time] ? Math.max(ev.breach[time].high['0.25'] ?? 0, ev.breach[time].low['0.25'] ?? 0) : null;
  base.audit.capacity = ext == null ? { score: null, note: 'extension odds not measured at this time → UNKNOWN' } : { score: ext >= 0.25 ? 1 : ext <= 0.12 ? -1 : 0, note: `from ${time}, price went ≥0.25 ATR past the day's high or low (one side) on up to ${pct(ext)} of ${ev.breach[time!].n} sessions` };
  labels.push({ item: 'Capacity cut-offs (≥25% → +1, ≤12% → −1)', label: 'JUDGMENT' });

  // Step 15 — E4
  const e4 = time ? ev.e4[time] : undefined;
  base.audit.e4 = e4 && atr ? { value: e4.stay, n: e4.n, boundary: [spot - 0.25 * atr, spot + 0.25 * atr], note: `P(NIFTY stays within ${fmt(spot - 0.25 * atr)}–${fmt(spot + 0.25 * atr)} until 15:30) ≈ ${pct(e4.stay)} — share of ${e4.n} past sessions that did so from ${time} (not conditioned on today's setup)` } : { value: null, n: 0, boundary: null, note: 'E4 not measured before 09:30 or ATR unknown → UNKNOWN' };

  // Step 6 — chain
  const rows = s.chain?.rows ?? [];
  if (!rows.length) unknown.push('option chain');
  const callWall = rows.length && atr ? wallOf(rows.filter((r) => Math.abs(r.strike - spot) <= 500), 'CE', spot, atr, bars) : null;
  const putWall = rows.length && atr ? wallOf(rows.filter((r) => Math.abs(r.strike - spot) <= 500), 'PE', spot, atr, bars) : null;
  base.audit.walls = { call: callWall, put: putWall };
  const scan = rows.filter((r) => Math.abs(r.strike - spot) <= 250);
  const sum = (right: 'CE' | 'PE', f: (r: ChainRow) => number | null) => scan.filter((r) => r.right === right).reduce((a, r) => a + (f(r) ?? 0), 0);
  base.audit.pcr = sum('CE', (r) => r.oi) ? sum('PE', (r) => r.oi) / sum('CE', (r) => r.oi) : null;
  if (scan.some((r) => r.oiOpen != null)) {
    const dCe = sum('CE', (r) => (r.oi != null && r.oiOpen != null ? r.oi - r.oiOpen : null)), dPe = sum('PE', (r) => (r.oi != null && r.oiOpen != null ? r.oi - r.oiOpen : null));
    base.audit.flows = [`Calls: ${dCe >= 0 ? 'writing' : 'unwinding'} (${dCe >= 0 ? '+' : ''}${fmt(dCe)} OI since the open)`, `Puts: ${dPe >= 0 ? 'writing' : 'unwinding'} (${dPe >= 0 ? '+' : ''}${fmt(dPe)} OI since the open)`, `Volume: calls ${fmt(sum('CE', (r) => r.volume))}, puts ${fmt(sum('PE', (r) => r.volume))}`];
    labels.push({ item: 'OI rise read as writing, fall as unwinding', label: 'JUDGMENT' });
  }

  // Step 8 — mode
  const strengthOf = (p: number) => (Math.abs(p) >= THRESHOLDS.pressureStrong ? 'Strong' : 'Moderate') as 'Strong' | 'Moderate';
  const dirValid = gateOpen && pressure != null && Math.abs(pressure) >= THRESHOLDS.pressureMin && (confidence ?? 0) >= THRESHOLDS.confidenceMin && !base.audit.conflicts.length;
  if (gateOpen) base.direction = dirValid ? (pressure! > 0 ? 'UP' : 'DOWN') : 'NOT CLEAR';
  if (dirValid) base.strength = strengthOf(pressure!);

  // Chain coverage: both rights must have every listed step within spot ±250, or the comparison would be one-sided.
  const coverage = chainCoverage(rows, spot);
  if (rows.length && coverage) unknown.push(coverage);

  // Steps 7, 9–11 — both sides, ATM-first; expand ±250 → ±500 when nothing qualifies within ±250
  if (rows.length && atr && coverage) {
    base.sellerView = 'NONE'; base.mode = 'NONE';
    base.why.push(`SIDE: NONE / INSUFFICIENT DATA — ${coverage}.`);
  } else if (rows.length && atr) {
    const ctx = { spot, atr, dayHigh, dayLow, time, ev, candles, directional: dirValid };
    const build = (right: 'CE' | 'PE') => { const v = sideView(rows, right, { ...ctx, window: 250 }); return v.chosen ? v : sideView(rows, right, { ...ctx, window: 500 }); };
    const call = build('CE'), put = build('PE');
    gradeSide(call, callWall, put, atr); gradeSide(put, putWall, call, atr);
    compareSides(call, put);
    base.sides = { call, put };
    base.comparison = COMPARE.map((f) => ({ factor: f, call: call.grades[f] ?? { grade: 'unknown', note: '' }, put: put.grades[f] ?? { grade: 'unknown', note: '' } }));
    labels.push({ item: 'Seller comparison (strong − weak count, ≥2 apart = stronger)', label: 'JUDGMENT' }, { item: `Distance floor (measured breach odds ≤${pct(THRESHOLDS.breachStrong)} strong, >${pct(THRESHOLDS.breachMax)} reject)`, label: 'JUDGMENT' }, { item: 'Breach odds beyond the day\'s high / low', label: 'MEASURED' }, { item: 'OI / volume / spread thresholds (spec step 11)', label: 'JUDGMENT' });

    // Two-sided gate (8C)
    const tsFail: string[] = [];
    if (!(base.audit.e4.value != null && base.audit.e4.value >= THRESHOLDS.e4TwoSided)) tsFail.push(`E4 ${base.audit.e4.value == null ? 'UNKNOWN' : pct(base.audit.e4.value)} < 60%`);
    if (!(base.audit.capacity.score != null && base.audit.capacity.score <= -1)) tsFail.push('capacity not ≤ −1');
    if (callWall?.status !== 'STRONG' || putWall?.status !== 'STRONG') tsFail.push('both walls not STRONG');
    if (unknown.some((u) => /event/i.test(u))) tsFail.push('intraday events UNKNOWN (no event calendar)');
    if (candles < 8) tsFail.push('fewer than 8 completed candles');
    if (!call.chosen || !put.chosen) tsFail.push('a side has no eligible strike');
    if (call.chosen?.gamma === 'WARNING' || put.chosen?.gamma === 'WARNING') tsFail.push('gamma warning');
    base.twoSided = { offered: !tsFail.length, failed: tsFail };

    let pick: SideView | null = null;
    if (dirValid) {
      // Seller side for a directional view: UP → sell PUTS, DOWN → sell CALLS (the spec's text maps it the other way; see the plan)
      pick = pressure! > 0 ? put : call;
      base.mode = pick.chosen ? 'DIRECTIONAL' : 'NONE';
      base.sellerView = pick.chosen ? (pick.right === 'CE' ? 'CALL SIDE STRONGER' : 'PUT SIDE STRONGER') : 'NONE';
    } else if (base.twoSided.offered) {
      base.mode = 'TWO-SIDED'; base.direction = 'TWO-SIDED'; base.sellerView = 'BOTH COMPARABLE';
    } else {
      const strong = [call, put].find((v) => v.verdict === 'STRONGER SELLER STRUCTURE');
      if (strong?.chosen) { pick = strong; base.mode = 'NON-DIRECTIONAL'; base.sellerView = strong.right === 'CE' ? 'CALL SIDE STRONGER' : 'PUT SIDE STRONGER'; }
      else if (call.verdict === 'COMPARABLE' && put.verdict === 'COMPARABLE') { base.mode = 'NONE'; base.sellerView = 'BOTH COMPARABLE'; }
      else { base.mode = 'NONE'; base.sellerView = 'NONE'; }
    }

    if (pick?.chosen) {
      const c = pick.chosen, isCall = c.right === 'CE', extreme = isCall ? dayHigh : dayLow;
      // Invalidation (JUDGMENT): a 15-minute close past halfway from the day's extreme to the strike
      const level = Math.round(extreme + (c.strike - extreme) / 2);
      const lot = s.chain?.lotSize ?? null;
      base.setup = {
        side: isCall ? 'CALL SELL' : 'PUT SELL', strike: c.strike, expiry: s.chain!.expiry, premium: c.premium!, lotSize: lot, lotValue: lot ? c.premium! * lot : null,
        breakeven: c.breakeven!, distSpot: c.distSpot, distExtreme: c.beyond, oi: c.oi, volume: c.volume, spreadPct: c.spreadPct, breachOdds: c.breachOdds,
        invalidation: { level, text: `15-minute close ${isCall ? 'above' : 'below'} ${fmt(level)} → ${isCall ? 'CALL' : 'PUT'} SELL invalidated` },
        premiumAtInvalidation: premiumAt(rows, c.right, c.strike, spot, level), gamma: c.gamma,
        flags: [...c.flags, ...(s.chain!.expiry <= dateOf(s.now) ? ['EXPIRY DAY'] : [])],
      };
      labels.push({ item: 'Invalidation level (halfway from the day\'s extreme to the strike)', label: 'JUDGMENT' });
    }
  } else {
    base.why.push(!rows.length ? 'No live option chain: the seller side cannot be analysed.' : 'ATR unknown: distances cannot be judged.');
    base.sellerView = 'NONE'; base.mode = 'NONE';
  }

  // Plain-language why, notice, triggers
  base.why = [...directionWhy(base, candles, checks, ev), ...sellerWhy(base, ev, time), ...base.why];
  if (base.mode === 'NON-DIRECTIONAL') base.notice = 'This is a non-directional seller-side selection. It does not mean the market is expected to move in the opposite direction.';
  base.triggers = triggers(base, callWall, putWall, atr);
  if (s.vix == null) unknown.push('India VIX');
  checks = base.audit.checks;
  return finish(base);
}

const dateOf = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

/** Null when calls and puts both have every strike step within spot ±250; otherwise what is missing. */
export function chainCoverage(rows: ChainRow[], spot: number): string | null {
  if (!rows.length) return null;
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  const step = Math.min(...strikes.slice(1).map((s, i) => s - strikes[i]).filter((d) => d > 0));
  if (!Number.isFinite(step)) return 'option chain has a single strike';
  const need: number[] = [];
  for (let k = Math.ceil((spot - 250) / step) * step; k <= spot + 250; k += step) need.push(k);
  const missing = (right: 'CE' | 'PE') => need.filter((k) => !rows.some((r) => r.right === right && r.strike === k && r.oi != null && (r.ltp != null || (r.bid != null && r.ask != null))));
  const mc = missing('CE'), mp = missing('PE');
  if (!mc.length && !mp.length) return null;
  const lo = Math.min(...strikes), hi = Math.max(...strikes);
  return `option chain incomplete: recorded strikes ${fmt(lo)}–${fmt(hi)} do not cover spot ${fmt(spot)} ±250 (missing ${mc.length} call and ${mp.length} put strikes)`;
}

function directionWhy(v: View, candles: number, checks: CheckResult[], ev: Evidence): string[] {
  if (v.direction === 'NOT ISSUED') return [`Direction is not issued yet: only ${candles} of the 4 needed 15-minute candles are complete.`];
  if (v.direction === 'NOT CLEAR') {
    const live = checks.filter((c) => c.weight > 0 && !/UNKNOWN/.test(c.weightBasis));
    if (!live.length) return [`Direction is not clear: none of the ten checks has beaten a coin flip at this time of day over ${ev.sessions} past sessions, so none carries weight.`];
    return [`Direction is not clear: ${v.audit.conflicts.length ? v.audit.conflicts.join(', ') : `the Pressure Ratio (${v.audit.pressure?.toFixed(2) ?? '–'}) or confidence is too low`}.`];
  }
  if (v.direction === 'TWO-SIDED') return ['Both sides pass the strict two-sided gate.'];
  return [`Direction ${v.direction} (${v.strength}): Pressure Ratio ${v.audit.pressure?.toFixed(2)}, confidence ${v.audit.confidence}.`];
}

function sellerWhy(v: View, ev: Evidence, time: string | null): string[] {
  const s = v.setup;
  if (s) {
    const ext = s.side === 'CALL SELL' ? 'high' : 'low';
    return [`${s.side === 'CALL SELL' ? 'The call' : 'The put'} side has the better selling structure: ${fmt(s.strike)} ${s.side === 'CALL SELL' ? 'CE' : 'PE'} is ${fmt(s.distExtreme)} points past today's ${ext}${s.breachOdds != null ? `, a distance price went past on ${pct(s.breachOdds)} of ${ev.breach[time!]?.n ?? ev.sessions} past sessions from this time` : ''}.`];
  }
  const c = v.sides.call, p = v.sides.put;
  if (!c || !p) return [];
  if (v.sellerView === 'BOTH COMPARABLE') return ['The call and put structures are too similar to justify choosing one, and the two-sided gate does not pass.'];
  const reason = (x: SideView) => x.graded?.fails[0] ?? 'no strike qualifies';
  return [`No side qualifies: calls — ${reason(c)}; puts — ${reason(p)}.`];
}

function triggers(v: View, cw: Wall | null, pw: Wall | null, atr: number | null): string[] {
  const t: string[] = [];
  if (v.setup) t.push(v.setup.invalidation.text);
  if (cw && atr) t.push(`Spot holds above the call wall ${fmt(cw.strike)} (wall breaks)`);
  if (pw && atr) t.push(`Spot holds below the put wall ${fmt(pw.strike)} (wall breaks)`);
  t.push('Call/put OI rotation flips (writing turns to unwinding)');
  t.push(`Re-check by ${v.expiresAt} (a view expires after 45 minutes)`);
  return t.slice(0, 4);
}

function windowFocus(m: number): string {
  if (m < 10 * 60 + 30) return 'Opening: expansion and whipsaw, day high/low forming, first wall tests — avoid overconfidence.';
  if (m < 12 * 60) return 'Mid-morning: trend confirmation or failure, wall behaviour, OI rotation.';
  if (m < 13 * 60 + 30) return 'Lunch: lower expansion, compression, premium decay, wall stability.';
  if (m < 14 * 60 + 45) return 'Afternoon: second expansion window, breakout/breakdown risk, OI shifts.';
  return 'Close: position squaring, rapid premium changes, late gamma — no unnecessary fresh entry.';
}

function logLine(s: Snapshot, v: View): string {
  const d = dateOf(s.now), a = v.audit;
  return `LOG | ${d} | ${v.header.time} | ${v.header.candles} | PR ${a.pressure?.toFixed(2) ?? 'NA'} | CAP ${a.capacity.score ?? 'NA'} | CONF ${a.confidence ?? 'NA'} | E4 ${a.e4.value == null ? 'NA' : (a.e4.value * 100).toFixed(0) + '%'} | ${v.mode} | ${v.sellerView} | ${v.setup?.side ?? 'NONE'} | ${v.setup?.strike ?? '-'} | ${a.spot?.toFixed(2) ?? 'NA'} | ACTUAL_1530_CLOSE=____`;
}

/** What changed between two views (spec step 17). */
export function whatChanged(prev: View, next: View): string[] {
  const out: string[] = [];
  const f = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${label}: ${String(a ?? '—')} → ${String(b ?? '—')}`); };
  f('Direction', prev.direction, next.direction);
  f('Seller view', prev.sellerView, next.sellerView);
  f('Mode', prev.mode, next.mode);
  f('Setup', prev.setup ? `${prev.setup.side} ${prev.setup.strike}` : 'NONE', next.setup ? `${next.setup.side} ${next.setup.strike}` : 'NONE');
  f('Call wall', prev.audit.walls.call?.strike, next.audit.walls.call?.strike);
  f('Put wall', prev.audit.walls.put?.strike, next.audit.walls.put?.strike);
  return out;
}

export { CHECK_LABELS };
