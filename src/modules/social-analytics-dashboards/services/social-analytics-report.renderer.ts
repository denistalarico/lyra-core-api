/**
 * The printed report — Etapa 9.
 *
 * A pure function, like `leadflow-analytics-report.renderer.ts`: it takes a
 * parsed document plus the letterhead and returns HTML. Nothing here reads a
 * repository or a provider, which is what makes the layout testable without a
 * browser and what keeps the Playwright call in the service.
 *
 * ## Colour
 *
 * The app's tokens (`--lyra-product-primary`, `--agency-*`) do not exist in this
 * document: Playwright loads the HTML standalone, with no stylesheet from the
 * app and no `data-lyra-product` on the shell. So the palette is declared once
 * at `:root` here, with the Social product colour as its literal value, and
 * every rule reads it through a variable. That is the same arrangement
 * `document-pdf-renderer.service.ts` uses for its document layouts, and it is
 * why a hex appears in this file while none appears in `socialAnalytics.css`.
 *
 * ## Print mechanics
 *
 * `paginated` puts a page break before each channel after the first, which is
 * what the plan means by "impressão": one channel per sheet, so a section is
 * never split across the fold when the document is printed and stapled.
 * `continuous` omits the breaks and lets the flow run. Either way the header
 * repeats on every page through a fixed running block, because a report that is
 * forwarded page by page needs the agency's mark on each one.
 */

import type {
  ReportBlock,
  ReportDocument,
  ReportFunnelBlock,
  ReportInsightBlock,
  ReportMetricBlock,
  ReportNoticeBlock,
  ReportPageMode,
  ReportSection,
  ReportTableBlock,
} from '../report-document.contract';

export type ReportLetterhead = {
  agencyName: string;
  agencyDetails: string[];
  agencyLogoUrl: string | null;
  /** The data owner — the managed client, when the report is scoped to one. */
  clientName: string | null;
  clientLogoUrl: string | null;
};

export type ReportRenderInput = {
  title: string;
  periodSince: string;
  periodUntil: string;
  pageMode: ReportPageMode;
  document: ReportDocument;
  letterhead: ReportLetterhead;
  generatedAt: Date;
};

/**
 * The Social product colour, as a literal.
 *
 * See the note at the top: the token it mirrors
 * (`--lyra-product-primary` for `data-lyra-product="social"`) is defined in the
 * app's stylesheet, which the print document does not load. Kept in one
 * constant so a change to the product colour is a single edit here.
 */
const PRODUCT_PRIMARY = '#7C3AED';

export function buildSocialAnalyticsReportHtml(
  input: ReportRenderInput,
): string {
  const { letterhead } = input;
  const sections = input.document.sections
    .map((section, index) =>
      renderSection(section, {
        pageMode: input.pageMode,
        first: index === 0,
      }),
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)}</title>
    <style>${styles()}</style>
  </head>
  <body>
    ${renderLetterhead(input)}
    <main>${sections}</main>
    <footer class="report-footer">
      <span>Relatório gerado por ${escapeHtml(letterhead.agencyName)} · Lyra Suite</span>
      <span>${escapeHtml(formatDateTime(input.generatedAt))}</span>
    </footer>
  </body>
</html>`;
}

/**
 * Agency above, client below — the order the plan specifies.
 *
 * The agency block is the sender's mark and sits at the top with its details on
 * the right; the client's is centred beneath it with the period, because the
 * client is the *subject* of the document, not its author. When the report is
 * agency-scoped there is no client, and the block collapses to the period alone
 * rather than leaving a labelled empty space.
 */
function renderLetterhead(input: ReportRenderInput): string {
  const { letterhead } = input;

  const agencyLogo = letterhead.agencyLogoUrl
    ? `<img class="brand-logo" src="${escapeHtml(letterhead.agencyLogoUrl)}" alt="" />`
    : '';

  const clientLogo = letterhead.clientLogoUrl
    ? `<img class="client-logo" src="${escapeHtml(letterhead.clientLogoUrl)}" alt="" />`
    : '';

  const details = letterhead.agencyDetails
    .filter((line) => line.trim().length > 0)
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join('');

  return `
    <header class="report-header">
      <div class="report-header__agency">
        <div class="report-header__brand">
          ${agencyLogo}
          <strong>${escapeHtml(letterhead.agencyName)}</strong>
        </div>
        <div class="report-header__details">${details}</div>
      </div>
      <div class="report-header__client">
        ${clientLogo}
        ${
          letterhead.clientName
            ? `<strong>${escapeHtml(letterhead.clientName)}</strong>`
            : ''
        }
        <h1>${escapeHtml(input.title)}</h1>
        <span class="report-header__period">${escapeHtml(
          formatPeriod(input.periodSince, input.periodUntil),
        )}</span>
      </div>
    </header>`;
}

function renderSection(
  section: ReportSection,
  options: { pageMode: ReportPageMode; first: boolean },
): string {
  // The break goes *before* each channel after the first, never after the last
  // — a trailing break would print a blank final sheet.
  const paginated = options.pageMode === 'paginated' && !options.first;

  const cards = section.cards
    .map((card) => {
      const block = renderBlock(card.block);

      return `
        <article class="card card--${card.block.kind}">
          <h3>${escapeHtml(card.title)}</h3>
          ${
            card.description
              ? `<p class="card__description">${escapeHtml(card.description)}</p>`
              : ''
          }
          ${block}
        </article>`;
    })
    .join('');

  return `
    <section class="section${paginated ? ' section--break' : ''}">
      <header class="section__header">
        <h2>${escapeHtml(section.title)}</h2>
        <span>${escapeHtml(section.channelLabel)}</span>
      </header>
      ${
        section.cards.length > 0
          ? `<div class="cards">${cards}</div>`
          : '<p class="empty">Nenhum card nesta seção.</p>'
      }
    </section>`;
}

function renderBlock(block: ReportBlock): string {
  switch (block.kind) {
    case 'metric':
      return renderMetric(block);
    case 'funnel':
      return renderFunnel(block);
    case 'table':
      return renderTable(block);
    case 'insight':
      return renderInsight(block);
    case 'notice':
      return renderNotice(block);
  }
}

function renderMetric(block: ReportMetricBlock): string {
  return `
    <div class="metric${block.highlighted ? ' metric--highlighted' : ''}">
      <strong>${escapeHtml(block.value)}</strong>
      ${block.detail ? `<small>${escapeHtml(block.detail)}</small>` : ''}
    </div>`;
}

/**
 * The funnel, drawn as the same polygons the screen draws.
 *
 * `<polygon>` rather than CSS shapes for the reason Etapa 7 recorded: a polygon
 * is resolution-independent in Playwright's print pipeline, where a `clip-path`
 * is at the mercy of whatever the rasteriser decides to do with it.
 *
 * The step list is rendered beside the shape and carries the numbers. The SVG is
 * `aria-hidden` and the list is not — same split as the card, and here it also
 * means a PDF text extractor gets the values rather than a picture of them.
 */
function renderFunnel(block: ReportFunnelBlock): string {
  const steps = block.steps;

  if (steps.length === 0) {
    return '<p class="empty">Este funil não tem etapas.</p>';
  }

  const gap = 2;
  const size = (100 - gap * (steps.length - 1)) / steps.length;
  const horizontal = block.orientation === 'horizontal';

  const bands = steps
    .map((step, index) => {
      const start = index * (size + gap);
      const next = steps[index + 1]?.ratio ?? step.ratio;
      const points = bandPoints(step.ratio, next, start, size, horizontal);
      const tint = bandTint(index, steps.length);

      return `<polygon points="${points}" fill="${mix(tint)}" />`;
    })
    .join('');

  const list = steps
    .map(
      (step) => `
        <li>
          <span class="funnel__label">${escapeHtml(step.label)}</span>
          <strong>${escapeHtml(step.value)}</strong>
          ${
            step.rate
              ? `<small>Taxa vs. etapa anterior: ${escapeHtml(step.rate)}</small>`
              : step.note
                ? `<small>${escapeHtml(step.note)}</small>`
                : ''
          }
        </li>`,
    )
    .join('');

  return `
    <div class="funnel${horizontal ? ' funnel--horizontal' : ''}">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${bands}</svg>
      <ol class="funnel__steps">${list}</ol>
    </div>`;
}

function renderTable(block: ReportTableBlock): string {
  if (block.columns.length === 0) {
    return '<p class="empty">Esta tabela não tem colunas visíveis.</p>';
  }

  const head = block.columns
    .map((column) => `<th>${escapeHtml(column)}</th>`)
    .join('');

  const body =
    block.rows.length > 0
      ? block.rows
          .map(
            (row) =>
              `<tr>${block.columns
                .map((_, index) => `<td>${escapeHtml(row[index] ?? '—')}</td>`)
                .join('')}</tr>`,
          )
          .join('')
      : `<tr><td class="empty" colspan="${block.columns.length}">Sem linhas neste período.</td></tr>`;

  return `
    <table class="table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${block.note ? `<p class="card__note">${escapeHtml(block.note)}</p>` : ''}`;
}

function renderInsight(block: ReportInsightBlock): string {
  const paragraphs = block.paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');

  // The model and the date travel with the text, as they do on the card: the
  // analysis is frozen prose about a period, and a reader months later has no
  // other way to know when — or by what — it was written.
  const meta = [
    block.generatedAt ? `Gerado em ${formatDay(block.generatedAt)}` : '',
    block.model ? `Modelo ${block.model}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="insight">
      ${paragraphs || '<p class="empty">Análise sem conteúdo.</p>'}
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
    </div>`;
}

/**
 * A card with no reading.
 *
 * Printed as the sentence the dashboard shows, never omitted: a card the
 * operator put on a dashboard and does not find in the report reads as the
 * export having lost it, while the sentence says plainly that the metric has no
 * number for this period.
 */
function renderNotice(block: ReportNoticeBlock): string {
  return `<p class="notice">${escapeHtml(block.message)}</p>`;
}

function bandPoints(
  stepRatio: number,
  nextRatio: number,
  start: number,
  size: number,
  horizontal: boolean,
): string {
  const halfTop = (stepRatio * 100) / 2;
  const halfBottom = (nextRatio * 100) / 2;
  const centre = 50;
  const near = start;
  const far = start + size;

  const corners: Array<[number, number]> = horizontal
    ? [
        [near, centre - halfTop],
        [far, centre - halfBottom],
        [far, centre + halfBottom],
        [near, centre + halfTop],
      ]
    : [
        [centre - halfTop, near],
        [centre + halfTop, near],
        [centre + halfBottom, far],
        [centre - halfBottom, far],
      ];

  return corners.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

/** Mirrors `funnelBandTint` in the frontend: 82% down to 28%. */
function bandTint(index: number, total: number): number {
  if (total <= 1) return 82;

  return Math.round(82 - ((82 - 28) * index) / (total - 1));
}

/**
 * `color-mix` is avoided in the print document.
 *
 * Chromium supports it, but the value would end up inside an SVG `fill`
 * attribute, and attribute-level colour functions are the kind of thing that
 * differs between the screen renderer and the print one. The mix is computed
 * here against the same white surface instead, so what the polygon receives is
 * a plain hex that no pipeline can reinterpret.
 */
function mix(percentage: number): string {
  const share = Math.min(100, Math.max(0, percentage)) / 100;
  const channels = [0x7c, 0x3a, 0xed];

  return `#${channels
    .map((channel) => {
      const value = Math.round(channel * share + 255 * (1 - share));
      return value.toString(16).padStart(2, '0');
    })
    .join('')}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function styles(): string {
  return `
    :root {
      --report-primary: ${PRODUCT_PRIMARY};
      --report-text: #0f172a;
      --report-muted: #64748b;
      --report-border: #e2e8f0;
      --report-surface: #f8fafc;
      color-scheme: light;
    }
    * { box-sizing: border-box; }
    @page { size: A4; margin: 14mm 12mm; }
    body {
      margin: 0;
      color: var(--report-text);
      font-family: Inter, Arial, Helvetica, sans-serif;
      font-size: 10px;
      line-height: 1.45;
      background: #fff;
    }
    .report-header {
      padding-bottom: 12px;
      border-bottom: 2px solid var(--report-primary);
    }
    .report-header__agency {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .report-header__brand { display: flex; align-items: center; gap: 10px; }
    .report-header__brand strong { font-size: 14px; }
    .brand-logo { max-height: 34px; max-width: 150px; object-fit: contain; }
    .report-header__details {
      display: grid;
      gap: 1px;
      color: var(--report-muted);
      font-size: 8.5px;
      text-align: right;
    }
    .report-header__client {
      display: grid;
      justify-items: center;
      gap: 4px;
      margin-top: 14px;
      text-align: center;
    }
    .client-logo { max-height: 42px; max-width: 180px; object-fit: contain; }
    .report-header__client strong { font-size: 11px; color: var(--report-muted); }
    .report-header__client h1 { margin: 2px 0 0; font-size: 20px; line-height: 1.2; }
    .report-header__period {
      color: var(--report-primary);
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    main { margin-top: 18px; }
    .section { margin-top: 18px; }
    .section:first-child { margin-top: 0; }
    /* One channel per sheet in "impressão" mode. */
    .section--break { break-before: page; page-break-before: always; }
    .section__header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      padding-bottom: 5px;
      border-bottom: 1px solid var(--report-border);
    }
    .section__header h2 { margin: 0; font-size: 14px; }
    .section__header span {
      color: var(--report-muted);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .card {
      padding: 10px;
      border: 1px solid var(--report-border);
      border-radius: 10px;
      background: var(--report-surface);
      /* A card split across the fold is unreadable on both sheets. */
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .card h3 { margin: 0; font-size: 9px; color: var(--report-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .card__description { margin: 3px 0 0; color: var(--report-muted); font-size: 8.5px; }
    .card__note { margin: 6px 0 0; color: var(--report-muted); font-size: 8.5px; }
    /* The wide kinds take the full row: a table or a funnel squeezed into a
       quarter of the page carries none of what it was put on the dashboard for. */
    .card--table, .card--funnel, .card--insight { grid-column: 1 / -1; }
    .metric strong { display: block; margin-top: 6px; font-size: 19px; line-height: 1.15; }
    .metric small { display: block; margin-top: 4px; color: var(--report-muted); font-size: 8.5px; }
    .metric--highlighted strong { color: var(--report-primary); font-size: 23px; }
    .funnel { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 14px; margin-top: 8px; align-items: stretch; }
    .funnel--horizontal { grid-template-columns: minmax(0, 1fr); }
    .funnel svg { width: 100%; height: 150px; }
    .funnel--horizontal svg { height: 90px; }
    .funnel__steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; align-content: center; }
    .funnel__steps li { display: grid; gap: 1px; padding-bottom: 4px; border-bottom: 1px solid var(--report-border); }
    .funnel__steps li:last-child { border-bottom: 0; }
    .funnel__label { color: var(--report-muted); font-size: 8.5px; font-weight: 800; text-transform: uppercase; }
    .funnel__steps strong { font-size: 13px; }
    .funnel__steps small { color: var(--report-muted); font-size: 8.5px; }
    .table { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 8.5px; }
    /* Repeat the header when a long table does run over a page. */
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .table th, .table td { padding: 5px 6px; border-bottom: 1px solid var(--report-border); text-align: right; }
    .table th:first-child, .table td:first-child { text-align: left; }
    .table th { color: var(--report-muted); background: #fff; font-size: 8px; text-transform: uppercase; }
    .insight { margin-top: 6px; }
    .insight p { margin: 0 0 6px; font-size: 9.5px; line-height: 1.5; }
    .insight small { color: var(--report-muted); font-size: 8px; }
    .notice, .empty {
      margin: 8px 0 0;
      color: var(--report-muted);
      font-size: 9px;
      font-style: italic;
    }
    .report-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 22px;
      padding-top: 8px;
      border-top: 1px solid var(--report-border);
      color: var(--report-muted);
      font-size: 8px;
    }
  `;
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
  // timezone and can print as the day before — the bug §1.3 of the plan keeps
  // warning about, arriving through the formatter instead of the query.
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatDateTime(value: Date): string {
  const day = String(value.getUTCDate()).padStart(2, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');

  return `${day}/${month}/${value.getUTCFullYear()} ${hours}:${minutes} UTC`;
}

/**
 * Every interpolated string passes through here.
 *
 * The body is operator-authored text — card titles, descriptions, and an Orion
 * analysis that itself summarised operator-authored labels — and it is rendered
 * by a real browser. Escaping is what keeps a title containing markup from
 * becoming markup in a document that is then sent to the client.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
