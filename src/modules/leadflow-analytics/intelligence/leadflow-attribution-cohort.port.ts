/**
 * What LeadFlow can say about a *set* of observed-attribution conversations.
 *
 * The cohort counterpart to `leadflow-attribution.port`. That one answers "what
 * do we know about this conversation"; this one answers "which conversations
 * entered this window with observed evidence, and what became of them".
 *
 * It lives beside the individual port rather than extending it because the two
 * differ in the one dimension that matters here: the individual view has no
 * window at all, and everything below is defined by one. Sharing a type between
 * them would mean a shape whose `cohortWindow` is meaningless half the time.
 *
 * ## Why the selection lives in LeadFlow and not in the projector
 *
 * The boundary spec on `intelligence-analytics` forbids that module from naming
 * `inbox_attribution_observations`, `inbox_conversations` or `crm_opportunities`
 * — and choosing "which conversations are eligible" is a query over exactly
 * those. The domain that owns the tables owns the selection; the projector
 * composes what comes back.
 */

/**
 * One conversation that entered the cohort, with its observed evidence folded.
 *
 * Deliberately *not* one row per observation. A conversation with three clicks
 * on one ad is one attributed conversation, and shipping observation rows to
 * the projector would put the de-duplication in the layer least able to see
 * whether it happened — which is exactly how an attributed count silently
 * triples.
 */
export type LeadFlowCohortConversation = {
  conversationId: string;
  /**
   * The conversation's entry instant: its **first** observation carrying an ad
   * id, inside the window.
   *
   * Not the first observation of any kind. A thread whose opening message
   * carried only a click id and whose second message a week later carried the
   * ad would otherwise enter the cohort a week before the evidence that puts it
   * there.
   */
  enteredAt: string;
  /** Distinct ad ids observed on this conversation, across all time, sorted. */
  distinctAdIds: string[];
  /** Observations carrying an ad id. Reported, never used as a count of one. */
  observationsCount: number;
  /**
   * The conversation's channel type, from the observation.
   *
   * Carried so the projector can state provider coverage without a second read
   * — and so `unsupported` is decided from the evidence rather than assumed.
   */
  channelType: string;
  provider: string;
  /**
   * The earliest recorded qualification, across all time — not clipped to the
   * window.
   *
   * Entry-cohort semantics: a conversation that entered on the last day of the
   * window and qualified two days later did qualify, and a window-clipped read
   * would report the cohort as failing when it is merely young. §11's maturity
   * fields exist so a reader can tell those two apart.
   */
  firstQualifiedAt: string | null;
};

/** One opportunity explicitly linked to a cohort conversation. */
export type LeadFlowCohortOpportunity = {
  conversationId: string;
  opportunityId: string;
  status: string;
  /** Canonical won semantics: `status = 'won'` and `won_at` present. */
  isWon: boolean;
  wonAt: string | null;
  valueAmount: string | null;
  currency: string | null;
};

/**
 * How many conversations were *eligible* to carry observed attribution.
 *
 * The denominator question, and the one most easily made dishonest. §16: a
 * coverage ratio over "all conversations" would count Instagram and Messenger
 * threads in the denominator, and those channels send no referral at all — so
 * the ratio would fall as those channels grow, describing nothing but the
 * channel mix.
 *
 * So eligibility is defined as *conversations on a channel whose provider can
 * report an ad id*: Meta WhatsApp today. `unsupported` counts the rest
 * separately rather than folding them into a failure.
 */
export type LeadFlowCohortEligibility = {
  /** Conversations on a supported channel with activity in the window. */
  eligibleConversations: number;
  /**
   * Conversations on channels that cannot carry a referral at all.
   *
   * Reported so a reader can see the shape of what was excluded. Never part of
   * the denominator: they are *unsupported*, not unattributed.
   */
  unsupportedConversations: number;
};

export const LEADFLOW_COHORT_PROVENANCE = {
  observation: 'inbox_attribution_observations',
  conversation: 'inbox_conversations',
  qualification: 'inbox_conversation_events',
  opportunity: 'crm_opportunities',
} as const;

/**
 * The channel type that carries an ad id today, and the provider that sends it.
 *
 * Exported so the projector can state provider coverage in the response without
 * re-deriving it, and so there is exactly one place that says "WhatsApp is what
 * Meta reports referrals on". Verified against the inbound adapters: only
 * `whatsapp-meta.adapter.ts` reads a `referral` block; the Instagram and
 * Messenger adapters have no such code path.
 */
export const LEADFLOW_SUPPORTED_ATTRIBUTION_CHANNEL = 'whatsapp' as const;
export const LEADFLOW_SUPPORTED_ATTRIBUTION_PROVIDER = 'meta' as const;
