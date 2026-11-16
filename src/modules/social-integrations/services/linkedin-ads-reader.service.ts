import { Injectable } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { LinkedInAdsError } from '../sync/linkedin-ads-error';
import type { InsightsWindow } from '../sync/insights-window';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import {
  LinkedInAdsApiClient,
  type LinkedInPage,
} from './linkedin-ads-api.client';

/** Hard ceiling of pages per collection; past it the page is `truncated`. */
const MAX_PAGES = 200;
/** `adAnalytics` answers at most 15,000 elements and does not paginate. */
export const LINKEDIN_ANALYTICS_MAX_ELEMENTS = 15_000;

/**
 * Every status, so archived/removed entities stay addressable for the
 * performance rows that still reference them.
 */
const ENTITY_STATUSES =
  'ACTIVE,PAUSED,ARCHIVED,DRAFT,CANCELED,PENDING_DELETION,REMOVED';

/**
 * Metrics requested from `adAnalytics` (max 20 per call). Pinned here with the
 * source because one invalid field fails the whole query (lesson of G2):
 * https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting
 * https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting-schema
 */
export const LINKEDIN_ANALYTICS_FIELDS = [
  'dateRange',
  'pivotValues',
  'impressions',
  'clicks',
  'landingPageClicks',
  'costInLocalCurrency',
  'externalWebsiteConversions',
  'oneClickLeads',
  'videoViews',
  'conversionValueInLocalCurrency',
] as const;

/** Insights level → `adAnalytics` pivot (D-I8: group=campaign, campaign=adset). */
export const LINKEDIN_PIVOT_BY_LEVEL: Record<SocialAdInsightsLevel, string> = {
  account: 'ACCOUNT',
  campaign: 'CAMPAIGN_GROUP',
  adset: 'CAMPAIGN',
  ad: 'CREATIVE',
};

export type LinkedInRawRow = Record<string, unknown>;

export type LinkedInRawPage = {
  rows: LinkedInRawRow[];
  truncated: boolean;
  apiCalls: number;
};

export type LinkedInRawHierarchy = {
  account: LinkedInRawPage;
  campaignGroups: LinkedInRawPage;
  campaigns: LinkedInRawPage;
  creatives: LinkedInRawPage;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Rest.li date object, e.g. `(year:2026,month:11,day:1)`. */
function restliDate(day: string): string {
  const match = DAY.exec(day);

  if (!match)
    throw new LinkedInAdsError('permanent', 'linkedin_ads_bad_request');

  return `(year:${Number(match[1])},month:${Number(match[2])},day:${Number(match[3])})`;
}

/**
 * Read-only reader for the LinkedIn Ads mirror (D-I7/D-I8). It returns raw
 * rows; the normalizers turn them into mirror rows and the existing writers
 * store them. There is no mutation path in this class.
 */
@Injectable()
export class LinkedInAdsReaderService {
  constructor(private readonly client: LinkedInAdsApiClient) {}

  /** The account node and the three levels below it. */
  async readHierarchy(
    credential: ResolvedAdCredential,
  ): Promise<LinkedInRawHierarchy> {
    const id = credential.externalAccountId;
    const token = credential.accessToken;

    const account = await this.client.get(token, `adAccounts/${id}`, '');

    return {
      account: { rows: [account], truncated: false, apiCalls: 1 },
      campaignGroups: await this.collect(
        token,
        `adAccounts/${id}/adCampaignGroups`,
        `q=search&search=(status:(values:List(${ENTITY_STATUSES})))&pageSize=1000`,
      ),
      campaigns: await this.collect(
        token,
        `adAccounts/${id}/adCampaigns`,
        `q=search&search=(status:(values:List(${ENTITY_STATUSES})))&pageSize=1000`,
      ),
      creatives: await this.collect(
        token,
        `adAccounts/${id}/creatives`,
        'q=criteria&pageSize=100&sortOrder=ASCENDING',
      ),
    };
  }

  /** One `adAnalytics` call for one level over the whole window. */
  async readDailyMetrics(
    credential: ResolvedAdCredential,
    level: SocialAdInsightsLevel,
    window: InsightsWindow,
  ): Promise<LinkedInRawPage> {
    const account = encodeURIComponent(
      `urn:li:sponsoredAccount:${credential.externalAccountId}`,
    );
    const query = [
      'q=analytics',
      `pivot=${LINKEDIN_PIVOT_BY_LEVEL[level]}`,
      'timeGranularity=DAILY',
      `dateRange=(start:${restliDate(window.since)},end:${restliDate(window.until)})`,
      `accounts=List(${account})`,
      `fields=${LINKEDIN_ANALYTICS_FIELDS.join(',')}`,
    ].join('&');

    const body = await this.client.get(
      credential.accessToken,
      'adAnalytics',
      query,
    );
    const elements = Array.isArray(body.elements)
      ? body.elements.filter(
          (item): item is LinkedInRawRow =>
            typeof item === 'object' && item !== null,
        )
      : [];

    return {
      rows: elements,
      // No pagination: a full answer may have been cut at the 15,000 cap.
      truncated: elements.length >= LINKEDIN_ANALYTICS_MAX_ELEMENTS,
      apiCalls: 1,
    };
  }

  private async collect(
    token: string,
    path: string,
    query: string,
  ): Promise<LinkedInRawPage> {
    const rows: LinkedInRawRow[] = [];
    let pageToken: string | null = null;
    let apiCalls = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      let result: LinkedInPage;
      try {
        result = await this.client.getPage(token, path, query, pageToken);
      } catch (error) {
        // Calls already made spent quota even though the sweep failed.
        if (error instanceof LinkedInAdsError) {
          throw new LinkedInAdsError(
            error.kind,
            error.code,
            error.retryAfterMs,
            error.apiCalls + apiCalls,
          );
        }
        throw error;
      }

      apiCalls += result.apiCalls;
      rows.push(...result.elements);
      pageToken = result.nextPageToken;

      if (!pageToken) return { rows, truncated: false, apiCalls };
    }

    return { rows, truncated: true, apiCalls };
  }
}
