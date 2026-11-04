import { NextResponse, type NextRequest } from 'next/server';
import { signFeedToken } from '@mtv/shared/feed-token';

export const dynamic = 'force-dynamic';

// The browser talks to the feed through this server, so the feed token never leaves it and the feed needs no extra
// CORS origin. Only the routes the platform uses are passed on.
const FEED = process.env.FEED_URL ?? 'http://127.0.0.1:4001';
const ALLOWED = /^(today|dashboard|screener\/(meta|count|run)|candles|search|quotes|eod\/status|user\/(settings|screens|screens\/delete|screens\/favourite|recent|watchlists|watchlists\/add|watchlists\/delete|strategies|strategies\/delete|alerts|alerts\/delete|alerts\/enabled|alert-events|alert-events\/read)|strategy\/backtest|selling-report|selling-plan|selling-paper\/start|selling-decay|selling-study(\/[a-z0-9-]+)?|alerts\/(channels|test)|kite\/(status|login|logout)|intraday\/candles)$/;

async function forward(req: NextRequest, path: string[]) {
  const route = path.join('/');
  if (!ALLOWED.test(route)) return NextResponse.json({ error: 'not_found', message: 'Unknown feed route' }, { status: 404 });
  const secret = process.env.FEED_TOKEN_SECRET ?? '';
  if (secret.length < 32) return NextResponse.json({ error: 'not_configured', message: 'FEED_TOKEN_SECRET is missing from .env' }, { status: 500 });
  const token = signFeedToken({ uid: 'owner', plan: 'FREE', exp: Math.floor(Date.now() / 1000) + 120, admin: true }, secret);
  try {
    const res = await fetch(`${FEED}/api/${route}${req.nextUrl.search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, ...(req.method === 'POST' && { 'content-type': 'application/json' }) },
      body: req.method === 'POST' ? await req.text() : undefined,
      cache: 'no-store',
      redirect: 'manual', // the Kite login answers with a redirect to Zerodha, which the browser must follow
    });
    const location = res.headers.get('location');
    if (location && res.status >= 300 && res.status < 400) return NextResponse.redirect(location, res.status);
    return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
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
