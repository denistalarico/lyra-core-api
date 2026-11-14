import { Injectable } from '@nestjs/common';
import {
  GoogleApiError,
  readGoogleAdsApiConfig,
} from '../../social-google/google-api.client';
import { GoogleAdsCredentialResolver } from '../../social-google/google-ads-credential.resolver';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { GoogleAdsError } from '../sync/google-ads-error';
import type { InsightsWindow } from '../sync/insights-window';
import { currentDayIn } from '../sync/insights-window';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';

const ADS_HOST = 'https://googleads.googleapis.com';
const REQUEST_TIMEOUT_MS = 30_000;
/** Hard ceiling on rows of one query; past it the page is `truncated`. */
const MAX_ROWS = 200_000;
/** Google Ads quota resets at midnight Pacific time. */
const QUOTA_TIMEZONE = 'America/Los_Angeles';
const HOUR_MS = 3_600_000;

export type GoogleAdsRawRow = Record<string, unknown>;

/** Raw rows of one GAQL query, plus whether the read saw all of them. */
export type GoogleAdsRawPage = {
  rows: GoogleAdsRawRow[];
  truncated: boolean;
  /** Operations this query cost against the project budget. */
  apiCalls: number;
};

export type GoogleAdsRawHierarchy = {
  account: GoogleAdsRawPage;
  campaigns: GoogleAdsRawPage;
  adGroups: GoogleAdsRawPage;
  ads: GoogleAdsRawPage;
};

const ACCOUNT_QUERY =
  'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer';

const CAMPAIGN_QUERY =
  'SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros, campaign_budget.period FROM campaign';

const AD_GROUP_QUERY =
  'SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group';

const AD_QUERY =
  'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad';

const METRIC_FIELDS =
  'segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.video_views, metrics.interactions, metrics.all_conversions';

/** Insights level → the GAQL resource and the id fields that name the row. */
const METRIC_QUERY_BY_LEVEL: Record<SocialAdInsightsLevel, string> = {
  account: 'SELECT customer.id, ' + METRIC_FIELDS + ' FROM customer',
  campaign: 'SELECT campaign.id, ' + METRIC_FIELDS + ' FROM campaign',
  adset: 'SELECT ad_group.id, campaign.id, ' + METRIC_FIELDS + ' FROM ad_group',
  ad:
    'SELECT ad_group_ad.ad.id, ad_group.id, campaign.id, ' +
    METRIC_FIELDS +
    ' FROM ad_group_ad',
};

/**
 * Read-only GAQL reader for the Google Ads mirror (D-G7).
 *
 * Authenticates with the OAuth access token of the resolved credential and
 * nothing else: no developer credential header is ever sent (A-05). The version
 * comes from `GOOGLE_ADS_API_VERSION`, never from this file.
 *
 * It returns raw rows. Turning them into mirror rows is the normalizers' job,
 * and storing them is the existing writers'. Every query spends one operation
 * of a per-process daily budget (D-G11), refused with `quota_budget_exhausted`
 * before any request leaves the process.
 */
@Injectable()
export class GoogleAdsReaderService {
  private budgetDay: string | null = null;
  private budgetUsed = 0;

  constructor(
    private readonly config: SocialAdSyncConfigService,
    private readonly googleCredentials: GoogleAdsCredentialResolver,
  ) {}

  /** The account node and the three levels below it: four queries. */
  async readHierarchy(
    credential: ResolvedAdCredential,
  ): Promise<GoogleAdsRawHierarchy> {
    const loginCustomerId = await this.loginCustomerId(credential);

    return {
      account: await this.query(credential, loginCustomerId, ACCOUNT_QUERY),
      campaigns: await this.query(credential, loginCustomerId, CAMPAIGN_QUERY),
      adGroups: await this.query(credential, loginCustomerId, AD_GROUP_QUERY),
      ads: await this.query(credential, loginCustomerId, AD_QUERY),
    };
  }

  /** One query for one level over the whole window (wide, not per day). */
  async readDailyMetrics(
    credential: ResolvedAdCredential,
    level: SocialAdInsightsLevel,
    window: InsightsWindow,
  ): Promise<GoogleAdsRawPage> {
    const loginCustomerId = await this.loginCustomerId(credential);
    // The window is validated `YYYY-MM-DD` upstream; it is still asserted here
    // because it is interpolated into a query string.
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(window.since) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(window.until)
    ) {
      throw new GoogleAdsError('permanent', 'google_ads_bad_request');
    }

    return this.query(
      credential,
      loginCustomerId,
      `${METRIC_QUERY_BY_LEVEL[level]} WHERE segments.date BETWEEN '${window.since}' AND '${window.until}'`,
    );
  }

  private loginCustomerId(credential: ResolvedAdCredential) {
    return this.googleCredentials.loginCustomerId({
      connectionId: credential.connectionId,
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      companyContextId: credential.companyContextId ?? null,
    });
  }

  private async query(
    credential: ResolvedAdCredential,
    loginCustomerId: string | null,
    gaql: string,
  ): Promise<GoogleAdsRawPage> {
    let version: string;
    try {
      version = readGoogleAdsApiConfig().version;
    } catch (error) {
      if (error instanceof GoogleApiError) {
        throw new GoogleAdsError('permanent', 'google_ads_not_configured');
      }
      throw error;
    }

    this.spendOperation();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    let response: Response;
    try {
      response = await fetch(
        `${ADS_HOST}/${version}/customers/${credential.externalAccountId}/googleAds:searchStream`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ query: gaql }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new GoogleAdsError('transient', 'google_ads_transient');
    }

    if (!response.ok) throw await this.failure(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GoogleAdsError('transient', 'google_ads_invalid_response');
    }

    const rows: GoogleAdsRawRow[] = [];
    let truncated = false;
    // `searchStream` answers an array of batches; a lone object is tolerated.
    const batches = Array.isArray(body) ? body : [body];

    for (const batch of batches) {
      const results =
        typeof batch === 'object' &&
        batch !== null &&
        Array.isArray((batch as { results?: unknown }).results)
          ? ((batch as { results: unknown[] }).results ?? [])
          : [];

      for (const row of results) {
        if (typeof row !== 'object' || row === null) continue;
        if (rows.length >= MAX_ROWS) {
          truncated = true;
          break;
        }
        rows.push(row as GoogleAdsRawRow);
      }

      if (truncated) break;
    }

    return { rows, truncated, apiCalls: 1 };
  }

  /**
   * Classifies a refusal into a code. The body is read only to find Google's
   * error enum and is never copied anywhere: it can name customers and echo
   * parts of the request.
   */
  private async failure(response: Response): Promise<GoogleAdsError> {
    if (response.status === 401) {
      return new GoogleAdsError('auth', 'google_ads_reauth_required');
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return new GoogleAdsError(
        'rate_limited',
        'google_ads_rate_limited',
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : null,
      );
    }

    if (response.status >= 500) {
      return new GoogleAdsError('transient', 'google_ads_transient');
    }

    const enumCode = await this.readErrorEnum(response);

    if (response.status === 403) {
      if (
        enumCode === 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' ||
        enumCode === 'ACTION_NOT_PERMITTED'
      ) {
        return new GoogleAdsError('auth', 'google_ads_project_not_approved');
      }
      if (enumCode === 'RESOURCE_EXHAUSTED') {
        return new GoogleAdsError('rate_limited', 'google_ads_rate_limited');
      }
      return new GoogleAdsError('auth', 'google_ads_permission_denied');
    }

    return new GoogleAdsError('permanent', 'google_ads_bad_request');
  }

  private async readErrorEnum(response: Response): Promise<string | null> {
    try {
      const body = (await response.json()) as {
        error?: {
          details?: Array<{ errors?: Array<{ errorCode?: unknown }> }>;
        };
      };
      for (const detail of body.error?.details ?? []) {
        for (const item of detail.errors ?? []) {
          const code = item.errorCode;
          if (typeof code !== 'object' || code === null) continue;
          for (const value of Object.values(code)) {
            if (typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value)) {
              return value;
            }
          }
        }
      }
    } catch {
      // An unreadable body is the same as an absent one.
    }

    return null;
  }

  /**
   * Counts one operation against today's Pacific-day budget, or refuses.
   *
   * Refused *before* the request, so an exhausted budget costs no quota and the
   * run goes back to the queue (`rate_limited`) for after the reset.
   */
  private spendOperation(now: Date = new Date()): void {
    const day = currentDayIn(QUOTA_TIMEZONE, now);

    if (this.budgetDay !== day) {
      this.budgetDay = day;
      this.budgetUsed = 0;
    }

    if (this.budgetUsed >= this.config.googleAdsDailyOperationBudget) {
      throw new GoogleAdsError(
        'rate_limited',
        'quota_budget_exhausted',
        this.msUntilQuotaReset(now, day),
      );
    }

    this.budgetUsed += 1;
  }

  private msUntilQuotaReset(now: Date, day: string): number {
    // Hourly steps until the Pacific date changes; at most 25 iterations.
    for (let hours = 1; hours <= 25; hours += 1) {
      const probe = new Date(now.getTime() + hours * HOUR_MS);
      if (currentDayIn(QUOTA_TIMEZONE, probe) !== day) {
        return hours * HOUR_MS;
      }
    }

    return 24 * HOUR_MS;
  }
}
