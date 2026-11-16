import { Injectable } from '@nestjs/common';
import {
  TIKTOK_API_BASE_URL,
  readTikTokAdsAppConfig,
} from '../oauth/tiktok-ads-oauth.support';
import { TikTokAdsError } from '../sync/tiktok-ads-error';

const REQUEST_TIMEOUT_MS = 30_000;
const MS_PER_HOUR = 3_600_000;

/** Envelope codes that mean the token can no longer be used (reconnect). */
const TOKEN_CODES = new Set([40102, 40104, 40105]);
/** Envelope codes that mean the grant does not cover the request. */
const PERMISSION_CODES = new Set([40001, 40003]);
const RATE_LIMIT_CODES = new Set([40100, 40133]);

export type TikTokTokenGrant = {
  accessToken: string;
  /** Advertisers the person granted in the authorization page. */
  advertiserIds: string[];
  /** Seconds until expiry, when TikTok states one. */
  expiresIn: number | null;
  refreshToken: string | null;
};

export type TikTokAdvertiser = {
  externalAccountId: string;
  accountName: string | null;
  currency: string | null;
  /** A validated IANA zone, or null when TikTok's answer is not one. */
  timezone: string | null;
  accountStatus: string | null;
};

export type TikTokPage = {
  rows: Record<string, unknown>[];
  totalPages: number;
  apiCalls: number;
};

export type TikTokQuery = Record<string, string | number | string[] | boolean>;

function isZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read-only HTTP access to TikTok API for Business v1.3 (D-I7).
 *
 * The token travels in the `Access-Token` header, never in a URL. Every answer
 * is an envelope `{ code, message, request_id, data }`; `code !== 0` is a
 * failure even with HTTP 200. The only POST is the OAuth token exchange.
 */
@Injectable()
export class TikTokAdsApiClient {
  async exchangeCode(authCode: string): Promise<TikTokTokenGrant> {
    const { appId, secret } = readTikTokAdsAppConfig();
    const data = await this.request(
      'POST',
      'oauth2/access_token/',
      null,
      JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
    );
    const accessToken = data.access_token;

    if (typeof accessToken !== 'string' || !accessToken) {
      throw new TikTokAdsError(
        'transient',
        'tiktok_ads_invalid_response',
        null,
        1,
      );
    }

    const ids: unknown[] = Array.isArray(data.advertiser_ids)
      ? (data.advertiser_ids as unknown[])
      : [];
    const seconds = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;

    return {
      accessToken,
      advertiserIds: ids
        .map((id): unknown => (typeof id === 'number' ? String(id) : id))
        .filter(
          (id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id),
        ),
      expiresIn: seconds(data.expires_in),
      refreshToken:
        typeof data.refresh_token === 'string' && data.refresh_token
          ? data.refresh_token
          : null,
    };
  }

  /** One GET. Arrays/objects are JSON-encoded, as the v1.3 API expects. */
  get(
    accessToken: string,
    path: string,
    query: TikTokQuery,
  ): Promise<Record<string, unknown>> {
    return this.request('GET', path, accessToken, null, query);
  }

  /** A `page`/`page_size` listing (`data.list`, `data.page_info.total_page`). */
  async getPage(
    accessToken: string,
    path: string,
    query: TikTokQuery,
  ): Promise<TikTokPage> {
    const data = await this.get(accessToken, path, query);
    const list = Array.isArray(data.list) ? data.list : [];
    const pageInfo = (data.page_info ?? {}) as { total_page?: unknown };
    const totalPages =
      typeof pageInfo.total_page === 'number' && pageInfo.total_page > 0
        ? pageInfo.total_page
        : 1;

    return {
      rows: list.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      ),
      totalPages,
      apiCalls: 1,
    };
  }

  /** Name, currency and zone of the granted advertisers (`advertiser/info/`). */
  async listAdvertisers(
    accessToken: string,
    advertiserIds: string[],
  ): Promise<TikTokAdvertiser[]> {
    const advertisers: TikTokAdvertiser[] = [];

    // `advertiser/info/` takes at most 100 ids per call.
    for (let start = 0; start < advertiserIds.length; start += 100) {
      const data = await this.get(accessToken, 'advertiser/info/', {
        advertiser_ids: advertiserIds.slice(start, start + 100),
        fields: [
          'advertiser_id',
          'name',
          'currency',
          'timezone',
          'display_timezone',
          'status',
        ],
      });
      const list = Array.isArray(data.list) ? data.list : [];

      for (const item of list) {
        if (typeof item !== 'object' || item === null) continue;
        const row = item as Record<string, unknown>;
        const id =
          typeof row.advertiser_id === 'number'
            ? String(row.advertiser_id)
            : row.advertiser_id;

        if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) continue;

        advertisers.push(this.toAdvertiser(id, row));
      }
    }

    return advertisers;
  }

  toAdvertiser(id: string, row: Record<string, unknown>): TikTokAdvertiser {
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null;

    return {
      externalAccountId: id,
      accountName: text(row.name),
      currency: text(row.currency),
      timezone: isZone(row.display_timezone)
        ? row.display_timezone.trim()
        : isZone(row.timezone)
          ? row.timezone.trim()
          : null,
      accountStatus: text(row.status),
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    accessToken: string | null,
    body: string | null,
    query?: TikTokQuery,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${TIKTOK_API_BASE_URL}/${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(
        key,
        Array.isArray(value) ? JSON.stringify(value) : String(value),
      );
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) headers['Access-Token'] = accessToken;
    if (body) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new TikTokAdsError('transient', 'tiktok_ads_transient', null, 1);
    }

    if (response.status === 429) {
      throw new TikTokAdsError(
        'rate_limited',
        'tiktok_ads_rate_limited',
        MS_PER_HOUR,
        1,
      );
    }
    if (response.status >= 500) {
      throw new TikTokAdsError('transient', 'tiktok_ads_transient', null, 1);
    }

    const envelope: unknown = await response.json().catch(() => null);

    if (typeof envelope !== 'object' || envelope === null) {
      throw new TikTokAdsError(
        'transient',
        'tiktok_ads_invalid_response',
        null,
        1,
      );
    }

    const { code, data } = envelope as { code?: unknown; data?: unknown };

    if (code !== 0) throw this.failure(code);

    return typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  }

  /** Classifies an envelope code. TikTok's `message` is never read. */
  private failure(code: unknown): TikTokAdsError {
    const value = typeof code === 'number' ? code : Number(code);

    if (TOKEN_CODES.has(value)) {
      return new TikTokAdsError('auth', 'tiktok_ads_reauth_required', null, 1);
    }
    if (PERMISSION_CODES.has(value)) {
      return new TikTokAdsError(
        'auth',
        'tiktok_ads_permission_denied',
        null,
        1,
      );
    }
    if (RATE_LIMIT_CODES.has(value)) {
      return new TikTokAdsError(
        'rate_limited',
        'tiktok_ads_rate_limited',
        MS_PER_HOUR,
        1,
      );
    }
    if (Number.isFinite(value) && value >= 50000) {
      return new TikTokAdsError('transient', 'tiktok_ads_transient', null, 1);
    }

    return new TikTokAdsError('permanent', 'tiktok_ads_bad_request', null, 1);
  }
}
