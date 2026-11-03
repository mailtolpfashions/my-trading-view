import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserStore } from './store';

const fresh = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'userstore-'));
  return { file: path.join(dir, 'user.json'), store: new UserStore(path.join(dir, 'user.json')) };
};
const screen = { name: 'RSI', category: 'technical' as const, formula: 'RSI(CLOSE, 14) > 50', tf: 'D' as const, candle: 'closed' as const, universe: { kind: 'all' as const }, filters: {}, columns: [] };

describe('user store', () => {
  it('saves, updates (keeping history and favourite), lists and deletes screens', async () => {
    const { store, file } = await fresh();
    const s = await store.saveScreen(screen);
    await store.setFavourite(s.id, true);
    await store.recordRun({ at: '2026-11-03T10:00:00Z', asOf: '2026-11-02', matches: 7, scanned: 100, ms: 5, screenId: s.id, name: 'RSI', formula: screen.formula, tf: 'D' });
    const u = await store.saveScreen({ ...screen, id: s.id, name: 'RSI 50' });
    expect(u).toMatchObject({ id: s.id, name: 'RSI 50', favourite: true, runs: [{ matches: 7 }] });
    // Persisted: a new store on the same file sees it.
    const again = new UserStore(file);
    expect((await again.screens()).map((x) => x.name)).toEqual(['RSI 50']);
    expect(await again.recent()).toHaveLength(1);
    await again.deleteScreen(s.id);
    expect(await again.screens()).toEqual([]);
  });

  it('refuses nameless or empty screens and unknown ids', async () => {
    const { store } = await fresh();
    await expect(store.saveScreen({ ...screen, name: ' ' })).rejects.toThrow(/name/);
    await expect(store.saveScreen({ ...screen, formula: '' })).rejects.toThrow(/condition/);
    await expect(store.saveScreen({ ...screen, id: 'nope' })).rejects.toThrow(/no longer exists/);
  });

  it('watchlists clean symbols and never duplicate them', async () => {
    const { store } = await fresh();
    const w = await store.saveWatchlist({ name: 'Banks', symbols: ['hdfcbank', 'ICICIBANK ', 'HDFCBANK', 'bad symbol!'] });
    expect(w.symbols).toEqual(['HDFCBANK', 'ICICIBANK']);
    expect((await store.addToWatchlist(w.id, ['SBIN', 'icicibank'])).symbols).toEqual(['HDFCBANK', 'ICICIBANK', 'SBIN']);
  });

  it('keeps a backup of the previous version and survives concurrent writes', async () => {
    const { store, file } = await fresh();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.saveWatchlist({ name: `L${i}`, symbols: ['TCS'] })));
    expect(await store.watchlists()).toHaveLength(20);
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8')).watchlists).toHaveLength(19);
  });

  it('never overwrites a file it could not read', async () => {
    const { file } = await fresh();
    await writeFile(file, '{ broken');
    const store = new UserStore(file);
    await expect(store.screens()).rejects.toThrow(/could not be read/);
    expect(await readFile(file, 'utf8')).toBe('{ broken');
  });
});
