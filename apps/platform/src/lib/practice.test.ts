import { describe, expect, it } from 'vitest';
import { position } from './practice';

describe('practice position', () => {
  it('averages entries and books P&L on exits', () => {
    const p = position([{ qty: 10, price: 100, time: 1 }, { qty: 10, price: 110, time: 2 }, { qty: -5, price: 120, time: 3 }], 115);
    expect(p).toEqual({ qty: 15, avg: 105, booked: 75, open: 150 });
  });
  it('flips from long to short at the fill price', () => {
    const p = position([{ qty: 5, price: 100, time: 1 }, { qty: -8, price: 90, time: 2 }], 95);
    expect(p).toEqual({ qty: -3, avg: 90, booked: -50, open: -15 });
  });
  it('flat after a round trip', () => {
    expect(position([{ qty: -2, price: 50, time: 1 }, { qty: 2, price: 40, time: 2 }], 45)).toEqual({ qty: 0, avg: 0, booked: 20, open: 0 });
  });
});
