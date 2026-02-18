export const SESSION_COOKIE_NAME = 'autonomy-session';
const SESSION_TTL_MS = Number(process.env.DASHBOARD_SESSION_TTL ?? 86400) * 1000; // default 24h

/** Auth is enabled only when both DASHBOARD_USER and DASHBOARD_PASSWORD are set */
export function isAuthEnabled(): boolean {
  return !!(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD);
}

/**
 * Timing-safe credential comparison.
 * Uses Web Crypto for Edge compatibility (no node:crypto import).
 */
export async function validateCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = process.env.DASHBOARD_USER ?? '';
  const expectedPass = process.env.DASHBOARD_PASSWORD ?? '';

  if (!expectedUser || !expectedPass) return false;

  const enc = new TextEncoder();

  // Constant-time comparison via HMAC: HMAC(key, a) === HMAC(key, b) iff a === b
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode('credential-check'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const [userMac, expectedUserMac] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(username)),
    crypto.subtle.sign('HMAC', key, enc.encode(expectedUser)),
  ]);
  const [passMac, expectedPassMac] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(password)),
    crypto.subtle.sign('HMAC', key, enc.encode(expectedPass)),
  ]);

  const userMatch = arrayBufferEqual(userMac, expectedUserMac);
  const passMatch = arrayBufferEqual(passMac, expectedPassMac);

  return userMatch && passMatch;
}

function arrayBufferEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  if (va.length !== vb.length) return false;
  let result = 0;
  for (let i = 0; i < va.length; i++) {
    result |= (va[i] ?? 0) ^ (vb[i] ?? 0);
  }
  return result === 0;
}

/** Derive HMAC signing key from env (DASHBOARD_SECRET or DASHBOARD_PASSWORD) */
async function getSigningKey(): Promise<CryptoKey> {
  const secret = process.env.DASHBOARD_SECRET ?? process.env.DASHBOARD_PASSWORD ?? '';
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str: string): ArrayBuffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/** Create HMAC-signed session token: base64url(payload).base64url(hmac) */
export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({
    sub: process.env.DASHBOARD_USER,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  });
  const enc = new TextEncoder();
  const payloadB64 = toBase64url(enc.encode(payload));
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return `${payloadB64}.${toBase64url(sig)}`;
}

/** Verify HMAC signature and check expiration */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return false;

    const key = await getSigningKey();
    const enc = new TextEncoder();
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64url(sigB64),
      enc.encode(payloadB64),
    );
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadB64)));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return false;

    return true;
  } catch {
    return false;
  }
}
