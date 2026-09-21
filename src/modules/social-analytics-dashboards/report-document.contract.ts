/**
 * The document a report is rendered from — Etapa 9.
 *
 * ## Why the content arrives from the client instead of being re-read here
 *
 * This is the same decision Etapa 8 made for Orion, for the same reason, and it
 * is the load-bearing one of this whole etapa: **the report has to agree with
 * the screen it was exported from.**
 *
 * A dashboard card shows "R$ 1.234,56" with the decimal places and the currency
 * its operator chose, or the sentence "Alcance do período ainda não medido"
 * where a measurement is missing. Re-reading those metrics server-side would
 * produce a second, independent answer: formatted by different code, possibly
 * landing on a different day boundary while today is still open, possibly
 * resolving a different ad account. A PDF that is sent to the client saying one
 * number while the dashboard behind it says another is indefensible, and nobody
 * downstream can tell which of the two is wrong.
 *
 * So the values travel as strings, already written the way the cards write them
 * — empty states included, because "não medido" is a reading and rendering a
 * zero in its place is the failure §2.1 of the plan exists to prevent.
 *
 * ## What the server contributes instead
 *
 * The letterhead. The agency's identity and logo are read here from
 * `workspace_company_settings`, never accepted from the request: the header of
 * a document that is forwarded to a client is precisely the part that must not
 * be spoofable by whatever posted the body.
 *
 * ## Why this file has no Nest imports
 *
 * Same reason as `dashboard-layout.contract.ts`: the global validation pipe runs
 * with `whitelist: true`, so any nested property not mirrored by a DTO class is
 * silently stripped on the way in. A report body is a deep tree of card shapes,
 * and mirroring every one of them in DTO classes would create a second
 * definition of each card kind to keep in sync with the frontend. The DTO
 * declares the envelope and `@IsObject()` keeps the body intact; this parser is
 * what refuses a malformed one.
 */

export class ReportDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportDocumentError';
  }
}

export const REPORT_PAGE_MODES = ['paginated', 'continuous'] as const;

export type ReportPageMode = (typeof REPORT_PAGE_MODES)[number];

export function isReportPageMode(value: unknown): value is ReportPageMode {
  return (REPORT_PAGE_MODES as readonly unknown[]).includes(value);
}

/** One reading, exactly as its card shows it. */
export type ReportMetricBlock = {
  kind: 'metric';
  label: string;
  value: string;
  /** The card's own note — "Medido em …", or why there is no number. */
  detail: string | null;
  /** Rendered larger, mirroring a highlighted KPI card. */
  highlighted: boolean;
};

/**
 * A funnel, already reduced to bands.
 *
 * The geometry travels as a ratio per step rather than as points, so that the
 * paper version is drawn by the same rule as the screen one (widths scaled
 * against the widest step, floored so the tail stays legible) without this
 * module having to re-derive it from values it deliberately does not parse.
 */
export type ReportFunnelBlock = {
  kind: 'funnel';
  orientation: 'vertical' | 'horizontal';
  steps: Array<{
    label: string;
    value: string;
    /** 0–1, already floored by the caller. */
    ratio: number;
    /** The conversion against the step above, or null when incomparable. */
    rate: string | null;
    note: string | null;
  }>;
};

/** A table's arrangement and the rows the card had on screen. */
export type ReportTableBlock = {
  kind: 'table';
  columns: string[];
  rows: string[][];
  note: string | null;
};

/** A frozen Orion analysis, carried as the paragraphs it was written as. */
export type ReportInsightBlock = {
  kind: 'insight';
  paragraphs: string[];
  generatedAt: string | null;
  model: string | null;
};

/** A card that has no reading — the sentence the dashboard shows in its place. */
export type ReportNoticeBlock = {
  kind: 'notice';
  message: string;
};

export type ReportBlock =
  | ReportMetricBlock
  | ReportFunnelBlock
  | ReportTableBlock
  | ReportInsightBlock
  | ReportNoticeBlock;

export type ReportCard = {
  title: string;
  description: string | null;
  block: ReportBlock;
};

export type ReportSection = {
  /** The channel's display label, not its id: this is print, not routing. */
  channelLabel: string;
  title: string;
  cards: ReportCard[];
};

export type ReportDocument = {
  version: 1;
  sections: ReportSection[];
};

const MAX_SECTIONS = 24;
const MAX_CARDS_PER_SECTION = 60;
const MAX_FUNNEL_STEPS = 12;
const MAX_TABLE_COLUMNS = 16;
const MAX_TABLE_ROWS = 100;
const MAX_INSIGHT_PARAGRAPHS = 30;
const MAX_TEXT = 400;
const MAX_PARAGRAPH = 4_000;

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReportDocumentError(`${what} inválido.`);
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new ReportDocumentError(`${what} inválido.`);
  }
  if (value.length > max) {
    throw new ReportDocumentError(`${what} excede o limite de ${max} itens.`);
  }

  return value;
}

/**
 * Text, trimmed and capped.
 *
 * Capped rather than rejected: every string here is display text an operator
 * typed into a card title, and a report that refuses to render because a title
 * is long would be a worse outcome than one that shortens it. Escaping is the
 * renderer's job, not this one's — a parser that escaped would produce a
 * document whose strings are only correct in HTML.
 */
function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max = MAX_TEXT): string | null {
  const parsed = text(value, max);
  return parsed.length > 0 ? parsed : null;
}

/** A width share, clamped into the band the funnel is allowed to draw. */
function ratio(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 0;

  return Math.min(1, Math.max(0, parsed));
}

function parseBlock(raw: unknown): ReportBlock {
  const block = asRecord(raw, 'Bloco do relatório');

  switch (block.kind) {
    case 'metric':
      return {
        kind: 'metric',
        label: text(block.label),
        value: text(block.value, 120),
        detail: optionalText(block.detail),
        highlighted: block.highlighted === true,
      };

    case 'funnel':
      return {
        kind: 'funnel',
        orientation:
          block.orientation === 'horizontal' ? 'horizontal' : 'vertical',
        steps: asArray(block.steps, 'Etapas do funil', MAX_FUNNEL_STEPS).map(
          (step) => {
            const entry = asRecord(step, 'Etapa do funil');

            return {
              label: text(entry.label),
              value: text(entry.value, 120),
              ratio: ratio(entry.ratio),
              rate: optionalText(entry.rate, 32),
              note: optionalText(entry.note),
            };
          },
        ),
      };

    case 'table': {
      const columns = asArray(
        block.columns,
        'Colunas da tabela',
        MAX_TABLE_COLUMNS,
      ).map((column) => text(column, 80));

      return {
        kind: 'table',
        columns,
        rows: asArray(block.rows, 'Linhas da tabela', MAX_TABLE_ROWS).map(
          (row) =>
            // Rows are truncated to the declared columns rather than padded
            // out: a row longer than its header would print cells under no
            // column at all, which reads as data belonging to the wrong field.
            asArray(row, 'Linha da tabela', MAX_TABLE_COLUMNS)
              .slice(0, columns.length)
              .map((cell) => text(cell, 120)),
        ),
        note: optionalText(block.note),
      };
    }

    case 'insight':
      return {
        kind: 'insight',
        paragraphs: asArray(
          block.paragraphs,
          'Parágrafos da análise',
          MAX_INSIGHT_PARAGRAPHS,
        )
          .map((paragraph) => text(paragraph, MAX_PARAGRAPH))
          .filter((paragraph) => paragraph.length > 0),
        generatedAt: optionalText(block.generatedAt, 40),
        model: optionalText(block.model, 80),
      };

    case 'notice':
      return { kind: 'notice', message: text(block.message) };

    default:
      throw new ReportDocumentError(
        `Tipo de bloco desconhecido no relatório: ${String(block.kind)}.`,
      );
  }
}

/**
 * Validates a posted report body and returns it in canonical shape.
 *
 * Rebuilding rather than returning the input: an unknown key at any level is
 * dropped instead of being carried into the renderer, so the HTML is only ever
 * built from fields this contract names.
 */
export function parseReportDocument(raw: unknown): ReportDocument {
  const document = asRecord(raw, 'Documento do relatório');

  if (document.version !== 1) {
    throw new ReportDocumentError(
      'Versão de relatório desconhecida. Atualize a página e tente novamente.',
    );
  }

  const sections = asArray(
    document.sections,
    'Seções do relatório',
    MAX_SECTIONS,
  ).map((rawSection) => {
    const section = asRecord(rawSection, 'Seção do relatório');

    return {
      channelLabel: text(section.channelLabel, 60),
      title: text(section.title, 120),
      cards: asArray(
        section.cards,
        'Cards da seção',
        MAX_CARDS_PER_SECTION,
      ).map((rawCard) => {
        const card = asRecord(rawCard, 'Card do relatório');

        return {
          title: text(card.title, 120),
          description: optionalText(card.description),
          block: parseBlock(card.block),
        };
      }),
    };
  });

  if (sections.length === 0) {
    throw new ReportDocumentError(
      'Selecione ao menos uma seção para gerar o relatório.',
    );
  }

  return { version: 1, sections };
}
