import { describe, expect, it } from 'vitest';
import { computeOptionCharges, exerciseStt } from '@mtv/paper';
import type { Candle } from '@mtv/shared';
import { moneynessStrike, pickExpiry, runOptionsBacktest, type ContractQuote, type OptionsData, type OptionsStrategy } from './index';

type Day = { spot: number; lot: number | null; contracts: Record<string, ContractQuote> }; // key `${expiry}|${strike}|${kind}`

/** In-memory F&O data: rupee prices, converted to paise. */
function memory(days: Record<string, { spot: number; lot?: number | null; c: [string, number, 'CE' | 'PE', number, boolean?, number?][] }>): OptionsData {
  const d: Record<string, Day> = {};
  for (const [date, v] of Object.entries(days)) {
    d[date] = { spot: v.spot * 100, lot: v.lot === undefined ? 65 : v.lot, contracts: {} };
    for (const [exp, strike, kind, close, traded = true, settle] of v.c) {
      d[date].contracts[`${exp}|${strike * 100}|${kind}`] = { strikePaise: strike * 100, closePaise: Math.round(close * 100), settlePaise: Math.round((settle ?? close) * 100), traded };
    }
  }
  return {
    tradingDates: async (_u, from, to) => Object.keys(d).filter((x) => x >= from && x <= to).sort(),
    meta: async (_u, date) => (d[date] ? { spotPaise: d[date].spot, lotSize: d[date].lot } : null),
    expiries: async (_u, date) => [...new Set(Object.keys(d[date]?.contracts ?? {}).map((k) => k.split('|')[0]))].sort(),
    chain: async (_u, date, expiry, kind) => Object.entries(d[date]?.contracts ?? {}).filter(([k]) => k.startsWith(expiry + '|') && k.endsWith('|' + kind)).map(([, v]) => v),
    quotes: async (_u, date, cs) => new Map(cs.map((c) => [`${c.expiry}|${c.strikePaise}|${c.kind}`, d[date]?.contracts[`${c.expiry}|${c.strikePaise}|${c.kind}`]] as const).filter(([, v]) => v) as [string, ContractQuote][]),
  };
}

const EXP = '2026-10-27';
const straddle = (over: Partial<OptionsStrategy> = {}): OptionsStrategy => ({
  name: 'Short straddle', underlying: 'NIFTY', entry: { when: 'weekdays', days: [5] /* Fri */ }, exit: {},
  legs: [
    { kind: 'CE', side: 'SELL', lots: 1, strike: { by: 'moneyness', moneyness: 'ATM', steps: 0 }, expiry: 'week0' },
    { kind: 'PE', side: 'SELL', lots: 1, strike: { by: 'moneyness', moneyness: 'ATM', steps: 0 }, expiry: 'week0' },
  ],
  ...over,
});

describe('expiry and strike selection', () => {
  it('weekly picks the first expiry strictly after the entry day; monthly is the last listed expiry of a month', () => {
    const exps = ['2026-10-27', '2026-11-03', '2026-11-10', '2026-11-24', '2026-12-29'];
    expect(pickExpiry(exps, '2026-10-27', 'week0')).toBe('2026-11-03'); // not the same-day expiry
    expect(pickExpiry(exps, '2026-10-26', 'week1')).toBe('2026-11-03');
    expect(pickExpiry(exps, '2026-10-26', 'month0')).toBe('2026-10-27');
    expect(pickExpiry(exps, '2026-10-28', 'month0')).toBe('2026-11-24');
    expect(pickExpiry(exps, '2026-10-28', 'month1')).toBe('2026-12-29');
  });
  it('OTM moves away from spot for each side; ITM moves into the money', () => {
    const spot = 22753_20;
    expect(moneynessStrike(spot, 50_00, 'CE', 'ATM', 0)).toBe(22750_00);
    expect(moneynessStrike(spot, 50_00, 'CE', 'OTM', 2)).toBe(22850_00);
    expect(moneynessStrike(spot, 50_00, 'PE', 'OTM', 2)).toBe(22650_00);
    expect(moneynessStrike(spot, 50_00, 'PE', 'ITM', 1)).toBe(22800_00);
  });
});

describe('end-of-day options backtest', () => {
  const days = {
    '2026-10-23': { spot: 22600, c: [[EXP, 22600, 'CE', 100], [EXP, 22600, 'PE', 80]] }, // Fri: entry
    '2026-10-26': { spot: 22700, c: [[EXP, 22600, 'CE', 140], [EXP, 22600, 'PE', 20]] }, // Mon
    '2026-10-27': { spot: 22650, c: [[EXP, 22600, 'CE', 50], [EXP, 22600, 'PE', 0.05]] }, // Tue: expiry
  } as const;

  it('short straddle held to expiry settles at intrinsic value against the official index close', async () => {
    const r = await runOptionsBacktest(straddle(), memory(days as never));
    const t = r.trades[0];
    expect(t).toMatchObject({ entryDate: '2026-10-23', exitDate: '2026-10-27', exitReason: 'expiry', tradingDays: 2 });
    // CE sold 100 settles at 22650 − 22600 = 50; PE sold 80 expires worthless. Gross = 65 × (50 + 80) = ₹8,450
    expect(t.legs.map((l) => l.exitPaise)).toEqual([50_00, 0]);
    expect(t.grossPaise).toBe(8450_00);
    // Charges: entry orders only (short options settle without exercise STT)
    const entry = computeOptionCharges({ side: 'SELL', qty: 65, premiumPaise: 100_00 }).total + computeOptionCharges({ side: 'SELL', qty: 65, premiumPaise: 80_00 }).total;
    expect(t.chargesPaise).toBe(entry);
    expect(r.metrics.netPaise).toBe(8450_00 - entry);
    expect(r.equity.at(-1)!.equityPaise).toBe(r.metrics.netPaise);
  });

  it('long options pay STT on exercise when they expire in the money', async () => {
    const r = await runOptionsBacktest(straddle({ legs: [{ kind: 'CE', side: 'BUY', lots: 1, strike: { by: 'moneyness', moneyness: 'ATM', steps: 0 }, expiry: 'week0' }] }), memory(days as never));
    const t = r.trades[0];
    expect(t.chargesPaise).toBe(computeOptionCharges({ side: 'BUY', qty: 65, premiumPaise: 100_00 }).total + exerciseStt(65, 50_00));
  });

  it('exits on a rupee stop loss at the daily close', async () => {
    const r = await runOptionsBacktest(straddle({ exit: { stopLossRupees: 1000 } }), memory(days as never));
    // Mon close: CE 100→140 (−40×65 = −2,600), PE 80→20 (+60×65 = +3,900): +1,300 -> no stop. Use a tighter case:
    expect(r.trades[0].exitReason).toBe('expiry');
    const r2 = await runOptionsBacktest(straddle({ legs: [straddle().legs[0]], exit: { stopLossRupees: 2000 } }), memory(days as never));
    expect(r2.trades[0]).toMatchObject({ exitReason: 'stop', exitDate: '2026-10-26' }); // −₹2,600 ≤ −₹2,000
    expect(r2.trades[0].legs[0].exitPaise).toBe(140_00);
  });

  it('skips an entry whose contract did not trade, and says why', async () => {
    const d = { ...days, '2026-10-23': { spot: 22600, c: [[EXP, 22600, 'CE', 100, false], [EXP, 22600, 'PE', 80]] } };
    const r = await runOptionsBacktest(straddle(), memory(d as never));
    expect(r.trades).toHaveLength(0);
    expect(r.skipped[0]).toMatchObject({ date: '2026-10-23', reason: expect.stringMatching(/22600 CE .* did not trade/) });
  });

  it('values an untraded day at NSE\'s settlement price and counts it', async () => {
    const d = { ...days, '2026-10-26': { spot: 22700, c: [[EXP, 22600, 'CE', 999, false, 135], [EXP, 22600, 'PE', 20]] } };
    const r = await runOptionsBacktest(straddle({ legs: [straddle().legs[0]], exit: { stopLossRupees: 2000 } }), memory(d as never));
    expect(r.trades[0]).toMatchObject({ exitReason: 'stop' });
    expect(r.trades[0].legs[0]).toMatchObject({ exitPaise: 135_00, settledDays: 1 }); // settle 135, not the stale close 999
    expect(r.metrics.settledLegDays).toBe(1);
  });

  it('skips days whose lot size could not be determined', async () => {
    const d = { ...days, '2026-10-23': { ...days['2026-10-23'], lot: null } };
    const r = await runOptionsBacktest(straddle(), memory(d as never));
    expect(r.skipped[0].reason).toMatch(/Lot size/);
  });

  it('selects by premium: the traded strike whose premium is closest to the target', async () => {
    const d = { '2026-10-23': { spot: 22600, c: [[EXP, 22700, 'CE', 60], [EXP, 22800, 'CE', 31], [EXP, 22900, 'CE', 12], [EXP, 23000, 'CE', 29, false]] }, '2026-10-27': { spot: 22600, c: [] } };
    const r = await runOptionsBacktest(straddle({ legs: [{ kind: 'CE', side: 'SELL', lots: 2, strike: { by: 'premium', premium: 30 }, expiry: 'week0' }] }), memory(d as never));
    expect(r.trades[0].legs[0]).toMatchObject({ strikePaise: 22800_00, entryPaise: 31_00, qty: 130 }); // 23000 is closer but untraded
  });

  it('indicator entry: a signal at Friday\'s close trades at Monday\'s close (no look-ahead)', async () => {
    const candle = (date: string, close: number): Candle => ({ time: Date.parse(`${date}T09:15:00Z`) / 1000 - 5.5 * 3600, open: close, high: close, low: close, close, volume: 0 });
    const daily = [candle('2026-10-22', 22500), candle('2026-10-23', 22600), candle('2026-10-26', 22700), candle('2026-10-27', 22650)];
    const d = { ...days, '2026-10-26': { spot: 22700, c: [[EXP, 22700, 'CE', 90], [EXP, 22700, 'PE', 85], [EXP, 22600, 'CE', 140], [EXP, 22600, 'PE', 20]] }, '2026-10-27': { spot: 22650, c: [] } };
    const s = straddle({ entry: { when: 'signal', rules: { match: 'all', conditions: [{ left: { kind: 'price', field: 'close' }, op: 'crossesAbove', right: { kind: 'number', value: 22550 } }] } } });
    const r = await runOptionsBacktest(s, memory(d as never), daily);
    expect(r.trades[0]).toMatchObject({ entryDate: '2026-10-26', spotEntryPaise: 22700_00 });
    expect(r.trades[0].legs.map((l) => l.strikePaise)).toEqual([22700_00, 22700_00]);
  });
});
