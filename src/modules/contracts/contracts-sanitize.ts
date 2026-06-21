import sanitizeHtml from 'sanitize-html';

const STYLEABLE_TAGS = ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'table', 'th', 'td'];

const ALLOWED_TAGS = [
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'blockquote',
  'hr',
  'a',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  table: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

for (const tag of STYLEABLE_TAGS) {
  ALLOWED_ATTRIBUTES[tag] = [...(ALLOWED_ATTRIBUTES[tag] ?? []), 'style', 'class'];
}

/**
 * Sanitizes contract template HTML (body/legacy header/footer) before it is
 * embedded into the document rendered by Playwright for PDF generation.
 * Strips script/iframe/event-handler vectors; presets generated internally
 * by the renderer do not need to pass through this (they are trusted).
 */
export function sanitizeContractHtml(html: string | null | undefined): string {
  if (!html) {
    return '';
  }

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        width: [/^\d+(\.\d+)?(px|%)$/],
      },
    },
  });
}
