import { Injectable } from '@nestjs/common';
import { GoogleAdsCredentialResolver } from '../../social-google/google-ads-credential.resolver';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';

/** `developers.google.com/data-manager/api/reference/rest/v1/events/ingest`. */
const DATA_MANAGER_INGEST_URL =
  'https://datamanager.googleapis.com/v1/events:ingest';
const REQUEST_TIMEOUT_MS = 30_000;

export type GoogleDataManagerErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'transient'
  | 'permanent';

/** A refused or failed ingestion: a code of ours plus Google's reason enum. */
export class GoogleDataManagerError extends Error {
  constructor(
    public readonly kind: GoogleDataManagerErrorKind,
    public readonly code: string,
    public readonly reason: string | null = null,
  ) {
    super(code);
    this.name = 'GoogleDataManagerError';
  }
}

/** One offline click conversion (GA-CONV, D-G6 revised). Ids only, no PII. */
export type GoogleClickConversionEvent = {
  /** Digits: the account's Google Ads conversion customer (operating account). */
  conversionCustomerId: string;
  /** Digits: id of the `UPLOAD_CLICKS` conversion action. */
  conversionActionId: string;
  gclid: string;
  eventAt: Date;
  /** Google deduplicates on it; a repeat on the same action is an adjustment. */
  transactionId: string;
  value: number | null;
  currency: string | null;
};

const DIGITS = /^\d{1,20}$/;
const ENUM = /^[A-Z][A-Z0-9_]{1,80}$/;

/**
 * HTTP client for the Data Manager API, the only supported path for new
 * offline conversion implementations since 2026-06-15
 * (`google-ads/api/docs/conversions/upload-clicks`).
 *
 * Same rules as the Google Ads clients: the OAuth bearer token from the
 * shared Google authorization (it needs the `datamanager` scope), no developer
 * credential, and provider bodies read only to find the error enum. One event
 * per request: the API is fast-fail, so one bad event would sink the others.
 * Consent is not sent: Lyra holds no consent record to vouch for.
 */
@Injectable()
export class GoogleDataManagerClient {
  constructor(
    private readonly googleCredentials: GoogleAdsCredentialResolver,
  ) {}

  async ingestClickConversion(
    credential: ResolvedAdCredential,
    event: GoogleClickConversionEvent,
    options: { validateOnly: boolean },
  ): Promise<{ requestId: string | null }> {
    if (
      credential.provider !== 'google_ads' ||
      !DIGITS.test(event.conversionCustomerId) ||
      !DIGITS.test(event.conversionActionId) ||
      !event.gclid ||
      !event.transactionId ||
      Number.isNaN(event.eventAt.getTime())
    ) {
      throw new GoogleDataManagerError(
        'permanent',
        'google_data_manager_bad_request',
      );
    }

    const loginCustomerId = await this.googleCredentials.loginCustomerId({
      connectionId: credential.connectionId,
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      companyContextId: credential.companyContextId ?? null,
    });

    const withValue =
      event.value !== null && Number.isFinite(event.value) && event.currency;
    const body = {
      destinations: [
        {
          operatingAccount: {
            accountType: 'GOOGLE_ADS',
            accountId: event.conversionCustomerId,
          },
          ...(loginCustomerId
            ? {
                loginAccount: {
                  accountType: 'GOOGLE_ADS',
                  accountId: loginCustomerId,
                },
              }
            : {}),
          productDestinationId: event.conversionActionId,
        },
      ],
      encoding: 'HEX',
      events: [
        {
          adIdentifiers: { gclid: event.gclid },
          eventTimestamp: event.eventAt.toISOString(),
          transactionId: event.transactionId,
          eventSource: 'WEB',
          ...(withValue
            ? { conversionValue: event.value, currency: event.currency }
            : {}),
        },
      ],
      validateOnly: options.validateOnly,
    };

    let response: Response;
    try {
      response = await fetch(DATA_MANAGER_INGEST_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Ambiguous after the request left; the retry carries the same
      // transactionId, which Google deduplicates.
      throw new GoogleDataManagerError(
        'transient',
        'google_data_manager_transient',
      );
    }

    if (!response.ok) throw await this.failure(response);

    try {
      const json = (await response.json()) as { requestId?: unknown };
      return {
        requestId:
          typeof json.requestId === 'string'
            ? json.requestId.slice(0, 120)
            : null,
      };
    } catch {
      return { requestId: null };
    }
  }

  private async failure(response: Response): Promise<GoogleDataManagerError> {
    if (response.status === 429) {
      return new GoogleDataManagerError(
        'rate_limited',
        'google_data_manager_rate_limited',
      );
    }
    if (response.status >= 500) {
      return new GoogleDataManagerError(
        'transient',
        'google_data_manager_transient',
      );
    }
    const reason = await this.readReason(response);
    if (response.status === 401) {
      return new GoogleDataManagerError(
        'auth',
        'google_data_manager_reauth_required',
        reason,
      );
    }
    if (response.status === 403) {
      if (reason === 'SERVICE_DISABLED') {
        return new GoogleDataManagerError(
          'auth',
          'google_data_manager_api_disabled',
          reason,
        );
      }
      if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
        return new GoogleDataManagerError(
          'auth',
          'google_data_manager_scope_missing',
          reason,
        );
      }
      return new GoogleDataManagerError(
        'auth',
        'google_data_manager_permission_denied',
        reason,
      );
    }
    return new GoogleDataManagerError(
      'permanent',
      'google_data_manager_bad_request',
      reason,
    );
  }

  /** The field violation's reason first (more specific), then ErrorInfo's. */
  private async readReason(response: Response): Promise<string | null> {
    try {
      const body = (await response.json()) as {
        error?: {
          details?: Array<{
            reason?: unknown;
            fieldViolations?: Array<{ reason?: unknown }>;
          }>;
        };
      };
      let info: string | null = null;
      for (const detail of body.error?.details ?? []) {
        for (const violation of detail.fieldViolations ?? []) {
          if (
            typeof violation.reason === 'string' &&
            ENUM.test(violation.reason)
          )
            return violation.reason;
        }
        if (
          !info &&
          typeof detail.reason === 'string' &&
          ENUM.test(detail.reason)
        )
          info = detail.reason;
      }
      return info;
    } catch {
      return null;
    }
  }
}
