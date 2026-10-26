import { NextResponse, type NextRequest } from 'next/server';
import { LANDING, LANDING_PATHS } from '@/lib/site-mode';

export function middleware(req: NextRequest) {
  if (!LANDING || LANDING_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'not_available' }, { status: 404 });
  return NextResponse.redirect(new URL('/', req.url));
}

// Skip Next.js internals and files with an extension (images, icons, robots.txt).
export const config = { matcher: ['/((?!_next/|.*\\..*).*)'] };
