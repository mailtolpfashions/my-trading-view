// Server only: who the feed is told the caller is, for both proxies (/api/feed/… and /api/…).
//   personal  the owner (admin): this app listens on 127.0.0.1 only and has no accounts
//   public    an anonymous visitor (anon, never admin), one id per browser in the nb_vid cookie, so the feed's daily
//             visitor allowance counts per visitor; owner-only routes are refused here and again in the feed.
// Accounts (milestone 2) will replace the visitor with the signed-in user.
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { signFeedToken } from '@mtv/shared/feed-token';
import { appMode, isPersonalRoute } from '@mtv/shared/mode';

const PUBLIC = appMode(process.env.NEXT_PUBLIC_APP_MODE ?? process.env.APP_MODE) === 'public';
const COOKIE = 'nb_vid';

export type FeedAuth = { token: string; headers: Record<string, string>; visitorCookie: string | null } | { refused: NextResponse };

export function feedAuth(req: NextRequest, route: string): FeedAuth {
  const secret = process.env.FEED_TOKEN_SECRET ?? '';
  if (secret.length < 32) return { refused: NextResponse.json({ error: 'not_configured', message: 'FEED_TOKEN_SECRET is missing from .env' }, { status: 500 }) };
  const exp = Math.floor(Date.now() / 1000) + 120;
  if (!PUBLIC) return { token: signFeedToken({ uid: 'owner', plan: 'FREE', exp, admin: true }, secret), headers: {}, visitorCookie: null };
  if (isPersonalRoute(route)) return { refused: NextResponse.json({ error: 'not_found', message: 'Not available on this site' }, { status: 404 }) };
  const known = req.cookies.get(COOKIE)?.value;
  const id = known && /^[0-9a-f-]{36}$/.test(known) ? known : randomUUID();
  // the visitor's address for the feed's per-IP allowance (the reverse proxy in front of this app sets it)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  return { token: signFeedToken({ uid: `v:${id}`, plan: 'FREE', exp, anon: true }, secret), headers: ip ? { 'x-forwarded-for': ip } : {}, visitorCookie: known === id ? null : id };
}

/** Sets the visitor cookie on a response when a new visitor id was made. */
export function withVisitor<T extends NextResponse>(res: T, auth: Extract<FeedAuth, { token: string }>): T {
  if (auth.visitorCookie) res.cookies.set(COOKIE, auth.visitorCookie, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 400 * 86400 });
  return res;
}
