import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verifySessionToken } from './auth';
import type { Env, Variables } from '../types';

type Ctx = { Bindings: Env; Variables: Variables };

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value;
}

/** Requires a valid Prometheus session token issued after Google sign-in. */
export const requireUser: MiddlewareHandler<Ctx> = async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  if (!token) throw new HTTPException(401, { message: 'Missing bearer token' });
  try {
    c.set('user', await verifySessionToken(c.env, token));
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired session' });
  }
  await next();
};

/**
 * Requires the runner's shared secret. The runner is a trusted backend peer,
 * not a user, so it gets its own credential and its own route namespace.
 */
export const requireRunner: MiddlewareHandler<Ctx> = async (c, next) => {
  const token = bearer(c.req.header('Authorization'));
  const expected = c.env.RUNNER_TOKEN;
  if (!expected) throw new HTTPException(503, { message: 'RUNNER_TOKEN not configured' });
  if (!token || !timingSafeEqual(token, expected)) {
    throw new HTTPException(401, { message: 'Bad runner token' });
  }
  await next();
};

/** Constant-time compare so a wrong token leaks nothing through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
