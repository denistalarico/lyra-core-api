import type { SocialAdKpis } from '../analytics/social-ad-kpi';

/**
 * The columns a caller may order by.
 *
 * A closed list, and it is the only thing that ever reaches the ORDER BY. The
 * value is mapped to a column expression by a lookup rather than interpolated,
 * so an unknown value cannot become SQL — `sort` is the one query parameter on
 * this whole surface that would otherwise be a string heading for a query.
 *
 * Derived KPIs are sortable too, which is why the mapping lives next to the
 * query rather than in the caller: `cpc` is not a column, it is
 * `spend / clicks`, and the sort has to be computed in SQL over the summed
 * numerator and denominator to agree with the value the response reports.
 */
export type SocialAdCampaignSort =
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

export type SocialAdSortDirection = 'asc' | 'desc';

/**
 * One campaign's totals for the requested period.
 *
 * Identity fields come from `social_ad_entities` and are nullable throughout:
 * facts and the hierarchy are separate reads that can disagree for minutes at a
 * time, and a campaign whose spend arrived before its name did must still
 * appear in this list. A row with a null `name` is a real campaign nobody has
 * mirrored yet, not an error — dropping it would silently understate the
 * account's spend.
 */
export type SocialAdCampaignRow = SocialAdKpis & {
  externalId: string;

  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;

  /**
   * Whether the mirror has stopped seeing this campaign.
   *
   * Archived campaigns still appear when they have spend in the period — last
   * quarter's money was really spent, and hiding the row would make the totals
   * on this page disagree with the overview's.
   */
  archived: boolean;

  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;

  /** Null for any period longer than a day. Reach is never summed. */
  reach: string | null;

  /** True when any day of this campaign's period is still provisional. */
  hasPartialData: boolean;
};

export type SocialAdAnalyticsCampaignsView = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: { since: string; until: string };
  sort: SocialAdCampaignSort;
  direction: SocialAdSortDirection;
  /**
   * Campaigns with at least one fact in the period, ordered as requested.
   *
   * A campaign with no delivery in the window is absent rather than present with
   * zeros: this is a ranking of what ran, and padding it with every campaign
   * that ever existed would bury the answer under paused history.
   */
  items: SocialAdCampaignRow[];
  total: number;
};
