import { describe, expect, it } from 'vitest';
import { applyRate, brokerById, buildLedger, computeCharges, computeFuturesCharges, computeOptionCharges, evaluate, exerciseStt, expirySettlementCharges, formatRupees, funds, toPaise, unrealisedPaise, validateOrder, type Trade } from './index';

describe('money', () => {
  it('parses rupees to integer paise without float error', () => {
    expect(toPaise('0.1') + toPaise('0.2')).toBe(toPaise('0.3'));
    expect(toPaise(1201.8)).toBe(120180);
    expect(toPaise('22753.20')).toBe(2275320);
    expect(toPaise(-5.5)).toBe(-550);
  });
  it('refuses amounts with sub-paisa precision instead of silently rounding', () => {
    expect(() => toPaise('10.005')).toThrow(/two decimals/);
    expect(() => toPaise('abc')).toThrow();
  });
  it('applies rates exactly, half-up to the paisa, even for very large orders', () => {
    expect(applyRate(1_00_000_00, 0.0000297)).toBe(297); // ₹1,00,000 × 0.00297% = ₹2.97
    expect(applyRate(307, 0.18)).toBe(55); // 55.26 -> 55
    expect(applyRate(250, 0.18)).toBe(45); // 45.0
    expect(applyRate(25, 0.1)).toBe(3); // 2.5 -> 3 (half-up)
    expect(applyRate(1_000_000_000_000_00, 0.001)).toBe(1_000_000_000_00); // ₹1 lakh crore × 0.1%, beyond float-safe products
  });
  it('formats rupees with Indian grouping', () => {
    expect(formatRupees(1_00_00_000_00)).toBe('₹1,00,00,000.00');
    expect(formatRupees(-5222)).toBe('−₹52.22');
  });
});

describe('charges (hand-calculated, 2025 schedule: IPFT ₹10/crore, old exchange rates)', () => {
  const date = '2025-06-02';
  it('delivery buy: 100 × ₹1,000', () => {
    // turnover ₹1,00,000 · STT 0.1% ₹100 · exch 0.00297% ₹2.97 · IPFT ₹0.10 · SEBI ₹0.10 · stamp 0.015% ₹15
    // GST 18% × (0 + 2.97 + 0.10 + 0.10) = ₹0.5706 -> ₹0.57 · total ₹118.74
    expect(computeCharges({ side: 'BUY', product: 'CNC', qty: 100, pricePaise: 1000_00, date })).toEqual({
      brokerage: 0, stt: 100_00, exchangeTxn: 297, ipft: 10, sebiFee: 10, stampDuty: 15_00, gst: 57, dpCharge: 0, total: 118_74,
    });
  });
  it('intraday sell: 100 × ₹1,000 (brokerage capped at ₹20)', () => {
    // brokerage min(0.03% = ₹30, ₹20) = ₹20 · STT 0.025% ₹25 · exch ₹2.97 · IPFT ₹0.10 · SEBI ₹0.10 · no stamp on sell
    // GST 18% × (20 + 2.97 + 0.10 + 0.10) = ₹4.1706 -> ₹4.17 · total ₹52.34
    expect(computeCharges({ side: 'SELL', product: 'MIS', qty: 100, pricePaise: 1000_00, date })).toEqual({
      brokerage: 20_00, stt: 25_00, exchangeTxn: 297, ipft: 10, sebiFee: 10, stampDuty: 0, gst: 417, dpCharge: 0, total: 52_34,
    });
  });
  it('small intraday buy: 10 × ₹100 (percentage brokerage below the cap)', () => {
    // turnover ₹1,000 · brokerage 0.03% ₹0.30 · exch ₹0.0297 -> ₹0.03 · IPFT, SEBI round to 0 · stamp 0.003% ₹0.03
    // GST 18% × (0.30 + 0.03) = ₹0.0594 -> ₹0.06 · total ₹0.42
    expect(computeCharges({ side: 'BUY', product: 'MIS', qty: 10, pricePaise: 100_00, date }).total).toBe(42);
  });
  it('adds the DP charge only on the first delivery sell of a scrip in a day', () => {
    const base = { side: 'SELL', product: 'CNC', qty: 10, pricePaise: 100_00, date } as const;
    expect(computeCharges({ ...base, firstDeliverySellToday: true }).dpCharge).toBe(15_34);
    expect(computeCharges(base).dpCharge).toBe(0);
  });
});

describe('option charges (hand-calculated, 2025 schedule)', () => {
  const date = '2025-06-02';
  it('sell 65 NIFTY PE @ ₹121.35', () => {
    // turnover ₹7,887.75 · brokerage ₹20 · STT 0.1% ₹7.88775 -> ₹7.89 · exch 0.03503% ₹2.7631 -> ₹2.76
    // IPFT ₹0.0079 -> ₹0.01 · SEBI ₹0.01 · GST 18% × (20 + 2.76 + 0.01 + 0.01) = ₹4.1004 -> ₹4.10 · total ₹34.77
    expect(computeOptionCharges({ side: 'SELL', qty: 65, premiumPaise: 121_35, date })).toEqual({
      brokerage: 20_00, stt: 789, exchangeTxn: 276, ipft: 1, sebiFee: 1, stampDuty: 0, gst: 410, dpCharge: 0, total: 34_77,
    });
  });
  it('buy 65 NIFTY CE @ ₹120.50', () => {
    // turnover ₹7,832.50 · brokerage ₹20 · exch ₹2.7437 -> ₹2.74 · IPFT ₹0.01 · SEBI ₹0.01 · stamp 0.003% ₹0.2350 -> ₹0.23
    // GST 18% × (20 + 2.74 + 0.01 + 0.01) = ₹4.0968 -> ₹4.10 · total ₹27.09
    expect(computeOptionCharges({ side: 'BUY', qty: 65, premiumPaise: 120_50, date }).total).toBe(27_09);
  });
  it('STT on exercise: 0.125% of intrinsic value, nothing when out of the money', () => {
    expect(exerciseStt(65, 150_00, date)).toBe(1219); // 65 × ₹150 = ₹9,750 × 0.125% = ₹12.1875 -> ₹12.19
    expect(exerciseStt(65, 0, date)).toBe(0);
  });
});

describe('charges from 1 Apr 2026 (Finance Act 2026 STT; NSE rates from 1 Mar 2026)', () => {
  const date = '2026-10-27';
  it('sell 65 NIFTY PE @ ₹121.35: STT 0.15% of premium', () => {
    // turnover ₹7,887.75 · brokerage ₹20 · STT 0.15% ₹11.8316 -> ₹11.83 · exch 0.03553% ₹2.8025 -> ₹2.80
    // IPFT ₹0.01/crore -> ₹0.00 · SEBI ₹0.01 · GST 18% × (20 + 2.80 + 0 + 0.01) = ₹4.1058 -> ₹4.11 · total ₹38.75
    expect(computeOptionCharges({ side: 'SELL', qty: 65, premiumPaise: 121_35, date })).toEqual({
      brokerage: 20_00, stt: 11_83, exchangeTxn: 280, ipft: 0, sebiFee: 1, stampDuty: 0, gst: 411, dpCharge: 0, total: 38_75,
    });
  });
  it('sell 65 NIFTY futures @ ₹25,000: STT 0.05%, and the rate switches exactly on 1 Apr 2026', () => {
    // turnover ₹16,25,000 · brokerage min(0.03% = ₹487.50, ₹20) = ₹20 · STT 0.05% ₹812.50 · exch 0.00183% ₹29.7375 -> ₹29.74
    // SEBI ₹1.625 -> ₹1.63 · GST 18% × (20 + 29.74 + 1.63) = ₹9.2466 -> ₹9.25 · total ₹873.12
    const o = { side: 'SELL', qty: 65, pricePaise: 25_000_00 } as const;
    expect(computeFuturesCharges({ ...o, date: '2026-04-01' })).toEqual({
      brokerage: 20_00, stt: 812_50, exchangeTxn: 29_74, ipft: 0, sebiFee: 163, stampDuty: 0, gst: 925, dpCharge: 0, total: 873_12,
    });
    expect(computeFuturesCharges({ ...o, date: '2026-03-31' }).stt).toBe(325_00); // 0.02% the day before
  });
  it('buy futures pays 0.002% stamp duty and no STT', () => {
    const c = computeFuturesCharges({ side: 'BUY', qty: 65, pricePaise: 25_000_00, date });
    expect(c.stt).toBe(0);
    expect(c.stampDuty).toBe(32_50);
  });
  it('exercise STT is 0.15% of intrinsic value', () => {
    expect(exerciseStt(65, 150_00, date)).toBe(14_63); // ₹9,750 × 0.15% = ₹14.625 -> ₹14.63
  });
});

describe('broker profiles', () => {
  it('Angel One delivery: lower of ₹20 or 0.1%, at least ₹5', () => {
    const angel = brokerById('angelone');
    expect(computeCharges({ side: 'BUY', product: 'CNC', qty: 1, pricePaise: 100_00, broker: angel }).brokerage).toBe(5_00);
    expect(computeCharges({ side: 'BUY', product: 'CNC', qty: 100, pricePaise: 100_00, broker: angel }).brokerage).toBe(10_00);
    expect(computeCharges({ side: 'BUY', product: 'CNC', qty: 100, pricePaise: 1000_00, broker: angel }).brokerage).toBe(20_00);
  });
  it('Upstox futures: lower of ₹20 or 0.05%', () => {
    expect(computeFuturesCharges({ side: 'BUY', qty: 1, pricePaise: 100_00, broker: brokerById('upstox') }).brokerage).toBe(5);
  });
  it('expiry settlement: exercise STT for a long ITM option, plus brokerage + GST where the broker charges it', () => {
    const date = '2026-10-27';
    expect(expirySettlementCharges({ side: 'BUY', qty: 65, intrinsicPaise: 150_00, date })).toBe(14_63); // Zerodha: STT only
    expect(expirySettlementCharges({ side: 'BUY', qty: 65, intrinsicPaise: 150_00, date, broker: brokerById('dhan') })).toBe(14_63 + 20_00 + 3_60);
    expect(expirySettlementCharges({ side: 'SELL', qty: 65, intrinsicPaise: 150_00, date, broker: brokerById('dhan') })).toBe(23_60); // assigned: no STT
    expect(expirySettlementCharges({ side: 'BUY', qty: 65, intrinsicPaise: 0, date, broker: brokerById('dhan') })).toBe(0);
  });
  it('unknown broker ids fall back to the default profile', () => {
    expect(brokerById('nope').id).toBe('zerodha');
  });
});

const trade = (id: string, side: 'BUY' | 'SELL', qty: number, rupees: number, extra: Partial<Trade> = {}): Trade => ({
  id, orderId: id, symbol: 'RELIANCE', product: 'MIS', side, qty, pricePaise: toPaise(rupees), chargesPaise: 0, time: Number(id), tradeDate: '2026-10-26', ...extra,
});

describe('ledger (FIFO, exact paise)', () => {
  it('realises P&L first-in-first-out and keeps the cost of the remaining lots', () => {
    // buy 10 @ 100, buy 10 @ 110, sell 15 @ 120 -> realised (120-100)×10 + (120-110)×5 = 250; open 5 @ 110
    const l = buildLedger([trade('1', 'BUY', 10, 100), trade('2', 'BUY', 10, 110), trade('3', 'SELL', 15, 120)], toPaise(10000));
    const p = l.positions[0];
    expect(p.qty).toBe(5);
    expect(p.realisedPaise).toBe(250_00);
    expect(p.openCostPaise).toBe(550_00);
    expect(unrealisedPaise(p, toPaise(115))).toBe(25_00);
    expect(l.cashPaise).toBe(toPaise(10000 - 1000 - 1100 + 1800));
  });
  it('handles intraday shorts and flips from short to long', () => {
    // sell 10 @ 200 (short), buy 15 @ 190 -> covers 10 for +100, opens long 5 @ 190
    const l = buildLedger([trade('1', 'SELL', 10, 200), trade('2', 'BUY', 15, 190)], toPaise(10000));
    expect(l.positions[0]).toMatchObject({ qty: 5, realisedPaise: 100_00, openCostPaise: 950_00 });
  });
  it('deducts charges from cash and reports them', () => {
    const l = buildLedger([trade('1', 'BUY', 1, 100, { chargesPaise: 42 })], toPaise(1000));
    expect(l.cashPaise).toBe(toPaise(900) - 42);
    expect(l.chargesPaise).toBe(42);
  });
  it('keeps CNC and MIS positions in the same symbol separate', () => {
    const l = buildLedger([trade('1', 'BUY', 5, 100, { product: 'CNC' }), trade('2', 'SELL', 5, 101)], toPaise(10000));
    expect(l.positions.map((p) => [p.product, p.qty])).toEqual([['CNC', 5], ['MIS', -5]]);
  });
  it('stays exact over many fractional-rupee trades', () => {
    const trades = Array.from({ length: 1000 }, (_, i) => trade(String(i + 1), i % 2 ? 'SELL' : 'BUY', 1, 0.1 + (i % 2) * 0.2));
    // 500 round trips, each buy ₹0.10 sell ₹0.30 -> +₹0.20 each = ₹100.00 exactly
    expect(buildLedger(trades, 0).realisedPaise).toBe(100_00);
  });
  it('rejects corrupt trades instead of producing wrong balances', () => {
    expect(() => buildLedger([trade('1', 'BUY', 0, 100)], 0)).toThrow(/Corrupt/);
  });
});

describe('funds (1× margin)', () => {
  it('long: full value used; available = equity − used', () => {
    const l = buildLedger([trade('1', 'BUY', 10, 100)], toPaise(10000));
    const f = funds(l, () => toPaise(110), 0);
    expect(f).toEqual({ equityPaise: toPaise(10100), usedPaise: toPaise(1100), blockedPaise: 0, availablePaise: toPaise(9000), unrealisedPaise: toPaise(100) });
  });
  it('short: margin equal to position value is blocked', () => {
    const l = buildLedger([trade('1', 'SELL', 10, 100)], toPaise(10000));
    const f = funds(l, () => toPaise(100), toPaise(500));
    expect(f.equityPaise).toBe(toPaise(10000));
    expect(f.availablePaise).toBe(toPaise(10000 - 1000 - 500));
  });
});

describe('matching', () => {
  const p = toPaise;
  it('market orders fill at the LTP', () => {
    expect(evaluate({ side: 'BUY', type: 'MARKET', triggered: false }, p(100), true)).toEqual({ action: 'fill', pricePaise: p(100) });
  });
  it('a new marketable limit fills at the better LTP; a resting limit fills at its own price', () => {
    const buy = { side: 'BUY', type: 'LIMIT', pricePaise: p(105), triggered: false } as const;
    expect(evaluate(buy, p(100), true)).toEqual({ action: 'fill', pricePaise: p(100) });
    expect(evaluate(buy, p(100), false)).toEqual({ action: 'fill', pricePaise: p(105) });
    expect(evaluate(buy, p(106), false)).toEqual({ action: 'wait' });
    const sell = { side: 'SELL', type: 'LIMIT', pricePaise: p(105), triggered: false } as const;
    expect(evaluate(sell, p(104.95), false)).toEqual({ action: 'wait' });
    expect(evaluate(sell, p(105), false)).toEqual({ action: 'fill', pricePaise: p(105) });
  });
  it('stop orders trigger on the trigger price, then behave as limit or market', () => {
    const sl = { side: 'SELL', type: 'SL', triggerPaise: p(95), pricePaise: p(94), triggered: false } as const;
    expect(evaluate(sl, p(96), false)).toEqual({ action: 'wait' });
    expect(evaluate(sl, p(95), false)).toEqual({ action: 'trigger' });
    expect(evaluate({ ...sl, triggered: true }, p(94.5), true)).toEqual({ action: 'fill', pricePaise: p(94.5) });
    expect(evaluate({ ...sl, triggered: true }, p(93), false)).toEqual({ action: 'wait' }); // gapped below the limit
    expect(evaluate({ side: 'BUY', type: 'SLM', triggerPaise: p(105), triggered: true }, p(106), true)).toEqual({ action: 'fill', pricePaise: p(106) });
  });
  it('validates orders like an exchange front-end', () => {
    expect(validateOrder({ side: 'BUY', type: 'MARKET', qty: 0 }, p(100))).toMatch(/Quantity/);
    expect(validateOrder({ side: 'BUY', type: 'MARKET', qty: 1.5 }, p(100))).toMatch(/Quantity/);
    expect(validateOrder({ side: 'BUY', type: 'SLM', qty: 1, triggerPaise: p(99) }, p(100))).toMatch(/above/);
    expect(validateOrder({ side: 'SELL', type: 'SL', qty: 1, triggerPaise: p(95), pricePaise: p(96) }, p(100))).toMatch(/at or below/);
    expect(validateOrder({ side: 'BUY', type: 'LIMIT', qty: 10, pricePaise: p(99.5) }, p(100))).toBeNull();
  });
});
