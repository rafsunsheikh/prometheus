/**
 * BM25 Okapi ranking — a port of what my-research-buddy used `rank_bm25` for.
 *
 * Thirty lines of arithmetic is not worth a dependency, and keeping it here
 * means retrieval runs where the book text already is: on the runner, rather
 * than in the Worker, which has far too little CPU per request to tokenize a
 * few hundred thousand characters.
 */

const TOKEN = /[a-z0-9]+/g;

export function tokenize(text: string): string[] {
  return (text || '').toLowerCase().match(TOKEN) ?? [];
}

const K1 = 1.5;
const B = 0.75;

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Rank `items` against `query`. `text` extracts the searchable text of an item.
 * Returns every item with a positive score, best first.
 */
export function rank<T>(items: T[], query: string, text: (item: T) => string): Scored<T>[] {
  if (items.length === 0) return [];

  const docs = items.map((i) => tokenize(text(i)));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;

  // Document frequency per term.
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const terms = [...new Set(tokenize(query))];
  const N = docs.length;

  const scored = docs.map((doc, i) => {
    const freq = new Map<string, number>();
    for (const t of doc) freq.set(t, (freq.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of terms) {
      const f = freq.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      // Okapi IDF, floored at zero: a term in nearly every chunk carries no
      // signal, and its negative idf would otherwise punish chunks for
      // containing the very word that was asked about.
      const idf = Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * doc.length) / avgLen));
    }
    return { item: items[i]!, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}
