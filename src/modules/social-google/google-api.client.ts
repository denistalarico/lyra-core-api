import { Injectable } from '@nestjs/common';
import {
  GOOGLE_ADS_API_VERSION_ENV,
  GOOGLE_ADS_DEFAULT_API_VERSION,
  SOCIAL_GOOGLE_ADS_LOGIN_CUSTOMER_ID_ENV,
} from './google-oauth.constants';

const REQUEST_TIMEOUT_MS = 10_000;
/** Bounds on discovery so a huge Google account cannot fan out unbounded. */
const MAX_ACCESSIBLE_CUSTOMERS = 25;
const MAX_PAGES = 5;
const GA4_SUMMARY_PAGE_SIZE = 200;

const ADS_HOST = 'https://googleads.googleapis.com';
const ANALYTICS_ADMIN_HOST = 'https://analyticsadmin.googleapis.com/v1beta';

export type GoogleApiErrorCode =
  | 'reauth_required'
  | 'permission_denied'
  | 'transient'
  | 'bad_request'
  | 'invalid_response'
  | 'google_ads_not_configured';

/**
 * Failure talking to a Google data API. `code` is the only thing safe to log or
 * return: provider bodies can echo identifiers and are never attached.
 */
export class GoogleApiError extends Error {
  constructor(public readonly code: GoogleApiErrorCode) {
    super(code);
    this.name = 'GoogleApiError';
  }
}

export type GoogleAdsCustomer = {
  customerId: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  isManager: boolean;
  isTest: boolean;
  status: string;
  /** `direct` or the manager customer id the account was reached through. */
  accessVia: string;
};

export type Ga4PropertySummary = {
  propertyId: string;
  displayName: string;
  accountId: string;
  accountName: string;
};

export type Ga4PropertyDetail = {
  propertyId: string;
  displayName: string;
  timeZone: string | null;
  currency: string | null;
};

export type GoogleAdsApiConfig = {
  version: string;
  loginCustomerId: string | null;
};

/** Reads server config; malformed values fail explicitly, never at boot. */
export function readGoogleAdsApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleAdsApiConfig {
  const version =
    env[GOOGLE_ADS_API_VERSION_ENV]?.trim() || GOOGLE_ADS_DEFAULT_API_VERSION;
  if (!/^v\d{1,3}$/.test(version)) {
    throw new GoogleApiError('google_ads_not_configured');
  }
  const rawLogin = env[SOCIAL_GOOGLE_ADS_LOGIN_CUSTOMER_ID_ENV]?.trim();
  const loginCustomerId = rawLogin ? rawLogin.replace(/-/g, '') : null;
  if (loginCustomerId && !/^\d{10}$/.test(loginCustomerId)) {
    throw new GoogleApiError('google_ads_not_configured');
  }
  return { version, loginCustomerId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Read-only discovery calls for the selection step (G1). Authenticated by the
 * caller's OAuth access token only: no developer credential header is ever sent.
 */
@Injectable()
export class GoogleApiClient {
  /** Customers the token can use, with managers expanded into child accounts. */
  async listAdsCustomers(accessToken: string): Promise<GoogleAdsCustomer[]> {
    const config = readGoogleAdsApiConfig();
    const base = `${ADS_HOST}/${config.version}`;

    const body = await this.request(
      `${base}/customers:listAccessibleCustomers`,
      {
        accessToken,
      },
    );
    const names =
      isRecord(body) && Array.isArray(body.resourceNames)
        ? body.resourceNames
        : [];
    const accessible = names
      .map((name) =>
        typeof name === 'string'
          ? /^customers\/(\d{10})$/.exec(name)?.[1]
          : null,
      )
      .filter((id): id is string => !!id);

    const roots = new Set(accessible);
    if (config.loginCustomerId) roots.add(config.loginCustomerId);

    const found = new Map<string, GoogleAdsCustomer>();
    let visited = 0;
    for (const rootId of roots) {
      if (visited++ >= MAX_ACCESSIBLE_CUSTOMERS) break;
      let root: GoogleAdsCustomer | null;
      try {
        root = await this.readCustomer(base, accessToken, rootId, null);
      } catch (error) {
        // One inaccessible root must not hide the others, but a dead token or
        // an outage is not specific to a root: those abort the listing.
        if (
          error instanceof GoogleApiError &&
          (error.code === 'permission_denied' || error.code === 'bad_request')
        ) {
          continue;
        }
        throw error;
      }
      if (!root) continue;
      this.keepClosest(found, root);
      if (!root.isManager) continue;
      try {
        for (const child of await this.listManagedCustomers(
          base,
          accessToken,
          rootId,
        )) {
          this.keepClosest(found, child);
        }
      } catch (error) {
        if (
          error instanceof GoogleApiError &&
          (error.code === 'permission_denied' || error.code === 'bad_request')
        ) {
          continue;
        }
        throw error;
      }
    }

    return [...found.values()].filter(
      (customer) =>
        customer.status !== 'CANCELED' && customer.status !== 'CLOSED',
    );
  }

  /** Account summaries (accounts + their GA4 properties) in one listing. */
  async listGa4PropertySummaries(
    accessToken: string,
  ): Promise<Ga4PropertySummary[]> {
    const out: Ga4PropertySummary[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        pageSize: String(GA4_SUMMARY_PAGE_SIZE),
      });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await this.request(
        `${ANALYTICS_ADMIN_HOST}/accountSummaries?${query.toString()}`,
        { accessToken },
      );
      if (!isRecord(body)) throw new GoogleApiError('invalid_response');
      const summaries = Array.isArray(body.accountSummaries)
        ? body.accountSummaries
        : [];
      for (const summary of summaries) {
        if (!isRecord(summary)) continue;
        const accountId = /^accounts\/(\d{1,20})$/.exec(
          str(summary.account) ?? '',
        )?.[1];
        if (!accountId) continue;
        const accountName = str(summary.displayName) ?? accountId;
        const properties = Array.isArray(summary.propertySummaries)
          ? summary.propertySummaries
          : [];
        for (const property of properties) {
          if (!isRecord(property)) continue;
          const propertyId = /^properties\/(\d{1,20})$/.exec(
            str(property.property) ?? '',
          )?.[1];
          if (!propertyId) continue;
          out.push({
            propertyId,
            displayName: str(property.displayName) ?? propertyId,
            accountId,
            accountName,
          });
        }
      }
      pageToken = str(body.nextPageToken);
      if (!pageToken) break;
    }
    return out;
  }

  /** Time zone and currency of one property (not part of the summaries). */
  async getGa4Property(
    accessToken: string,
    propertyId: string,
  ): Promise<Ga4PropertyDetail> {
    const body = await this.request(
      `${ANALYTICS_ADMIN_HOST}/properties/${encodeURIComponent(propertyId)}`,
      { accessToken },
    );
    if (!isRecord(body)) throw new GoogleApiError('invalid_response');
    return {
      propertyId,
      displayName: str(body.displayName) ?? propertyId,
      timeZone: str(body.timeZone),
      currency: str(body.currencyCode),
    };
  }

  private keepClosest(
    found: Map<string, GoogleAdsCustomer>,
    next: GoogleAdsCustomer,
  ) {
    const current = found.get(next.customerId);
    // A direct grant is the most reliable route to an account.
    if (
      !current ||
      (current.accessVia !== 'direct' && next.accessVia === 'direct')
    ) {
      found.set(next.customerId, next);
    }
  }

  private async readCustomer(
    base: string,
    accessToken: string,
    customerId: string,
    loginCustomerId: string | null,
  ): Promise<GoogleAdsCustomer | null> {
    const rows = await this.search(
      base,
      accessToken,
      customerId,
      loginCustomerId,
      'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account, customer.status FROM customer LIMIT 1',
    );
    const customer =
      rows[0] && isRecord(rows[0].customer) ? rows[0].customer : null;
    if (!customer) return null;
    return {
      customerId,
      name: str(customer.descriptiveName) ?? customerId,
      currency: str(customer.currencyCode),
      timezone: str(customer.timeZone),
      isManager: customer.manager === true,
      isTest: customer.testAccount === true,
      status: str(customer.status) ?? 'UNKNOWN',
      accessVia: 'direct',
    };
  }

  private async listManagedCustomers(
    base: string,
    accessToken: string,
    managerId: string,
  ): Promise<GoogleAdsCustomer[]> {
    const rows = await this.search(
      base,
      accessToken,
      managerId,
      managerId,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.test_account, customer_client.status, customer_client.hidden, customer_client.level FROM customer_client WHERE customer_client.level >= 1',
    );
    const out: GoogleAdsCustomer[] = [];
    for (const row of rows) {
      const client = isRecord(row.customerClient) ? row.customerClient : null;
      if (!client || client.hidden === true) continue;
      const id = str(client.id);
      if (!id || !/^\d{10}$/.test(id)) continue;
      out.push({
        customerId: id,
        name: str(client.descriptiveName) ?? id,
        currency: str(client.currencyCode),
        timezone: str(client.timeZone),
        isManager: client.manager === true,
        isTest: client.testAccount === true,
        status: str(client.status) ?? 'UNKNOWN',
        accessVia: managerId,
      });
    }
    return out;
  }

  private async search(
    base: string,
    accessToken: string,
    customerId: string,
    loginCustomerId: string | null,
    query: string,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await this.request(
        `${base}/customers/${customerId}/googleAds:search`,
        {
          accessToken,
          loginCustomerId,
          json: pageToken ? { query, pageToken } : { query },
        },
      );
      if (!isRecord(body)) throw new GoogleApiError('invalid_response');
      if (Array.isArray(body.results)) {
        for (const row of body.results) if (isRecord(row)) rows.push(row);
      }
      pageToken = str(body.nextPageToken);
      if (!pageToken) break;
    }
    return rows;
  }

  private async request(
    url: string,
    options: {
      accessToken: string;
      loginCustomerId?: string | null;
      json?: unknown;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
    };
    if (options.loginCustomerId) {
      headers['login-customer-id'] = options.loginCustomerId;
    }
    if (options.json !== undefined)
      headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.json !== undefined ? 'POST' : 'GET',
        headers,
        body:
          options.json !== undefined ? JSON.stringify(options.json) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleApiError('transient');
    }

    if (response.status === 401) throw new GoogleApiError('reauth_required');
    if (response.status === 403) throw new GoogleApiError('permission_denied');
    if (response.status === 429 || response.status >= 500) {
      throw new GoogleApiError('transient');
    }
    if (!response.ok) throw new GoogleApiError('bad_request');
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GoogleApiError('invalid_response');
    }
  }
}
