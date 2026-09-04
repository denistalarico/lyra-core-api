/**
 * What LeadFlow can say about how one conversation arrived, and what it became.
 *
 * The types live beside the adapter that fills them so the cross-domain
 * projector can import a shape without importing a query — the same split I3.5
 * used for the destination breakdown, and for the same boundary reason.
 */

/** One stored observation, unchanged from what the provider reported. */
export type LeadFlowAttributionObservation = {
  observationId: string;
  messageId: string;
  conversationId: string;
  provider: string;
  channelType: string;
  /** `referral.source_id`. Null when the provider sent only a click id. */
  adId: string | null;
  /**
   * `referral.ctwa_clid`, exposed as evidence only.
   *
   * I4 never resolves a click id: doing so would mean asking Meta, and the
   * whole read path is local by design. Its presence is reported so a reader
   * can tell "no provider evidence at all" from "evidence that this layer
   * cannot yet resolve".
   */
  clickId: string | null;
  /** `ad`, `post`, `page` — the surface clicked, not the object. */
  sourceType: string | null;
  observedAt: string;
};

/**
 * How the observations on one conversation relate to each other.
 *
 * A conversation is a long-lived thread keyed by phone number, so a contact who
 * clicks a second ad weeks later re-enters the same conversation and produces a
 * second observation. All three states are real, and collapsing them is exactly
 * what I1.1's table was built to prevent:
 *
 * - `single` — one observation carrying an ad id.
 * - `multiple_consistent` — several, all naming the same ad. Repeat clicks on
 *   one ad; nothing is in tension.
 * - `conflicting` — several, naming different ads. Both clicks happened; the
 *   evidence does not say which one "counts", because that is a modelling
 *   decision (first-touch, last-touch, linear) and I4 makes none.
 * - `none` — no observation carries an ad id.
 */
export type LeadFlowAttributionConsistency =
  | 'none'
  | 'single'
  | 'multiple_consistent'
  | 'conflicting';

/** Everything LeadFlow knows about one conversation's observed origin. */
export type LeadFlowConversationAttribution = {
  conversationId: string;
  /** False when the conversation does not exist in this scope at all. */
  exists: boolean;
  observations: LeadFlowAttributionObservation[];
  /** Distinct non-null ad ids across the observations, sorted. */
  distinctAdIds: string[];
  consistency: LeadFlowAttributionConsistency;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  /**
   * The earliest observed qualification transition for this conversation, from
   * I3.1's append-only event log.
   *
   * Reused rather than recomputed: the current `qualification_status` column
   * says what is true now, and reading it as history is precisely the error
   * I3.1 exists to remove. Null means no transition was ever recorded — which
   * for a conversation older than I3.1 does not mean it was never qualified.
   */
  firstQualifiedAt: string | null;
};

/** One opportunity reached by an explicit conversation link. */
export type LeadFlowAttributionOpportunity = {
  opportunityId: string;
  status: string;
  /** Canonical won semantics: `status = 'won'` and `won_at` present. */
  isWon: boolean;
  wonAt: string | null;
  /**
   * The seller-entered deal value, in `currency`.
   *
   * Not revenue, and never summed across currencies by this layer — see the
   * adapter's currency handling and I4 §14.
   */
  valueAmount: string | null;
  currency: string | null;
};

export const LEADFLOW_ATTRIBUTION_PROVENANCE = {
  observation: 'inbox_attribution_observations',
  conversation: 'inbox_conversations',
  qualification: 'inbox_conversation_events',
  opportunity: 'crm_opportunities',
} as const;

/**
 * Folds a conversation's observations into their consistency state.
 *
 * Exported and pure so the rule is testable on its own and stated once. The
 * ordering of the checks is the definition: any two distinct ad ids is a
 * conflict regardless of how many observations produced them, and one ad id
 * seen many times is not.
 */
export function resolveAttributionConsistency(
  distinctAdIds: readonly string[],
  observationsWithAdId: number,
): LeadFlowAttributionConsistency {
  if (distinctAdIds.length === 0) return 'none';
  if (distinctAdIds.length > 1) return 'conflicting';
  return observationsWithAdId > 1 ? 'multiple_consistent' : 'single';
}
