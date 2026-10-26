import { describe, expect, it } from 'vitest';
import { signFeedToken, verifyFeedToken } from './feed-token';

const SECRET = 'x'.repeat(64);

describe('admin claim', () => {
  const secret = 'x'.repeat(32);
  it('round-trips, and is absent for ordinary users', () => {
    expect(verifyFeedToken(signFeedToken({ uid: 'a', plan: 'FREE', exp: 2e9, admin: true }, secret), secret, 1e9)?.admin).toBe(true);
    expect(verifyFeedToken(signFeedToken({ uid: 'b', plan: 'FREE', exp: 2e9 }, secret), secret, 1e9)?.admin).toBeUndefined();
  });
});

describe('feed tokens', () => {
  it('round-trips valid claims', () => {
    const t = signFeedToken({ uid: 'u1', plan: 'LIVE', exp: 2000 }, SECRET);
    expect(verifyFeedToken(t, SECRET, 1000)).toEqual({ uid: 'u1', plan: 'LIVE', exp: 2000 });
  });
  it('rejects expired tokens', () => {
    expect(verifyFeedToken(signFeedToken({ uid: 'u1', plan: 'LIVE', exp: 1000 }, SECRET), SECRET, 1000)).toBeNull();
  });
  it('rejects a token whose plan was edited (FREE -> LIVE)', () => {
    const t = signFeedToken({ uid: 'u1', plan: 'FREE', exp: 2000 }, SECRET);
    const forged = Buffer.from(JSON.stringify({ uid: 'u1', plan: 'LIVE', exp: 2000 })).toString('base64url') + '.' + t.split('.')[1];
    expect(verifyFeedToken(forged, SECRET, 1000)).toBeNull();
  });
  it('rejects tokens signed with another secret, and garbage', () => {
    expect(verifyFeedToken(signFeedToken({ uid: 'u1', plan: 'FREE', exp: 2000 }, 'y'.repeat(64)), SECRET, 1000)).toBeNull();
    expect(verifyFeedToken('nonsense', SECRET)).toBeNull();
    expect(verifyFeedToken(undefined, SECRET)).toBeNull();
  });
  it('refuses to work with a short secret', () => {
    expect(() => signFeedToken({ uid: 'u', plan: 'FREE', exp: 1 }, 'short')).toThrow();
  });
});
