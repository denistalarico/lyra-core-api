import { LEADFLOW_METRIC_CATALOG } from './leadflow-metric.catalog';
/** Versioned LeadFlow layout envelope, reusable by CA13 without Nest/CRUD. */

export const DASHBOARD_LAYOUT_VERSION = 1;

export const DASHBOARD_CHANNEL_IDS = [
  'overview',
  'service',
  'commercial',
  'lead_quality',
  'automations',
  'recommendations',
] as const;

export type DashboardChannelId = (typeof DASHBOARD_CHANNEL_IDS)[number];

export const DASHBOARD_CARD_KINDS = [
  'kpi',
  'chart',
  'table',
  'funnel',
  'insight',
  'breakdown',
  // A sub-block holds one level of cards; nested groups are refused.
  'group',
] as const;

export type DashboardCardKind = (typeof DASHBOARD_CARD_KINDS)[number];

export type DashboardCardSize = { w: number; h: number };

/** Envelope mirrors Social; parsing also validates canonical LeadFlow bodies. */
export type DashboardCard = {
  id: string;
  kind: DashboardCardKind;
  size: DashboardCardSize;
  [key: string]: unknown;
};

export type DashboardSection = {
  id: string;
  channel: DashboardChannelId;
  title: string;
  description?: string | null;
  cards: DashboardCard[];
};

export type DashboardLayout = {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  sections: DashboardSection[];
};

/** Bounds that exist to stop a payload from becoming a denial of service. */
const MAX_SECTIONS = 24;
const MAX_CARDS_PER_SECTION = 60;
const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_SECTION_DESCRIPTION_LENGTH = 280;
const MAX_CARDS_PER_GROUP = 40;

export function isDashboardChannelId(
  value: unknown,
): value is DashboardChannelId {
  return (
    typeof value === 'string' &&
    (DASHBOARD_CHANNEL_IDS as readonly string[]).includes(value)
  );
}

function isCardKind(value: unknown): value is DashboardCardKind {
  return (
    typeof value === 'string' &&
    (DASHBOARD_CARD_KINDS as readonly string[]).includes(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emptyDashboardLayout(
  channels: DashboardChannelId[],
): DashboardLayout {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    sections: channels.map((channel) => ({
      id: `section-${channel}`,
      channel,
      title: DEFAULT_SECTION_TITLES[channel],
      cards: [],
    })),
  };
}

const DEFAULT_SECTION_TITLES: Record<DashboardChannelId, string> = {
  overview: 'Visão geral',
  service: 'Atendimento',
  commercial: 'Comercial',
  lead_quality: 'Qualidade dos leads',
  automations: 'Automações',
  recommendations: 'Sugestões',
};

export class DashboardLayoutError extends Error {}

/**
 * Parses an untrusted layout document, or throws.
 *
 * Returns a newly built object rather than the input: the stored document must
 * not carry whatever extra top-level keys a caller attached, and rebuilding the
 * envelope is what guarantees that.
 */
export function parseDashboardLayout(value: unknown): DashboardLayout {
  if (!isPlainObject(value)) {
    throw new DashboardLayoutError('O layout do dashboard é inválido.');
  }

  if (value.version !== DASHBOARD_LAYOUT_VERSION) {
    throw new DashboardLayoutError(
      `Versão de layout não suportada. Esperado ${DASHBOARD_LAYOUT_VERSION}.`,
    );
  }

  if (!Array.isArray(value.sections)) {
    throw new DashboardLayoutError('O layout deve conter uma lista de seções.');
  }

  if (value.sections.length > MAX_SECTIONS) {
    throw new DashboardLayoutError('O layout tem seções demais.');
  }

  const seenSectionIds = new Set<string>();
  const sections = value.sections.map((raw) => {
    const section = parseSection(raw);

    if (seenSectionIds.has(section.id)) {
      throw new DashboardLayoutError('Há seções com o mesmo identificador.');
    }
    seenSectionIds.add(section.id);

    return section;
  });

  return { version: DASHBOARD_LAYOUT_VERSION, sections };
}

function parseSection(raw: unknown): DashboardSection {
  if (!isPlainObject(raw)) {
    throw new DashboardLayoutError('Uma seção do layout é inválida.');
  }

  const id = parseId(raw.id, 'seção');
  const title = parseTitle(raw.title);

  if (!isDashboardChannelId(raw.channel)) {
    throw new DashboardLayoutError(
      'Uma seção do layout aponta para um canal desconhecido.',
    );
  }

  if (!Array.isArray(raw.cards)) {
    throw new DashboardLayoutError('Uma seção do layout não tem cards.');
  }

  if (raw.cards.length > MAX_CARDS_PER_SECTION) {
    throw new DashboardLayoutError('Uma seção do layout tem cards demais.');
  }

  // One set for the whole section, sub-blocks included: the editor finds a
  // card by id without knowing which grid holds it.
  const seenCardIds = new Set<string>();
  const claim = (card: DashboardCard) => {
    if (seenCardIds.has(card.id)) {
      throw new DashboardLayoutError('Há cards com o mesmo identificador.');
    }
    seenCardIds.add(card.id);
  };

  const cards = raw.cards.map((card) => {
    const parsed = parseCard(card, { allowGroup: true });
    claim(parsed);

    if (parsed.kind === 'group') {
      (parsed.cards as DashboardCard[]).forEach(claim);
    }

    return parsed;
  });

  const description = parseSectionDescription(raw.description);

  return description === undefined
    ? { id, channel: raw.channel, title, cards }
    : { id, channel: raw.channel, title, description, cards };
}

/** Absent stays absent, so layouts that never had one are stored unchanged. */
function parseSectionDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== 'string') {
    throw new DashboardLayoutError('A descrição de uma seção é inválida.');
  }

  const description = value.trim();

  if (description.length > MAX_SECTION_DESCRIPTION_LENGTH) {
    throw new DashboardLayoutError('A descrição de uma seção é longa demais.');
  }

  return description.length > 0 ? description : null;
}

function parseCard(
  raw: unknown,
  { allowGroup }: { allowGroup: boolean },
): DashboardCard {
  if (!isPlainObject(raw)) {
    throw new DashboardLayoutError('Um card do layout é inválido.');
  }

  const id = parseId(raw.id, 'card');

  if (!isCardKind(raw.kind)) {
    throw new DashboardLayoutError('Um card do layout tem tipo desconhecido.');
  }

  const size = parseSize(raw.size);

  if (raw.kind === 'group') {
    if (!allowGroup) {
      throw new DashboardLayoutError(
        'Um sub-bloco não pode conter outro sub-bloco.',
      );
    }

    if (!Array.isArray(raw.cards)) {
      throw new DashboardLayoutError('Um sub-bloco do layout não tem cards.');
    }

    if (raw.cards.length > MAX_CARDS_PER_GROUP) {
      throw new DashboardLayoutError(
        'Um sub-bloco do layout tem cards demais.',
      );
    }

    const cards = raw.cards.map((card) =>
      parseCard(card, { allowGroup: false }),
    );

    return {
      ...raw,
      id,
      kind: raw.kind,
      size,
      cards,
      title: raw.title === undefined ? 'Grupo' : parseTitle(raw.title),
    };
  }

  const ids =
    raw.kind === 'chart'
      ? raw.metricIds
      : raw.kind === 'funnel'
        ? Array.isArray(raw.steps)
          ? raw.steps.map((step: unknown) =>
              isPlainObject(step) ? step.metric : null,
            )
          : [raw.source]
        : raw.kind === 'table'
          ? [raw.source]
          : raw.kind === 'insight'
            ? []
            : [raw.metric];
  if (
    !Array.isArray(ids) ||
    ids.length > 60 ||
    ids.some(
      (metric) => !LEADFLOW_METRIC_CATALOG.some((entry) => entry.id === metric),
    )
  ) {
    throw new DashboardLayoutError(
      'O card aponta para uma métrica desconhecida.',
    );
  }
  const metric = LEADFLOW_METRIC_CATALOG.find((entry) => entry.id === ids[0]);
  if (
    raw.kind !== 'insight' &&
    (ids.length !== 1 || metric?.kind !== raw.kind)
  ) {
    throw new DashboardLayoutError(
      'O tipo do card não corresponde à sua métrica.',
    );
  }
  if (
    raw.title !== undefined &&
    (typeof raw.title !== 'string' || raw.title.length > 120)
  )
    throw new DashboardLayoutError('Título do card inválido.');
  if (
    raw.description !== undefined &&
    raw.description !== null &&
    (typeof raw.description !== 'string' || raw.description.length > 280)
  )
    throw new DashboardLayoutError('Descrição do card inválida.');
  if (raw.kind === 'insight' && typeof raw.body !== 'string')
    throw new DashboardLayoutError('Análise inválida.');
  const defaults =
    raw.kind === 'chart'
      ? { chartType: 'line' }
      : raw.kind === 'funnel'
        ? { orientation: 'horizontal' }
        : raw.kind === 'breakdown'
          ? { render: 'chart' }
          : {};
  if (
    raw.kind === 'chart' &&
    raw.chartType !== undefined &&
    (typeof raw.chartType !== 'string' ||
      !['line', 'bar', 'area'].includes(raw.chartType))
  )
    throw new DashboardLayoutError('Gráfico inválido.');
  if (
    raw.kind === 'funnel' &&
    raw.orientation !== undefined &&
    (typeof raw.orientation !== 'string' ||
      !['horizontal', 'vertical'].includes(raw.orientation))
  )
    throw new DashboardLayoutError('Funil inválido.');
  if (
    raw.kind === 'breakdown' &&
    raw.render !== undefined &&
    (typeof raw.render !== 'string' || !['chart', 'table'].includes(raw.render))
  )
    throw new DashboardLayoutError('Distribuição inválida.');
  return { ...defaults, ...raw, id, kind: raw.kind, size };
}

function parseSize(raw: unknown): DashboardCardSize {
  if (!isPlainObject(raw)) {
    throw new DashboardLayoutError('Um card do layout não tem tamanho.');
  }

  const w = raw.w;
  const h = raw.h;

  if (!isPositiveInteger(w) || !isPositiveInteger(h)) {
    throw new DashboardLayoutError(
      'O tamanho de um card do layout é inválido.',
    );
  }

  // 12 columns (§4.2); the height cap matches the tallest card the grid allows.
  if (w > 12 || h > 8) {
    throw new DashboardLayoutError(
      'O tamanho de um card do layout excede a grade.',
    );
  }

  return { w, h };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DashboardLayoutError(`Um ${what} do layout está sem id.`);
  }

  if (value.length > MAX_ID_LENGTH) {
    throw new DashboardLayoutError(
      `O id de um ${what} do layout é longo demais.`,
    );
  }

  return value;
}

function parseTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DashboardLayoutError('Uma seção do layout está sem título.');
  }

  const title = value.trim();

  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new DashboardLayoutError('O título de uma seção é inválido.');
  }

  return title;
}
