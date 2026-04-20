/**
 * POST /api/auth/login
 *
 * Validates credentials (constant-time compare, brute-force delay on failure)
 * and sets an httpOnly signed session cookie on success.
 */

import { NextResponse } from 'next/server';
import { createToken, COOKIE_NAME, MAX_AGE } from '../../../../lib/session';

// Constant-time string comparison — prevents timing attacks.
// Iterates max(a, b) chars even when lengths differ.
function timingSafeEqual(a, b) {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { username = '', password = '' } = body;
  const validUser = process.env.BASIC_AUTH_USER     ?? '';
  const validPass = process.env.BASIC_AUTH_PASSWORD ?? '';

  if (!validUser || !validPass) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const ok =
    timingSafeEqual(String(username), validUser) &&
    timingSafeEqual(String(password), validPass);

  if (!ok) {
    // Artificial 600ms delay — slows brute-force to ~100 guesses/minute max
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: 'प्रयोगकर्ता नाम वा पासवर्ड गलत छ' }, { status: 401 });
  }

  const token = await createToken(username);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,                                      // JS cannot read this cookie
    secure:   process.env.NODE_ENV === 'production',    // HTTPS only in prod
    sameSite: 'lax',                                    // CSRF protection
    maxAge:   MAX_AGE,                                  // 24 hours
    path:     '/',
  });
  return response;
}
