/**
 * Protected dashboard page — Server Component.
 *
 * Verifies the session cookie on the server before sending any HTML.
 * Unauthenticated requests are redirected to /login by the middleware,
 * but this page adds a second layer as a safety net.
 */

import { cookies }   from 'next/headers';
import { redirect }  from 'next/navigation';
import { verifyToken, COOKIE_NAME } from '../../lib/session';
import Dashboard from '../../src/App';

export const dynamic = 'force-dynamic'; // never cache; always re-check cookie

export default async function DashboardPage() {
  const token   = cookies().get(COOKIE_NAME)?.value;
  const session = await verifyToken(token);

  if (!session) redirect('/login');

  // The Dashboard component is a 'use client' component — rendered entirely
  // in the browser. This Server Component is just the auth gate + shell.
  return <Dashboard />;
}
