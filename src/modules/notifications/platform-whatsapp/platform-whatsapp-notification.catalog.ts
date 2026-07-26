/**
 * Logical → physical template catalog for platform WhatsApp notifications.
 *
 * Consumers (executors, publishers) only ever name a LOGICAL `templateKey`. The
 * physical provider template name lives here, resolved at the provider boundary
 * — so no caller knows or can invent `lyra_leadflow_handoff_alert_v1`, and the
 * physical name can change with the WABA without touching a single consumer.
 */

/** The one logical key this phase implements. */
export const LEADFLOW_HANDOFF_TEMPLATE_KEY = 'leadflow.handoff.requested';

/**
 * Body variables of the handoff alert, as an explicit named contract rather than
 * a positional array. The approved template declares three variables IN THIS
 * ORDER; the provider is the only place allowed to flatten them to Meta's array.
 *
 *   {{1}} = workspaceName · {{2}} = contactDisplayName · {{3}} = handoffReason
 */
export interface LeadFlowHandoffTemplateVariables {
  workspaceName: string;
  contactDisplayName: string;
  handoffReason: string;
}

export type PlatformWhatsAppTemplateCategory =
  | 'utility'
  | 'marketing'
  | 'authentication';
export type PlatformWhatsAppTemplateStatus =
  | 'approved'
  | 'pending'
  | 'unavailable';

/**
 * A registered provider template. `businessModeKey` is optional and reserved:
 * Business-Mode-specific templates are only ever declared here as contract; none
 * is registered or implemented this phase.
 */
export interface PlatformWhatsAppTemplateDefinition {
  templateKey: string;
  businessModeKey?: string | null;
  providerTemplateName: string;
  languageCode: string;
  category: PlatformWhatsAppTemplateCategory;
  status: PlatformWhatsAppTemplateStatus;
  version: number;
}

/**
 * The registry. Only the generic handoff alert is registered. Future
 * per-Business-Mode templates belong here as additional entries with the same
 * `templateKey` and a set `businessModeKey`; until approved and added, resolution
 * falls back to the generic entry, then to "unavailable".
 */
export const PLATFORM_WHATSAPP_TEMPLATES: readonly PlatformWhatsAppTemplateDefinition[] =
  [
    {
      templateKey: LEADFLOW_HANDOFF_TEMPLATE_KEY,
      businessModeKey: null,
      providerTemplateName: 'lyra_leadflow_handoff_alert_v1',
      languageCode: 'pt_BR',
      category: 'utility',
      status: 'approved',
      version: 1,
    },
  ];

/**
 * Resolves a logical key (optionally scoped to a Business Mode) to a physical
 * template: a Business-Mode-specific entry wins, then the generic entry for the
 * key, else null — the caller maps null onto `skipped_template_unavailable`.
 */
export function resolvePlatformWhatsAppTemplate(
  templateKey: string,
  businessModeKey?: string | null,
): PlatformWhatsAppTemplateDefinition | null {
  const forKey = PLATFORM_WHATSAPP_TEMPLATES.filter(
    (template) =>
      template.templateKey === templateKey && template.status === 'approved',
  );
  if (forKey.length === 0) {
    return null;
  }
  if (businessModeKey) {
    const specific = forKey.find(
      (template) => template.businessModeKey === businessModeKey,
    );
    if (specific) {
      return specific;
    }
  }
  return forKey.find((template) => !template.businessModeKey) ?? null;
}

/**
 * Whether a logical `templateKey` is one an agent may legitimately reference:
 * it must resolve to an approved template (Business-Mode-specific or generic).
 *
 * This is the guard for "the LLM may only suggest a templateKey from the
 * catalog" — an agent-suggested key that does not resolve is refused rather than
 * invented. Role-scoping and the agent-decision call site come with the phase
 * that lets agents propose templates.
 */
export function isPlatformWhatsAppTemplateKeyAllowed(
  templateKey: string,
  businessModeKey?: string | null,
): boolean {
  return resolvePlatformWhatsAppTemplate(templateKey, businessModeKey) !== null;
}

/** Terminal fallbacks, applied when a variable is empty after normalization. */
export const HANDOFF_VARIABLE_FALLBACKS: LeadFlowHandoffTemplateVariables = {
  workspaceName: 'Sua empresa',
  contactDisplayName: 'Contato sem nome',
  handoffReason: 'Solicitação de atendimento humano',
};

const MAX_PARAMETER_LENGTH = 160;

/**
 * Flattens the named variables to Meta's positional body parameters, IN THE
 * APPROVED ORDER, applying normalization and terminal fallbacks.
 *
 * Normalization makes each value template-safe (Meta rejects newlines, tabs and
 * runs of 4+ spaces in body parameters) and caps length. It is not a substitute
 * for the caller keeping sensitive data out of the variables in the first place.
 */
export function buildHandoffTemplateParameters(
  variables: LeadFlowHandoffTemplateVariables,
): [string, string, string] {
  return [
    normalizeParameter(
      variables.workspaceName,
      HANDOFF_VARIABLE_FALLBACKS.workspaceName,
    ),
    normalizeParameter(
      variables.contactDisplayName,
      HANDOFF_VARIABLE_FALLBACKS.contactDisplayName,
    ),
    normalizeParameter(
      variables.handoffReason,
      HANDOFF_VARIABLE_FALLBACKS.handoffReason,
    ),
  ];
}

function normalizeParameter(
  value: string | null | undefined,
  fallback: string,
): string {
  const collapsed = (value ?? '')
    // Strip C0/C1 control characters (newlines, tabs, etc.), then collapse any
    // remaining whitespace run to a single space — Meta rejects both in params.
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed === '') {
    return fallback;
  }
  return collapsed.length > MAX_PARAMETER_LENGTH
    ? `${collapsed.slice(0, MAX_PARAMETER_LENGTH - 1).trimEnd()}…`
    : collapsed;
}
