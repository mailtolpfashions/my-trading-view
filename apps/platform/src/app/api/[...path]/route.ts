import { NextResponse, type NextRequest } from 'next/server';
import { feedAuth, withVisitor } from '@/lib/feed-auth';

export const dynamic = 'force-dynamic';

// Pass-through for the tools brought over from the first app, which call the data service as /api/<path>. (/api/feed/<path>
// is the platform's own route, which Next matches first.) Who the caller is (owner, or a visitor on the public site) and
// what the public site refuses: lib/feed-auth.ts.
const FEED = process.env.FEED_URL ?? 'http://127.0.0.1:4001';

async function forward(req: NextRequest, path: string[]) {
  const auth = feedAuth(req, path.join('/'));
  if ('refused' in auth) return auth.refused;
  try {
    const res = await fetch(`${FEED}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${auth.token}`, ...auth.headers, ...(req.method === 'POST' && { 'content-type': req.headers.get('content-type') ?? 'application/json' }) },
      body: req.method === 'POST' ? await req.text() : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
    const location = res.headers.get('location');
    if (location && res.status >= 300 && res.status < 400) return NextResponse.redirect(location, res.status);
    const out = new NextResponse(await res.arrayBuffer(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
    const left = res.headers.get('x-visitor-remaining');
    if (left != null) out.headers.set('x-visitor-remaining', left);
    return withVisitor(out, auth);
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
