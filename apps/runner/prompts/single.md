Below is the full text of a short book or document.

Book: {{TITLE}}
{{AUTHOR_LINE}}

Produce exactly this structure in Markdown:

# {{TITLE}}

*A Socrates summary{{AUTHOR_SUFFIX}}*

## In one paragraph
A single tight paragraph — what this is, what it argues, and who it is for.

## Core argument
The spine of the text in 3–6 paragraphs.

## Key themes
Three to eight themes, each a `### ` heading followed by a short paragraph.

## Chapter-by-chapter
A `- **<chapter or section name>** — ` bullet per chapter or major section,
one to three sentences each, in order. If the text has no such divisions,
replace this section with `## How it unfolds` and give a short narrative of
the progression instead.

## Takeaways
Six to twelve concrete, self-contained bullets.

## Notable passages
The strongest verbatim quotations as `>` blockquotes. Omit if there are none.

--- BEGIN TEXT ---
{{CONTENT}}
--- END TEXT ---
