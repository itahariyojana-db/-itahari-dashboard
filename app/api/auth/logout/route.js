/**
 * POST /api/auth/logout
 *
 * Clears the session cookie and redirects to /login.
 */

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../../../../lib/session';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Overwrite with an expired cookie to force the browser to delete it
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,   // expires immediately
    path:     '/',
  });
  return response;
}
