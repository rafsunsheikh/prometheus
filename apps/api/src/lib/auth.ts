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

/**
 * Reduce an address to the form that actually identifies the mailbox.
 *
 * Gmail ignores dots in the local part, ignores anything after a `+`, and
 * treats googlemail.com as gmail.com — so those really are one account, and
 * matching them literally would reject an address that is genuinely on the
 * list. Every other domain is left alone, where dots are significant.
 */
function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at === -1) return email;

  const domain = email.slice(at + 1);
  let local = email.slice(0, at);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = (local.split('+')[0] ?? '').replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export interface Identity {
  /** The address that owns this person's library. */
  canonical: string;
  /** Every normalized address that signs in as this person. */
  aliases: string[];
}

/**
 * Parse ALLOWED_EMAILS into people.
 *
 *   "you@example.com|you.alt@example.com, friend@example.com"
 *
 * `,` separates different people — as it always has, so an existing flat list
 * keeps its meaning. `|` joins addresses belonging to the SAME person, and the
 * first of those is the identity their books are filed under.
 *
 * The safe direction matters here: forget a `|` and you get two separate
 * private libraries. Nothing is ever shared by accident.
 */
export function identities(env: Env): Identity[] {
  return env.ALLOWED_EMAILS.split(',')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => {
      const members = group.split('|').map((e) => e.trim()).filter(Boolean);
      return {
        canonical: (members[0] ?? '').toLowerCase(),
        aliases: members.map(normalizeEmail),
      };
    })
    .filter((id) => id.canonical !== '');
}

/**
 * Map a Google address to the identity that owns the library, or null if it is
 * not on the list. A canonical address resolves to itself, so this doubles as
 * the allowlist check.
 */
export function resolveIdentity(env: Env, email: string): string | null {
  const normalized = normalizeEmail(email);
  return identities(env).find((id) => id.aliases.includes(normalized))?.canonical ?? null;
}

export function isAllowed(env: Env, email: string): boolean {
  return resolveIdentity(env, email) !== null;
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
    via: null,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

function secretKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function issueSessionToken(env: Env, user: SessionUser): Promise<string> {
  // Subject is the canonical identity, so ownership follows the person rather
  // than whichever of their accounts they happened to use.
  return new SignJWT({ name: user.name, picture: user.picture, via: user.via })
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
  const subject = payload.sub;
  if (!subject) throw new Error('Session token has no subject');
  // Re-resolve on every request so revoking access is immediate, rather than
  // waiting for an already-issued token to expire. This also re-applies any
  // change to the alias groups without forcing a fresh sign-in.
  const email = resolveIdentity(env, subject);
  if (!email) throw new Error('Access revoked');
  return {
    email,
    via: typeof payload.via === 'string' ? payload.via : null,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

export const sessionTtlSeconds = SESSION_TTL_SECONDS;
