/**
 * Next.js Edge Middleware — cookie-based route protection.
 *
 * Runs before every matched request on Vercel's edge network.
 * Replaces the previous HTTP Basic Auth middleware.
 *
 * Unauthenticated users are redirected to /login.
 * Authenticated users visiting /login are redirected to /dashboard.
 */

import { NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from './lib/session';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Auth API endpoints are always public — never block them
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token   = request.cookies.get(COOKIE_NAME)?.value;
  const session = await verifyToken(token);

  if (pathname === '/login') {
    // Already logged in → skip login page, go straight to dashboard
    if (session) return NextResponse.redirect(new URL('/dashboard', request.url));
    return NextResponse.next();
  }

  // Every other route (including /) requires a valid session
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next.js internals and static public files
  matcher: ['/((?!_next/static|_next/image|favicon\\.svg|icons\\.svg).*)'],
};
