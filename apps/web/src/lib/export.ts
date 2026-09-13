import type { Paragraph as ParagraphType, TextRun as TextRunType } from 'docx';
import { renderMarkdown } from './markdown';

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Safari has actually started the download.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(title: string): string {
  return (
    title
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'summary'
  );
}

export function exportMarkdown(title: string, markdown: string): void {
  download(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    `${safeFilename(title)}.md`,
  );
}

type DocxModule = typeof import('docx');

/** Inline runs: **bold**, *italic*, `code`. Enough for what Socrates emits. */
function inlineRuns(d: DocxModule, text: string): TextRunType[] {
  const { TextRun } = d;
  const runs: TextRunType[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) runs.push(new TextRun(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith('`')) {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas' }));
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) runs.push(new TextRun(text.slice(cursor)));
  return runs.length > 0 ? runs : [new TextRun('')];
}

export async function exportDocx(title: string, markdown: string): Promise<void> {
  const d = await import('docx');
  const { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } = d;
  const paragraphs: ParagraphType[] = [];

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd();

    if (!line.trim()) continue;

    if (line.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 240 },
          children: inlineRuns(d, line.slice(2)),
        }),
      );
    } else if (line.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 160 },
          children: inlineRuns(d, line.slice(3)),
        }),
      );
    } else if (line.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 260, after: 120 },
          children: inlineRuns(d, line.slice(4)),
        }),
      );
    } else if (line.startsWith('#### ')) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: inlineRuns(d, line.slice(5)),
        }),
      );
    } else if (line.startsWith('> ')) {
      paragraphs.push(
        new Paragraph({
          indent: { left: 720 },
          spacing: { before: 120, after: 120 },
          children: [new TextRun({ text: line.slice(2), italics: true, color: '444444' })],
        }),
      );
    } else if (/^[-*]\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: inlineRuns(d, line.replace(/^[-*]\s+/, '')),
        }),
      );
    } else if (/^\d+\.\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: 'socrates-ordered', level: 0 },
          spacing: { after: 80 },
          children: inlineRuns(d, line.replace(/^\d+\.\s+/, '')),
        }),
      );
    } else if (/^(\*|-|_){3,}$/.test(line.trim())) {
      paragraphs.push(
        new Paragraph({
          text: '',
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        }),
      );
    } else if (/^\*[^*]+\*$/.test(line.trim())) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { after: 240 },
          children: [new TextRun({ text: line.trim().slice(1, -1), italics: true, color: '666666' })],
        }),
      );
    } else {
      paragraphs.push(
        new Paragraph({ spacing: { after: 160 }, children: inlineRuns(d, line) }),
      );
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'socrates-ordered',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Georgia', size: 22 }, paragraph: { spacing: { line: 320 } } },
      },
    },
    sections: [{ properties: {}, children: paragraphs }],
  });

  download(
    await Packer.toBlob(doc),
    `${safeFilename(title)}.docx`,
  );
}

/**
 * PDF via the browser's own print pipeline. This produces real selectable text
 * and correct pagination, which a canvas-rasterizing library does not — the
 * trade is that the reader confirms "Save as PDF" in the print dialog.
 */
export function exportPdf(title: string, markdown: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error('Could not open the print view');
  }

  doc.open();
  doc.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt;
         line-height: 1.65; color: #1a1a1a; margin: 0; }
  h1 { font-family: Fraunces, Georgia, serif; font-size: 25pt; line-height: 1.15;
       margin: 0 0 6pt; color: #111; }
  h2 { font-family: Fraunces, Georgia, serif; font-size: 15pt; margin: 22pt 0 8pt;
       padding-bottom: 4pt; border-bottom: 0.6pt solid #d4d4d4; color: #111;
       break-after: avoid; }
  h3 { font-family: Inter, Helvetica, sans-serif; font-size: 11.5pt; margin: 15pt 0 5pt;
       color: #a8560d; break-after: avoid; }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
  p { margin: 0 0 9pt; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 10pt; padding-left: 16pt; }
  li { margin-bottom: 4pt; }
  blockquote { margin: 11pt 0 11pt 10pt; padding: 2pt 0 2pt 12pt;
               border-left: 2.5pt solid #d98a2b; font-style: italic; color: #3c3c3c; }
  blockquote p { margin: 4pt 0; }
  em { color: #555; }
  strong { color: #000; }
  code { font-family: 'SF Mono', Consolas, monospace; font-size: 9.5pt;
         background: #f2f2f2; padding: 1pt 3pt; border-radius: 2pt; }
  pre { background: #f6f6f6; padding: 8pt; border-radius: 3pt; overflow: hidden;
        white-space: pre-wrap; font-size: 9pt; }
  hr { border: 0; border-top: 0.6pt solid #ddd; margin: 16pt 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 10pt 0; }
  th, td { border-bottom: 0.6pt solid #ddd; padding: 4pt 6pt; text-align: left; }
  h1 + p em { display: block; margin-bottom: 16pt; color: #777; font-size: 10.5pt; }
</style></head>
<body>${renderMarkdown(markdown)}</body></html>`);
  doc.close();

  const print = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Keep the frame alive long enough for the dialog to read from it.
    setTimeout(() => frame.remove(), 60_000);
  };

  // Wait for webfonts so the PDF matches the on-screen design.
  const fonts: FontFaceSet | undefined = doc.fonts;
  if (fonts) {
    fonts.ready.then(() => setTimeout(print, 150));
  } else {
    setTimeout(print, 600);
  }
}
