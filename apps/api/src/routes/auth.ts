import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { identities, issueSessionToken, resolveIdentity, sessionTtlSeconds, verifyGoogleIdToken } from '../lib/auth';
import { requireUser } from '../lib/middleware';
import { readJson } from '../lib/storage';
import { adminCheck } from './admin';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.post('/google', async (c) => {
  const body = await readJson<{ credential: string }>(c.req);
  if (!body.credential) throw new HTTPException(400, { message: 'Missing credential' });

  let user;
  try {
    user = await verifyGoogleIdToken(c.env, body.credential);
  } catch (err) {
    throw new HTTPException(401, {
      message: err instanceof Error ? err.message : 'Could not verify Google token',
    });
  }

  if (identities(c.env).length === 0) {
    // Distinguish "the allowlist was never configured" from "you are not on
    // it" — otherwise a missing secret looks exactly like a rejected user.
    throw new HTTPException(503, {
      message:
        'The allowlist is not configured on the API. Set the ALLOWED_EMAILS secret (see apps/api/wrangler.toml).',
    });
  }

  const canonical = resolveIdentity(c.env, user.email);
  if (!canonical) {
    // Deliberately explicit: this is a private app, and a clear "not on the
    // list" beats a vague failure when you are the one maintaining the list.
    throw new HTTPException(403, {
      message: `${user.email} is not on the Prometheus allowlist.`,
    });
  }

  // Sign-in resolves to the canonical identity, so every one of a person's
  // addresses opens the same library rather than a separate empty one.
  const signedInAs = user.email;
  user = {
    ...user,
    email: canonical,
    via: canonical === signedInAs ? null : signedInAs,
  };

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO users (email, name, picture, first_seen, last_seen)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(email) DO UPDATE SET name = ?2, picture = ?3, last_seen = ?4`,
  )
    .bind(user.email, user.name, user.picture, now)
    .run();

  return c.json({
    token: await issueSessionToken(c.env, user),
    expiresIn: sessionTtlSeconds,
    user: { ...user, isAdmin: adminCheck(c.env, user.email) },
  });
});

app.get('/me', requireUser, (c) => {
  const user = c.get('user');
  return c.json({ user: { ...user, isAdmin: adminCheck(c.env, user.email) } });
});

export default app;
