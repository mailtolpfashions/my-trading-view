import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { signFeedToken } from '@mtv/shared/feed-token';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/server/admin';
import { currentPlan } from '@/server/entitlements';

export const dynamic = 'force-dynamic';

/**
 * Short-lived (10 min) token proving to the feed service who the user is and which plan they are on.
 * Visitors without an account get an anonymous token carrying a stable visitor id (a long-lived cookie), so the feed
 * can count their daily free runs; signing in removes the limit.
 */
const VISITOR_COOKIE = 'mtv_vid';
export async function GET() {
  const secret = process.env.FEED_TOKEN_SECRET ?? '';
  const exp = Math.floor(Date.now() / 1000) + 600;
  const session = await getSession();
  if (!session) {
    const jar = await cookies();
    const existing = jar.get(VISITOR_COOKIE)?.value;
    const vid = existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : randomUUID();
    const token = signFeedToken({ uid: `anon:${vid}`, plan: 'FREE', exp, anon: true }, secret);
    const res = NextResponse.json({ token, plan: 'FREE', exp, anon: true }, { headers: { 'Cache-Control': 'no-store' } });
    if (vid !== existing) res.cookies.set(VISITOR_COOKIE, vid, { httpOnly: true, sameSite: 'lax', secure: (process.env.BETTER_AUTH_URL ?? '').startsWith('https:'), path: '/', maxAge: 365 * 86400 });
    return res;
  }
  const { plan } = await currentPlan(session.user.id);
  const token = signFeedToken({ uid: session.user.id, plan, exp, ...(isAdmin(session.user.email) && { admin: true }) }, secret);
  return NextResponse.json({ token, plan, exp }, { headers: { 'Cache-Control': 'no-store' } });
}
