/**
 * Canonical form for a Meta ad account id.
 *
 * The Marketing API hands the same account back under two spellings: a single
 * `/me/adaccounts` row carries both `id: "act_415877197389621"` and
 * `account_id: "415877197389621"`, and different edges expect different ones.
 *
 * The domain already settled on the prefixed form — the graph client rebuilds
 * `act_<digits>` when Meta returns only the bare number, the select DTOs demand
 * the prefix, and `maskExternalAccountId` assumes it when rendering. What was
 * missing is one place that states the rule, so a comparison somewhere does not
 * quietly decide `act_415…` and `415…` are different accounts.
 *
 * CANONICAL: `act_<digits>` — what `external_account_id` stores, what every
 * comparison normalizes to, and what the operator sees in Meta's own UI.
 */

/** The canonical shape itself, shared with the DTOs so it is stated once. */
export const CANONICAL_AD_ACCOUNT_ID_PATTERN = /^act_[0-9]{1,32}$/;

const BARE_AD_ACCOUNT_ID_PATTERN = /^[0-9]{1,32}$/;

/**
 * Returns the canonical id, or null when the value is not an ad account id.
 *
 * Deliberately narrow. It strips exactly one leading `act_` and then demands
 * digits, so nothing else normalizes into a valid handle: `act_act_1` keeps a
 * non-numeric body and is rejected, `ACT_1` never matches the prefix and is
 * rejected too, and `act_01` stays distinct from `act_1` because the digits are
 * compared as text and never as a number. Rejecting is the safe outcome — the
 * one caller that matters compares the result against configuration, and a
 * lenient parse there is a way past the guardrail.
 */
export function normalizeAdAccountId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const digits = trimmed.startsWith('act_') ? trimmed.slice(4) : trimmed;

  if (!BARE_AD_ACCOUNT_ID_PATTERN.test(digits)) {
    return null;
  }

  return `act_${digits}`;
}

/**
 * Whether two values name the same ad account.
 *
 * Two unparseable values are not "equal": null === null must never open a gate.
 */
export function isSameAdAccountId(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeAdAccountId(left);
  const normalizedRight = normalizeAdAccountId(right);

  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}
