import { describe, expect, it } from 'vitest';
import { black76, yearsToExpiry } from '@mtv/options';
import { brokerById, computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { SimError, parityForward, simulatePosition, type ContractQuote, type OptionsData, type SimInput } from './index';

/** In-memory F&O data: rupee prices, converted to paise. Rows: [expiry, strike, kind, close, traded?, settle?]. */
function memory(days: Record<string, { spot: number | null; lot?: number; c: [string, number, 'CE' | 'PE', number, boolean?, number?][] }>): OptionsData {
  const d: Record<string, { spot: number | null; lot: number; contracts: Record<string, ContractQuote> }> = {};
  for (const [date, v] of Object.entries(days)) {
    d[date] = { spot: v.spot == null ? null : Math.round(v.spot * 100), lot: v.lot ?? 75, contracts: {} };
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

const W1 = '2026-10-27', W2 = '2026-11-03';
const zerodha = brokerById('zerodha');

describe('options simulator', () => {
  const data = memory({
    '2026-10-22': { spot: 22600, c: [[W1, 22600, 'CE', 120], [W1, 22600, 'PE', 100]] }, // entry
    '2026-10-23': { spot: 22700, c: [[W1, 22600, 'CE', 160], [W1, 22600, 'PE', 40, false, 45]] }, // PE untraded: settle 45
    '2026-10-26': { spot: 22650, c: [[W1, 22600, 'CE', 90], [W1, 22600, 'PE', 10]] },
    '2026-10-27': { spot: 22680.5, c: [[W1, 22600, 'CE', 81], [W1, 22600, 'PE', 0.05]] }, // expiry
  });
  const straddle: SimInput = {
    underlying: 'NIFTY', entryDate: '2026-10-22', broker: zerodha,
    legs: [
      { expiry: W1, strikePaise: 22600_00, kind: 'CE', side: 'SELL', lots: 2, entryPaise: 120_00 },
      { expiry: W1, strikePaise: 22600_00, kind: 'PE', side: 'SELL', lots: 2, entryPaise: 100_00 },
    ],
  };

  it('sizes each leg by its own expiry’s lot when the data knows it (NSE moving to a new lot size)', async () => {
    // Day lot 75 (near expiry); the later expiry's contracts already carry the new lot 65.
    const twoExpiries = memory({
      '2026-10-22': { spot: 22600, c: [[W1, 22600, 'CE', 120], [W2, 22600, 'CE', 180]] },
      '2026-10-23': { spot: 22650, c: [[W1, 22600, 'CE', 140], [W2, 22600, 'CE', 200]] },
    });
    const r = await simulatePosition({
      underlying: 'NIFTY', entryDate: '2026-10-22', broker: zerodha,
      legs: [
        { expiry: W1, strikePaise: 22600_00, kind: 'CE', side: 'SELL', lots: 1, entryPaise: 120_00 },
        { expiry: W2, strikePaise: 22600_00, kind: 'CE', side: 'BUY', lots: 1, entryPaise: 180_00 },
      ],
    }, { ...twoExpiries, lotFor: async (_u, _d, expiry) => (expiry === W2 ? 65 : 75) });
    expect(r.legs.map((l) => l.qty)).toEqual([75, 65]);
    expect(r.days[1].grossPaise).toBe(-75 * (140_00 - 120_00) + 65 * (200_00 - 180_00));
  });

  it('marks to NSE close each day, uses the settlement price on untraded days, and settles at intrinsic on expiry', async () => {
    const r = await simulatePosition(straddle, data);
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27']);
    expect(r.end).toBe('expired');
    const qty = 150;
    expect(r.days[0].grossPaise).toBe(0);
    expect(r.days[1].legs.map((l) => [l.pricePaise, l.source])).toEqual([[160_00, 'close'], [45_00, 'settle']]);
    expect(r.days[1].grossPaise).toBe(-qty * (160_00 - 120_00) - qty * (45_00 - 100_00));
    // Expiry: CE settles at 22,680.50 − 22,600 = 80.50 (not NSE's 81 close); PE expires worthless.
    expect(r.days[3].legs.map((l) => [l.pricePaise, l.source])).toEqual([[80_50, 'expired'], [0, 'expired']]);
    expect(r.days[3].grossPaise).toBe(-qty * (80_50 - 120_00) - qty * (0 - 100_00));
    expect(r.days[3].openLegs).toBe(0);
  });

  it('charges entry at the entry date, exits at each day\'s prices, and settlement on expiry', async () => {
    const r = await simulatePosition(straddle, data);
    const entry = computeOptionCharges({ side: 'SELL', qty: 150, premiumPaise: 120_00, date: '2026-10-22', broker: zerodha }).total
      + computeOptionCharges({ side: 'SELL', qty: 150, premiumPaise: 100_00, date: '2026-10-22', broker: zerodha }).total;
    expect(r.entryChargesPaise).toBe(entry);
    const exitDay2 = computeOptionCharges({ side: 'BUY', qty: 150, premiumPaise: 90_00, date: '2026-10-26', broker: zerodha }).total
      + computeOptionCharges({ side: 'BUY', qty: 150, premiumPaise: 10_00, date: '2026-10-26', broker: zerodha }).total;
    expect(r.days[2].chargesIfExitPaise).toBe(entry + exitDay2);
    // Held to expiry: short legs pay no exercise STT; only the broker's exercise brokerage, if any.
    const settle = expirySettlementCharges({ side: 'SELL', qty: 150, intrinsicPaise: 80_50, date: W1, broker: zerodha })
      + expirySettlementCharges({ side: 'SELL', qty: 150, intrinsicPaise: 0, date: W1, broker: zerodha });
    expect(r.days[3].chargesIfExitPaise).toBe(entry + settle);
    expect(r.days[3].netIfExitPaise).toBe(r.days[3].grossPaise - entry - settle);
  });

  it('keeps an expired leg fixed while a later leg runs on, and stops where the data ends', async () => {
    const cal = memory({
      '2026-10-26': { spot: 22600, c: [[W1, 22600, 'CE', 60], [W2, 22600, 'CE', 150]] },
      '2026-10-27': { spot: 22550, c: [[W1, 22600, 'CE', 1], [W2, 22600, 'CE', 120]] },
      '2026-10-28': { spot: 22800, c: [[W2, 22600, 'CE', 260]] },
    });
    const r = await simulatePosition({
      underlying: 'NIFTY', entryDate: '2026-10-26',
      legs: [
        { expiry: W1, strikePaise: 22600_00, kind: 'CE', side: 'SELL', lots: 1, entryPaise: 60_00 },
        { expiry: W2, strikePaise: 22600_00, kind: 'CE', side: 'BUY', lots: 1, entryPaise: 150_00 },
      ],
    }, cal);
    expect(r.end).toBe('end-of-data');
    expect(r.days[1].legs[0]).toMatchObject({ pricePaise: 0, source: 'expired' });
    expect(r.days[2].legs[0]).toMatchObject({ pricePaise: 0, source: 'expired' });
    expect(r.days[2].grossPaise).toBe(-75 * (0 - 60_00) + 75 * (260_00 - 150_00));
    expect(r.days[2].openLegs).toBe(1);
  });

  it('recovers IV and Greeks from prices through the parity forward', async () => {
    const date = '2026-10-20', exp = '2026-11-24', r = 0.065, sigma = 0.14, F = 22680;
    const T = yearsToExpiry(Date.parse(`${date}T15:30:00Z`) / 1000 - 5.5 * 3600, exp);
    const px = (k: 'CE' | 'PE', K: number) => black76(k, F, K, T, r, sigma).price;
    const g = black76('CE', F, 22700, T, r, sigma);
    const d = memory({ [date]: { spot: 22600, c: [[exp, 22600, 'CE', px('CE', 22600)], [exp, 22600, 'PE', px('PE', 22600)], [exp, 22700, 'CE', px('CE', 22700)]] } });
    const res = await simulatePosition({ underlying: 'NIFTY', entryDate: date, legs: [{ expiry: exp, strikePaise: 22700_00, kind: 'CE', side: 'BUY', lots: 1, entryPaise: Math.round(px('CE', 22700) * 100) }] }, d);
    const leg = res.days[0].legs[0];
    // Prices are rounded to the paisa, so IV is recovered to about 0.01 vol point.
    expect(leg.iv).toBeCloseTo(sigma, 3);
    expect(res.days[0].delta).toBeCloseTo(75 * g.delta, 1);
    expect(res.days[0].theta).toBeCloseTo(75 * g.theta, 0);
  });

  it('parity forward uses the traded pair nearest spot', () => {
    const q = (k: number, c: number, traded = true): ContractQuote => ({ strikePaise: k, closePaise: c, settlePaise: c, traded });
    expect(parityForward([q(100_00, 12_00), q(110_00, 5_00)], [q(100_00, 2_00), q(110_00, 6_00, false)], 109_00, 0)).toBe(110_00 - 0 + (12_00 - 2_00) - 10_00);
    expect(parityForward([q(100_00, 12_00, false)], [q(100_00, 2_00)], 100_00, 0)).toBeNull();
  });

  it('refuses bad input and a non-trading entry day', async () => {
    await expect(simulatePosition({ ...straddle, legs: [] }, data)).rejects.toThrow(SimError);
    await expect(simulatePosition({ ...straddle, entryDate: '2026-10-24' }, data)).rejects.toThrow(/No NSE F&O data/);
    await expect(simulatePosition({ ...straddle, legs: [{ ...straddle.legs[0], strikePaise: 22650_00 }] }, data)).rejects.toThrow(/not in NSE's file/);
  });
});
