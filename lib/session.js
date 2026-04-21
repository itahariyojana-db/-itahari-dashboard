/**
 * Session token utilities — Web Crypto only, no Node.js imports.
 * Works identically in:
 *   • Next.js API routes  (Node 18+ runtime — crypto.subtle is a global)
 *   • Next.js middleware   (Edge runtime   — crypto.subtle is a global)
 *   • Server Components   (Node 18+ runtime)
 *
 * Token format: <base64url-payload>.<base64url-HMAC-SHA256-signature>
 * Payload:      JSON { user, exp }   (exp = Unix seconds)
 */

export const COOKIE_NAME = '__session';
export const MAX_AGE     = 60 * 60; // 1 hour in seconds

// ── Base64url helpers (btoa/atob are global in all runtimes) ──────────

function b64url(buf) {
  let str = '';
  const bytes = new Uint8Array(buf);
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── HMAC key (imported fresh each call — Edge Runtime has no key cache) ──

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

// ── Public API ────────────────────────────────────────────────────────

export async function createToken(user) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET env var is not set');

  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ user, exp: Math.floor(Date.now() / 1000) + MAX_AGE }),
    ),
  );

  const key    = await hmacKey(secret, 'sign');
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${b64url(sigBuf)}`;
}

export async function verifyToken(token) {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);

  try {
    const key   = await hmacKey(secret, 'verify');
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      new TextEncoder().encode(payload),
    );
    if (!valid) return null;

    const data = JSON.parse(
      new TextDecoder().decode(b64urlDecode(payload)),
    );

    if (data.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return data; // { user, exp }
  } catch {
    return null;
  }
}
