import type TurndownService from 'turndown';

/* The parsers are megabytes of code. Load each one the first time a reader
   actually hands us that format, not on page load. */

let turndownPromise: Promise<TurndownService> | null = null;
function getTurndown(): Promise<TurndownService> {
  turndownPromise ??= import('turndown').then(
    (m) =>
      new m.default({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      }),
  );
  return turndownPromise;
}

async function getPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export type SourceFormat = 'pdf' | 'epub' | 'docx' | 'txt' | 'md';

export interface Extracted {
  markdown: string;
  title: string;
  author: string | null;
  format: SourceFormat;
}

export interface ExtractProgress {
  (stage: string, ratio: number): void;
}

export function detectFormat(file: File): SourceFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.epub')) return 'epub';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
  if (name.endsWith('.txt') || name.endsWith('.text')) return 'txt';
  return null;
}

/** Strip the debris that survives every extractor: page numbers on their own
 *  line, repeated running headers, form feeds, and runaway blank lines. */
function tidy(raw: string): string {
  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/[­​‌‍﻿]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

  // Rejoin words hyphenated across a line break.
  text = text.replace(/(\w)-\n(\w)/g, '$1$2');

  const lines = text.split('\n');

  // A short line that repeats on many pages is a running header or footer.
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim();
    if (key.length > 3 && key.length < 70) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const boilerplate = new Set(
    [...counts.entries()].filter(([, n]) => n >= 8).map(([key]) => key),
  );

  const kept = lines.filter((line) => {
    const t = line.trim();
    if (/^\d{1,4}$/.test(t)) return false; // bare page number
    if (/^(page\s+)?\d{1,4}\s*(of\s+\d{1,4})?$/i.test(t)) return false;
    if (boilerplate.has(t)) return false;
    return true;
  });

  return kept
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFromFilename(file: File): string {
  return file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractPdf(file: File, onProgress: ExtractProgress): Promise<Extracted> {
  const pdfjs = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const doc = await loadingTask.promise;

  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    // pdf.js gives positioned fragments; rebuild lines from the y coordinate
    // so paragraphs survive instead of collapsing into one run-on string.
    let out = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n';
      out += item.str;
      if (item.hasEOL) out += '\n';
      lastY = y;
    }
    pages.push(out);
    page.cleanup();
    if (n % 5 === 0 || n === doc.numPages) {
      onProgress(`Reading page ${n} of ${doc.numPages}`, n / doc.numPages);
    }
  }

  await loadingTask.destroy();

  return {
    markdown: tidy(pages.join('\n\n')),
    title: info.Title?.trim() || titleFromFilename(file),
    author: info.Author?.trim() || null,
    format: 'pdf',
  };
}

async function extractEpub(file: File, onProgress: ExtractProgress): Promise<Extracted> {
  const [{ default: JSZip }, turndown] = await Promise.all([import('jszip'), getTurndown()]);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();

  // container.xml points at the OPF, which holds metadata and the reading order.
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Not a valid EPUB: META-INF/container.xml is missing');
  const opfPath = parser
    .parseFromString(containerXml, 'application/xml')
    .querySelector('rootfile')
    ?.getAttribute('full-path');
  if (!opfPath) throw new Error('Not a valid EPUB: no OPF declared');

  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new Error(`Not a valid EPUB: ${opfPath} is missing`);
  const opf = parser.parseFromString(opfXml, 'application/xml');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const title = opf.querySelector('metadata > title')?.textContent?.trim();
  const author = opf.querySelector('metadata > creator')?.textContent?.trim();

  // Map manifest ids to hrefs, then walk the spine to get true reading order.
  const manifest = new Map<string, string>();
  for (const item of opf.querySelectorAll('manifest > item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  }
  const spine = [...opf.querySelectorAll('spine > itemref')]
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((href): href is string => Boolean(href));

  const chapters: string[] = [];
  for (const [i, href] of spine.entries()) {
    const path = decodeURIComponent(opfDir + href.split('#')[0]);
    const html = await zip.file(path)?.async('text');
    if (!html) continue;

    const dom = parser.parseFromString(html, 'application/xhtml+xml');
    dom.querySelectorAll('script, style, nav[epub\\:type="toc"]').forEach((el) => el.remove());
    const body = dom.querySelector('body');
    if (body?.textContent?.trim()) chapters.push(turndown.turndown(body.innerHTML));

    onProgress(`Reading chapter ${i + 1} of ${spine.length}`, (i + 1) / spine.length);
  }

  if (chapters.length === 0) throw new Error('No readable chapters found in this EPUB');

  return {
    markdown: tidy(chapters.join('\n\n---\n\n')),
    title: title || titleFromFilename(file),
    author: author || null,
    format: 'epub',
  };
}

async function extractDocx(file: File, onProgress: ExtractProgress): Promise<Extracted> {
  onProgress('Converting document', 0.4);
  const [{ default: mammoth }, turndown] = await Promise.all([import('mammoth'), getTurndown()]);
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  onProgress('Converting document', 0.9);
  return {
    markdown: tidy(turndown.turndown(html)),
    title: titleFromFilename(file),
    author: null,
    format: 'docx',
  };
}

async function extractPlain(file: File, format: SourceFormat): Promise<Extracted> {
  const text = await file.text();
  return {
    // Markdown files are already structured; do not run the de-boilerplate pass.
    markdown: format === 'md' ? text.trim() : tidy(text),
    title: titleFromFilename(file),
    author: null,
    format,
  };
}

export const MAX_FILE_BYTES = 120 * 1024 * 1024;

export async function extractBook(file: File, onProgress: ExtractProgress): Promise<Extracted> {
  const format = detectFormat(file);
  if (!format) {
    throw new Error(`Unsupported file type. Socrates reads PDF, EPUB, DOCX, TXT and Markdown.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`,
    );
  }

  onProgress('Opening file', 0.02);
  const result =
    format === 'pdf'
      ? await extractPdf(file, onProgress)
      : format === 'epub'
        ? await extractEpub(file, onProgress)
        : format === 'docx'
          ? await extractDocx(file, onProgress)
          : await extractPlain(file, format);

  if (result.markdown.length < 200) {
    throw new Error(
      'Barely any text came out of that file. If it is a scanned PDF, the pages are images and need OCR first.',
    );
  }

  onProgress('Ready', 1);
  return result;
}
