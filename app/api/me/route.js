/**
 * GET /api/me — returns { user, role } from the current session.
 * Returns 401 if no valid session exists.
 */

import { NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '../../../lib/session';
import { cookies } from 'next/headers';

export async function GET() {
  const token   = cookies().get(COOKIE_NAME)?.value ?? '';
  const session = await verifyToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ user: session.user, role: session.role ?? 'admin' });
}
