/**
 * Session token utilities using jose (HS256 JWT).
 * Works in Node.js 18+ runtime and Vercel Edge Runtime.
 *
 * Exported API is identical to the previous custom HMAC implementation
 * so all callers (middleware, API routes, server components) need no changes.
 */

import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = '__session';
export const MAX_AGE     = 60 * 60; // 1 hour in seconds

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET env var is not set');
  return new TextEncoder().encode(s);
}

export async function createToken(user, role = 'admin') {
  return new SignJWT({ user, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifyToken(token) {
  if (!token) return null;
  if (!process.env.SESSION_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload; // { user, role, iat, exp }
  } catch {
    return null;
  }
}
