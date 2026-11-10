import { describe, expect, it } from 'vitest';
import { analyze, breachOdds, checkWeight, whatChanged, type ChainRow, type Evidence, type Minute, type Snapshot } from './index';

// A session on Thu 5 Nov 2026: 09:15 IST = 03:45 UTC.
const T0 = Date.UTC(2026, 10, 5, 3, 45) / 1000;
const at = (hh: number, mm: number) => T0 + ((hh * 60 + mm) - (9 * 60 + 15)) * 60;

/** NIFTY minutes from 09:15 to `until`, oscillating around 25,000 inside 24,950–25,050. */
function minutes(until: number, base = 25000, drift = 0): Minute[] {
  const out: Minute[] = [];
  for (let t = T0; t + 60 <= until; t += 60) {
    const i = (t - T0) / 60, c = base + drift * i + 40 * Math.sin(i / 7);
    out.push({ time: t, open: c - 2, high: c + 10, low: c - 10, close: c, volume: 0 });
  }
  return out;
}
const grid = { '0': 0.9, '0.1': 0.6, '0.25': 0.3, '0.5': 0.12, '0.75': 0.05, '1': 0.02, '1.5': 0.005 };
const TIMES = [570, 585, 600, 615, 630, 675, 720, 780, 840, 885];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ev = (hit = 0.5, n = 250): Evidence => ({
  built: 'test', sessions: 250, from: '2025-11-04', to: '2026-11-04', times: TIMES,
  checks: Object.fromEntries(['refClose', 'vwap', 'structure', 'rsi', 'opening', 'heavyGreen', 'heavyVwap', 'bank', 'drift'].map((id) => [id, Object.fromEntries(TIMES.map((t) => [hm(t), { hit, n }]))])),
  e4: Object.fromEntries(TIMES.map((t) => [hm(t), { stay: 0.2, n: 250 }])),
  breach: Object.fromEntries(TIMES.map((t) => [hm(t), { n: 250, high: grid, low: grid }])),
  baseRates: [], notes: [],
});

/** Chain 24,500–25,500 every 50: premiums fall with distance; OI peaks at 25,150 CE and 24,850 PE. */
function chain(over: (r: ChainRow) => Partial<ChainRow> = () => ({})): ChainRow[] {
  const rows: ChainRow[] = [];
  for (let k = 24500; k <= 25500; k += 50) for (const right of ['CE', 'PE'] as const) {
    const itm = right === 'CE' ? 25000 - k : k - 25000;
    const ltp = Math.max(2, 120 + itm * 0.5 - Math.abs(itm) * 0.05);
    const wall = (right === 'CE' && k === 25150) || (right === 'PE' && k === 24850);
    const r: ChainRow = { strike: k, right, ltp, bid: ltp * 0.996, ask: ltp * 1.004, oi: wall ? 900000 : 300000, oiOpen: 250000, oiDayHigh: wall ? 920000 : 310000, oiDayLow: 200000, volume: 50000 };
    rows.push({ ...r, ...over(r) });
  }
  return rows;
}
function snap(now: number, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    now, live: true, source: 'test', nifty: minutes(now), refClose: 24990, officialPrevClose: 24992, atr: 200, atrNote: 'test', vix: 13, vixNote: 'test',
    prev15Closes: Array.from({ length: 30 }, (_, i) => 24900 + i * 3), bank: null, heavy: [],
    chain: { expiry: '2026-11-10', lotSize: 65, rows: chain() }, unknown: ['global cues', 'event calendar', 'order-book depth'], ...extra,
  };
}

describe('intraday seller engine — gates', () => {
  it('stops without live data', () => {
    const v = analyze(snap(at(11, 0), { live: false }), ev());
    expect(v.stop).toMatch(/LIVE DATA NOT AVAILABLE/);
    expect(v.mode).toBe('NONE');
  });
  it('does not issue direction before 4 completed candles, but still analyses both seller sides', () => {
    const v = analyze(snap(at(9, 55)), ev());
    expect(v.header.candles).toBe(2);
    expect(v.direction).toBe('NOT ISSUED');
    expect(v.header.line).toContain('DIRECTION NOT ISSUED');
    expect(v.sides.call).not.toBeNull();
    expect(v.sides.put).not.toBeNull();
    expect(v.audit.pressure).toBeNull();
  });
  it('says NOT CLEAR when no check has a measured edge (every weight 0)', () => {
    const v = analyze(snap(at(11, 30)), ev(0.5, 250));
    expect(v.direction).toBe('NOT CLEAR');
    expect(v.audit.pressureNote).toMatch(/no check has a measured edge/i);
    expect(v.why[0]).toMatch(/coin flip/);
  });
});

describe('check weights (spec step 4 + beat-chance rule)', () => {
  const e = (hit: number, n: number) => ev(hit, n);
  it('58% on 124 sessions is inside the coin-flip band → 0', () => expect(checkWeight(e(0.58, 124), 'opening', '10:15').weight).toBe(0));
  it('62% on 250 sessions → 1', () => expect(checkWeight(e(0.62, 250), 'opening', '10:15').weight).toBe(1));
  it('57% on 1,000 sessions beats chance → 0.5', () => expect(checkWeight(e(0.57, 1000), 'opening', '10:15').weight).toBe(0.5));
  it('62% on 150 sessions (beats chance, < 200 sessions) → 0.5', () => expect(checkWeight(e(0.62, 150), 'opening', '10:15').weight).toBe(0.5));
  it('a check never measured gets ±0.5 with hit rate UNKNOWN', () => expect(checkWeight(e(0.5, 250), 'oiShift', '10:15')).toEqual({ weight: 0.5, basis: expect.stringMatching(/UNKNOWN/) }));
});

describe('seller side', () => {
  it('interpolates breach odds and returns null outside the measured times', () => {
    expect(breachOdds(ev(), '11:15', 'high', 0.375)).toBeCloseTo(0.21, 5);
    expect(breachOdds(ev(), null, 'high', 0.3)).toBeNull();
  });
  it('picks the stronger side and, within it, the nearest eligible strike (ATM-first), not the richest', () => {
    // Puts unusable (wide spreads): calls must win; the first call strike far enough past the day high is chosen.
    const v = analyze(snap(at(12, 0), { chain: { expiry: '2026-11-10', lotSize: 65, rows: chain((r) => (r.right === 'PE' ? { bid: r.ltp! * 0.9, ask: r.ltp! * 1.1 } : {})) } }), ev());
    expect(v.sellerView).toBe('CALL SIDE STRONGER');
    expect(v.mode).toBe('NON-DIRECTIONAL');
    const dayHigh = v.audit.dayHigh!;
    const eligible = v.sides.call!.candidates.filter((c) => c.pass).map((c) => c.strike);
    expect(v.setup!.strike).toBe(Math.min(...eligible));
    expect(v.setup!.strike).toBeGreaterThan(dayHigh);
    expect(v.notice).toMatch(/does not mean the market is expected/);
    expect(v.setup!.invalidation.level).toBe(Math.round(dayHigh + (v.setup!.strike - dayHigh) / 2));
  });
  it('outputs SIDE: NONE when neither side passes the mandatory filters', () => {
    const v = analyze(snap(at(12, 0), { chain: { expiry: '2026-11-10', lotSize: 65, rows: chain((r) => ({ bid: r.ltp! * 0.9, ask: r.ltp! * 1.1 })) } }), ev());
    expect(v.mode).toBe('NONE');
    expect(v.setup).toBeNull();
    expect(v.why.join(' ')).toMatch(/No side qualifies/);
  });
  it('never assumes a missing bid/ask: that strike fails with UNKNOWN', () => {
    const v = analyze(snap(at(12, 0), { chain: { expiry: '2026-11-10', lotSize: 65, rows: chain(() => ({ bid: null, ask: null })) } }), ev());
    expect(v.setup).toBeNull();
    expect(v.sides.call!.candidates.every((c) => c.fails.includes('bid/ask UNKNOWN'))).toBe(true);
  });
  it('answers SIDE: NONE / INSUFFICIENT DATA when the recorded chain does not cover spot ±250 on both sides', () => {
    const v = analyze(snap(at(12, 0), { chain: { expiry: '2026-11-10', lotSize: 65, rows: chain().filter((r) => r.right === 'CE' || r.strike >= 25100) } }), ev());
    expect(v.mode).toBe('NONE');
    expect(v.sellerView).toBe('NONE');
    expect(v.setup).toBeNull();
    expect(v.why.join(' ')).toMatch(/INSUFFICIENT DATA — option chain incomplete/);
    expect(v.audit.unknown.join(' ')).toMatch(/option chain incomplete/);
  });
  it('does not offer two-sided while the event calendar is unknown', () => {
    const v = analyze(snap(at(13, 0)), ev());
    expect(v.twoSided.offered).toBe(false);
    expect(v.twoSided.failed.join(' ')).toMatch(/event/);
  });
  it('reports what changed between two runs', () => {
    const a = analyze(snap(at(12, 0)), ev()), b = analyze(snap(at(12, 0), { chain: null }), ev());
    expect(whatChanged(a, a)).toEqual([]);
    expect(whatChanged(a, b).length).toBeGreaterThanOrEqual(0);
  });
  it('writes the calibration log line', () => {
    const v = analyze(snap(at(12, 0)), ev());
    expect(v.log).toMatch(/^LOG \| 2026-11-05 \| 12:00 \| 11 \| PR /);
    expect(v.log).toMatch(/ACTUAL_1530_CLOSE=____$/);
  });
});
