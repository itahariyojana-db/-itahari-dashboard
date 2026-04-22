/**
 * POST /api/logout  — alias for /api/auth/logout
 * Clears the session cookie.
 */

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../../../lib/session';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   0,
    path:     '/',
  });
  return response;
}
