import { describe, expect, it } from 'vitest';
import { DEFAULT_PIVOT_CFG, newSim, pivotLevels, stepSim, type Level, type Point } from './pivot-core';

const lv = (pairs: [string, number][]): Level[] => pairs.map(([name, r]) => ({ name, paise: r * 100 }));
// minute 600 = 10:00
const bar = (minute: number, o: number, h: number, l: number, c: number, spread = 0): Point =>
  ({ time: minute * 60, minute, open: o * 100, high: h * 100, low: l * 100, last: c * 100, bid: (c - spread / 2) * 100, ask: (c + spread / 2) * 100, tick: false });
const tick = (minute: number, px: number, bid = px, ask = px): Point => ({ time: minute * 60, minute, open: px * 100, high: px * 100, low: px * 100, last: px * 100, bid: bid * 100, ask: ask * 100, tick: true });

describe('pivotLevels (TradingView Traditional)', () => {
  it('matches the hand-worked 25900 CE levels from 20 Nov (H 76.8, L 7.8, C 63.8)', () => {
    const m = Object.fromEntries(pivotLevels(7680, 780, 6380).map((x) => [x.name, x.paise / 100]));
    expect(m).toMatchObject({ S1: 22.13, P: 49.47, R1: 91.13, R2: 118.47, R3: 160.13, R4: 201.8, R5: 243.47 });
    expect(m.S2).toBeUndefined(); // below zero: dropped
  });
});

describe('fixed version: +15 / -20', () => {
  const L = lv([['P', 50], ['R1', 90], ['R2', 120]]);
  it('buys at the cross of a level and takes the target', () => {
    const s = newSim('fixed');
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(600, 85, 88, 84, 87));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(601, 88, 92, 87, 91)); // crosses 90: buy at 90
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(602, 91, 106, 90, 104)); // 105 reached
    expect(s.trades).toEqual([expect.objectContaining({ level: 'R1', entryPaise: 9000, exitPaise: 10500, why: 'target' })]);
  });
  it('a bar touching both stop and target counts as the stop', () => {
    const s = newSim('fixed');
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(600, 85, 88, 84, 87));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(601, 88, 92, 87, 91));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(602, 91, 110, 65, 80));
    expect(s.trades[0]).toMatchObject({ exitPaise: 7000, why: 'stop' });
  });
  it('no entry before 09:30 or from 15:00; open trades are sold at 15:00', () => {
    const s = newSim('fixed');
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(565, 85, 88, 84, 87));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(566, 88, 92, 87, 91)); // 09:26: too early
    expect(s.open).toBeNull();
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(890, 85, 88, 84, 87));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(891, 88, 92, 87, 91)); // 14:51: buy at 90
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(900, 95, 96, 94, 95)); // 15:00: out at the close
    expect(s.trades[0]).toMatchObject({ entryPaise: 9000, exitPaise: 9500, why: 'time' });
  });
  it('needs a fresh cross for the next trade', () => {
    const s = newSim('fixed');
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(600, 85, 88, 84, 87));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(601, 88, 92, 87, 91));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(602, 91, 106, 90, 104)); // target
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(603, 104, 108, 100, 101)); // above 90 all along: no new cross
    expect(s.open).toBeNull();
  });
});

describe('ladder version', () => {
  const L = lv([['S1', 30], ['P', 50], ['R1', 90], ['R2', 120], ['R3', 150]]);
  it('stop starts one level below; T1 moves it to the entry level, T2 to T1', () => {
    const s = newSim('ladder');
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(600, 45, 48, 44, 47));
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(601, 48, 52, 47, 51)); // buy at 50 (P), stop 30
    expect(s.open).toMatchObject({ entryPaise: 5000, stopPaise: 3000 });
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(602, 51, 95, 50, 93)); // T1 (90): stop 50
    expect(s.open?.stopPaise).toBe(5000);
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(603, 93, 125, 92, 118)); // T2 (120): stop 90
    expect(s.open?.stopPaise).toBe(9000);
    stepSim(s, L, DEFAULT_PIVOT_CFG, bar(604, 118, 119, 85, 86)); // back to 90: out at 90
    expect(s.trades[0]).toMatchObject({ entryPaise: 5000, exitPaise: 9000, why: 'trail', reached: 'R2' });
  });
  it('live ticks buy at the ask and sell at the bid', () => {
    const s = newSim('ladder');
    stepSim(s, L, DEFAULT_PIVOT_CFG, tick(600, 49, 48.9, 49.1));
    stepSim(s, L, DEFAULT_PIVOT_CFG, tick(600, 50.5, 50.4, 50.6));
    expect(s.open?.entryPaise).toBe(5060);
    stepSim(s, L, DEFAULT_PIVOT_CFG, tick(601, 29.5, 29.4, 29.6));
    expect(s.trades[0]).toMatchObject({ exitPaise: 2940, why: 'stop' });
  });
});
