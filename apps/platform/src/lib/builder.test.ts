import { describe, expect, it } from 'vitest';
import { parseFormula } from '@mtv/rules';
import { addTo, duplicateItem, fromComparison, fromTree, group, leaf, mapItem, moveItem, reading, setAllJoins, setJoin, toComparison, toTree, type Group } from './builder';

const canon = (f: string) => {
  const p = parseFormula(f);
  if (!p.ok) throw new Error(p.error);
  return p.formula;
};
const round = (f: string) => fromTree(toTree(f)!);
const texts = (g: Group) => g.children.map((c) => (c.kind === 'leaf' ? c.text : `[${c.children.length}]`));

describe('visual builder tree', () => {
  it('round-trips formulas without changing meaning or grouping', () => {
    for (const f of [
      'RSI(14) > 50 AND [W] (RSI(CLOSE, 14) > 60) AND [M] (RSI(CLOSE, 14) > 70)',
      'CLOSE > EMA(CLOSE, 50) AND RSI(CLOSE, 14) > 55 AND (CROSSOVER(MACD_LINE, MACD_SIGNAL) OR SUPERTREND_DIR(10, 3) = 1)',
      'NOT INSIDE_BAR AND (CLOSE > OPEN OR NOT (VOLUME > 1000 AND CLOSE > 10))',
      'BULLISH_ENGULFING',
      '(CLOSE > 1 AND OPEN > 1) AND HIGH > 1',
      'CLOSE > 1 AND OPEN > 1 OR HIGH > 1 AND LOW > 1 OR VOLUME > 1',
      'NOT (CLOSE > 1 OR OPEN > 1)',
    ]) expect(round(f), f).toBe(canon(f));
  });

  it('shows AND-before-OR runs as one list with a join per row; brackets only where needed', () => {
    const t = toTree('CLOSE > 1 AND OPEN > 1 OR HIGH > 1')!;
    expect(texts(t)).toEqual(['CLOSE > 1', 'OPEN > 1', 'HIGH > 1']);
    expect(t.joins).toEqual(['AND', 'OR']);
    expect(reading(t)).toBe('(1 AND 2) OR 3');
    const b = toTree('CLOSE > 1 AND (OPEN > 1 OR HIGH > 1)')!;
    expect(texts(b)).toEqual(['CLOSE > 1', '[2]']);
    expect(reading(b)).toBeNull();
  });

  it('a join changed in the list changes the formula by the AND-first rule', () => {
    let t = toTree('CLOSE > 1 AND OPEN > 1 AND HIGH > 1')!;
    t = setJoin(t, t.id, 1, 'OR');
    expect(fromTree(t)).toBe('CLOSE > 1 AND OPEN > 1 OR HIGH > 1');
    t = setJoin(t, t.id, 0, 'OR');
    t = setJoin(t, t.id, 1, 'AND');
    expect(fromTree(t)).toBe('CLOSE > 1 OR OPEN > 1 AND HIGH > 1');
    expect(reading(t)).toBe('1 OR (2 AND 3)');
    expect(fromTree(setAllJoins(t, t.id, 'OR'))).toBe('CLOSE > 1 OR OPEN > 1 OR HIGH > 1');
  });

  it('gives each condition its timeframe, and keeps a mixed one as written', () => {
    const t = toTree('RSI(14) > 50 AND [W] RSI(14) > 60 AND CLOSE > [W] HIGH[1]')!;
    expect(t.children.map((c) => (c.kind === 'leaf' ? [c.tf, c.text] : null))).toEqual([
      [null, 'RSI(CLOSE, 14) > 50'], ['W', 'RSI(CLOSE, 14) > 60'], ['mixed', 'CLOSE > [W] HIGH[1]'],
    ]);
  });

  it('puts a whole row on its timeframe, and is stable', () => {
    const f = 'CLOSE > [W] HIGH[1] AND [W] RSI(14) > 60';
    expect(round(f)).toBe('CLOSE > [W] HIGH[1] AND [W] (RSI(CLOSE, 14) > 60)');
    expect(round(round(f))).toBe(round(f));
  });

  it('nests groups, negates, moves, duplicates and removes, keeping the joins in step', () => {
    let t: Group = toTree('CLOSE > 1 AND OPEN > 1')!;
    const inner = { ...group([leaf('HIGH > 1'), leaf('LOW > 1')], 'OR'), id: 'g1' };
    t = addTo(t, t.id, inner);
    expect(fromTree(t)).toBe('CLOSE > 1 AND OPEN > 1 AND (HIGH > 1 OR LOW > 1)');
    t = mapItem(t, 'g1', (g) => ({ ...g, not: true }));
    expect(fromTree(t)).toBe('CLOSE > 1 AND OPEN > 1 AND NOT (HIGH > 1 OR LOW > 1)');
    t = moveItem(t, 'g1', -1);
    expect(fromTree(t)).toBe('CLOSE > 1 AND NOT (HIGH > 1 OR LOW > 1) AND OPEN > 1');
    const first = t.children[0].id;
    t = setJoin(t, t.id, 0, 'OR');
    t = duplicateItem(t, first);
    expect(t.joins).toEqual(['AND', 'OR', 'AND']);
    t = mapItem(t, first, () => null);
    expect(t.children).toHaveLength(3);
    expect(t.joins).toEqual(['OR', 'AND']);
    expect(fromTree(t)).toBe('CLOSE > 1 OR NOT (HIGH > 1 OR LOW > 1) AND OPEN > 1');
  });

  it('skips empty conditions and groups, and changes a leaf\'s timeframe', () => {
    let t = toTree('RSI(14) > 50')!;
    t = addTo(t, t.id, leaf(''));
    t = addTo(t, t.id, group());
    expect(fromTree(t)).toBe('RSI(CLOSE, 14) > 50');
    t = mapItem(t, t.children[0].id, (l) => ({ ...l, tf: 'M' } as typeof l));
    expect(fromTree(t)).toBe('[M] (RSI(CLOSE, 14) > 50)');
  });
});

describe('comparison rows', () => {
  it('splits comparisons and crossings into value / operator / value and back', () => {
    expect(toComparison('RSI(14) > 55')).toEqual({ left: 'RSI(CLOSE, 14)', op: '>', right: '55' });
    expect(toComparison('CROSSOVER(EMA(CLOSE, 9), EMA(CLOSE, 21))')).toEqual({ left: 'EMA(CLOSE, 9)', op: 'crosses above', right: 'EMA(CLOSE, 21)' });
    expect(toComparison('BULLISH_ENGULFING')).toBeNull();
    expect(fromComparison({ left: 'CLOSE', op: 'crosses below', right: 'SMA(CLOSE, 20)' })).toBe('CROSSUNDER(CLOSE, SMA(CLOSE, 20))');
    expect(fromComparison({ left: 'CLOSE', op: '>=', right: 'HIGH[1]' })).toBe('CLOSE >= HIGH[1]');
  });
});
