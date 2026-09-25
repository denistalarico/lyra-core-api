import type { SocialAdKpis } from '../analytics/social-ad-kpi';
import type { SocialAdSortDirection } from './social-ad-analytics-campaigns.view';

/**
 * The columns a caller may order ads by.
 *
 * The same closed list as `SocialAdAdSetSort`, mapped through a fixed SQL
 * expression in the service and never interpolated from the query.
 */
export type SocialAdAdSort =
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'leads'
  | 'conversions'
  | 'ctr'
  | 'cpc'
  | 'cpl'
  | 'roas'
  | 'name';

/**
 * One ad's totals for the requested period.
 *
 * Identity fields come from `social_ad_entities` and are nullable throughout,
 * for the same reason as `SocialAdAdSetRow`: facts and the hierarchy are
 * separate reads that can disagree for minutes at a time, and an ad that
 * delivered before the mirror saw it must still show its spend.
 */
export type SocialAdAdRow = SocialAdKpis & {
  externalId: string;

  /** The parent campaign's external id, denormalised onto every ad fact. */
  campaignExternalId: string | null;

  /**
   * The ad set this ad belongs to, from the hierarchy mirror rather than from
   * the fact.
   *
   * Null until the mirror has seen the ad. The fact row cannot supply it: an
   * ad-level fact carries its campaign in `campaign_external_id` and nothing
   * else, because that column's index exists to answer "this campaign's
   * objects" and an ad set id written into it would make the index point at
   * objects that are not campaigns.
   */
  adSetExternalId: string | null;

  name: string | null;
  status: string | null;
  effectiveStatus: string | null;

  /**
   * The creative this ad renders, by id — never a URL.
   *
   * What a client does with it is ask `GET /social/analytics/ads/thumbnail` for
   * the picture, which is resolved from Meta at that moment and cached briefly.
   * Null means the mirror has not learned a creative for this ad, which renders
   * a placeholder and nothing else: the row is about the numbers beside it.
   */
  creativeId: string | null;

  archived: boolean;

  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  /** Conversations started. Beside `leads`, never summed with it. */
  messagingConversations: string | null;
  conversions: string;
  conversionValue: string;
  videoViews: string;

  /** Null for any period longer than a day. Reach is never summed. */
  reach: string | null;

  hasPartialData: boolean;
};

export type SocialAdAnalyticsAdsView = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: { since: string; until: string };
  sort: SocialAdAdSort;
  direction: SocialAdSortDirection;
  /** Ads with at least one fact in the period, ordered as requested. */
  items: SocialAdAdRow[];
  total: number;
};
