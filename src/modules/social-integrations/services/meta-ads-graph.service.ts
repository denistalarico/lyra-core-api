import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MetaAdsLoginConfig,
  SOCIAL_META_ADS_APP_ID_ENV,
  SOCIAL_META_ADS_APP_SECRET_ENV,
  SOCIAL_META_ADS_LOGIN_CONFIG_ID_ENV,
  isNonEmptyString,
  isRecord,
} from '../oauth/meta-ads-oauth.support';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';

/** Hard ceiling on pagination, so a hostile or looping response cannot hang a request. */
const MAX_AD_ACCOUNT_PAGES = 10;
const AD_ACCOUNT_PAGE_SIZE = 50;

export type MetaAdAccount = {
  externalAccountId: string;
  accountName: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: string | null;
  businessId: string | null;
  businessName: string | null;
};

type GraphError = { message?: unknown; code?: unknown; type?: unknown };

/**
 * Read-only Meta Marketing API client for Lyra Social.
 *
 * A sibling of `MetaGraphService`, not an extension of it. That service's
 * contract is messaging — pages, webhook subscriptions, phone numbers,
 * conversation identities — and every method here would have to be guarded
 * against being called by a channel. Two small clients with narrow contracts
 * are cheaper to reason about than one client that serves two products.
 *
 * The app credentials are the Social app's own
 * (`SOCIAL_META_ADS_APP_ID` / `SOCIAL_META_ADS_APP_SECRET`). They are not
 * shared with the Inbox: a `config_id` belongs to the app that defines it, so
 * the client id, the client secret and the login config have to come from the
 * same app or Meta refuses the authorization.
 */
@Injectable()
export class MetaAdsGraphService {
  private get graphVersion() {
    return process.env.META_GRAPH_API_VERSION ?? 'v24.0';
  }

  // Read from the Social variables only. There is deliberately no `??
  // process.env.META_APP_ID` here: a fallback would silently authorize against
  // the messaging app, which cannot resolve the Social login config, and the
  // failure would surface as an opaque "URL bloqueada" from Meta instead of as
  // a missing-configuration error from us.
  private get appId() {
    return process.env[SOCIAL_META_ADS_APP_ID_ENV]?.trim();
  }

  private get appSecret() {
    return process.env[SOCIAL_META_ADS_APP_SECRET_ENV]?.trim();
  }

  private get loginConfigId() {
    return process.env[SOCIAL_META_ADS_LOGIN_CONFIG_ID_ENV]?.trim();
  }

  getLoginConfig(): MetaAdsLoginConfig {
    const appId = this.requireAppId();
    this.requireAppSecret();

    if (!this.loginConfigId) {
      throw new BadRequestException(
        `${SOCIAL_META_ADS_LOGIN_CONFIG_ID_ENV} is not configured.`,
      );
    }

    return {
      appId,
      configId: this.loginConfigId,
      authorizationEndpoint: `https://www.facebook.com/${this.graphVersion}/dialog/oauth`,
    };
  }

  async exchangeOAuthCode(input: { code: string; redirectUri: string }) {
    const appId = this.requireAppId();
    const appSecret = this.requireAppSecret();

    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/oauth/access_token`,
    );
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('code', input.code);

    const response = await this.fetchGraph(url);
    const data = await this.readJson(response);

    const accessToken = isRecord(data) ? data.access_token : undefined;

    if (!response.ok || !isNonEmptyString(accessToken)) {
      throw new BadRequestException('Meta Ads OAuth token exchange failed.');
    }

    return {
      accessToken: accessToken.trim(),
      expiresIn: this.readNumber(isRecord(data) ? data.expires_in : undefined),
    };
  }

  /**
   * Trades the short-lived login token for a long-lived one.
   *
   * Without this the credential dies in about an hour, which would make every
   * connection break silently the same afternoon it was made. The exchange is
   * best-effort: if Meta refuses, the caller keeps the short-lived token and
   * the expiry shown in the UI is simply nearer.
   */
  async exchangeLongLivedToken(accessToken: string) {
    const appId = this.requireAppId();
    const appSecret = this.requireAppSecret();

    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/oauth/access_token`,
    );
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', accessToken);

    const response = await this.fetchGraph(url);
    const data = await this.readJson(response);
    const longLivedToken = isRecord(data) ? data.access_token : undefined;

    if (!response.ok || !isNonEmptyString(longLivedToken)) {
      return null;
    }

    return {
      accessToken: longLivedToken.trim(),
      expiresIn: this.readNumber(isRecord(data) ? data.expires_in : undefined),
    };
  }

  /** Ad accounts the authorizing user can read. Read-only edge. */
  async listAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
    const accounts: MetaAdAccount[] = [];
    const seenCursors = new Set<string>();

    let url: URL | null = this.buildAdAccountsUrl(accessToken, null);

    for (let page = 0; page < MAX_AD_ACCOUNT_PAGES && url; page += 1) {
      const response = await this.fetchGraph(url);
      const data = await this.readJson(response);

      if (!response.ok || !isRecord(data) || !Array.isArray(data.data)) {
        throw new BadRequestException(
          this.describeGraphError(data) ?? 'Meta Ads account lookup failed.',
        );
      }

      for (const candidate of data.data) {
        const account = this.parseAdAccount(candidate);
        if (account) {
          accounts.push(account);
        }
      }

      url = this.nextAdAccountsUrl(accessToken, data.paging, seenCursors);
    }

    return accounts;
  }

  /**
   * Turns a provider error into something safe to store and show.
   *
   * Meta error strings routinely echo back the token, the redirect URI or the
   * app secret that caused the failure. Persisting one verbatim in
   * `last_sync_error` would write a credential into a column that every
   * settings screen renders.
   */
  sanitizeMetaErrorMessage(
    value: unknown,
    knownSecrets: ReadonlyArray<string | undefined> = [],
  ): string | null {
    if (typeof value !== 'string') return null;

    let sanitized = value.replace(/https?:\/\/\S+/gi, '[REDACTED_URL]');
    sanitized = sanitized.replace(
      /\b(?:authorization|(?:page[\s_-]*|user[\s_-]*)?access[\s_-]*token|app[\s_-]*secret|client[\s_-]*secret|oauth[\s_-]*code|authorization[\s_-]*code)\s*(?::|=|\s)\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)[,;]?/gi,
      '[REDACTED]',
    );
    sanitized = sanitized.replace(
      /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
      '[REDACTED]',
    );

    for (const secret of [...knownSecrets, this.appSecret]) {
      const normalizedSecret = secret?.trim();
      if (normalizedSecret) {
        sanitized = sanitized.split(normalizedSecret).join('[REDACTED]');
      }
    }

    return sanitized.replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  private buildAdAccountsUrl(accessToken: string, after: string | null) {
    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/me/adaccounts`,
    );
    url.searchParams.set(
      'fields',
      'id,account_id,name,currency,timezone_name,account_status,business{id,name}',
    );
    url.searchParams.set('limit', String(AD_ACCOUNT_PAGE_SIZE));
    url.searchParams.set('access_token', accessToken);

    if (after) {
      url.searchParams.set('after', after);
    }

    return url;
  }

  /**
   * Follows `paging.next` only when it points back at the Graph origin and at
   * a cursor not seen before — a redirect-shaped response must not turn this
   * client into an open fetcher, and a repeated cursor must not loop.
   */
  private nextAdAccountsUrl(
    accessToken: string,
    paging: unknown,
    seenCursors: Set<string>,
  ): URL | null {
    if (!isRecord(paging)) return null;

    const next = paging.next;
    if (!isNonEmptyString(next)) return null;

    let parsedNext: URL;
    try {
      parsedNext = new URL(next);
    } catch {
      return null;
    }

    if (
      parsedNext.origin !== META_GRAPH_ORIGIN ||
      !parsedNext.pathname.startsWith(`/${this.graphVersion}/`) ||
      parsedNext.username ||
      parsedNext.password
    ) {
      return null;
    }

    const after = parsedNext.searchParams.get('after')?.trim();
    if (!after || seenCursors.has(after)) {
      return null;
    }

    seenCursors.add(after);

    return this.buildAdAccountsUrl(accessToken, after);
  }

  private parseAdAccount(value: unknown): MetaAdAccount | null {
    if (!isRecord(value)) return null;

    // `id` arrives as `act_<account_id>`; it is the handle every other
    // Marketing API edge expects, so it is the one worth persisting.
    const externalAccountId = isNonEmptyString(value.id)
      ? value.id.trim()
      : isNonEmptyString(value.account_id)
        ? `act_${value.account_id.trim()}`
        : null;

    if (!externalAccountId) return null;

    const business = isRecord(value.business) ? value.business : null;

    return {
      externalAccountId,
      accountName: isNonEmptyString(value.name) ? value.name.trim() : null,
      currency: isNonEmptyString(value.currency)
        ? value.currency.trim().toUpperCase().slice(0, 8)
        : null,
      timezone: isNonEmptyString(value.timezone_name)
        ? value.timezone_name.trim().slice(0, 64)
        : null,
      // Meta returns this as a number today. Accepting only scalars keeps an
      // object from being stringified into "[object Object]" and stored as a
      // status the UI would then render.
      accountStatus:
        typeof value.account_status === 'number' ||
        typeof value.account_status === 'string'
          ? String(value.account_status)
          : null,
      businessId:
        business && isNonEmptyString(business.id) ? business.id.trim() : null,
      businessName:
        business && isNonEmptyString(business.name)
          ? business.name.trim()
          : null,
    };
  }

  private describeGraphError(data: unknown) {
    if (!isRecord(data)) return null;

    const error = isRecord(data.error) ? (data.error as GraphError) : null;

    return this.sanitizeMetaErrorMessage(error?.message);
  }

  private requireAppId() {
    if (!this.appId) {
      throw new BadRequestException(
        `${SOCIAL_META_ADS_APP_ID_ENV} is not configured.`,
      );
    }

    return this.appId;
  }

  private requireAppSecret() {
    if (!this.appSecret) {
      throw new BadRequestException(
        `${SOCIAL_META_ADS_APP_SECRET_ENV} is not configured.`,
      );
    }

    return this.appSecret;
  }

  private readNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  private async fetchGraph(url: URL) {
    try {
      return await fetch(url, { method: 'GET' });
    } catch {
      throw new BadRequestException('Meta Graph API request failed.');
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
}
