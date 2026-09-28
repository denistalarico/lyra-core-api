/**
 * The printed report.
 *
 * A pure function, like `leadflow-analytics-report.renderer.ts`: it takes the
 * snapshot and the letterhead and returns HTML. Nothing here reads a repository
 * or a provider, which keeps the layout testable without a browser and keeps
 * the Playwright call in the service.
 *
 * ## Three layers, in this order
 *
 * 1. The agency's document model: the same `.doc-header` / `.doc-footer`
 *    markup and template CSS a quote uses, so the report carries the model the
 *    agency picked in Vendas › Layout de documentos. Only the header and the
 *    footer are taken from it; the model's page decorations (the dark band of
 *    Authority, the side bar of Signature) are drawn for one sheet and would
 *    land in the middle of a multi-page report.
 * 2. The title: the client's company and the report title, which are not part
 *    of the dashboard on screen.
 * 3. The dashboard as the operator arranged it (see `report-snapshot.contract`),
 *    with the app's own CSS, forced to the light theme: paper is white whatever
 *    theme the operator exported from.
 *
 * ## Fitting a screen-wide grid onto paper
 *
 * The blocks keep the width they had on screen, so the grid, the card sizes and
 * the charts' drawn pixels all stay as they were, and the whole body is scaled
 * down with `zoom` to the printable width. Reflowing it to the page width
 * instead would move cards onto other rows, and the charts, which are drawn at
 * a fixed pixel size, would overflow their cards.
 *
 * ## Pages
 *
 * The margins belong to `@page`, and the footer repeats in the bottom margin of
 * every sheet through `@bottom-left` / `@bottom-right` boxes, with the page
 * count. On screen, where there are no pages, the preview draws one sheet with
 * the same margins and the model's footer at the end.
 */

import type {
  ReportOrientation,
  ReportPageMode,
  ReportSnapshot,
} from '../report-snapshot.contract';

export type ReportLetterhead = {
  /** The document model the agency chose: `essence`, `frame`, … */
  layoutType: string;
  /** The model's CSS, tokens already replaced. */
  layoutCss: string;
  headerHtml: string;
  footerHtml: string;
  /** Repeated on every printed page, left of the page count. */
  footerText: string;
  fontFamily: string;
  headingFontFamily: string;
  /** The client's company, when the report is scoped to a client. */
  clientName: string | null;
  clientLogoUrl: string | null;
};

export type ReportRenderInput = {
  title: string;
  periodSince: string;
  periodUntil: string;
  pageMode: ReportPageMode;
  orientation: ReportOrientation;
  snapshot: ReportSnapshot;
  letterhead: ReportLetterhead;
};

const PAGE_MM = {
  portrait: { width: 210, height: 297 },
  landscape: { width: 297, height: 210 },
} as const;

const MARGIN_MM = { top: 12, side: 12, bottom: 16 };

const PX_PER_MM = 96 / 25.4;

const LAYOUT_TYPES = new Set([
  'essence',
  'frame',
  'authority',
  'flow',
  'orbit',
  'pulse',
  'signature',
]);

/** The scale that fits the blocks' on-screen width into the printable width. */
export function reportZoom(
  width: number,
  orientation: ReportOrientation,
): number {
  const printable =
    (PAGE_MM[orientation].width - MARGIN_MM.side * 2) * PX_PER_MM;

  return Math.min(1, Math.round((printable / width) * 10_000) / 10_000);
}

export function buildSocialAnalyticsReportHtml(
  input: ReportRenderInput,
): string {
  const { letterhead, snapshot } = input;
  const layoutType = LAYOUT_TYPES.has(letterhead.layoutType)
    ? letterhead.layoutType
    : 'essence';

  return `<!doctype html>
<html lang="pt-BR"${rootAttributes(snapshot.rootAttributes)} data-theme="light">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)}</title>
    <style>${snapshot.css}</style>
    <style>${letterhead.layoutCss.replace(/<\/style/gi, '')}</style>
    <style>${reportCss(input)}</style>
  </head>
  <body class="social-report">
    <div class="doc-page doc-template-${layoutType} report-page">
      ${letterhead.headerHtml}
      ${renderTitle(input)}
      <div class="report-body" style="width: ${snapshot.width}px; zoom: ${reportZoom(snapshot.width, input.orientation)};">
        ${snapshot.html}
      </div>
      ${letterhead.footerHtml}
    </div>
  </body>
</html>`;
}

/** The client's company over the report title, with the period beneath. */
function renderTitle(input: ReportRenderInput): string {
  const { letterhead } = input;
  const logo = letterhead.clientLogoUrl
    ? `<img class="report-title__logo" src="${escapeHtml(letterhead.clientLogoUrl)}" alt="" />`
    : '';
  const client = letterhead.clientName
    ? `<span class="report-title__client">${escapeHtml(letterhead.clientName)}</span>`
    : '';

  return `
      <section class="report-title">
        ${logo}
        <div class="report-title__copy">
          ${client}
          <h1>${escapeHtml(input.title)}</h1>
          <p class="report-title__period">${escapeHtml(
            formatPeriod(input.periodSince, input.periodUntil),
          )}</p>
        </div>
      </section>`;
}

/**
 * The attributes the app's `<html>` carried, minus the theme, which the report
 * always sets to light. The contract already limited the names to `class`,
 * `lang`, `dir` and `data-*`.
 */
function rootAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .filter(([name]) => name !== 'data-theme' && name !== 'lang')
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
}

function reportCss(input: ReportRenderInput): string {
  const { letterhead } = input;
  const page = PAGE_MM[input.orientation];
  const font = cssFontFamily(letterhead.fontFamily, 'Inter');
  const headingFont = cssFontFamily(letterhead.headingFontFamily, 'Sora');
  const footerText = cssString(letterhead.footerText);
  const paginated = input.pageMode === 'paginated';

  return `
    @page {
      size: A4 ${input.orientation};
      margin: ${MARGIN_MM.top}mm ${MARGIN_MM.side}mm ${MARGIN_MM.bottom}mm;
      @bottom-left {
        content: ${footerText};
        vertical-align: top;
        padding-top: 5mm;
        color: #64748b;
        font: 8px/1.4 ${font}, Arial, sans-serif;
      }
      @bottom-right {
        content: "Página " counter(page) " de " counter(pages);
        vertical-align: top;
        padding-top: 5mm;
        color: #64748b;
        font: 8px/1.4 ${font}, Arial, sans-serif;
      }
    }

    html, body {
      min-height: 0;
      overflow: visible;
      background: #e2e8f0;
      color-scheme: light;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body.social-report {
      margin: 0;
      padding: 24px 0;
    }

    /* One sheet on screen, drawn with the printed margins. */
    .report-page.doc-page {
      overflow: visible;
      width: ${page.width}mm;
      min-height: ${page.height}mm;
      margin: 0 auto;
      padding: ${MARGIN_MM.top}mm ${MARGIN_MM.side}mm ${MARGIN_MM.bottom}mm;
      border: 0;
      border-radius: 0;
      background: #ffffff;
      box-shadow: 0 8px 28px rgb(15 23 42 / 16%);
    }

    /* The model's page decorations are sized for a single sheet. */
    .report-page.doc-page::before,
    .report-page.doc-page::after {
      content: none;
      display: none;
    }

    .report-page .doc-header {
      padding-top: 0;
    }

    /* Authority's header is white text over the dark band the page draws; with
       the band gone, the header carries it. */
    .doc-template-authority .doc-header {
      padding: 16px 20px;
      border-bottom: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, #0f172a 0%, #111827 58%, #1e3a8a 100%);
    }

    .doc-template-authority .doc-footer,
    .doc-template-signature .doc-header {
      margin: 0;
      padding-left: 0;
    }

    .report-page .doc-footer {
      margin-top: 24px;
    }

    .report-title {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 20px 0 22px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--doc-border, #e2e8f0);
      break-after: avoid;
      page-break-after: avoid;
    }

    .report-title__logo {
      flex: 0 0 auto;
      max-width: 120px;
      max-height: 52px;
      object-fit: contain;
    }

    .report-title__copy {
      min-width: 0;
    }

    .report-title__client {
      display: block;
      color: var(--doc-primary, #2563eb);
      font: 800 11px/1.3 ${headingFont}, Arial, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .report-title h1 {
      margin: 4px 0 3px;
      color: var(--doc-text, #0f172a);
      font: 700 24px/1.15 ${headingFont}, Arial, sans-serif;
    }

    .report-title__period {
      margin: 0;
      color: var(--doc-muted, #64748b);
      font: 500 11px/1.4 ${font}, Arial, sans-serif;
    }

    .report-body {
      max-width: none;
    }

    .report-body [data-report-channel] + [data-report-channel] {
      margin-top: 24px;
    }

    /* Sticky under the app's topbar on screen; on paper it is just a heading. */
    .report-body .social-analytics__block-head {
      position: static;
      top: auto;
    }

    .report-body .social-analytics-card {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    @media print {
      html, body {
        background: #ffffff;
      }

      body.social-report {
        padding: 0;
      }

      .report-page.doc-page {
        width: auto;
        min-height: 0;
        padding: 0;
        box-shadow: none;
      }

      /* Printed pages carry the footer in their bottom margin instead. */
      .report-page .doc-footer {
        display: none;
      }
${
  paginated
    ? `
      /* "Impressão": one channel per sheet. */
      .report-body [data-report-channel] + [data-report-channel] {
        margin-top: 0;
        break-before: page;
        page-break-before: always;
      }`
    : ''
}
    }
  `;
}

/** A font family name the model stores, reduced to something safe to quote. */
function cssFontFamily(value: string, fallback: string): string {
  const name = value.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || fallback;

  return `"${name}"`;
}

/** A CSS string literal; `<` is escaped so the text cannot end the style element. */
function cssString(value: string): string {
  const escaped = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3C ');

  return `"${escaped}"`;
}

function formatPeriod(since: string, until: string): string {
  return since === until
    ? formatDay(since)
    : `${formatDay(since)} a ${formatDay(until)}`;
}

/** `YYYY-MM-DD` to `DD/MM/YYYY`, without constructing a `Date`. */
function formatDay(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  // A calendar day parsed into a Date would be re-anchored to the runtime's
  // timezone and can print as the day before.
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Every string the server interpolates passes through here. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
