import { Injectable } from '@nestjs/common';
import {
  GoogleApiError,
  readGoogleAdsApiConfig,
} from '../../social-google/google-api.client';
import { GoogleAdsCredentialResolver } from '../../social-google/google-ads-credential.resolver';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import {
  GoogleAdsError,
  type GoogleAdsErrorKind,
} from '../sync/google-ads-error';
import type { GoogleAdsRawRow } from './google-ads-reader.service';

const ADS_HOST = 'https://googleads.googleapis.com';
const REQUEST_TIMEOUT_MS = 30_000;
/** Inspection reads are tiny; anything bigger is not what a write looks at. */
const MAX_ROWS = 10_000;

/**
 * GA-WRITE (D-G5): the `:mutate` services a governed manual action may reach.
 * A closed list: nothing else in the Google Ads API is writable from here.
 */
export const GOOGLE_ADS_MUTATE_RESOURCES = [
  'campaigns',
  'campaignBudgets',
  'campaignCriteria',
  'assetGroups',
  'assetGroupSignals',
  'adGroupCriteria',
  'adGroups',
  'adGroupAds',
] as const;

export type GoogleAdsMutateResource =
  (typeof GOOGLE_ADS_MUTATE_RESOURCES)[number];

/** A refused write, with Google's error enum (safe: an identifier, no data). */
export class GoogleAdsMutationError extends GoogleAdsError {
  constructor(
    kind: GoogleAdsErrorKind,
    code: string,
    public readonly reason: string | null = null,
  ) {
    super(kind, code, null, 1);
    this.name = 'GoogleAdsMutationError';
  }
}

/**
 * HTTP client for governed Google Ads writes (GA-WRITE) and the small reads
 * that check state around them.
 *
 * Same rules as `GoogleAdsReaderService`: OAuth bearer token and
 * `login-customer-id` only, no developer credential header (A-05), version
 * from `GOOGLE_ADS_API_VERSION`. Provider bodies are read only to find the
 * error enum and are never copied anywhere.
 *
 * It only executes what a caller built. Deciding whether a write may happen
 * (brake, policy, preflight, confirmation) is the manual action service's job.
 */
@Injectable()
export class GoogleAdsMutationClient {
  constructor(
    private readonly googleCredentials: GoogleAdsCredentialResolver,
  ) {}

  /** One GAQL read (one operation). Rows may name customers: never log them. */
  async search(
    credential: ResolvedAdCredential,
    gaql: string,
  ): Promise<GoogleAdsRawRow[]> {
    const body = await this.post(credential, 'googleAds:searchStream', {
      query: gaql,
    });
    const rows: GoogleAdsRawRow[] = [];
    // `searchStream` answers an array of batches; a lone object is tolerated.
    for (const batch of Array.isArray(body) ? body : [body]) {
      const results =
        typeof batch === 'object' &&
        batch !== null &&
        Array.isArray((batch as { results?: unknown }).results)
          ? (batch as { results: unknown[] }).results
          : [];
      for (const row of results) {
        if (typeof row !== 'object' || row === null) continue;
        if (rows.length >= MAX_ROWS) return rows;
        rows.push(row as GoogleAdsRawRow);
      }
    }
    return rows;
  }

  /**
   * `customers/{cid}/{resource}:mutate`. `validateOnly` asks Google to run
   * every check without applying anything (the preflight, D-G5).
   */
  async mutate(
    credential: ResolvedAdCredential,
    resource: GoogleAdsMutateResource,
    operations: Array<Record<string, unknown>>,
    options: { validateOnly: boolean },
  ): Promise<{ resourceNames: string[] }> {
    if (!GOOGLE_ADS_MUTATE_RESOURCES.includes(resource)) {
      throw new GoogleAdsMutationError('permanent', 'google_ads_bad_request');
    }
    const body = await this.post(credential, `${resource}:mutate`, {
      operations,
      partialFailure: false,
      validateOnly: options.validateOnly,
    });
    const results =
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as { results?: unknown }).results)
        ? (body as { results: unknown[] }).results
        : [];
    const resourceNames = results
      .map((row) =>
        typeof row === 'object' && row !== null
          ? (row as { resourceName?: unknown }).resourceName
          : null,
      )
      .filter((name): name is string => typeof name === 'string');
    return { resourceNames };
  }

  private async post(
    credential: ResolvedAdCredential,
    path: string,
    json: unknown,
  ): Promise<unknown> {
    let version: string;
    try {
      version = readGoogleAdsApiConfig().version;
    } catch (error) {
      if (error instanceof GoogleApiError) {
        throw new GoogleAdsMutationError(
          'permanent',
          'google_ads_not_configured',
        );
      }
      throw error;
    }
    if (!/^\d{1,20}$/.test(credential.externalAccountId)) {
      throw new GoogleAdsMutationError('permanent', 'google_ads_bad_request');
    }

    const loginCustomerId = await this.googleCredentials.loginCustomerId({
      connectionId: credential.connectionId,
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      companyContextId: credential.companyContextId ?? null,
    });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    let response: Response;
    try {
      response = await fetch(
        `${ADS_HOST}/${version}/customers/${credential.externalAccountId}/${path}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(json),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      // A timeout after a write left is ambiguous; the caller re-reads state.
      throw new GoogleAdsMutationError('transient', 'google_ads_transient');
    }

    if (!response.ok) throw await this.failure(response);

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GoogleAdsMutationError(
        'transient',
        'google_ads_invalid_response',
      );
    }
  }

  /** Same classification as the reader, plus the enum as `reason`. */
  private async failure(response: Response): Promise<GoogleAdsMutationError> {
    if (response.status === 401) {
      return new GoogleAdsMutationError('auth', 'google_ads_reauth_required');
    }
    if (response.status === 429) {
      return new GoogleAdsMutationError(
        'rate_limited',
        'google_ads_rate_limited',
      );
    }
    if (response.status >= 500) {
      return new GoogleAdsMutationError('transient', 'google_ads_transient');
    }

    const reason = await this.readErrorEnum(response);

    if (response.status === 403) {
      if (
        reason === 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' ||
        reason === 'ACTION_NOT_PERMITTED'
      ) {
        return new GoogleAdsMutationError(
          'auth',
          'google_ads_project_not_approved',
          reason,
        );
      }
      if (reason === 'RESOURCE_EXHAUSTED') {
        return new GoogleAdsMutationError(
          'rate_limited',
          'google_ads_rate_limited',
          reason,
        );
      }
      return new GoogleAdsMutationError(
        'auth',
        'google_ads_permission_denied',
        reason,
      );
    }

    return new GoogleAdsMutationError(
      'permanent',
      'google_ads_bad_request',
      reason,
    );
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
            if (
              typeof value === 'string' &&
              /^[A-Z][A-Z0-9_]{1,80}$/.test(value)
            ) {
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
}
