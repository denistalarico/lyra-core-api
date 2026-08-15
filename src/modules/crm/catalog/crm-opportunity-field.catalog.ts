/**
 * The fields of an opportunity that policy may refer to.
 *
 * This replaces a bare allowlist of technical names that lived inside the
 * transition policy service. It exists as a catalog because four separate
 * consumers need to agree on the same answer to "which fields exist, what are
 * they called, and which ones mean a lead is qualified":
 *
 *  - stage transition policies, which require fields before an edge may be taken;
 *  - the Lead Score engine, whose qualification rule reads the essential ones;
 *  - Automations, whose `presentFields` signal must not invent a second
 *    definition of the same fact;
 *  - the settings UI, which has to show an operator real names rather than
 *    `contactPhone`.
 *
 * Two definitions of "required fields" would be two sources of truth about
 * whether a lead is complete, and they would drift.
 */

export type CrmOpportunityFieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'money'
  | 'date'
  | 'enum'
  | 'reference';

/** Where a field comes from. */
export type CrmOpportunityFieldOrigin =
  /** A column of the opportunity itself, present in every Business Mode. */
  | 'core'
  /** A qualification field declared by the active Business Mode template. */
  | 'business_mode'
  /**
   * A projection of the deterministic Lead Score. Not a column: the score
   * lives in its own 1:1 table so writing it cannot look like the deal
   * changing. Addressable so "qualified" can mean "the score says so".
   */
  | 'lead_score';

/** Coarse grouping, used only to organise the picker. */
export type CrmOpportunityFieldGroup =
  | 'contact'
  | 'deal'
  | 'schedule'
  | 'outcome'
  | 'system';

/** One value a field is known to take, named for an operator. */
export interface CrmOpportunityFieldOption {
  value: string;
  label: string;
}

export interface CrmOpportunityFieldSpec {
  /** Path used by policy: a column name, or `businessContext.<key>`. */
  key: string;
  /** Operator-facing name. Never a technical identifier. */
  label: string;
  type: CrmOpportunityFieldType;
  origin: CrmOpportunityFieldOrigin;
  group: CrmOpportunityFieldGroup;
  /**
   * Values this field is known to hold, so a rule can be built by picking
   * instead of by typing. Most of these columns are open `varchar`s rather than
   * database enums: the list is what the platform itself writes and what the
   * CRM offers, not a closed set. A consumer must therefore keep a stored value
   * that is no longer listed instead of discarding it.
   *
   * Absent for genuinely free text (a name, a title, a description) and for
   * Business Mode qualification answers, which declare no vocabulary.
   */
  options?: readonly CrmOpportunityFieldOption[];
  /**
   * Identifiers and internal plumbing. Usable in policy, but hidden from the
   * ordinary picker: an operator asked to require "contactId" is being asked a
   * question about the database, not about their business.
   */
  developerOnly: boolean;
  /**
   * Declared by the Business Mode as necessary for a lead to count as
   * qualified. Only ever true for `business_mode` fields — core fields are
   * shared by every mode and none of them defines qualification on its own.
   */
  essential: boolean;
}

/** Prefix under which Business Mode qualification answers are stored. */
export const CRM_BUSINESS_CONTEXT_PREFIX = 'businessContext.';

/** Shape a Business Mode qualification key must have to be addressable. */
export const CRM_BUSINESS_CONTEXT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * The origins the platform writes, in the CRM's own wording.
 *
 * LeadFlow sets `whatsapp` or the conversation's own channel when it projects an
 * opportunity out of the Inbox; the rest are what the opportunity form offers.
 */
const SOURCE_OPTIONS: readonly CrmOpportunityFieldOption[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'webchat', label: 'Webchat' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'email', label: 'E-mail' },
  { value: 'referral', label: 'Indicação' },
  { value: 'import', label: 'Importação' },
  { value: 'other', label: 'Outro' },
];

const PRIORITY_OPTIONS: readonly CrmOpportunityFieldOption[] = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

const CURRENCY_OPTIONS: readonly CrmOpportunityFieldOption[] = [
  { value: 'BRL', label: 'Real (BRL)' },
  { value: 'USD', label: 'Dólar (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'GBP', label: 'Libra (GBP)' },
];

/**
 * Written by the Inbox, not by hand: the operational status is the projection
 * of the conversation's ownership state onto the opportunity.
 */
const OPERATIONAL_STATUS_OPTIONS: readonly CrmOpportunityFieldOption[] = [
  { value: 'ai_active', label: 'Atendimento com o agente' },
  { value: 'handoff_requested', label: 'Handoff solicitado' },
  { value: 'human_active', label: 'Atendimento humano' },
  { value: 'paused', label: 'Pausado' },
  { value: 'closed', label: 'Encerrado' },
];

/**
 * Columns of the opportunity that policy may reference.
 *
 * Every entry corresponds to a real column on `crm_opportunities`; a label here
 * is a promise that the field can actually be read and shown.
 */
export const CRM_CORE_OPPORTUNITY_FIELDS: readonly CrmOpportunityFieldSpec[] = [
  field('contactName', 'Nome do contato', 'text', 'contact'),
  field('contactEmail', 'E-mail do contato', 'text', 'contact'),
  field('contactPhone', 'Telefone do contato', 'text', 'contact'),
  field('contactId', 'Contato vinculado', 'reference', 'contact', true),
  field('title', 'Título da oportunidade', 'text', 'deal'),
  field('description', 'Descrição', 'longText', 'deal'),
  field('valueAmount', 'Valor', 'money', 'deal'),
  field('currency', 'Moeda', 'enum', 'deal', false, CURRENCY_OPTIONS),
  field('priority', 'Prioridade', 'enum', 'deal', false, PRIORITY_OPTIONS),
  field('source', 'Origem', 'text', 'deal', false, SOURCE_OPTIONS),
  field('assignedUserId', 'Responsável', 'reference', 'deal', true),
  field('expectedCloseDate', 'Data prevista de fechamento', 'date', 'schedule'),
  field('nextFollowUpAt', 'Próximo follow-up', 'date', 'schedule'),
  field('lastActivityAt', 'Última atividade', 'date', 'schedule'),
  field('lostReason', 'Motivo da perda', 'text', 'outcome'),
  field(
    'operationalStatus',
    'Status operacional',
    'enum',
    'outcome',
    false,
    OPERATIONAL_STATUS_OPTIONS,
  ),
  field('businessMode', 'Business Mode', 'enum', 'system', true),
];

const CORE_KEYS = new Set(CRM_CORE_OPPORTUNITY_FIELDS.map((spec) => spec.key));

/** Bands the Lead Score resolves to, coldest first. Stable across versions. */
export const CRM_LEAD_SCORE_BAND_VALUES = ['cold', 'warm', 'hot'] as const;

const LEAD_SCORE_BAND_LABELS: Record<
  (typeof CRM_LEAD_SCORE_BAND_VALUES)[number],
  string
> = {
  cold: 'Frio',
  warm: 'Morno',
  hot: 'Quente',
};

/**
 * Virtual fields projecting the deterministic Lead Score into policy.
 *
 * The score is never a column on the opportunity — it lives in its own 1:1
 * projection so that writing it cannot look like the deal itself changing.
 * These keys let a transition policy read it anyway, so a stage can require a
 * qualified lead without inventing a second definition of the number.
 * `leadScore.band` is the version-stable signal (bands never move between
 * policy versions, so a published gate keeps meaning the same thing);
 * `leadScore.score` is the raw number, for an operator who prefers a floor.
 */
export const CRM_LEAD_SCORE_FIELDS: readonly CrmOpportunityFieldSpec[] = [
  {
    key: 'leadScore.band',
    label: 'Faixa do Lead Score',
    type: 'enum',
    origin: 'lead_score',
    group: 'system',
    developerOnly: false,
    essential: false,
    // The one genuinely closed vocabulary here: bands never move between policy
    // versions, which is what makes a published gate keep its meaning. Derived
    // from the band values themselves so a new band cannot go unnamed.
    options: CRM_LEAD_SCORE_BAND_VALUES.map((value) => ({
      value,
      label: LEAD_SCORE_BAND_LABELS[value],
    })),
  },
  {
    key: 'leadScore.score',
    label: 'Lead Score (pontos)',
    type: 'number',
    origin: 'lead_score',
    group: 'system',
    developerOnly: false,
    essential: false,
  },
];

const LEAD_SCORE_KEYS = new Set(CRM_LEAD_SCORE_FIELDS.map((spec) => spec.key));

/**
 * Whether a key addresses the Lead Score projection rather than a column.
 *
 * Callers that evaluate policy read these from the score's own table instead of
 * the opportunity, and load it only on demand — a policy that never mentions the
 * score must never pay for a query against it.
 */
export function isLeadScoreField(key: string): boolean {
  return LEAD_SCORE_KEYS.has(key);
}

/**
 * Whether a policy may reference this key at all.
 *
 * Deliberately structural rather than catalog-scoped: a published policy must
 * not become invalid because the client later switched Business Mode. The
 * catalog decides what to *offer*; this decides what is *addressable*.
 */
export function isAddressableOpportunityField(key: string): boolean {
  if (CORE_KEYS.has(key)) return true;
  if (LEAD_SCORE_KEYS.has(key)) return true;
  if (!key.startsWith(CRM_BUSINESS_CONTEXT_PREFIX)) return false;
  return CRM_BUSINESS_CONTEXT_KEY_PATTERN.test(
    key.slice(CRM_BUSINESS_CONTEXT_PREFIX.length),
  );
}

/** Core spec for a key, when it is one. */
export function coreFieldSpec(
  key: string,
): CrmOpportunityFieldSpec | undefined {
  return CRM_CORE_OPPORTUNITY_FIELDS.find((spec) => spec.key === key);
}

/**
 * Turns a Business Mode template's persisted qualification fields into specs.
 *
 * The template stores `{ key, label, type, required }`; the key is a slug of
 * the operator-facing label and is stored on the opportunity under
 * `businessContext`. Entries that are not addressable are dropped rather than
 * silently repaired — a malformed key would otherwise become a field that can
 * be selected but never read.
 */
export function businessModeFieldSpecs(
  qualificationFields: readonly Record<string, unknown>[],
): CrmOpportunityFieldSpec[] {
  const specs: CrmOpportunityFieldSpec[] = [];
  const seen = new Set<string>();

  for (const entry of qualificationFields) {
    const rawKey = entry.key;
    const rawLabel = entry.label;
    if (typeof rawKey !== 'string' || typeof rawLabel !== 'string') continue;
    if (!CRM_BUSINESS_CONTEXT_KEY_PATTERN.test(rawKey)) continue;

    const key = `${CRM_BUSINESS_CONTEXT_PREFIX}${rawKey}`;
    if (seen.has(key) || CORE_KEYS.has(key)) continue;
    seen.add(key);

    specs.push({
      key,
      label: rawLabel,
      type: templateType(entry.type),
      origin: 'business_mode',
      group: 'deal',
      developerOnly: false,
      // The template marks which answers a qualified lead must have given.
      essential: entry.required === true,
    });
  }

  return specs;
}

function templateType(value: unknown): CrmOpportunityFieldType {
  if (value === 'textarea') return 'longText';
  if (value === 'number') return 'number';
  if (value === 'date') return 'date';
  if (value === 'select' || value === 'enum') return 'enum';
  return 'text';
}

function field(
  key: string,
  label: string,
  type: CrmOpportunityFieldType,
  group: CrmOpportunityFieldGroup,
  developerOnly = false,
  options?: readonly CrmOpportunityFieldOption[],
): CrmOpportunityFieldSpec {
  return {
    key,
    label,
    type,
    origin: 'core',
    group,
    developerOnly,
    essential: false,
    ...(options ? { options } : {}),
  };
}
