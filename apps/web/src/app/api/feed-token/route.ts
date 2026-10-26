import { NextResponse } from 'next/server';
import { signFeedToken } from '@mtv/shared/feed-token';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/server/admin';
import { currentPlan } from '@/server/entitlements';

export const dynamic = 'force-dynamic';

/** Short-lived (10 min) token proving to the feed service who the user is and which plan they are on. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  const { plan } = await currentPlan(session.user.id);
  const exp = Math.floor(Date.now() / 1000) + 600;
  const token = signFeedToken({ uid: session.user.id, plan, exp, ...(isAdmin(session.user.email) && { admin: true }) }, process.env.FEED_TOKEN_SECRET ?? '');
  return NextResponse.json({ token, plan, exp }, { headers: { 'Cache-Control': 'no-store' } });
}
