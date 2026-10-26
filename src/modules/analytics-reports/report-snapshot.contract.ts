/**
 * The body a report is rendered from: a snapshot of the dashboard as the
 * operator sees it.
 *
 * ## Why the body is the rendered dashboard, not a list of values
 *
 * The first version sent every card as formatted strings and printed them as a
 * column of boxes. The numbers agreed with the screen, but nothing else did: the
 * grid the operator arranged, the card sizes, the charts, the table rows and the
 * thumbnails were all gone. A dashboard is saved exactly so the client sees it
 * that way, and a PDF that re-lays it out is a different document.
 *
 * So the client clones the blocks it is exporting, with the editing controls
 * removed and the images inlined, together with the CSS rules those blocks use.
 * The values are still the strings the cards render; the same rule as before,
 * now including the layout.
 *
 * ## What the server contributes, and what keeps the body inert
 *
 * The letterhead (the agency's document model, the client's name and logo) is
 * still read here and never accepted from the request.
 *
 * The body is operator-supplied markup rendered by a real browser, so three
 * things hold it down:
 *
 * - Chromium renders it with JavaScript disabled;
 * - every network request is refused except the few the service allows (see
 *   `SocialAnalyticsReportService`), so markup cannot make the server fetch
 *   an internal address;
 * - this parser refuses the elements that only exist to run or embed something.
 *   A snapshot built by the dashboard never contains them, so finding one means
 *   the body did not come from the dashboard.
 *
 * The preview goes back to the browser inside an iframe sandboxed without
 * `allow-scripts`, which is the same guarantee on the other side.
 */

export class ReportSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportSnapshotError';
  }
}

export const REPORT_PAGE_MODES = ['paginated', 'continuous'] as const;

export type ReportPageMode = (typeof REPORT_PAGE_MODES)[number];

export const REPORT_ORIENTATIONS = ['portrait', 'landscape'] as const;

export type ReportOrientation = (typeof REPORT_ORIENTATIONS)[number];

export type ReportSnapshot = {
  version: 2;
  /** The width the blocks had on screen, in CSS pixels. */
  width: number;
  /** The cloned blocks, inside the wrappers that carry the app's classes. */
  html: string;
  /** The app's CSS rules that match something in `html`. */
  css: string;
  /** Attributes of the app's `<html>`, e.g. `data-lyra-product`. */
  rootAttributes: Record<string, string>;
};

export const REPORT_SNAPSHOT_VERSION = 2;

/** Room for inlined thumbnails; the JSON body limit is 10 MB. */
const MAX_HTML = 8_000_000;
const MAX_CSS = 1_500_000;
const MIN_WIDTH = 320;
const MAX_WIDTH = 3_840;
const MAX_ROOT_ATTRIBUTES = 12;

/**
 * Elements a dashboard never renders and that exist to execute or embed.
 * Matched on the opening tag; text content is escaped (`&lt;script`), and the
 * client drops the label attributes a title is repeated in, so a card title
 * that mentions one does not trip it. Inline handlers are not checked: with
 * scripts off on both sides there is nothing to run them.
 */
const FORBIDDEN_TAGS =
  /<\s*(script|iframe|frame|object|embed|base|meta|link|form)\b/i;
const ATTRIBUTE_NAME = /^(lang|dir|class|data-[a-z0-9-]{1,40})$/;

export function parseReportSnapshot(raw: unknown): ReportSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReportSnapshotError('O conteúdo do relatório é inválido.');
  }

  const value = raw as Record<string, unknown>;

  if (value.version !== REPORT_SNAPSHOT_VERSION) {
    throw new ReportSnapshotError(
      'Versão do relatório não suportada. Recarregue a página e tente novamente.',
    );
  }

  const width = value.width;
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width < MIN_WIDTH ||
    width > MAX_WIDTH
  ) {
    throw new ReportSnapshotError('A largura do dashboard é inválida.');
  }

  const html = value.html;
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new ReportSnapshotError('O relatório não tem conteúdo.');
  }
  if (html.length > MAX_HTML) {
    throw new ReportSnapshotError(
      'O relatório ficou grande demais. Exporte menos canais por vez.',
    );
  }
  if (FORBIDDEN_TAGS.test(html)) {
    throw new ReportSnapshotError('O conteúdo do relatório é inválido.');
  }

  const css = value.css;
  if (typeof css !== 'string' || css.length > MAX_CSS) {
    throw new ReportSnapshotError('O estilo do relatório é inválido.');
  }
  // Closing the style element would let the stylesheet become markup.
  if (/<\/style/i.test(css)) {
    throw new ReportSnapshotError('O estilo do relatório é inválido.');
  }

  return {
    version: REPORT_SNAPSHOT_VERSION,
    width: Math.round(width),
    html,
    css,
    rootAttributes: parseRootAttributes(value.rootAttributes),
  };
}

function parseRootAttributes(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReportSnapshotError('O conteúdo do relatório é inválido.');
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_ROOT_ATTRIBUTES) {
    throw new ReportSnapshotError('O conteúdo do relatório é inválido.');
  }

  const attributes: Record<string, string> = {};

  for (const [name, attribute] of entries) {
    if (
      !ATTRIBUTE_NAME.test(name) ||
      typeof attribute !== 'string' ||
      attribute.length > 200
    ) {
      throw new ReportSnapshotError('O conteúdo do relatório é inválido.');
    }
    attributes[name] = attribute;
  }

  return attributes;
}
