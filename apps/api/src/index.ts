import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import bookRoutes from './routes/books';
import runnerRoutes from './routes/runner';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Match an origin against the allowlist. An entry may end in `*` to match a
 * prefix — used only in local dev (`http://localhost:*`), because Vite silently
 * moves to another port when 5173 is taken and the app would otherwise fail
 * with an opaque network error. Production config lists exact origins.
 */
function originAllowed(allowed: string[], origin: string): boolean {
  return allowed.some((entry) =>
    entry.endsWith('*') ? origin.startsWith(entry.slice(0, -1)) : entry === origin,
  );
}

app.use('*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (originAllowed(allowed, origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400,
  })(c, next);
});

app.get('/', (c) =>
  c.json({
    name: 'prometheus-api',
    feature: 'socrates',
    ok: true,
  }),
);

app.route('/api/auth', authRoutes);
app.route('/api/books', bookRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/runner', runnerRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
