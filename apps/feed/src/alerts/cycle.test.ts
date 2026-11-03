import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The screen result, the store and the channels are stand-ins; the engine itself is real.
const state = vi.hoisted(() => ({ matches: [] as string[], eodDate: '2026-11-02', sent: [] as { channel: string; title: string; lines: string[] }[], failTelegram: false }));
vi.mock('../screener/screener', () => ({
  runScreen: vi.fn(async () => ({ tf: 'D', rows: state.matches.map((s) => ({ symbol: s, close: 100, barDate: state.eodDate })) })),
}));
vi.mock('../eod/store', () => ({ eodLatestDate: () => state.eodDate }));
vi.mock('../intraday/instance', () => ({ live: { status: { state: 'off' } } }));
vi.mock('./channels', () => ({
  send: vi.fn(async (channel: string, m: { title: string; lines: string[] }) => {
    if (channel === 'inApp') return; // as the real one: in-app events are simply stored
    if (channel === 'telegram' && state.failTelegram) throw new Error('401 bad token');
    state.sent.push({ channel, title: m.title, lines: m.lines });
  }),
}));
vi.mock('../user/store', async (orig) => {
  const mod = await orig<typeof import('../user/store')>();
  const dir = await mkdtemp(path.join(tmpdir(), 'alerts-'));
  return { ...mod, userStore: new mod.UserStore(path.join(dir, 'user.json')) };
});

const { AlertEngine } = await import('./engine');
const { userStore } = await import('../user/store');

describe('an alert from creation to repeat', () => {
  beforeEach(() => { state.sent.length = 0; });

  it('baseline, one message for new matches, quiet while they hold, again after they stop and return', async () => {
    const screen = await userStore.saveScreen({ name: 'Breakouts', category: 'technical', formula: 'CLOSE > 1', tf: 'D', candle: 'closed', universe: { kind: 'all' }, filters: {}, columns: [] });
    const alert = await userStore.saveAlert({ name: 'Breakouts alert', source: { kind: 'screen', id: screen.id }, trigger: 'first', session: 'market', channels: ['inApp', 'telegram'], until: null });
    const engine = new AlertEngine(() => {});
    const check = async (day: string, matches: string[]) => { state.eodDate = day; state.matches = matches; await engine.tick(); };

    await check('2026-11-02', ['AAA', 'BBB']); // baseline
    expect(state.sent).toEqual([]);
    expect((await userStore.alertEvents())[0].note).toMatch(/2 stocks match right now/);

    await engine.tick(); // same day again: not due
    expect((await userStore.alertEvents())).toHaveLength(1);

    await check('2026-11-03', ['AAA', 'BBB', 'CCC']); // CCC is new: one message per channel
    expect(state.sent.map((x) => [x.channel, x.title])).toEqual([['telegram', 'Breakouts alert: 1 new stock']]);
    expect((await userStore.alertEvents())[0].hits.map((h) => h.symbol)).toEqual(['CCC']);

    state.sent.length = 0;
    await check('2026-11-04', ['AAA', 'CCC']); // nothing new
    expect(state.sent).toEqual([]);
    await check('2026-11-05', ['AAA', 'BBB', 'CCC']); // BBB stopped and returned: reported again
    expect(state.sent[0].lines[0]).toMatch(/^BBB/);

    state.failTelegram = true;
    await check('2026-11-06', ['AAA', 'BBB', 'CCC', 'DDD']);
    const a = (await userStore.alerts()).find((x) => x.id === alert.id)!;
    expect(a.lastError).toMatch(/telegram failed: 401 bad token/);
    expect((await userStore.alertEvents())[0].delivered).toEqual({ inApp: 'sent', telegram: 'failed: 401 bad token' });
  });

  it('an alert past its end date is paused, not run', async () => {
    const screen = await userStore.saveScreen({ name: 'Old', category: 'technical', formula: 'CLOSE > 1', tf: 'D', candle: 'closed', universe: { kind: 'all' }, filters: {}, columns: [] });
    const a = await userStore.saveAlert({ name: 'Old alert', source: { kind: 'screen', id: screen.id }, trigger: 'first', session: 'market', channels: ['inApp'], until: '2020-01-01' });
    await new AlertEngine(() => {}).tick();
    expect((await userStore.alerts()).find((x) => x.id === a.id)!.enabled).toBe(false);
  });
});
