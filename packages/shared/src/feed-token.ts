// Short-lived signed tokens the web app issues and the feed service verifies (HMAC-SHA256 over a JSON payload).
// Server-only: imported as '@mtv/shared/feed-token', never from the browser bundle.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type Plan = 'FREE' | 'LIVE';
/** `admin` (site owner, from ADMIN_EMAILS) may manage the server's broker connection. */
export type FeedClaims = { uid: string; plan: Plan; exp: number; admin?: boolean };

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signFeedToken(claims: FeedClaims, secret: string): string {
  if (secret.length < 32) throw new Error('FEED_TOKEN_SECRET must be at least 32 characters');
  const payload = b64u(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the claims if the signature is valid and the token has not expired; otherwise null. */
export function verifyFeedToken(token: string | null | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): FeedClaims | null {
  if (!token || secret.length < 32) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString()) as FeedClaims;
    if (typeof c.uid !== 'string' || (c.plan !== 'FREE' && c.plan !== 'LIVE') || typeof c.exp !== 'number' || c.exp <= nowSec) return null;
    if (c.admin !== undefined && typeof c.admin !== 'boolean') return null;
    return c;
  } catch {
    return null;
  }
}
