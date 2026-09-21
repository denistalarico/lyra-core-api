/**
 * The versioned layout document stored in `social_analytics_dashboards.layout`.
 *
 * Kept as a contract module with no Nest dependency so the validator can be
 * unit-tested on its own and reused by the report renderer (Etapa 9) without
 * pulling the CRUD service in.
 *
 * `version` is the whole point of the shape: a reader that meets a document it
 * does not understand must refuse it rather than interpret a card kind it has
 * never seen. Etapas 6–8 add card kinds, and each addition widens this union
 * instead of adding a column.
 */

export const DASHBOARD_LAYOUT_VERSION = 1;

export const DASHBOARD_CHANNEL_IDS = [
  'facebook',
  'instagram',
  'meta_ads',
  'google_ads',
] as const;

export type DashboardChannelId = (typeof DASHBOARD_CHANNEL_IDS)[number];

export const DASHBOARD_CARD_KINDS = [
  'kpi',
  'chart',
  'table',
  'funnel',
  'insight',
] as const;

export type DashboardCardKind = (typeof DASHBOARD_CARD_KINDS)[number];

export type DashboardCardSize = { w: number; h: number };

/**
 * Cards are stored as read, not re-modelled field by field.
 *
 * The service validates the envelope — version, section shape, card id, kind
 * and size — and passes the kind-specific body through. Mirroring every field
 * of every card kind here would put a second definition of each card in the
 * backend, which would then have to be migrated in lockstep with the frontend
 * that actually renders them; the frontend's own types are the authority on the
 * body, and the grid limits are enforced where the cards are laid out.
 */
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
  facebook: 'Facebook',
  instagram: 'Instagram',
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
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

  const seenCardIds = new Set<string>();
  const cards = raw.cards.map((card) => {
    const parsed = parseCard(card);

    if (seenCardIds.has(parsed.id)) {
      throw new DashboardLayoutError('Há cards com o mesmo identificador.');
    }
    seenCardIds.add(parsed.id);

    return parsed;
  });

  return { id, channel: raw.channel, title, cards };
}

function parseCard(raw: unknown): DashboardCard {
  if (!isPlainObject(raw)) {
    throw new DashboardLayoutError('Um card do layout é inválido.');
  }

  const id = parseId(raw.id, 'card');

  if (!isCardKind(raw.kind)) {
    throw new DashboardLayoutError('Um card do layout tem tipo desconhecido.');
  }

  const size = parseSize(raw.size);

  // The body passes through, minus the envelope fields, which are rebuilt.
  return { ...raw, id, kind: raw.kind, size };
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
