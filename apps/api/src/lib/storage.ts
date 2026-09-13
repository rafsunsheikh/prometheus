import type { Env } from '../types';

export const contentKey = (bookId: string) => `books/${bookId}/content.md`;
export const summaryKey = (bookId: string) => `books/${bookId}/summary.md`;

export async function putText(env: Env, key: string, text: string): Promise<void> {
  await env.BUCKET.put(key, text, {
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
  });
}

export async function getText(env: Env, key: string): Promise<string | null> {
  const obj = await env.BUCKET.get(key);
  return obj ? await obj.text() : null;
}

export async function deletePrefix(env: Env, prefix: string): Promise<void> {
  const listed = await env.BUCKET.list({ prefix });
  if (listed.objects.length > 0) {
    await env.BUCKET.delete(listed.objects.map((o) => o.key));
  }
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Parse a JSON body, treating malformed input as an empty object rather than
 *  a 500. Callers validate the fields they care about. */
export async function readJson<T extends object>(req: { json: () => Promise<unknown> }): Promise<Partial<T>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}
