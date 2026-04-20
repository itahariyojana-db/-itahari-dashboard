/**
 * Vercel Edge Middleware — HTTP Basic Auth
 *
 * Runs before every request on Vercel's edge network.
 * Returns 401 + WWW-Authenticate to trigger the browser's native login popup.
 * Credentials are read from environment variables — never hardcoded.
 *
 * Set in Vercel: Project → Settings → Environment Variables
 *   BASIC_AUTH_USER      your username
 *   BASIC_AUTH_PASSWORD  your password
 *
 * ⚠️  Basic Auth is only secure over HTTPS.
 *     Vercel provides HTTPS on all deployments by default.
 */

// Constant-time string comparison — prevents timing attacks that let an
// attacker guess credentials one character at a time by measuring response
// latency. Always iterates the full length of both strings.
function timingSafeEqual(a, b) {
  let diff = a.length ^ b.length; // non-zero if lengths differ → false
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default function middleware(request) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;

  // Fail secure: block everything if env vars are not configured.
  if (!expectedUser || !expectedPass) {
    return new Response('Auth env vars not configured on server.', { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';

  if (authHeader.startsWith('Basic ')) {
    try {
      // atob() decodes base64 — available in Edge Runtime (no Node Buffer needed)
      const decoded = atob(authHeader.slice(6));
      const colon   = decoded.indexOf(':');
      if (colon !== -1) {
        const user = decoded.slice(0, colon);
        const pass = decoded.slice(colon + 1);
        if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
          return; // ✓ valid — pass request through to the app
        }
      }
    } catch {
      // Malformed base64 — fall through to 401
    }
  }

  // Missing or invalid credentials → trigger browser login popup
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Itahari Dashboard", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export const config = {
  // Match ALL routes — browser caches credentials per-origin so the
  // dialog only appears once per session, even for asset requests.
  matcher: ['/(.*)', '/'],
};
