import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { signFeedToken } from '@mtv/shared/feed-token';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/server/admin';
import { currentPlan } from '@/server/entitlements';

export const dynamic = 'force-dynamic';

/**
 * Short-lived (10 min) token proving to the feed service who the user is and which plan they are on.
 * Visitors without an account (the public chart page) get an anonymous Free token: delayed chart data only.
 */
export async function GET() {
  const secret = process.env.FEED_TOKEN_SECRET ?? '';
  const exp = Math.floor(Date.now() / 1000) + 600;
  const session = await getSession();
  if (!session) {
    const token = signFeedToken({ uid: `anon:${randomUUID()}`, plan: 'FREE', exp, anon: true }, secret);
    return NextResponse.json({ token, plan: 'FREE', exp, anon: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { plan } = await currentPlan(session.user.id);
  const token = signFeedToken({ uid: session.user.id, plan, exp, ...(isAdmin(session.user.email) && { admin: true }) }, secret);
  return NextResponse.json({ token, plan, exp }, { headers: { 'Cache-Control': 'no-store' } });
}
