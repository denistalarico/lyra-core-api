import { Injectable } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { shiftDay, type InsightsWindow } from '../sync/insights-window';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import { TikTokAdsError } from '../sync/tiktok-ads-error';
import {
  TikTokAdsApiClient,
  type TikTokPage,
  type TikTokQuery,
} from './tiktok-ads-api.client';

/** Maximum `page_size` of the v1.3 listings and of the integrated report. */
const PAGE_SIZE = 1000;
/** Hard ceiling of pages per read; past it the page is `truncated`. */
const MAX_PAGES = 50;
/** `stat_time_day` reports accept at most 30 days per request. */
export const TIKTOK_REPORT_MAX_DAYS = 30;

/**
 * Metrics of the BASIC integrated report. Pinned with the source because one
 * invalid metric fails the whole request (lesson of G2):
 * https://github.com/tiktok/tiktok-business-api-sdk (Reporting API,
 * `report/integrated/get/`) and the Marketing API "Reporting" metric list.
 */
export const TIKTOK_REPORT_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'reach',
  'frequency',
  'conversion',
  'video_play_actions',
] as const;

/** Insights level → `data_level` and the id dimension (D-I8 is 1:1 here). */
export const TIKTOK_LEVEL: Record<
  SocialAdInsightsLevel,
  { dataLevel: string; idDimension: string }
> = {
  account: { dataLevel: 'AUCTION_ADVERTISER', idDimension: 'advertiser_id' },
  campaign: { dataLevel: 'AUCTION_CAMPAIGN', idDimension: 'campaign_id' },
  adset: { dataLevel: 'AUCTION_ADGROUP', idDimension: 'adgroup_id' },
  ad: { dataLevel: 'AUCTION_AD', idDimension: 'ad_id' },
};

const CAMPAIGN_FIELDS = [
  'campaign_id',
  'campaign_name',
  'operation_status',
  'secondary_status',
  'objective_type',
  'budget',
  'budget_mode',
  'create_time',
  'modify_time',
];
const ADGROUP_FIELDS = [
  'adgroup_id',
  'adgroup_name',
  'campaign_id',
  'operation_status',
  'secondary_status',
  'budget',
  'budget_mode',
  'schedule_start_time',
  'schedule_end_time',
  'optimization_goal',
  'billing_event',
  'create_time',
  'modify_time',
];
const AD_FIELDS = [
  'ad_id',
  'ad_name',
  'adgroup_id',
  'campaign_id',
  'operation_status',
  'secondary_status',
  'create_time',
  'modify_time',
];

export type TikTokRawRow = Record<string, unknown>;

export type TikTokRawPage = {
  rows: TikTokRawRow[];
  truncated: boolean;
  apiCalls: number;
};

export type TikTokRawHierarchy = {
  advertiser: TikTokRawPage;
  campaigns: TikTokRawPage;
  adGroups: TikTokRawPage;
  ads: TikTokRawPage;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read-only reader for the TikTok Ads mirror (D-I7/D-I8). Raw rows only; the
 * normalizers shape them and the existing writers store them.
 */
@Injectable()
export class TikTokAdsReaderService {
  constructor(private readonly client: TikTokAdsApiClient) {}

  async readHierarchy(
    credential: ResolvedAdCredential,
  ): Promise<TikTokRawHierarchy> {
    const token = credential.accessToken;
    const advertiserId = credential.externalAccountId;
    const info = await this.client.get(token, 'advertiser/info/', {
      advertiser_ids: [advertiserId],
      fields: ['advertiser_id', 'name', 'currency', 'status'],
    });
    const list = Array.isArray(info.list) ? info.list : [];

    return {
      advertiser: {
        rows: list.filter(
          (item): item is TikTokRawRow =>
            typeof item === 'object' && item !== null,
        ),
        truncated: false,
        apiCalls: 1,
      },
      campaigns: await this.collect(token, 'campaign/get/', {
        advertiser_id: advertiserId,
        fields: CAMPAIGN_FIELDS,
      }),
      adGroups: await this.collect(token, 'adgroup/get/', {
        advertiser_id: advertiserId,
        fields: ADGROUP_FIELDS,
      }),
      ads: await this.collect(token, 'ad/get/', {
        advertiser_id: advertiserId,
        fields: AD_FIELDS,
      }),
    };
  }

  /**
   * One report per level per window, cut into ≤ 30-day requests (the limit
   * with `stat_time_day`). Dates are in the advertiser's own timezone.
   */
  async readDailyMetrics(
    credential: ResolvedAdCredential,
    level: SocialAdInsightsLevel,
    window: InsightsWindow,
  ): Promise<TikTokRawPage> {
    if (!DAY.test(window.since) || !DAY.test(window.until)) {
      throw new TikTokAdsError('permanent', 'tiktok_ads_bad_request');
    }

    const { dataLevel, idDimension } = TIKTOK_LEVEL[level];
    const rows: TikTokRawRow[] = [];
    let apiCalls = 0;
    let truncated = false;

    for (
      let start = window.since;
      start <= window.until;
      start = shiftDay(start, TIKTOK_REPORT_MAX_DAYS)
    ) {
      const candidate = shiftDay(start, TIKTOK_REPORT_MAX_DAYS - 1);
      const end = candidate < window.until ? candidate : window.until;
      const page = await this.collect(
        credential.accessToken,
        'report/integrated/get/',
        {
          advertiser_id: credential.externalAccountId,
          report_type: 'BASIC',
          data_level: dataLevel,
          dimensions: [idDimension, 'stat_time_day'],
          metrics: [...TIKTOK_REPORT_METRICS],
          start_date: start,
          end_date: end,
        },
        apiCalls,
      );

      rows.push(...page.rows);
      apiCalls = page.apiCalls;
      truncated ||= page.truncated;
    }

    return { rows, truncated, apiCalls };
  }

  /** Walks `page` until `total_page`; `spent` carries calls already made. */
  private async collect(
    token: string,
    path: string,
    query: TikTokQuery,
    spent = 0,
  ): Promise<TikTokRawPage> {
    const rows: TikTokRawRow[] = [];
    let apiCalls = spent;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      let result: TikTokPage;
      try {
        result = await this.client.getPage(token, path, {
          ...query,
          page,
          page_size: PAGE_SIZE,
        });
      } catch (error) {
        // Calls already made spent quota even though the read failed.
        if (error instanceof TikTokAdsError) {
          throw new TikTokAdsError(
            error.kind,
            error.code,
            error.retryAfterMs,
            error.apiCalls + apiCalls,
          );
        }
        throw error;
      }

      apiCalls += result.apiCalls;
      rows.push(...result.rows);

      if (page >= result.totalPages) {
        return { rows, truncated: false, apiCalls };
      }
    }

    return { rows, truncated: true, apiCalls };
  }
}
