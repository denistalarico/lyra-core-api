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
  | 'business_mode';

/** Coarse grouping, used only to organise the picker. */
export type CrmOpportunityFieldGroup =
  | 'contact'
  | 'deal'
  | 'schedule'
  | 'outcome'
  | 'system';

export interface CrmOpportunityFieldSpec {
  /** Path used by policy: a column name, or `businessContext.<key>`. */
  key: string;
  /** Operator-facing name. Never a technical identifier. */
  label: string;
  type: CrmOpportunityFieldType;
  origin: CrmOpportunityFieldOrigin;
  group: CrmOpportunityFieldGroup;
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
  field('currency', 'Moeda', 'enum', 'deal'),
  field('priority', 'Prioridade', 'enum', 'deal'),
  field('source', 'Origem', 'text', 'deal'),
  field('assignedUserId', 'Responsável', 'reference', 'deal', true),
  field('expectedCloseDate', 'Data prevista de fechamento', 'date', 'schedule'),
  field('nextFollowUpAt', 'Próximo follow-up', 'date', 'schedule'),
  field('lastActivityAt', 'Última atividade', 'date', 'schedule'),
  field('lostReason', 'Motivo da perda', 'text', 'outcome'),
  field('operationalStatus', 'Status operacional', 'enum', 'outcome'),
  field('businessMode', 'Business Mode', 'enum', 'system', true),
];

const CORE_KEYS = new Set(CRM_CORE_OPPORTUNITY_FIELDS.map((spec) => spec.key));

/**
 * Whether a policy may reference this key at all.
 *
 * Deliberately structural rather than catalog-scoped: a published policy must
 * not become invalid because the client later switched Business Mode. The
 * catalog decides what to *offer*; this decides what is *addressable*.
 */
export function isAddressableOpportunityField(key: string): boolean {
  if (CORE_KEYS.has(key)) return true;
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
): CrmOpportunityFieldSpec {
  return {
    key,
    label,
    type,
    origin: 'core',
    group,
    developerOnly,
    essential: false,
  };
}
