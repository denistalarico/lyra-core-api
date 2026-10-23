/**
 * The variables a Lyra follow-up template may carry (IX2).
 *
 * Same syntax and same rules as the agenda messages
 * (`leadflow-automations/catalog/appointment-message-variables.catalog.ts`):
 * `{{namespace.field}}`, a small closed vocabulary of values the platform can
 * actually resolve, and an unknown placeholder survives untouched so a typo is
 * visible instead of silently deleted. Mirrored on the web in
 * `modules/leadflow/inbox/followup/followupTemplateVariables.ts`; a `.test.cjs`
 * fails if the two drift.
 */
export type FollowupTemplateVariableKey =
  | 'contact.firstName'
  | 'contact.name'
  | 'user.firstName'
  | 'business.name';

export const FOLLOWUP_TEMPLATE_VARIABLE_KEYS: readonly FollowupTemplateVariableKey[] =
  ['contact.firstName', 'contact.name', 'user.firstName', 'business.name'];

const KEY_SET = new Set<string>(FOLLOWUP_TEMPLATE_VARIABLE_KEYS);

/** `{{ namespace.field }}` — whitespace tolerated, one dotted segment only. */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][\w]*\.[a-zA-Z][\w]*)\s*\}\}/g;

export type FollowupTemplateValues = Partial<
  Record<FollowupTemplateVariableKey, string | null>
>;

export function isFollowupTemplateVariableKey(
  value: unknown,
): value is FollowupTemplateVariableKey {
  return typeof value === 'string' && KEY_SET.has(value);
}

/**
 * Replaces the known variables. A value that could not be resolved collapses
 * and the sentence is tidied — "Oi , tudo bem?" reads worse than "Oi, tudo
 * bem?". Never a raw id: the values handed in are names or nothing (D-IX-1).
 */
export function renderFollowupTemplate(
  text: string,
  values: FollowupTemplateValues,
): string {
  const rendered = text.replace(VARIABLE_PATTERN, (whole, key: string) =>
    isFollowupTemplateVariableKey(key) ? (values[key]?.trim() ?? '') : whole,
  );
  return rendered
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function firstName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('@')) return trimmed || null;
  return trimmed.split(/\s+/)[0] ?? null;
}
