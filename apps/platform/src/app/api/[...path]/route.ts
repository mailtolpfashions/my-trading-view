import { NextResponse, type NextRequest } from 'next/server';
import { signFeedToken } from '@mtv/shared/feed-token';

export const dynamic = 'force-dynamic';

// Pass-through for the tools brought over from the first app, which call the data service as /api/<path>: the owner's
// token is added here. (/api/feed/<path> is the platform's own route, which Next matches first.) This app has no
// accounts and listens on 127.0.0.1 only, so the owner is the only caller.
const FEED = process.env.FEED_URL ?? 'http://127.0.0.1:4001';

async function forward(req: NextRequest, path: string[]) {
  const secret = process.env.FEED_TOKEN_SECRET ?? '';
  if (secret.length < 32) return NextResponse.json({ error: 'not_configured', message: 'FEED_TOKEN_SECRET is missing from .env' }, { status: 500 });
  const token = signFeedToken({ uid: 'owner', plan: 'FREE', exp: Math.floor(Date.now() / 1000) + 120, admin: true }, secret);
  try {
    const res = await fetch(`${FEED}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, ...(req.method === 'POST' && { 'content-type': req.headers.get('content-type') ?? 'application/json' }) },
      body: req.method === 'POST' ? await req.text() : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
    const location = res.headers.get('location');
    if (location && res.status >= 300 && res.status < 400) return NextResponse.redirect(location, res.status);
    return new NextResponse(await res.arrayBuffer(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'feed_down', message: 'The data service is not running. Start it with npm run platform.' }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await params).path);
}
