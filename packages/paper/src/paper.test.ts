import { describe, expect, it } from 'vitest';
import { applyRate, buildLedger, computeCharges, computeOptionCharges, evaluate, exerciseStt, formatRupees, funds, toPaise, unrealisedPaise, validateOrder, type Trade } from './index';

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

describe('charges (hand-calculated)', () => {
  it('delivery buy: 100 × ₹1,000', () => {
    // turnover ₹1,00,000 · STT 0.1% ₹100 · exch 0.00297% ₹2.97 · SEBI ₹0.10 · stamp 0.015% ₹15
    // GST 18% × (0 + 2.97 + 0.10) = ₹0.5526 -> ₹0.55 · total ₹118.62
    expect(computeCharges({ side: 'BUY', product: 'CNC', qty: 100, pricePaise: 1000_00 })).toEqual({
      brokerage: 0, stt: 100_00, exchangeTxn: 297, sebiFee: 10, stampDuty: 15_00, gst: 55, dpCharge: 0, total: 118_62,
    });
  });
  it('intraday sell: 100 × ₹1,000 (brokerage capped at ₹20)', () => {
    // brokerage min(0.03% = ₹30, ₹20) = ₹20 · STT 0.025% ₹25 · exch ₹2.97 · SEBI ₹0.10 · no stamp on sell
    // GST 18% × (20 + 2.97 + 0.10) = ₹4.1526 -> ₹4.15 · total ₹52.22
    expect(computeCharges({ side: 'SELL', product: 'MIS', qty: 100, pricePaise: 1000_00 })).toEqual({
      brokerage: 20_00, stt: 25_00, exchangeTxn: 297, sebiFee: 10, stampDuty: 0, gst: 415, dpCharge: 0, total: 52_22,
    });
  });
  it('small intraday buy: 10 × ₹100 (percentage brokerage below the cap)', () => {
    // turnover ₹1,000 · brokerage 0.03% ₹0.30 · exch ₹0.0297 -> ₹0.03 · SEBI ₹0.001 -> ₹0.00 · stamp 0.003% ₹0.03
    // GST 18% × (0.30 + 0.03 + 0) = ₹0.0594 -> ₹0.06 · total ₹0.42
    expect(computeCharges({ side: 'BUY', product: 'MIS', qty: 10, pricePaise: 100_00 }).total).toBe(42);
  });
  it('adds the DP charge only on the first delivery sell of a scrip in a day', () => {
    const base = { side: 'SELL', product: 'CNC', qty: 10, pricePaise: 100_00 } as const;
    expect(computeCharges({ ...base, firstDeliverySellToday: true }).dpCharge).toBe(15_34);
    expect(computeCharges(base).dpCharge).toBe(0);
  });
});

describe('option charges (hand-calculated)', () => {
  it('sell 65 NIFTY PE @ ₹121.35', () => {
    // turnover ₹7,887.75 · brokerage ₹20 · STT 0.1% ₹7.88775 -> ₹7.89 · exch 0.03503% ₹2.7631 -> ₹2.76
    // SEBI ₹0.0079 -> ₹0.01 · no stamp on sell · GST 18% × (20 + 2.76 + 0.01) = ₹4.0986 -> ₹4.10 · total ₹34.76
    expect(computeOptionCharges({ side: 'SELL', qty: 65, premiumPaise: 121_35 })).toEqual({
      brokerage: 20_00, stt: 789, exchangeTxn: 276, sebiFee: 1, stampDuty: 0, gst: 410, dpCharge: 0, total: 34_76,
    });
  });
  it('buy 65 NIFTY CE @ ₹120.50', () => {
    // turnover ₹7,832.50 · brokerage ₹20 · no STT on buy · exch ₹2.7437 -> ₹2.74 · SEBI ₹0.01 · stamp 0.003% ₹0.2350 -> ₹0.23
    // GST 18% × (20 + 2.74 + 0.01) = ₹4.095 -> ₹4.10 (half-up) · total ₹27.08
    expect(computeOptionCharges({ side: 'BUY', qty: 65, premiumPaise: 120_50 }).total).toBe(27_08);
  });
  it('STT on exercise: 0.125% of intrinsic value, nothing when out of the money', () => {
    expect(exerciseStt(65, 150_00)).toBe(1219); // 65 × ₹150 = ₹9,750 × 0.125% = ₹12.1875 -> ₹12.19
    expect(exerciseStt(65, 0)).toBe(0);
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
