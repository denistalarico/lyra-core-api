import { BadRequestException, Injectable } from '@nestjs/common';
import { normalizeAdAccountId } from '../meta-ad-account-id';
import {
  MetaAdsLoginConfig,
  SOCIAL_META_ADS_APP_ID_ENV,
  SOCIAL_META_ADS_APP_SECRET_ENV,
  SOCIAL_META_ADS_LOGIN_CONFIG_ID_ENV,
  isNonEmptyString,
  isRecord,
} from '../oauth/meta-ads-oauth.support';
import {
  EMPTY_META_GRAPH_USAGE,
  MetaGraphError,
  MetaGraphUsage,
  classifyGraphResponse,
  classifyGraphTransportFailure,
  parseMetaGraphUsage,
} from './meta-graph-error';

const META_GRAPH_ORIGIN = 'https://graph.facebook.com';

/**
 * Ceiling on how long a single Graph call may take.
 *
 * `fetch` has no default timeout, so without this a provider that accepts the
 * connection and then stops answering holds the caller open indefinitely. That
 * is survivable for a settings screen, where a person eventually gives up, and
 * is not survivable for a worker that will hold a claimed job while it waits.
 */
export const META_GRAPH_TIMEOUT_MS = 30_000;

/** Hard ceiling on pagination, so a hostile or looping response cannot hang a request. */
const MAX_AD_ACCOUNT_PAGES = 10;
const AD_ACCOUNT_PAGE_SIZE = 50;

/**
 * What a caller may address on the Graph: `act_123`, or `act_123/campaigns`.
 *
 * The path is assembled by callers, so it is validated rather than trusted. A
 * value carrying `..`, a query string or a second host would otherwise turn
 * this client into a general-purpose fetcher pointed at Meta with our token
 * attached.
 */
const GRAPH_PATH_PATTERN = /^[A-Za-z0-9_]+(?:\/[a-z_]+)?$/;

/** A Graph path always opens with its API version: `/v25.0/…`. */
const GRAPH_VERSION_PREFIX = /^\/v\d+\.\d+\//;

/** A completed Graph call: the response, its body, and what the headers said. */
type GraphRequestResult = {
  response: Response;
  data: unknown;
  usage: MetaGraphUsage;
};

/** Rows from a paged edge, plus the usage reading from the last page fetched. */
export type MetaGraphPage<T> = {
  rows: T[];
  usage: MetaGraphUsage;
  /**
   * The walk stopped at the page ceiling with more pages still on offer.
   *
   * Reported rather than swallowed because the difference matters to anything
   * that reasons about absence: a truncated read looks exactly like a complete
   * one from the row list alone, and treating it as complete is how a sync
   * concludes that ten thousand objects "disappeared" and archives them.
   */
  truncated: boolean;
};

/** One paginated edge read, addressed by path and field list. */
export type MetaGraphEdgeRequest = {
  accessToken: string;
  /** Graph path below the version, e.g. `act_123/campaigns`. */
  path: string;
  /** Comma-separated Graph field list. */
  fields: string;
  limit: number;
  maxPages: number;
  failureMessage: string;
  /**
   * Extra query parameters for edges that need more than a field list.
   *
   * Insights is the reason: its answer is defined by `level`, `time_range`,
   * `time_increment` and the attribution flag as much as by its fields. They
   * are passed here rather than baked into a second URL builder, so the token,
   * the version and the origin keep being attached in exactly one place.
   */
  params?: Readonly<Record<string, string>>;
};

/**
 * Query parameters `buildGraphUrl` owns and a caller may not supply.
 *
 * `access_token` above all: a caller-supplied one would silently replace the
 * credential this client was given. The other three are set from the typed
 * fields of the request, and letting a loose map override them would mean two
 * sources of truth for the same value.
 */
const RESERVED_GRAPH_PARAMS = new Set([
  'access_token',
  'fields',
  'limit',
  'after',
]);

/** Graph parameter names are lowercase words; anything else is a bug. */
const GRAPH_PARAM_PATTERN = /^[a-z_]+$/;

export type MetaAdAccount = {
  externalAccountId: string;
  accountName: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: string | null;
  businessId: string | null;
  businessName: string | null;
};

type GraphError = {
  message?: unknown;
  code?: unknown;
  /** Meta's second-level code: 463 is "expired", 467 is "invalid". */
  error_subcode?: unknown;
  type?: unknown;
};

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

    const { response, data, usage } = await this.requestGraph(url);

    const accessToken = isRecord(data) ? data.access_token : undefined;

    if (!response.ok || !isNonEmptyString(accessToken)) {
      // The provider message is dropped rather than sanitized here: a failed
      // code exchange echoes back the code and frequently the secret, and no
      // caller of this method renders anything but the fixed string.
      throw this.toGraphError({
        response,
        data,
        usage,
        safeMessage: 'Meta Ads OAuth token exchange failed.',
      });
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

    const { response, data } = await this.requestGraph(url);
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
    const { rows } = await this.listAdAccountsWithUsage(accessToken);

    return rows;
  }

  /**
   * The same read, with the rate-limit headers it produced.
   *
   * Separate from `listAdAccounts` so S1's callers keep the return type they
   * were written against. A sync pipeline needs to know it is at 90% of the
   * business use-case quota before it starts the next account; a settings
   * screen does not, and should not have to unwrap a tuple to ignore it.
   */
  async listAdAccountsWithUsage(
    accessToken: string,
  ): Promise<MetaGraphPage<MetaAdAccount>> {
    const page = await this.fetchPagedRows({
      buildUrl: (after) => this.buildAdAccountsUrl(accessToken, after),
      maxPages: MAX_AD_ACCOUNT_PAGES,
      failureMessage: 'Meta Ads account lookup failed.',
    });

    const accounts: MetaAdAccount[] = [];

    for (const candidate of page.rows) {
      const account = this.parseAdAccount(candidate);
      if (account) {
        accounts.push(account);
      }
    }

    return { rows: accounts, usage: page.usage, truncated: page.truncated };
  }

  /**
   * Reads one Graph node — an ad account, a campaign — with no pagination.
   *
   * Separate from `readEdge` because a node has no `data` array to walk, and
   * making the paginator tolerate a bodiless shape would weaken the one check
   * that catches an edge answering with an error object instead of rows.
   */
  async readNode(input: {
    accessToken: string;
    path: string;
    fields: string;
    failureMessage: string;
  }): Promise<Record<string, unknown>> {
    const url = this.buildGraphUrl({
      path: input.path,
      accessToken: input.accessToken,
      fields: input.fields,
    });

    const { response, data, usage } = await this.requestGraph(url);

    if (!response.ok || !isRecord(data)) {
      throw this.toGraphError({
        response,
        data,
        usage,
        safeMessage: input.failureMessage,
        allowProviderMessage: true,
      });
    }

    return data;
  }

  /**
   * Reads a paginated Graph edge through the S2.1 walker.
   *
   * The only way for a reader to page a Meta edge. Everything the walker
   * guarantees — the URL rebuilt from our own credentials on every page, a
   * `next` that must point at the same path on the same origin, a repeated
   * cursor ending the walk — is a property of *that* loop, and a second
   * pagination implementation elsewhere would have none of it.
   */
  async readEdge(input: MetaGraphEdgeRequest): Promise<MetaGraphPage<unknown>> {
    return this.fetchPagedRows({
      buildUrl: (after) =>
        this.buildGraphUrl({
          path: input.path,
          accessToken: input.accessToken,
          fields: input.fields,
          limit: input.limit,
          after,
          params: input.params,
        }),
      maxPages: input.maxPages,
      failureMessage: input.failureMessage,
    });
  }

  /**
   * Walks a cursor-paginated Graph edge.
   *
   * Generalized from the ad-accounts loop it replaces, unchanged in what it
   * guarantees: the URL is always rebuilt from `buildUrl` with our own
   * credentials, so `paging.next` contributes a cursor and nothing else. A
   * `next` that points somewhere other than the same Graph path cannot redirect
   * this client at another host, and a repeated cursor ends the walk instead of
   * looping until the page ceiling.
   *
   * The cursor is deliberately not returned. Persisting a resume point is an
   * S2.2 decision, and offering one here would invite a caller to store a value
   * that expires without saying so.
   */
  private async fetchPagedRows(input: {
    buildUrl: (after: string | null) => URL;
    maxPages: number;
    failureMessage: string;
  }): Promise<MetaGraphPage<unknown>> {
    const rows: unknown[] = [];
    const seenCursors = new Set<string>();

    let usage: MetaGraphUsage = EMPTY_META_GRAPH_USAGE;
    let after: string | null = null;
    let truncated = false;

    for (let page = 0; page < input.maxPages; page += 1) {
      const url = input.buildUrl(after);
      const result = await this.requestGraph(url);

      usage = result.usage;

      const data = result.data;

      if (!result.response.ok || !isRecord(data) || !Array.isArray(data.data)) {
        throw this.toGraphError({
          response: result.response,
          data,
          usage,
          safeMessage: input.failureMessage,
          allowProviderMessage: true,
        });
      }

      rows.push(...(data.data as unknown[]));

      after = this.nextCursor(data.paging, url.pathname, seenCursors);

      if (!after) break;

      // Meta still has more and the ceiling is reached: the row list is a
      // prefix, not the edge.
      truncated = page === input.maxPages - 1;
    }

    return { rows, usage, truncated };
  }

  /**
   * Builds a Graph URL for a validated path, always with our own credentials.
   *
   * Single builder for nodes and edges so the token, the version and the origin
   * are attached in exactly one place — a second builder is how a call ends up
   * on an unversioned path or, worse, with a caller-supplied token.
   */
  private buildGraphUrl(input: {
    path: string;
    accessToken: string;
    fields: string;
    limit?: number;
    after?: string | null;
    params?: Readonly<Record<string, string>>;
  }): URL {
    if (!GRAPH_PATH_PATTERN.test(input.path)) {
      // A caller built this string, so a bad one is a programming error rather
      // than a provider failure — and must not become a request.
      throw new BadRequestException('Invalid Meta Graph path.');
    }

    const url = new URL(
      `${META_GRAPH_ORIGIN}/${this.graphVersion}/${input.path}`,
    );

    // Written before the owned parameters below, so a caller cannot shadow one
    // even if the guard were ever relaxed.
    for (const [key, value] of Object.entries(input.params ?? {})) {
      if (!GRAPH_PARAM_PATTERN.test(key) || RESERVED_GRAPH_PARAMS.has(key)) {
        throw new BadRequestException('Invalid Meta Graph parameter.');
      }

      url.searchParams.set(key, value);
    }

    url.searchParams.set('fields', input.fields);

    if (input.limit) {
      url.searchParams.set('limit', String(input.limit));
    }

    if (input.after) {
      url.searchParams.set('after', input.after);
    }

    url.searchParams.set('access_token', input.accessToken);

    return url;
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
   * Reads the next cursor out of `paging.next`, or null to stop.
   *
   * Accepts a cursor only when `next` points back at the Graph origin, at a
   * versioned Graph path, and at the very same edge we asked for — a
   * redirect-shaped response must not turn this client into an open fetcher,
   * and a `next` that jumps to a different edge is not pagination. Credentials
   * embedded in a `next` URL are never honoured either: `username`/`password`
   * disqualify it outright, and the token always comes from `buildUrl`.
   *
   * The version segment is compared as "some version", not as "our version".
   * Meta rolls `paging.next` forward on its own — a request against v25.0
   * answers with a `next` on v26.0 — and demanding equality made every walk
   * stop after its first page while reporting nothing wrong. That is the worst
   * possible shape for this failure: the caller receives a prefix that looks
   * exactly like a complete edge, and a sync built on it concludes that
   * everything past page one has been deleted. The cursor is still the only
   * thing taken from that URL, so nothing is loosened by accepting a newer
   * version of the same path.
   */
  private nextCursor(
    paging: unknown,
    expectedPath: string,
    seenCursors: Set<string>,
  ): string | null {
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
      !GRAPH_VERSION_PREFIX.test(parsedNext.pathname) ||
      this.withoutVersion(parsedNext.pathname) !==
        this.withoutVersion(expectedPath) ||
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

    return after;
  }

  /** `/v26.0/act_1/ads` → `/act_1/ads`, so two versions of one edge compare equal. */
  private withoutVersion(pathname: string): string {
    return pathname.replace(GRAPH_VERSION_PREFIX, '/');
  }

  private parseAdAccount(value: unknown): MetaAdAccount | null {
    if (!isRecord(value)) return null;

    // Meta sends both spellings: `id` as `act_<digits>` and `account_id` as
    // the bare number. Either normalizes to the canonical handle, which is the
    // one every other Marketing API edge expects and the one worth persisting.
    // A row that matches neither is dropped rather than stored — it could not
    // be selected afterwards anyway, since the select DTOs demand this shape.
    const externalAccountId =
      normalizeAdAccountId(value.id) ?? normalizeAdAccountId(value.account_id);

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

  /**
   * Turns a failed Graph response into a classified, safe-to-store error.
   *
   * The provider message is only used when the caller says it is renderable,
   * and only after sanitizing. Some edges — the token exchange above — must
   * never surface it at all, because what they echo back is the credential
   * that failed.
   */
  private toGraphError(input: {
    response: Response;
    data: unknown;
    usage: MetaGraphUsage;
    safeMessage: string;
    allowProviderMessage?: boolean;
  }): MetaGraphError {
    const error =
      isRecord(input.data) && isRecord(input.data.error)
        ? (input.data.error as GraphError)
        : null;

    const metaCode = this.readNumber(error?.code);
    const metaSubcode = this.readNumber(
      isRecord(error) ? error.error_subcode : undefined,
    );
    const httpStatus = this.readNumber(input.response.status);

    const providerMessage = input.allowProviderMessage
      ? this.sanitizeMetaErrorMessage(error?.message)
      : null;

    return new MetaGraphError({
      kind: classifyGraphResponse({ httpStatus, metaCode, metaSubcode }),
      safeMessage: providerMessage ?? input.safeMessage,
      httpStatus,
      metaCode,
      metaSubcode,
      usage: input.usage,
    });
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

  /**
   * One Graph call: bounded in time, and never re-throwing the provider's own
   * error object.
   *
   * A transport failure stringifies to things like
   * `ECONNRESET at https://graph.facebook.com/...?access_token=EAAG…`, so the
   * message is always ours; only the *kind* is taken from the failure.
   */
  private async requestGraph(url: URL): Promise<GraphRequestResult> {
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        signal: this.requestTimeoutSignal(),
      });
    } catch (error) {
      const classified = classifyGraphTransportFailure(error);

      throw new MetaGraphError({
        kind: classified.kind,
        safeMessage: classified.safeMessage,
      });
    }

    return {
      response,
      data: await this.readJson(response),
      usage: parseMetaGraphUsage(response.headers),
    };
  }

  /**
   * Guarded rather than called directly: a runtime without `AbortSignal.timeout`
   * should still make the request, not fail on a missing platform API.
   */
  private requestTimeoutSignal(): AbortSignal | undefined {
    return typeof AbortSignal !== 'undefined' &&
      typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(META_GRAPH_TIMEOUT_MS)
      : undefined;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
}
