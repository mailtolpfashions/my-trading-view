import { describe, expect, it } from 'vitest';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import { PAPER_RULE, PAPER_STRADDLE, PLAYBOOKS, decide, isFirstDayWithin, ivAboveMedian, ivRank, nextWeekday, staleFlags, straddleLegs, type DecideContext, type MarketSnapshot, type Playbook, type SellEntry, type SellPosition } from '@mtv/options';
import { makeBook, monthlyExpiries, passCheck, runSelling, runOptionsBacktest, summariseSelling, booksFrom, type BookRow, type DayBook, type OptionsData, type SellingConfig } from './index';

const EXP = '2026-01-29', NEXT = '2026-02-26', LOT = 65;
const dates = ['2026-01-23', '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29'];
type Row = [string, number, 'CE' | 'PE', number, boolean?];

function book(date: string, spot: number, rows: Row[]): DayBook {
  return makeBook(date, spot * 100, LOT, rows.map(([expiry, strike, kind, close, traded = true]): BookRow & { expiry: string; kind: 'CE' | 'PE' } => ({ expiry, kind, strikePaise: strike * 100, closePaise: Math.round(close * 100), settlePaise: Math.round(close * 100), traded })));
}
const monthly = monthlyExpiries([EXP, NEXT]);

/** A short strangle sold 3 days before expiry at 25,000 ± 200, entered with fixed strike steps. */
const entry: SellEntry = { cycle: 'monthly', daysBefore: 3, short: { stepsOtm: 4 }, wingPct: null, lots: 1 };
const cfg = (playbook: Playbook, over: Partial<SellingConfig> = {}): SellingConfig => ({ entry, playbook, fill: 'same-close', slippagePaise: 0, todayNotionalPaise: 25000_00 * LOT, ...over });
const pb = (id: string) => PLAYBOOKS.find((p) => p.id === id)!;
const fees = (side: 'BUY' | 'SELL', premium: number, date: string, qty = LOT) => computeOptionCharges({ side, qty, premiumPaise: Math.round(premium * 100), date }).total;

const calm = [
  book(dates[0], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]),
  book(dates[1], 25000, [[EXP, 25200, 'CE', 80], [EXP, 24800, 'PE', 80]]),
  book(dates[2], 25000, [[EXP, 25200, 'CE', 60], [EXP, 24800, 'PE', 60]]),
  book(dates[3], 25000, [[EXP, 25200, 'CE', 30], [EXP, 24800, 'PE', 30]]),
  book(dates[4], 25050, [[EXP, 25200, 'CE', 0.05], [EXP, 24800, 'PE', 0.05]]),
];

describe('worked examples, rupees checked by hand', () => {
  it('hold: premium is kept when both legs expire worthless', () => {
    const opening = [book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]), calm[2], calm[3], calm[4]];
    const { trades } = runSelling(cfg(pb('hold')), opening, monthly);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.exitReason).toBe('expiry');
    expect(t.grossPaise).toBe(200_00 * LOT); // (100 + 100) × 65 = ₹13,000
    expect(t.chargesPaise).toBe(fees('SELL', 100, dates[1]) * 2);
    expect(t.netPaise).toBe(t.grossPaise - t.chargesPaise);
  });

  it('hold: an in-the-money short settles at full intrinsic value, not at 0', () => {
    const days = [
      book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]),
      book(dates[2], 25400, [[EXP, 25200, 'CE', 260], [EXP, 24800, 'PE', 10]]),
      book(dates[3], 25500, [[EXP, 25200, 'CE', 310], [EXP, 24800, 'PE', 2]]),
      book(dates[4], 25600, [[EXP, 25200, 'CE', 400], [EXP, 24800, 'PE', 0.05]]),
    ];
    const t = runSelling(cfg(pb('hold')), days, monthly).trades[0];
    expect(t.grossPaise).toBe((200 - 400) * 100 * LOT); // received ₹200, paid ₹400 intrinsic: a ₹13,000 loss
  });

  it('book 50%: exits at the close that first shows half the credit earned', () => {
    const days = [book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]), calm[2], calm[3], calm[4]];
    const t = runSelling(cfg(pb('book-50')), days, monthly).trades[0];
    expect(t.exitReason).toBe('target');
    expect(t.exitDate).toBe(dates[3]);
    expect(t.grossPaise).toBe((200 - 60) * 100 * LOT); // sold 200, bought back 60
    const charges = fees('SELL', 100, dates[1]) * 2 + fees('BUY', 30, dates[3]) * 2;
    expect(t.chargesPaise).toBe(charges);
  });

  it('stop at 2× credit exits once the loss reaches ₹400 per unit', () => {
    const days = [
      book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]),
      book(dates[2], 25600, [[EXP, 25200, 'CE', 590], [EXP, 24800, 'PE', 10]]),
      calm[4],
    ];
    const t = runSelling(cfg(pb('stop-2x'), { entry: { ...entry, daysBefore: 2 } }), days, monthly).trades[0];
    expect(t.exitReason).toBe('stop');
    expect(t.exitDate).toBe(dates[2]);
    expect(t.grossPaise).toBe((200 - 600) * 100 * LOT);
  });

  it('next-close fills act a day later and slippage goes against us on every fill', () => {
    const days = [
      book(dates[0], 25000, [[EXP, 25200, 'CE', 120], [EXP, 24800, 'PE', 120]]),
      book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]),
      calm[2], calm[3], calm[4],
    ];
    const r = runSelling(cfg(pb('book-50'), { fill: 'next-close', slippagePaise: 100, entry: { ...entry, daysBefore: 4 } }), days, monthly);
    const t = r.trades[0];
    expect(t.entryDate).toBe(dates[1]);
    const sold = t.fills.filter((f) => f.stage === 'entry');
    expect(sold.map((f) => f.pricePaise)).toEqual([99_00, 99_00]); // 100 less ₹1 slippage
    expect(t.exitDate).toBe(dates[4]); // decided at 28 Jan close, the next close is expiry itself, so it settles
    expect(t.exitReason).toBe('expiry');
  });
});

describe('adjustments', () => {
  const ctx: DecideContext = { fillCost: () => 0, entryDelta: 0.16, wingPct: 2 };
  const position = (): SellPosition => ({
    creditPaise: 200_00 * LOT, realisedPaise: 0, adjustments: 0,
    legs: [
      { expiry: EXP, strikePaise: 25200_00, kind: 'CE', side: 'SELL', qty: LOT, entryPaise: 100_00, role: 'short' },
      { expiry: EXP, strikePaise: 24800_00, kind: 'PE', side: 'SELL', qty: LOT, entryPaise: 100_00, role: 'short' },
    ],
  });
  /** A market with stated deltas, as read from premiums. */
  const market = (spot: number, rows: { e?: string; k: number; r: 'CE' | 'PE'; p: number; d: number; traded?: boolean }[]): MarketSnapshot => ({
    date: dates[2], spotPaise: spot * 100, expiries: [EXP, NEXT], isMonthly: () => true,
    chain: (e, r) => rows.filter((x) => (x.e ?? EXP) === e && x.r === r).map((x) => ({ strikePaise: x.k * 100, pricePaise: x.p * 100, traded: x.traded ?? true })),
    quote: (l) => { const x = rows.find((y) => (y.e ?? EXP) === l.expiry && y.k * 100 === l.strikePaise && y.r === l.kind); return x ? { strikePaise: l.strikePaise, pricePaise: x.p * 100, traded: x.traded ?? true } : null; },
    delta: (l) => { const x = rows.find((y) => (y.e ?? EXP) === l.expiry && y.k * 100 === l.strikePaise && y.r === l.kind); return x ? x.d : null; },
  });
  const rally = market(25250, [
    { k: 25200, r: 'CE', p: 200, d: 0.55 },
    { k: 24800, r: 'PE', p: 30, d: -0.05 },
    { k: 25000, r: 'PE', p: 90, d: -0.2 },
    { k: 25100, r: 'PE', p: 130, d: -0.3 },
    { k: 25600, r: 'CE', p: 40, d: 0.1 },
    { e: NEXT, k: 25800, r: 'CE', p: 240, d: 0.16 },
  ]);

  it('rolling the safe side in: exits the far put and sells one nearer, for a credit', () => {
    const d = decide(position(), rally, pb('roll-safe-in-delta'), ctx);
    expect(d.type).toBe('adjust');
    if (d.type !== 'adjust') return;
    expect(d.close).toEqual([{ expiry: EXP, strikePaise: 24800_00, kind: 'PE' }]);
    expect(d.open[0]).toMatchObject({ strikePaise: 25100_00, kind: 'PE', side: 'SELL' }); // target 0.275, nearest of 0.05 / 0.20 / 0.30
    expect(d.why).toContain('Exit 24800 PE and sell 25100 PE');
  });

  it('rolling the tested side out goes to the next expiry only for a net credit', () => {
    const d = decide(position(), rally, pb('roll-tested-out-delta'), ctx);
    expect(d).toMatchObject({ type: 'adjust', open: [{ expiry: NEXT, strikePaise: 25800_00, kind: 'CE' }] });
    const costly = decide(position(), rally, pb('roll-tested-out-delta'), { ...ctx, fillCost: () => 40_00 * LOT });
    expect(costly).toMatchObject({ type: 'none', blocked: 'no net credit after costs' });
  });

  it('rolling out picks the furthest strike that still collects, not the first delta', () => {
    const tested = market(25250, [
      { k: 25200, r: 'CE', p: 200, d: 0.55 },
      { k: 24800, r: 'PE', p: 30, d: -0.05 },
      { e: NEXT, k: 25800, r: 'CE', p: 150, d: 0.16 }, // the first delta: would cost ₹50
      { e: NEXT, k: 25500, r: 'CE', p: 260, d: 0.3 }, // collects ₹60
      { e: NEXT, k: 25300, r: 'CE', p: 380, d: 0.45 }, // collects more, but nearer
    ]);
    expect(decide(position(), tested, pb('roll-tested-out-delta'), ctx)).toMatchObject({ type: 'adjust', open: [{ expiry: NEXT, strikePaise: 25500_00 }] });
  });

  it('adding protection buys a wing on the tested side and needs no credit', () => {
    const d = decide(position(), rally, pb('add-hedge-delta'), ctx);
    expect(d).toMatchObject({ type: 'adjust', close: [], open: [{ strikePaise: 25600_00, kind: 'CE', side: 'BUY', role: 'wing' }] }); // short + 2% of 25,250
  });

  it('losses are checked before any adjustment, and a limit stops further adjusting', () => {
    const p = { ...position(), adjustments: 2 };
    expect(decide(p, rally, pb('roll-safe-in-delta'), ctx).type).toBe('none'); // 2 of 2 used
    const crash = market(26500, [{ k: 25200, r: 'CE', p: 900, d: 0.97 }, { k: 24800, r: 'PE', p: 1, d: -0.01 }, { k: 25100, r: 'PE', p: 2, d: -0.02 }]);
    expect(decide(position(), crash, pb('roll-safe-in-delta'), ctx)).toMatchObject({ type: 'exit', reason: 'max-loss' }); // (900 + 1 − 200) > 3 × 200
  });

  it('the trigger stays quiet while nothing is under pressure', () => {
    const quiet = market(25000, [{ k: 25200, r: 'CE', p: 90, d: 0.2 }, { k: 24800, r: 'PE', p: 90, d: -0.2 }]);
    expect(decide(position(), quiet, pb('roll-safe-in-delta'), ctx).type).toBe('none');
    expect(decide(position(), quiet, pb('hold'), ctx).type).toBe('none');
  });
});

describe('integrity', () => {
  const noisy = (): DayBook[] => {
    const out: DayBook[] = [];
    const start = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 29; i++) {
      const date = new Date(start + i * 86400_000).toISOString().slice(0, 10);
      const spot = 25000 + 400 * Math.sin(i / 3), t = Math.max(1, 29 - i);
      const rows: Row[] = [];
      for (let k = 24000; k <= 26000; k += 50) {
        const call = Math.max(0, spot - k) + (t * 4) * Math.exp(-Math.abs(spot - k) / 500);
        const put = Math.max(0, k - spot) + (t * 4) * Math.exp(-Math.abs(spot - k) / 500);
        rows.push([EXP, k, 'CE', Math.max(0.05, +call.toFixed(2))], [EXP, k, 'PE', Math.max(0.05, +put.toFixed(2))]);
      }
      out.push(book(date, spot, rows));
    }
    return out;
  };

  it('every trade nets to its fills less its charges', () => {
    const r = runSelling(cfg(pb('roll-safe-in-strike'), { entry: { ...entry, daysBefore: 20, short: { delta: 0.16 } }, fill: 'next-close', slippagePaise: 100 }), noisy(), monthly);
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) {
      const cash = t.fills.reduce((s, f) => s + (f.side === 'SELL' ? 1 : -1) * f.qty * f.pricePaise, 0);
      const charges = t.fills.reduce((s, f) => s + f.chargesPaise, 0);
      expect(t.grossPaise).toBe(cash);
      expect(t.netPaise).toBe(cash - charges);
    }
    expect(r.equity.at(-1)!.equityPaise).toBe(r.trades.reduce((s, t) => s + t.netPaise, 0));
  });

  it('adding later days changes no earlier decision', () => {
    const c = cfg(pb('roll-tested-out-strike'), { entry: { ...entry, daysBefore: 20, short: { delta: 0.16 } }, fill: 'next-close', slippagePaise: 100 });
    const all = noisy(), part = noisy().slice(0, 22);
    // Same index positions for the entry calendar: only the tail is missing.
    const calendar = all.map((x) => x.date);
    const a = runSelling({ ...c, calendar }, all, monthly), b = runSelling({ ...c, calendar }, part, monthly);
    const before = (x: typeof a) => x.equity.slice(0, 20).map((e) => e.equityPaise);
    expect(before(a)).toEqual(before(b));
  });

  it('hold matches the plain options backtester exactly on the same trades', async () => {
    const days = noisy();
    const data: OptionsData = {
      tradingDates: async () => days.map((b) => b.date),
      meta: async (_u, d) => { const b = days.find((x) => x.date === d)!; return { spotPaise: b.spotPaise, lotSize: LOT }; },
      expiries: async () => [EXP],
      chain: async (_u, d, e, k) => days.find((x) => x.date === d)!.rows.get(`${e}|${k}`) ?? [],
      quotes: async (_u, d, cs) => new Map(cs.flatMap((c) => { const r = days.find((x) => x.date === d)!.byLeg.get(`${c.expiry}|${c.strikePaise}|${c.kind}`); return r ? [[`${c.expiry}|${c.strikePaise}|${c.kind}`, r] as const] : []; })),
    };
    const plain = await runOptionsBacktest({
      name: 'x', underlying: 'NIFTY', entry: { when: 'daysToExpiry', days: 15 }, exit: {},
      legs: [
        { kind: 'CE', side: 'SELL', lots: 1, strike: { by: 'moneyness', moneyness: 'OTM', steps: 4 }, expiry: 'month0' },
        { kind: 'PE', side: 'SELL', lots: 1, strike: { by: 'moneyness', moneyness: 'OTM', steps: 4 }, expiry: 'month0' },
      ],
    }, data);
    const books = await booksFrom(data, 'NIFTY', '2026-01-01', '2026-01-31');
    const ours = runSelling(cfg(pb('hold'), { entry: { ...entry, daysBefore: 15, short: { stepsOtm: 4 } }, reenterSameDay: false }), books, monthly);
    expect(plain.trades.map((t) => [t.entryDate, t.exitDate, t.grossPaise, t.chargesPaise, t.netPaise])).toEqual(ours.trades.map((t) => [t.entryDate, t.exitDate, t.grossPaise, t.chargesPaise, t.netPaise]));
    expect(ours.trades.length).toBe(1);
  });

  it('long in-the-money wings pay exercise STT at expiry', () => {
    const days = [
      book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100], [EXP, 25700, 'CE', 20], [EXP, 24300, 'PE', 20]]),
      book(dates[2], 26000, [[EXP, 25200, 'CE', 800], [EXP, 24800, 'PE', 1], [EXP, 25700, 'CE', 300], [EXP, 24300, 'PE', 1]]),
      book(dates[3], 26000, [[EXP, 25200, 'CE', 800], [EXP, 24800, 'PE', 1], [EXP, 25700, 'CE', 300], [EXP, 24300, 'PE', 1]]),
      book(dates[4], 26000, [[EXP, 25200, 'CE', 800], [EXP, 24800, 'PE', 0.05], [EXP, 25700, 'CE', 300], [EXP, 24300, 'PE', 0.05]]),
    ];
    const t = runSelling(cfg(pb('hold'), { entry: { ...entry, wingPct: 2 } }), days, monthly).trades[0];
    expect(t.grossPaise).toBe(((200 - 40) - 800 + 300) * 100 * LOT); // the wing limits the call loss to 500
    expect(t.fills.filter((f) => f.stage === 'expiry' && f.side === 'SELL').reduce((s, f) => s + f.chargesPaise, 0)).toBe(exerciseStt(LOT, 300_00, dates[4]));
  });
});

describe('the paper rule', () => {
  const start = Date.parse('2026-01-02T00:00:00Z'), EXPIRY = '2026-03-03', NEAR = monthlyExpiries([EXPIRY]);
  /** Weekdays from 2 Jan to expiry, with calm prices. The index holds still, so only time passes. */
  const quiet = (): DayBook[] => {
    const out: DayBook[] = [];
    for (let i = 0; i <= 60; i++) {
      const date = new Date(start + i * 86400_000).toISOString().slice(0, 10), day = new Date(date).getUTCDay();
      if (day === 0 || day === 6) continue;
      const t = 60 - i, rows: Row[] = [];
      for (let k = 20000; k <= 26000; k += 100) {
        const d = Math.abs(k - 25000), v = (t + 1) * 6 * Math.exp(-d / 900) + 2;
        rows.push([EXPIRY, k, 'CE', +(Math.max(0, 25000 - k) + v).toFixed(2)], [EXPIRY, k, 'PE', +(Math.max(0, k - 25000) + v).toFixed(2)]);
      }
      out.push(book(date, 25000, rows));
    }
    return out;
  };
  const rule = (over: Partial<SellingConfig> = {}): SellingConfig => ({ ...PAPER_RULE, fill: 'same-close', slippagePaise: 100, todayNotionalPaise: 25000_00 * LOT, ...over });

  it('enters on the first trading day within 45 days, buys the crash put, and exits at 21 days left', () => {
    const { trades } = runSelling(rule(), quiet(), NEAR);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.entryDate).toBe('2026-01-19'); // 17 Jan (45 days out) is a Saturday, 18 a Sunday
    expect(t.exitDate).toBe('2026-02-10'); // the first close with 21 days left
    expect(t.exitReason).toBe('time');
    const entry = t.fills.filter((f) => f.stage === 'entry');
    expect(entry).toHaveLength(3);
    expect(entry.find((f) => f.side === 'BUY')).toMatchObject({ kind: 'PE', strikePaise: 21200_00 }); // nearest to 21,250 with ties downward
    expect(t.fills.filter((f) => f.stage === 'exit')).toHaveLength(3);
  });

  it('skips the month when the entry condition refuses, without counting it as a problem', () => {
    const r = runSelling(rule({ allowEntry: () => false }), quiet(), NEAR);
    expect(r.trades).toHaveLength(0);
    expect(r.skipped).toHaveLength(0);
  });

  it('high IV means above the median of earlier days only', () => {
    const series = Array.from({ length: 100 }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, iv: i < 99 ? 0.1 + i / 1000 : 0.3 }));
    expect(ivAboveMedian(series, series[99].date)).toBe(true);
    expect(ivAboveMedian(series.map((p, i) => (i === 99 ? { ...p, iv: 0.01 } : p)), series[99].date)).toBe(false);
    expect(ivAboveMedian(series, series[10].date)).toBeNull(); // too little history
  });

  it('finds the first day inside the window and steps past weekends', () => {
    expect(isFirstDayWithin('2026-01-19', '2026-01-16', EXPIRY, 45)).toBe(true);
    expect(isFirstDayWithin('2026-01-20', '2026-01-19', EXPIRY, 45)).toBe(false);
    expect(isFirstDayWithin('2026-01-16', '2026-01-15', EXPIRY, 45)).toBe(false);
    expect(nextWeekday('2026-01-17')).toBe('2026-01-19');
    expect(nextWeekday('2026-01-19')).toBe('2026-01-19');
  });

  it('flags a stale close, keeps the honest run, and leaves clean chains alone', () => {
    expect(staleFlags([200_00, 360_00, 104_00, 400_00, 450_00], true)).toEqual([false, false, true, false, false]); // the 12 Mar 2020 pattern
    expect(staleFlags([500_00, 400_00, 300_00, 200_00], false)).toEqual([false, false, false, false]);
    expect(staleFlags([100_00, 100_00, 100_03], true)).toEqual([false, false, false]);
  });
});

describe('the second paper rule', () => {
  const chain: Record<string, { strikePaise: number; pricePaise: number; traded: boolean }[]> = {
    CE: [{ strikePaise: 24000_00, pricePaise: 500_00, traded: true }, { strikePaise: 24100_00, pricePaise: 440_00, traded: true }, { strikePaise: 24200_00, pricePaise: 400_00, traded: true }],
    PE: [{ strikePaise: 24000_00, pricePaise: 300_00, traded: true }, { strikePaise: 24100_00, pricePaise: 340_00, traded: false }, { strikePaise: 24200_00, pricePaise: 400_00, traded: true }],
  };
  const m = { date: '2026-11-16', spotPaise: 23900_00, expiries: [EXP], isMonthly: () => true, chain: (_e: string, k: 'CE' | 'PE') => chain[k], quote: () => null, delta: () => null } as MarketSnapshot;

  it('sells both options at the traded strike nearest the forward', () => {
    expect(straddleLegs(m, EXP, 24110_00, LOT)).toMatchObject({ legs: [{ strikePaise: 24200_00, kind: 'CE', side: 'SELL', qty: LOT }, { strikePaise: 24200_00, kind: 'PE', side: 'SELL', qty: LOT }] }); // 24100 PE did not trade
  });

  it('refuses when no traded strike is within 2% of the index', () => {
    expect(straddleLegs(m, EXP, 26000_00, LOT)).toHaveProperty('skip');
  });

  it('books 50% of the credit, and otherwise exits at 25 days left', () => {
    const position: SellPosition = { creditPaise: 800_00 * LOT, realisedPaise: 0, adjustments: 0, legs: [{ expiry: '2026-12-29', strikePaise: 24000_00, kind: 'CE', side: 'SELL', qty: LOT, entryPaise: 500_00, role: 'short' }, { expiry: '2026-12-29', strikePaise: 24000_00, kind: 'PE', side: 'SELL', qty: LOT, entryPaise: 300_00, role: 'short' }] };
    const ctx: DecideContext = { fillCost: () => 0, entryDelta: 0.16, wingPct: 2 };
    const at = (date: string, ce: number, pe: number) => ({ ...m, date, quote: (l: { kind: string }) => ({ strikePaise: 24000_00, pricePaise: (l.kind === 'CE' ? ce : pe) * 100, traded: true }) }) as MarketSnapshot;
    expect(decide(position, at('2026-11-20', 500, 300), PAPER_STRADDLE.playbook, ctx).type).toBe('none');
    expect(decide(position, at('2026-11-24', 200, 200), PAPER_STRADDLE.playbook, ctx)).toMatchObject({ type: 'exit', reason: 'target' });
    expect(decide(position, at('2026-12-04', 500, 300), PAPER_STRADDLE.playbook, ctx)).toMatchObject({ type: 'exit', reason: 'time' });
  });

  it('ranks IV against earlier days only', () => {
    const h = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), iv: i / 100 }));
    expect(ivRank(h, h[99].date)).toBe(1);
    expect(ivRank(h.map((p, i) => (i === 99 ? { ...p, iv: 0 } : p)), h[99].date)).toBe(0);
    expect(ivRank(h, h[10].date)).toBeNull();
  });
});

describe('tables', () => {
  it('splits years from the daily marks, and the pass mark names the check that failed', () => {
    const days = [book(dates[1], 25000, [[EXP, 25200, 'CE', 100], [EXP, 24800, 'PE', 100]]), calm[2], calm[3], calm[4]];
    const r = runSelling(cfg(pb('hold')), days, monthly);
    const s = summariseSelling(r);
    expect(s.years[0].period).toBe('2026');
    expect(s.years[0].netPaise).toBe(s.netPaise);
    expect(s.confirmPeriodNetPaise).toBe(s.netPaise);
    expect(s.stress).toHaveLength(8);
    const ok = passCheck(s, { capitalPaise: 5_00_000_00, worstMonthPct: 5, worstYearPct: 15, gapPct: 8, gapLimitPct: 15 });
    expect(ok.checks.map((c) => c.ok).slice(0, 4)).toEqual([true, true, true, true]);
  });
});
