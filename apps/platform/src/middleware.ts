import { NextResponse, type NextRequest } from 'next/server';
import { appMode, isPersonalPage } from '@mtv/shared/mode';

// The public site answers "not found" for the owner's pages (Trade lab, Kite connection, the owner's research …):
// the links are hidden too, but a typed address must not open them either. The owner's app (personal) is unchanged.
const PUBLIC = appMode(process.env.NEXT_PUBLIC_APP_MODE) === 'public';

export function middleware(req: NextRequest) {
  if (PUBLIC && isPersonalPage(req.nextUrl.pathname)) return NextResponse.rewrite(new URL('/not-available', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next|fonts|icon|favicon).*)'] };
