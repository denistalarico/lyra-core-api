/**
 * What the paid-media mirror can say about an ad id somebody observed elsewhere.
 *
 * This is the Social half of I4's bridge, and it is deliberately shaped as an
 * *answer to a question about an id*, not as a fact source. The caller already
 * holds an identifier — Meta's `referral.source_id`, recorded by Inbox
 * ingestion on the inbound message that carried it — and needs to know where,
 * if anywhere, that id sits in this workspace's ad hierarchy.
 *
 * ## Why this is not `IntelligenceFactSource`
 *
 * That port answers "what were the totals per day for this scope", and every
 * one of its shapes — `grain`, day buckets, metric descriptors, aggregability —
 * exists to describe a *series*. An ad-id lookup has no window, no grain and no
 * aggregation; forcing it through that interface would mean inventing a fake
 * day dimension for a question that has none, and every consumer would then
 * have to unwrap a one-bucket series to read a single row. So I4 adds a port
 * beside it rather than bending it.
 *
 * ## No metrics, by construction
 *
 * Nothing here reads `social_ad_metrics_daily`. An ad that delivered a
 * click-to-WhatsApp conversation is a real ad with a real place in the
 * hierarchy whether or not its spend has been ingested — and on this
 * deployment, ad-set metrics have not been ingested at all. Making the bridge
 * depend on facts would mean a conversation with perfectly good provider
 * evidence reported as unattributable because a backfill had not run.
 */

/** Where a matched ad sits, every level resolved from the mirror. */
export type SocialAdHierarchyPath = {
  connectionId: string;
  /** Provider-side ids, exactly as the mirror stores them. */
  adId: string;
  adsetId: string | null;
  campaignId: string | null;
  accountId: string | null;
  /**
   * The ad set's *internal* row id, for joining evidence keyed on it.
   *
   * `social_ad_destination_observations.ad_entity_id` references
   * `social_ad_entities.id` rather than the provider's external id, precisely
   * because the external id is not unique across connections. Carrying it here
   * means the destination lookup inherits the scope this walk already applied,
   * instead of re-deriving "which ad set row was that" from the external id and
   * risking a different answer.
   *
   * Never rendered — it is a join key, not an identifier a consumer should see.
   */
  adsetEntityId: string | null;
  /**
   * Provider-authored names, for display only.
   *
   * Never an identifier and never a join key: I4's join is on ids alone, and a
   * name here must not become the thing a later reader matches on.
   */
  adName: string | null;
  adsetName: string | null;
  campaignName: string | null;
};

/**
 * Why a lookup produced no path.
 *
 * Every value is a distinct operational cause with a distinct remedy, which is
 * the whole reason they are not one `unknown`:
 *
 * - `ad_not_found` — the id is real evidence, but this workspace's mirror has
 *   no ad with it. Either the hierarchy sync has not run, or the ad belongs to
 *   an ad account this agency does not manage. Both are true states of the
 *   world, and neither is an error.
 * - `ambiguous_connection` — the same external id resolves under more than one
 *   Meta Ads connection in the same scope. Meta ad ids are unique within a
 *   Business, not across Businesses, so this is genuinely undecidable from the
 *   evidence and must never be resolved by picking one.
 */
export type SocialAdHierarchyMiss = 'ad_not_found' | 'ambiguous_connection';

export type SocialAdHierarchyResult =
  | { status: 'matched'; path: SocialAdHierarchyPath }
  | { status: SocialAdHierarchyMiss; candidateConnectionIds: string[] };

/**
 * Exported so the cross-domain projector can state where a number came from
 * without naming another domain's table.
 *
 * The boundary spec on `intelligence-analytics` forbids that module from
 * mentioning `social_ad_entities` at all — a mention is one edit away from a
 * query. The provenance string still has to reach the response, so the domain
 * that owns the table owns the sentence describing it.
 */
export const SOCIAL_AD_HIERARCHY_PROVENANCE = 'social_ad_entities' as const;
