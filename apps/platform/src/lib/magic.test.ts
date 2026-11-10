import { describe, expect, it } from 'vitest';
import { parseFormula } from '@mtv/rules';
import { MAGIC_EXAMPLES, readMagic } from './magic';

describe('magic filters', () => {
  it('reads every example shown under the box into valid conditions', () => {
    for (const x of MAGIC_EXAMPLES) {
      const r = readMagic(x);
      expect(r.ok, x).toBe(true);
      if (r.ok) for (const c of r.conditions) expect(parseFormula(c).ok, c).toBe(true);
    }
  });
  it('reads a written comparison with its own timeframes, Chartink style', () => {
    expect(readMagic('5-minute volume > 2 x 5-minute SMA(volume, 10)')).toMatchObject({ ok: true, conditions: ['[5m] VOLUME > 2 * [5m] SMA(VOLUME, 10)'] });
    expect(readMagic('daily rsi(14) crossed above 60')).toMatchObject({ ok: true, conditions: ['CROSSOVER([D] RSI(CLOSE, 14), 60)'] });
    expect(readMagic('monthly close > monthly open')).toMatchObject({ ok: true, conditions: ['[M] CLOSE > [M] OPEN'] }); // monthly stays monthly
  });
  it('turns phrases into the conditions they stand for', () => {
    expect(readMagic('latest close between 100 and 2000')).toMatchObject({ ok: true, conditions: ['CLOSE >= 100', 'CLOSE <= 2000'] });
    expect(readMagic('2 green candles on 15 min')).toMatchObject({ ok: true, conditions: ['[15m] CLOSE > [15m] OPEN', '[15m] CLOSE[1] > [15m] OPEN[1]'] });
    expect(readMagic('hammer on daily')).toMatchObject({ ok: true, conditions: ['[D] HAMMER'] });
  });
  it('says so when it does not understand, and never guesses', () => {
    expect(readMagic('stocks my friend likes').ok).toBe(false);
    expect(readMagic('').ok).toBe(false);
  });
});
