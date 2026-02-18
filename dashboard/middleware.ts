import { type NextRequest, NextResponse } from 'next/server';
import { isAuthEnabled, SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/api/auth'];
const STATIC_PREFIXES = ['/_next', '/favicon.ico'];

function isPublicPath(pathname: string): boolean {
  return (
    STATIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

export async function middleware(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token && (await verifySessionToken(token))) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
