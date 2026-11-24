import { NextResponse, type NextRequest } from 'next/server';
import { feedAuth, withVisitor } from '@/lib/feed-auth';

export const dynamic = 'force-dynamic';

// The browser talks to the feed through this server, so the feed token never leaves it and the feed needs no extra
// CORS origin. Only the routes the platform uses are passed on; the caller (owner, or a public visitor) and what the public
// site refuses come from lib/feed-auth.ts.
const FEED = process.env.FEED_URL ?? 'http://127.0.0.1:4001';
const ALLOWED = /^(today|dashboard|screener\/(meta|count|run)|candles|search|quotes|eod\/status|user\/(settings|screens|screens\/delete|screens\/favourite|recent|watchlists|watchlists\/add|watchlists\/delete|strategies|strategies\/delete|option-strategies|option-strategies\/delete|alerts|alerts\/delete|alerts\/enabled|alert-events|alert-events\/read)|strategy\/backtest|options-lab\/run|selling-report|selling-three|selling-research\/(callratio|combo|weekly-buy|yearly|workshop|calendar|calendar-far|search-ui|conclusion)|selling-plan|selling-paper\/start|selling-decay|selling-study(\/[a-z0-9-]+)?|alerts\/(channels|test)|kite\/(status|login|logout)|intraday\/candles|seller\/(view|days|calibration|calibration-day)|paperlog\/blind-buy|patterns\/meta|tradelab(\/(order|cancel|exit|reset|contracts|quote|rules|rules\/delete|log|margin|baskets|baskets\/delete|baskets\/execute|premium|straddle920|expiry-straddle|pivotbuy|weekend))?|quant\/(experiments|leads|portfolio|strategies|strategy|detail\/[A-Za-z0-9-]+\/[a-z0-9:-]+))$/;

async function forward(req: NextRequest, path: string[]) {
  const route = path.join('/');
  if (!ALLOWED.test(route)) return NextResponse.json({ error: 'not_found', message: 'Unknown feed route' }, { status: 404 });
  const auth = feedAuth(req, route);
  if ('refused' in auth) return auth.refused;
  try {
    const res = await fetch(`${FEED}/api/${route}${req.nextUrl.search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${auth.token}`, ...auth.headers, ...(req.method === 'POST' && { 'content-type': 'application/json' }) },
      body: req.method === 'POST' ? await req.text() : undefined,
      cache: 'no-store',
      redirect: 'manual', // the Kite login answers with a redirect to Zerodha, which the browser must follow
    });
    const location = res.headers.get('location');
    if (location && res.status >= 300 && res.status < 400) return NextResponse.redirect(location, res.status);
    const out = new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
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
