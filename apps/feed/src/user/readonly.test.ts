import { describe, expect, it } from 'vitest';
import { UserStore, UserStoreError } from './store';

describe('the public site\'s user store (no accounts yet)', () => {
  const s = new UserStore(null);
  it('reads as empty', async () => {
    expect(await s.screens()).toEqual([]);
    expect(await s.watchlists()).toEqual([]);
    expect(await s.recent()).toEqual([]);
  });
  it('refuses every change with a plain reason, writing nothing', async () => {
    await expect(s.saveWatchlist({ name: 'Mine', symbols: ['TCS'] })).rejects.toBeInstanceOf(UserStoreError);
    await expect(s.saveWatchlist({ name: 'Mine', symbols: ['TCS'] })).rejects.toThrow(/Saving needs an account/);
    expect(await s.watchlists()).toEqual([]);
  });
});
