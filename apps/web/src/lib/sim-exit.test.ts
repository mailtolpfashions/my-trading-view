import { describe, expect, it } from 'vitest';
import type { SimResult } from './options';
import { firstExit } from './sim-exit';

const run = (nets: number[]): SimResult => ({
  underlying: 'NIFTY', entryDate: '2026-10-01', lotSize: 65, legs: [], entryChargesPaise: 0, end: 'expired', notes: [],
  days: nets.map((n, i) => ({ date: `2026-10-0${i + 1}`, spotPaise: null, legs: [], grossPaise: 0, chargesIfExitPaise: 0, netIfExitPaise: n * 100, delta: 0, theta: 0, vega: 0, gamma: 0, greeksMissing: 0, openLegs: 1 })),
});

describe('simulator exit rules', () => {
  it('fires the first rule after the entry day, at that day’s close', () => {
    const r = run([-200, -500, -1500, 3000]); // rupees after charges, day by day
    expect(firstExit(r, { stopLoss: 1000, target: 2500, exitDate: null })).toEqual({ idx: 2, reason: 'Stop loss' });
    expect(firstExit(r, { stopLoss: null, target: 2500, exitDate: null })).toEqual({ idx: 3, reason: 'Target' });
  });
  it('ignores the entry day and puts the exit date first on its day', () => {
    const r = run([-5000, 100, -2000]);
    expect(firstExit(r, { stopLoss: 1000, target: null, exitDate: null })).toEqual({ idx: 2, reason: 'Stop loss' });
    expect(firstExit(r, { stopLoss: 1000, target: null, exitDate: '2026-10-03' })).toEqual({ idx: 2, reason: 'Exit date' });
  });
  it('returns null when nothing fires', () => {
    expect(firstExit(run([0, 10, 20]), { stopLoss: 1000, target: 5000, exitDate: null })).toBeNull();
  });
});
