import sanitizeHtml from "sanitize-html";

/**
 * Small, dependency-free Markdown to HTML renderer for the official Help Center.
 *
 * Content is authored by the platform (trusted), so we cover exactly the
 * features our articles use instead of pulling a full Markdown engine:
 *   headings (#..######), paragraphs, unordered / ordered lists, bold, italic,
 *   inline code, fenced code blocks, blockquote, [links](url) (internal and
 *   external), GFM pipe tables and horizontal rules.
 *
 * The output is ALWAYS run through sanitize-html so that, even though the
 * source is trusted, no raw/dangerous HTML can ever reach the browser. The
 * frontend renders the result via dangerouslySetInnerHTML, so sanitizing here
 * is what makes that safe.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "target", "rel"],
  th: ["colspan", "rowspan", "align"],
  td: ["colspan", "rowspan", "align"],
};

// Private-use-area sentinels for inline-code placeholders. These characters
// never occur in authored prose, so placeholders cannot collide with real text
// (unlike space-delimited numbers, which would clash with e.g. "top 5 items").
const CODE_OPEN = String.fromCharCode(0xe000);
const CODE_CLOSE = String.fromCharCode(0xe001);

export function markdownToHtml(markdown: string): string {
  const html = renderBlocks(markdown ?? "");
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // Relative (internal) links are allowed by omitting them from schemes.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const isExternal = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: isExternal
            ? { ...attribs, target: "_blank", rel: "noopener noreferrer" }
            : attribs,
        };
      },
    },
  });
}

function renderBlocks(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line - skip.
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block.
    if (/^```/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    // GFM pipe table (header row followed by a delimiter row).
    if (line.includes("|") && isTableDelimiter(lines[i + 1])) {
      const table: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        table.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(table));
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(
        `<blockquote><p>${renderInline(quote.join(" ").trim())}</p></blockquote>`,
      );
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(
          `<li>${renderInline(lines[i].replace(/^[-*]\s+/, "").trim())}</li>`,
        );
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(
          `<li>${renderInline(lines[i].replace(/^\d+\.\s+/, "").trim())}</li>`,
        );
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Paragraph - gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isBlockStart(lines[i], lines[i + 1])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

function isBlockStart(line: string, next?: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    (line.includes("|") && isTableDelimiter(next))
  );
}

function isTableDelimiter(line: string | undefined): boolean {
  if (!line) return false;
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line);
}

function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(rows: string[]): string {
  const [headerRow, , ...bodyRows] = rows;
  const headers = splitRow(headerRow);
  const head = headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const body = bodyRows
    .map(
      (row) =>
        `<tr>${splitRow(row)
          .map((cell) => `<td>${renderInline(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  // Extract inline code spans first so their contents are never re-processed.
  const codeSpans: string[] = [];
  let working = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(escapeHtml(code));
    return `${CODE_OPEN}${codeSpans.length - 1}${CODE_CLOSE}`;
  });

  working = escapeHtml(working);

  // Links: [text](url)
  working = working.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) => `<a href="${url}">${label}</a>`,
  );

  // Bold, then italic (bold first so ** is not eaten by the * rule).
  working = working.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  working = working.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  working = working.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  working = working.replace(/(?<![\w*])_([^_\n]+?)_(?![\w])/g, "<em>$1</em>");

  // Restore code spans.
  working = working.replace(
    new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, "g"),
    (_m, idx: string) => `<code>${codeSpans[Number(idx)] ?? ""}</code>`,
  );

  return working;
}
