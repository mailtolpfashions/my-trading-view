import { describe, expect, it } from 'vitest';
import { computeOptionCharges } from '@mtv/paper';
import type { MarketSnapshot } from '@mtv/options';
import type { SellingPaperTrade } from '../user/store';
import { closeTrade } from './plan';

const LOT = 65, D = '2026-12-08';
const trade = (): SellingPaperTrade => ({
  id: 'x', openedOn: '2026-11-16', expiry: '2026-12-29', exitOn: D, spotPaise: 24000_00, creditPaise: 0, chargesPaise: 500_00, status: 'open',
  closedOn: null, why: null, netPaise: null, lastMarkOn: D, lastPnlPaise: 0,
  legs: [
    { expiry: '2026-12-29', strikePaise: 25000_00, kind: 'CE', side: 'SELL', qty: LOT, entryPaise: 100_00, role: 'short' },
    { expiry: '2026-12-29', strikePaise: 22500_00, kind: 'PE', side: 'SELL', qty: LOT, entryPaise: 130_00, role: 'short' },
    { expiry: '2026-12-29', strikePaise: 20200_00, kind: 'PE', side: 'BUY', qty: LOT, entryPaise: 32_00, role: 'wing' },
  ],
});
const prices: Record<number, number> = { 25000_00: 40_00, 22500_00: 60_00, 20200_00: 10_00 };
const market = { date: D, quote: (l: { strikePaise: number }) => ({ strikePaise: l.strikePaise, pricePaise: prices[l.strikePaise], traded: true }) } as unknown as MarketSnapshot;

describe('closing a paper trade', () => {
  it('books each leg at the close with ₹1 against us, and adds the closing charges', () => {
    const t = closeTrade(trade(), market, { type: 'exit', reason: 'time', why: '21 days left' });
    const buy = (p: number) => computeOptionCharges({ side: 'BUY', qty: LOT, premiumPaise: p, date: D }).total;
    const sell = (p: number) => computeOptionCharges({ side: 'SELL', qty: LOT, premiumPaise: p, date: D }).total;
    const gross = LOT * ((100 - 41) + (130 - 61) + (9 - 32)) * 100; // shorts bought back ₹1 higher, the put sold ₹1 lower
    const charges = 500_00 + buy(41_00) + buy(61_00) + sell(9_00);
    expect(t.status).toBe('closed');
    expect(t.closedOn).toBe(D);
    expect(t.chargesPaise).toBe(charges);
    expect(t.netPaise).toBe(gross - charges);
  });
});
