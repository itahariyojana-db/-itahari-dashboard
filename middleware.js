/**
 * Next.js Edge Middleware — cookie-based route protection.
 *
 * Fail-secure: any unexpected error redirects to /login rather than
 * silently passing the request through to the protected page.
 */

import { NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from './lib/session';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Auth API endpoints must always be reachable (login/logout)
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  try {
    const token   = request.cookies.get(COOKIE_NAME)?.value ?? '';
    const session = await verifyToken(token);

    if (pathname === '/login') {
      // Already authenticated → skip login, go to dashboard
      if (session) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      return NextResponse.next();
    }

    // All other routes require a valid session
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
  } catch {
    // Fail-secure: any runtime error → redirect to login, never pass through
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.svg|icons\\.svg).*)'],
};
