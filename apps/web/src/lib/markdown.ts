import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

/** Render trusted markdown (our own summaries and extracted book text) to HTML.
 *  marked escapes raw HTML by default under these options, so book text that
 *  happens to contain angle brackets renders as text rather than markup. */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}

/** Pull a display title out of a summary's leading H1, if it has one. */
export function leadingHeading(md: string): string | null {
  const match = md.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}
