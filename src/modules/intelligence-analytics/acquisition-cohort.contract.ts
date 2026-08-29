import type {
  IntelligenceFreshness,
  IntelligenceProvenance,
} from '../../common/intelligence';
import type {
  CanonicalAcquisitionChannel,
  ChannelResolution,
} from './acquisition-channel';

/**
 * What this view is, stated in the type system so it cannot be mistaken.
 *
 * The whole risk of putting ad spend next to won deals is that a reader — or a
 * future endpoint, or a UI author who never read this file — takes the
 * adjacency for causation and reports "this ad produced R$ 40.000". The numbers
 * here do not support that claim and never will at this join basis.
 *
 * So the claim the view *does* make is a required field of the payload rather
 * than a caveat in a comment. `kind` and `joinBasis` are single-member unions:
 * adding individual attribution later means adding a member and forcing every
 * consumer's switch to acknowledge it, instead of quietly changing what the
 * same-shaped response means.
 */
export type CohortAnalysisKind = 'cohort_correlation';

/**
 * How the two domains were lined up.
 *
 * `date_channel_bucket` — same tenant/workspace/client, same day bucket, same
 * channel bucket. That is a *coincidence in time and place*, which is genuinely
 * useful (it is how every media team reads a dashboard) and is not the same as
 * knowing which spend produced which conversation.
 */
export type CohortJoinBasis = 'date_channel_bucket';

/**
 * The paid-media side of the cohort.
 *
 * Every value is an exact-decimal string or null, exactly as it left the fact
 * source. Nothing here is a ratio: the derived block is computed once, from
 * these, at the end.
 *
 * `reach` is deliberately absent. It is `non_additive`, so it has no correct
 * value over a multi-day window, and a field that would be null on every
 * multi-day request is a field that teaches consumers to ignore nulls.
 */
export type CohortSocialFacts = {
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  /**
   * Leads **as the provider counted them**, never mixed with the LeadFlow
   * count. See `CohortDataQuality.providerLeadSemantics`.
   */
  providerLeads: string | null;
  conversions: string | null;
  conversionValue: string | null;
};

/**
 * The funnel side of the cohort, from LeadFlow and CRM.
 *
 * `qualifiedLeads` is `string | null` and is null in this release — see the
 * data-quality block, which names why rather than leaving the reader to wonder
 * whether it is a bug or a zero.
 */
export type CohortLeadFlowFacts = {
  conversationsReceived: string | null;
  inboundMessages: string | null;
  qualifiedLeads: string | null;
  opportunitiesCreated: string | null;
  wonOpportunities: string | null;
  /**
   * Named for what the CRM column holds, not for what a finance report would
   * call it.
   *
   * `crm_opportunities.value_amount` is the value a salesperson entered on the
   * opportunity. It is the agreed value of deals marked won — not invoiced,
   * not received, not recognised revenue. Calling it `revenue` would put a
   * number on a screen next to ad spend that a reader would reasonably take to
   * the accountant, and it would not match the books.
   */
  wonOpportunityValue: string | null;
};

/**
 * Cost and conversion ratios, derived at this level and never stored.
 *
 * All eight are quotients of the two blocks above, computed once from the
 * aggregated totals. Every one is `string | null`, and null means the
 * denominator was zero — never `0`, never `Infinity`, never `NaN`.
 *
 * The funnel rates are *not* multiplied into a percentage here; they are plain
 * quotients under a `ratio` reading, because the two sides are cohorts rather
 * than a tracked population and presenting `38%` invites the reader to treat it
 * as a conversion rate of specific people.
 */
export type CohortDerivedMetrics = {
  /** Spend ÷ provider-reported leads. The provider's own denominator. */
  providerCpl: string | null;
  costPerConversation: string | null;
  costPerQualifiedLead: string | null;
  costPerOpportunity: string | null;
  costPerWonOpportunity: string | null;
  conversationToQualifiedRate: string | null;
  qualifiedToOpportunityRate: string | null;
  opportunityToWonRate: string | null;
};

/**
 * What the reader must be told, carried as data.
 *
 * This block is the reason the view is safe to expose. Each flag answers a
 * question a reader would otherwise answer wrongly by assumption, and it
 * travels with the payload so a future UI cannot render the numbers without
 * also having received the caveats.
 */
export type CohortDataQuality = {
  /** Always true here. The numbers are correlated by period and channel. */
  cohortCorrelation: true;
  /**
   * Always false in I3. No number in this payload is derived from
   * `inbox_attribution_observations`, and none identifies which ad produced
   * which conversation.
   */
  individualAttribution: false;
  /** How the channel bucket was arrived at. */
  channelResolution: ChannelResolution;
  /** True when any covered day is still being written to by the sync. */
  partialData: boolean;
  /** Human-readable, ordered, and meant to be rendered verbatim. */
  limitations: string[];
  /**
   * Metric keys the view asked for and could not obtain, with the reason.
   *
   * A named gap, so a consumer can distinguish "zero qualified leads" from
   * "this platform cannot yet count qualified leads" — which a bare `null`
   * cannot express.
   */
  missingFacts: Array<{ metricKey: string; reason: string }>;
};

/**
 * Where each side's numbers came from, kept separate.
 *
 * Not flattened into one `source: 'Lyra'`. The point of provenance is that
 * somebody can re-derive a figure they distrust, and that requires knowing that
 * spend came from `social_ad_metrics_daily` under `account_default` while the
 * funnel came from `crm_opportunities` written live.
 */
export type CohortProvenance = {
  social: IntelligenceProvenance;
  leadflow: IntelligenceProvenance;
  /** How this projector combined the two — the third fact of the derivation. */
  projector: {
    kind: CohortAnalysisKind;
    joinBasis: CohortJoinBasis;
    /** The timezone the day buckets were cut in, and where it came from. */
    dayBucketTimezone: string;
    dayBucketTimezoneSource: 'ad_account' | 'utc_fallback';
  };
};

/**
 * Combined freshness, with both sides kept legible.
 *
 * `overallPartial` is the OR of the two, because a view is only as current as
 * its least current half: a reader told "as of now" while D0 spend is still
 * landing would compute a cost per lead that changes under them tomorrow.
 */
export type CohortFreshness = {
  social: IntelligenceFreshness;
  leadflow: IntelligenceFreshness;
  overallPartial: boolean;
};

/** One cohort row: a period, a channel bucket, and the two sides of it. */
export type AcquisitionCohortView = {
  kind: CohortAnalysisKind;
  joinBasis: CohortJoinBasis;
  period: { since: string; until: string };
  channel: CanonicalAcquisitionChannel;
  currency: string | null;
  /**
   * Informative only, and null unless LeadFlow resolved one. I3 never requires
   * it and never filters on it — Business Mode is I5.
   */
  businessMode: string | null;
  social: CohortSocialFacts;
  leadflow: CohortLeadFlowFacts;
  derived: CohortDerivedMetrics;
  provenance: CohortProvenance;
  freshness: CohortFreshness;
  dataQuality: CohortDataQuality;
};

/**
 * The limitation that must appear on every response.
 *
 * Written once, exported, and asserted by a spec — because the failure mode of
 * a caveat is that a later edit drops it and nothing breaks.
 */
export const COHORT_CORRELATION_LIMITATION =
  'Os dados de mídia e funil foram comparados por período e canal. ' +
  'Esta vista não representa atribuição individual de leads.';
