Build a concept map of this book from the summary below.

Book: {{TITLE}}
{{AUTHOR_LINE}}

A concept map is the book's structure seen at a glance: the central idea, the
branches it divides into, and what sits under each. It is not an outline of the
chapters — it is the shape of the argument.

Rules:

- The root label is the book's central idea in a few words. Not the title.
- Give the root {{MIN_BRANCH}} to {{MAX_BRANCH}} branches. Each branch is a major
  theme, using the author's own vocabulary where they coin a term.
- Go at most {{DEPTH}} levels below the root. Leaves should be concrete — a
  claim, a distinction, a method — not a vague category.
- Labels are SHORT: two to six words, {{MAX_LABEL}} characters at the very most.
  A label is a handle, not a sentence.
- Every node must be supported by the summary. Do not add what the book does not
  say, and do not import outside knowledge about the book or its author.
- Prefer a balanced map. If one branch would hold ten children and another one,
  the grouping is wrong.

Reply with JSON and nothing else — no prose before or after, no code fence:

{"label": "central idea", "children": [
  {"label": "a theme", "children": [
    {"label": "something concrete"}
  ]}
]}

--- SUMMARY ---
{{SUMMARY}}
--- END SUMMARY ---
