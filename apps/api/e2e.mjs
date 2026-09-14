import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
const API = 'https://prometheus-api.rafsunsheikh116-6a6.workers.dev';
const SCRATCH = process.argv[2];
const secret = readFileSync(`${SCRATCH}/session-secret.txt`, 'utf8').trim();

const tok = await new SignJWT({ name: 'Rafsun Sheikh', via: null })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('rafsun.sheikh@audd.digital')
  .setIssuer('prometheus').setAudience('prometheus-web')
  .setIssuedAt().setExpirationTime('2h')
  .sign(new TextEncoder().encode(secret));
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

const me = await fetch(`${API}/api/auth/me`, { headers: H });
console.log('GET /api/auth/me ->', me.status, await me.text());

const raw = readFileSync(`${SCRATCH}/artofwar.txt`, 'utf8');
const s = raw.indexOf('*** START OF THE PROJECT GUTENBERG');
const e = raw.indexOf('*** END OF THE PROJECT GUTENBERG');
const markdown = raw.slice(s > -1 ? raw.indexOf('\n', s) + 1 : 0, e > -1 ? e : raw.length).trim();

const r = await fetch(`${API}/api/books`, { method: 'POST', headers: H, body: JSON.stringify({
  title: 'The Art of War', author: 'Sun Tzu', sourceName: 'artofwar.txt',
  sourceFormat: 'txt', markdown }) });
console.log('POST /api/books ->', r.status, await r.text());
console.log('\nSESSION_TOKEN_FOR_LATER=' + tok);
