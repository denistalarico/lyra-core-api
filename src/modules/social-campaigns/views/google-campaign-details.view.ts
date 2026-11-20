import type { SocialAdSearchTermKind } from '../../social-integrations/entities/social-ad-search-term-daily.entity';

/**
 * GA-DET: response of `GET social/campaigns/google/campaigns/:campaignId/details`
 * (plan §5.4). Measures are decimal strings, like the hierarchy view: money and
 * fractional conversions are never floats on the wire.
 */
export type GoogleCampaignDetailMeasures = {
  spend: string;
  impressions: string;
  clicks: string;
  conversions: string;
  conversionValue: string;
};

export type GoogleCampaignDetailsView = {
  campaignId: string;
  /** `campaign.advertising_channel_type` (e.g. `PERFORMANCE_MAX`, `SEARCH`). */
  channelType: string | null;
  period: { since: string; until: string };
  /** Some day of the period was still open when read (today, intraday). */
  hasPartialData: boolean;
  totals: GoogleCampaignDetailMeasures;
  /** Where it served (`segments.ad_network_type`), most spend first. */
  channels: Array<
    GoogleCampaignDetailMeasures & { key: string; label: string }
  >;
  /** Which conversion it was. `spend` is always null: no CPA per action. */
  conversionActions: Array<{
    id: string;
    label: string;
    category: string | null;
    conversions: string;
    conversionValue: string;
    spend: null;
  }>;
  terms: {
    grain: 'daily' | 'period';
    periodPreset?: '7d' | '30d' | 'month';
    kind: SocialAdSearchTermKind;
    /** Top 100. `text: ''` is PMax's catch-all category. */
    rows: Array<{
      text: string;
      impressions: string;
      clicks: string;
      conversions: string;
      /** Null where Google reports no cost (PMax categories). */
      spend: string | null;
    }>;
  };
  /** Campaign total minus the sum of the channels, never negative. */
  unattributed: { conversions: string; spend: string };
};
