import type { SocialAdKpis } from '../analytics/social-ad-kpi';
import type { SocialAdSortDirection } from './social-ad-analytics-campaigns.view';

/**
 * The columns a caller may order ad sets by.
 *
 * Same closed-lookup discipline as `SocialAdCampaignSort`: mapped through a
 * fixed SQL expression in the service, never interpolated from the query.
 */
export type SocialAdAdSetSort =
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
 * One ad set's totals for the requested period.
 *
 * Identity fields come from `social_ad_entities` and are nullable throughout,
 * for the same reason as `SocialAdCampaignRow`: facts and the hierarchy are
 * separate reads that can disagree for minutes at a time.
 */
export type SocialAdAdSetRow = SocialAdKpis & {
  externalId: string;

  /** The parent campaign's external id, denormalised onto every ad-set fact. */
  campaignExternalId: string | null;

  name: string | null;
  status: string | null;
  effectiveStatus: string | null;

  /**
   * Meaningful at this level only — Meta states them on the ad set, not on the
   * campaign or ad edges. Null at every other level, never inherited.
   */
  optimizationGoal: string | null;
  billingEvent: string | null;
  destinationType: string | null;

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

export type SocialAdAnalyticsAdSetsView = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: { since: string; until: string };
  sort: SocialAdAdSetSort;
  direction: SocialAdSortDirection;
  /** Ad sets with at least one fact in the period, ordered as requested. */
  items: SocialAdAdSetRow[];
  total: number;
};
