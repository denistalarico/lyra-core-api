import type { CanonicalPaidMediaDestination } from '../sync/paid-media-destination';

/**
 * Paid media, split by where it sent people — the read I3.4 made possible.
 *
 * The split is only honest at one grain. `destination_type` is a property of the
 * **ad set**, so a campaign holding one WhatsApp ad set and one Instagram Direct
 * ad set has no destination of its own, and the account has none at all. Until
 * I3.4 the fact table stopped at campaign level, which is why every earlier
 * release reported this as a named gap rather than a number: producing it would
 * have meant apportioning a campaign's money across its ad sets by some weight —
 * ad set count, impressions, anything — that nobody measured. That is an estimate
 * wearing a measurement's clothes, and it is wrong in exactly the case the
 * feature exists for, an account testing WhatsApp against Direct inside one
 * campaign.
 *
 * So this module reads `entity_level = 'adset'` rows and nothing else. Not as a
 * preference: a query that omitted the filter would sum the account row, every
 * campaign row and every ad set row for the same day and report roughly three
 * times the real spend, and it would look entirely plausible.
 *
 * ## Why the destination is joined per day rather than read off the ad set
 *
 * `social_ad_entities.destination_type` holds what the ad set points at *now*.
 * Grouping August's spend by it would relabel August with September's
 * configuration the moment an advertiser switched an ad set from Direct to
 * WhatsApp — silently, with no column anywhere recording that the number changed
 * meaning. I3.2a exists to prevent precisely that: the observations table is
 * append-only evidence of what was seen and when, and this read resolves each
 * day against the newest observation at or before it.
 *
 * Days before an ad set's first observation resolve to `null`, which becomes the
 * `unknown` bucket. That is the answer, not a gap to be filled: back-projecting
 * the first observation over prior months would attribute a quarter of spend to
 * a destination confirmed once, at the end.
 */

/** One destination's additive totals over the window. */
export type SocialAdDestinationBucket = {
  /**
   * The canonical destination, or `unknown`.
   *
   * `unknown` is a first-class bucket rather than a dropped row. It carries real
   * money — an ad set not yet observed, or one whose provider string this
   * pipeline does not map — and hiding it would make the buckets silently fail
   * to add up to the account total, which is the one property a reader checks.
   */
  destination: CanonicalPaidMediaDestination;
  /**
   * How much of this bucket's spend has no observation behind it at all.
   *
   * Only ever non-zero on the `unknown` bucket, and it is what separates the two
   * reasons a day lands there: `temporalUnknownSpend` is spend from days that
   * predate the ad set's first observation, and the remainder of `unknown` is
   * spend whose observed provider string mapped to no canonical destination.
   * A reader who cannot tell those apart cannot tell "wait for the sync" from
   * "the mapping needs an entry".
   */
  temporalUnknownSpend: string | null;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  /** Leads **as Meta counted them**. Never mixed with a LeadFlow count. */
  providerLeads: string | null;
  conversions: string | null;
  conversionValue: string | null;
  videoViews: string | null;
  /**
   * Always null, and a declaration rather than an omission.
   *
   * Reach is de-duplicated by Meta within one day for one object. There is no
   * arithmetic that turns a set of daily per-ad-set reaches into a period reach
   * per destination — the same person reached by two ad sets on two days is one
   * person, and nothing in the fact table says so. Summing would overstate by
   * however much the audiences overlap, which is largest for the accounts that
   * run several ad sets at one destination, i.e. the ones this breakdown is for.
   *
   * Carried as an explicit null field rather than left out of the type so that a
   * consumer sees the metric exists and is unavailable, instead of assuming it
   * was forgotten and computing it themselves.
   */
  reach: null;
  /** Days in the window this bucket has any fact for. */
  factDays: number;
  /** Of those, how many were still being written when they were read. */
  partialDays: number;
};

/**
 * What this read is derived from, named by the domain that owns the tables.
 *
 * Exported as data so a cross-domain consumer can publish it as provenance
 * without naming Social's tables in its own source. That is not cosmetic: the
 * cross-domain module has a boundary spec forbidding it from mentioning any
 * domain table, precisely because a module that names `social_ad_metrics_daily`
 * is one edit away from querying it and duplicating the filters that make the
 * numbers right.
 */
export const DESTINATION_BREAKDOWN_PROVENANCE = {
  socialMetrics: 'social_ad_metrics_daily (adset)',
  destination: 'social_ad_destination_observations',
} as const;

/** The whole breakdown, with the coverage a reader needs to judge it. */
export type SocialAdDestinationBreakdown = {
  buckets: SocialAdDestinationBucket[];
  currency: string | null;
  /**
   * Whether ad-set facts exist for this window at all.
   *
   * The distinction that keeps I3.4's backfill honest. A connection whose
   * account and campaign chain is complete may still have no ad-set rows for an
   * old window, because I3.4 widened the coverage requirement and the re-read has
   * not reached that far back yet. An empty breakdown then means "not ingested
   * yet", not "no delivery" — and only this flag can say which.
   */
  hasAdsetFacts: boolean;
  /** Distinct days in the window that carry an ad-set fact. */
  coveredDays: number;
  /** Days requested. */
  expectedDays: number;
};

/**
 * The destinations a reader may be shown, in a fixed order.
 *
 * Ordered so the three inbox destinations come first — they are the ones with a
 * LeadFlow counterpart and therefore the ones a cross-domain reader is looking
 * for — then the destinations that leave the platform, then the two that name no
 * single answer. A UI that renders them in array order gets a sensible page
 * without deciding anything.
 */
export const DESTINATION_BUCKET_ORDER: readonly CanonicalPaidMediaDestination[] =
  [
    'whatsapp',
    'instagram_direct',
    'messenger',
    'messaging_multi',
    'website',
    'lead_form',
    'app',
    'phone',
    'profile',
    'on_post',
    'unknown',
  ];

/**
 * Sorts buckets into the canonical order, with anything unrecognised last.
 *
 * A provider value that maps to a destination this list does not know must still
 * be rendered rather than dropped — the mapping grows faster than this file.
 */
export function sortDestinationBuckets(
  buckets: readonly SocialAdDestinationBucket[],
): SocialAdDestinationBucket[] {
  const rank = (destination: string) => {
    const index = DESTINATION_BUCKET_ORDER.indexOf(
      destination as CanonicalPaidMediaDestination,
    );

    return index === -1 ? DESTINATION_BUCKET_ORDER.length : index;
  };

  return [...buckets].sort((left, right) => {
    const delta = rank(left.destination) - rank(right.destination);

    return delta !== 0
      ? delta
      : left.destination.localeCompare(right.destination);
  });
}
