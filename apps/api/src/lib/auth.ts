import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { Env, SessionUser } from '../types';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// createRemoteJWKSet caches keys internally; hold one per isolate.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function googleJwks() {
  jwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return jwks;
}

export function allowlist(env: Env): string[] {
  return env.ALLOWED_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(env: Env, email: string): boolean {
  return allowlist(env).includes(email.trim().toLowerCase());
}

/**
 * Verify a Google Identity Services ID token and return the user, or throw.
 * This is the only place an identity is established — the browser's claim of
 * who it is never matters, only what Google signed.
 */
export async function verifyGoogleIdToken(env: Env, credential: string): Promise<SessionUser> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the API');
  }

  const { payload } = await jwtVerify(credential, googleJwks(), {
    issuer: GOOGLE_ISSUERS,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const email = typeof payload.email === 'string' ? payload.email : null;
  if (!email) throw new Error('Google token carried no email');
  if (payload.email_verified !== true) throw new Error('Google email is not verified');

  return {
    email: email.toLowerCase(),
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

function secretKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function issueSessionToken(env: Env, user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, picture: user.picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.email)
    .setIssuer('prometheus')
    .setAudience('prometheus-web')
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey(env));
}

export async function verifySessionToken(env: Env, token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, secretKey(env), {
    issuer: 'prometheus',
    audience: 'prometheus-web',
  });
  const email = payload.sub;
  if (!email) throw new Error('Session token has no subject');
  // Re-check the allowlist on every request so revoking access is immediate,
  // rather than waiting for an already-issued token to expire.
  if (!isAllowed(env, email)) throw new Error('Access revoked');
  return {
    email,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

export const sessionTtlSeconds = SESSION_TTL_SECONDS;
