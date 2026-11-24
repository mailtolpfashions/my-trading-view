import { describe, expect, it } from 'vitest';
import { appMode, isPersonalPage, isPersonalRoute } from './mode';

describe('app mode', () => {
  it('is personal unless APP_MODE says public', () => {
    expect(appMode(undefined)).toBe('personal');
    expect(appMode('')).toBe('personal');
    expect(appMode('Public ')).toBe('public');
    expect(appMode('personal')).toBe('personal');
  });
  it('knows the owner-only pages, prefixes included, and nothing more', () => {
    expect(isPersonalPage('/tradelab')).toBe(true);
    expect(isPersonalPage('/research/quant')).toBe(true);
    expect(isPersonalPage('/options/intraday-seller')).toBe(true);
    expect(isPersonalPage('/research/fii')).toBe(false);
    expect(isPersonalPage('/options')).toBe(false);
    expect(isPersonalPage('/options/max-pain')).toBe(false);
    expect(isPersonalPage('/tradelabs')).toBe(false); // a prefix match needs the slash
  });
  it('knows the owner-only feed routes, with or without /api/', () => {
    for (const r of ['tradelab', 'tradelab/order', '/api/kite/login', 'seller/view', 'quant/experiments', 'selling-study/abc', 'intraday/candles?symbol=X', 'alerts/test'])
      expect(isPersonalRoute(r), r).toBe(true);
    for (const r of ['candles', '/api/screener/run', 'strategy/backtest', 'options-lab/run', 'research/fii', 'today', 'users-guide', 'user/screens'])
      expect(isPersonalRoute(r), r).toBe(false);
  });
});
