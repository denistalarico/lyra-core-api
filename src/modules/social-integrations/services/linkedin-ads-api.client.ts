import { Injectable } from '@nestjs/common';
import { LinkedInAdsError } from '../sync/linkedin-ads-error';
import {
  LINKEDIN_TOKEN_URL,
  readLinkedInAdsAppConfig,
  readLinkedInApiVersion,
} from '../oauth/linkedin-ads-oauth.support';

const API_HOST = 'https://api.linkedin.com/rest';
const REQUEST_TIMEOUT_MS = 30_000;
const MS_PER_HOUR = 3_600_000;

export type LinkedInTokenGrant = {
  accessToken: string;
  /** Seconds until expiry (LinkedIn issues 60 days). */
  expiresIn: number | null;
  /** Only for partners with programmatic refresh; otherwise absent. */
  refreshToken: string | null;
  refreshTokenExpiresIn: number | null;
};

export type LinkedInAdAccount = {
  externalAccountId: string;
  accountName: string | null;
  currency: string | null;
  accountStatus: string | null;
};

export type LinkedInPage = {
  elements: Record<string, unknown>[];
  nextPageToken: string | null;
  apiCalls: number;
};

/**
 * Read-only HTTP access to the LinkedIn Marketing API (D-I7).
 *
 * Every call carries the three headers the versioned API requires. The version
 * comes from `LINKEDIN_API_VERSION`, never from this file. No mutation method
 * exists here: the only POST is the OAuth token exchange.
 *
 * Failures are reduced to a `LinkedInAdsError` code; response bodies are never
 * copied anywhere because they echo URNs and request fragments.
 */
@Injectable()
export class LinkedInAdsApiClient {
  async exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<LinkedInTokenGrant> {
    const { clientId, clientSecret } = readLinkedInAdsAppConfig();

    let response: Response;
    try {
      response = await fetch(LINKEDIN_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: input.redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new LinkedInAdsError(
        'transient',
        'linkedin_ads_transient',
        null,
        1,
      );
    }

    if (!response.ok) {
      throw new LinkedInAdsError(
        response.status >= 500 ? 'transient' : 'auth',
        response.status >= 500
          ? 'linkedin_ads_transient'
          : 'linkedin_ads_token_exchange_failed',
        null,
        1,
      );
    }

    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const accessToken = body?.access_token;

    if (typeof accessToken !== 'string' || !accessToken) {
      throw new LinkedInAdsError(
        'transient',
        'linkedin_ads_invalid_response',
        null,
        1,
      );
    }

    const seconds = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;

    return {
      accessToken,
      expiresIn: seconds(body?.expires_in),
      refreshToken:
        typeof body?.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : null,
      refreshTokenExpiresIn: seconds(body?.refresh_token_expires_in),
    };
  }

  /**
   * One GET against `/rest/<path>?<query>`. `query` is passed pre-encoded
   * because Rest.li syntax (`List(...)`, `(start:(year:...))`) must not be
   * re-encoded by URLSearchParams.
   */
  async get(
    accessToken: string,
    path: string,
    query: string,
  ): Promise<Record<string, unknown>> {
    const version = readLinkedInApiVersion();

    if (!version) {
      throw new LinkedInAdsError('permanent', 'linkedin_ads_not_configured');
    }

    let response: Response;
    try {
      response = await fetch(`${API_HOST}/${path}${query ? `?${query}` : ''}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Linkedin-Version': version,
          'X-Restli-Protocol-Version': '2.0.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new LinkedInAdsError(
        'transient',
        'linkedin_ads_transient',
        null,
        1,
      );
    }

    // The request reached LinkedIn: the quota is spent even though it failed.
    if (!response.ok) throw this.failure(response);

    const body: unknown = await response.json().catch(() => null);

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new LinkedInAdsError(
        'transient',
        'linkedin_ads_invalid_response',
        null,
        1,
      );
    }

    return body as Record<string, unknown>;
  }

  /** A finder with cursor pagination (`metadata.nextPageToken`). */
  async getPage(
    accessToken: string,
    path: string,
    query: string,
    pageToken: string | null,
  ): Promise<LinkedInPage> {
    const body = await this.get(
      accessToken,
      path,
      pageToken ? `${query}&pageToken=${encodeURIComponent(pageToken)}` : query,
    );
    const elements = Array.isArray(body.elements)
      ? body.elements.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
        )
      : [];
    const metadata = body.metadata as { nextPageToken?: unknown } | undefined;
    const next = metadata?.nextPageToken;

    return {
      elements,
      nextPageToken: typeof next === 'string' && next ? next : null,
      apiCalls: 1,
    };
  }

  /**
   * Ad accounts the member can read: BUSINESS/ENTERPRISE, not test, ACTIVE.
   * https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts
   */
  async listAdAccounts(accessToken: string): Promise<LinkedInAdAccount[]> {
    const accounts: LinkedInAdAccount[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < 20; page += 1) {
      const result: LinkedInPage = await this.getPage(
        accessToken,
        'adAccounts',
        'q=search&search=(status:(values:List(ACTIVE)),test:false)&pageSize=100',
        pageToken,
      );

      for (const element of result.elements) {
        const id =
          typeof element.id === 'number' ? String(element.id) : element.id;

        if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) continue;

        accounts.push({
          externalAccountId: id,
          accountName:
            typeof element.name === 'string' && element.name.trim()
              ? element.name.trim()
              : null,
          currency:
            typeof element.currency === 'string' && element.currency.trim()
              ? element.currency.trim()
              : null,
          accountStatus:
            typeof element.status === 'string' ? element.status : null,
        });
      }

      pageToken = result.nextPageToken;
      if (!pageToken) break;
    }

    return accounts;
  }

  /** Classifies a refusal. The body is never read. */
  private failure(response: Response): LinkedInAdsError {
    const status = response.status;

    if (status === 401) {
      return new LinkedInAdsError(
        'auth',
        'linkedin_ads_reauth_required',
        null,
        1,
      );
    }

    if (status === 403) {
      return new LinkedInAdsError(
        'auth',
        'linkedin_ads_permission_denied',
        null,
        1,
      );
    }

    if (status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));

      return new LinkedInAdsError(
        'rate_limited',
        'linkedin_ads_rate_limited',
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : MS_PER_HOUR,
        1,
      );
    }

    if (status >= 500) {
      return new LinkedInAdsError(
        'transient',
        'linkedin_ads_transient',
        null,
        1,
      );
    }

    return new LinkedInAdsError(
      'permanent',
      'linkedin_ads_bad_request',
      null,
      1,
    );
  }
}
