import { Injectable } from '@nestjs/common';
import {
  META_ORGANIC_AUTHORIZATION_ORIGIN,
  META_ORGANIC_GRAPH_API_VERSION,
  META_ORGANIC_GRAPH_ORIGIN,
  requireSocialMetaAppId,
  requireSocialMetaAppSecret,
  requireSocialMetaOrganicLoginConfigId,
  type MetaOrganicLoginConfig,
} from './meta-organic-oauth.support';
import {
  MetaOrganicGraphError,
  type MetaOrganicGraphErrorCode,
  type MetaOrganicGraphErrorKind,
} from './meta-organic-graph.error';

export const META_ORGANIC_GRAPH_TIMEOUT_MS = 30_000;
const META_ORGANIC_PAGE_SIZE = 100;
const META_ORGANIC_MAX_PAGES = 10;
const META_GRAPH_VERSION_PREFIX = /^\/v\d+\.\d+\//;
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);
const META_CREDENTIAL_CODES = new Set([102, 190]);
const META_PERMISSION_CODES = new Set([10, 200, 294]);

type MetaErrorPayload = {
  code?: unknown;
  error_subcode?: unknown;
};

export type MetaOrganicToken = {
  accessToken: string;
  expiresIn: number | null;
};

export type MetaOrganicFacebookPage = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  tasks: string[];
  avatarUrl: string | null;
};

export type MetaOrganicInstagramAccount = {
  accountId: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
};

@Injectable()
export class MetaOrganicGraphService {
  getLoginConfig(): MetaOrganicLoginConfig {
    const appId = requireSocialMetaAppId();
    requireSocialMetaAppSecret();

    return {
      appId,
      configId: requireSocialMetaOrganicLoginConfigId(),
      authorizationEndpoint: `${META_ORGANIC_AUTHORIZATION_ORIGIN}/${META_ORGANIC_GRAPH_API_VERSION}/dialog/oauth`,
    };
  }

  async exchangeOAuthCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<MetaOrganicToken> {
    const url = this.oauthTokenUrl();
    url.searchParams.set('client_id', requireSocialMetaAppId());
    url.searchParams.set('client_secret', requireSocialMetaAppSecret());
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('code', input.code);

    return this.readToken(await this.requestJson(url, { method: 'GET' }));
  }

  async exchangeLongLivedToken(accessToken: string): Promise<MetaOrganicToken> {
    const url = this.oauthTokenUrl();
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', requireSocialMetaAppId());
    url.searchParams.set('client_secret', requireSocialMetaAppSecret());
    url.searchParams.set('fb_exchange_token', accessToken);

    return this.readToken(await this.requestJson(url, { method: 'GET' }));
  }

  async listFacebookPages(
    userAccessToken: string,
  ): Promise<MetaOrganicFacebookPage[]> {
    const pages: MetaOrganicFacebookPage[] = [];
    const seenPageIds = new Set<string>();
    const seenCursors = new Set<string>();
    let after: string | null = null;

    for (
      let pageNumber = 0;
      pageNumber < META_ORGANIC_MAX_PAGES;
      pageNumber += 1
    ) {
      const url = this.graphUrl('me/accounts');
      url.searchParams.set('fields', 'id,name,access_token,tasks,picture{url}');
      url.searchParams.set('limit', String(META_ORGANIC_PAGE_SIZE));
      if (after) url.searchParams.set('after', after);

      const data = await this.requestJson(
        url,
        this.authorized(userAccessToken),
      );
      if (!isRecord(data) || !Array.isArray(data.data)) {
        throw this.invalidResponse();
      }

      for (const candidate of data.data) {
        const page = this.parseFacebookPage(candidate);
        if (!seenPageIds.has(page.pageId)) {
          seenPageIds.add(page.pageId);
          pages.push(page);
        }
      }

      after = this.readNextCursor(data.paging, url.pathname, seenCursors);
      if (!after) return pages;
    }

    throw new MetaOrganicGraphError({
      kind: 'permanent',
      code: 'meta_pagination_limit',
    });
  }

  async getFacebookPageInstagramAccount(input: {
    pageId: string;
    pageAccessToken: string;
  }): Promise<MetaOrganicInstagramAccount | null> {
    const url = this.graphUrl(encodeURIComponent(input.pageId));
    url.searchParams.set(
      'fields',
      'instagram_business_account{id,name,username,profile_picture_url}',
    );

    const data = await this.requestJson(
      url,
      this.authorized(input.pageAccessToken),
    );
    if (!isRecord(data)) throw this.invalidResponse();

    const account = data.instagram_business_account;
    if (account === undefined || account === null) return null;
    if (!isRecord(account)) throw this.invalidResponse();

    const accountId = readRequiredString(account.id);
    if (!accountId) throw this.invalidResponse();

    return {
      accountId,
      name: readOptionalString(account.name),
      username: readOptionalString(account.username),
      avatarUrl: readOptionalString(account.profile_picture_url),
    };
  }

  async revokePermissions(accessToken: string): Promise<void> {
    const data = await this.requestJson(
      this.graphUrl('me/permissions'),
      this.authorized(accessToken, 'DELETE'),
    );

    if (!isRecord(data) || data.success !== true) {
      throw this.invalidResponse();
    }
  }

  private oauthTokenUrl(): URL {
    return new URL(
      `${META_ORGANIC_GRAPH_ORIGIN}/${META_ORGANIC_GRAPH_API_VERSION}/oauth/access_token`,
    );
  }

  private graphUrl(path: string): URL {
    return new URL(
      `${META_ORGANIC_GRAPH_ORIGIN}/${META_ORGANIC_GRAPH_API_VERSION}/${path}`,
    );
  }

  private authorized(accessToken: string, method = 'GET'): RequestInit {
    return {
      method,
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  }

  private async requestJson(url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: this.requestTimeoutSignal(),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new MetaOrganicGraphError({
        kind: 'transient',
        code: timedOut ? 'meta_request_timeout' : 'meta_network_error',
      });
    }

    const data = await this.readJson(response);
    if (!response.ok) throw this.responseError(response.status, data);
    return data;
  }

  private readToken(data: unknown): MetaOrganicToken {
    if (!isRecord(data)) throw this.invalidResponse();
    const accessToken = readRequiredString(data.access_token);
    if (!accessToken) throw this.invalidResponse();

    return {
      accessToken,
      expiresIn: readFiniteNumber(data.expires_in),
    };
  }

  private parseFacebookPage(value: unknown): MetaOrganicFacebookPage {
    if (!isRecord(value) || !Array.isArray(value.tasks)) {
      throw this.invalidResponse();
    }

    const pageId = readRequiredString(value.id);
    const pageName = readRequiredString(value.name);
    const pageAccessToken = readRequiredString(value.access_token);
    if (
      !pageId ||
      !pageName ||
      !pageAccessToken ||
      !value.tasks.every((task) => typeof task === 'string')
    ) {
      throw this.invalidResponse();
    }

    const picture = isRecord(value.picture) ? value.picture : null;
    const pictureData = picture && isRecord(picture.data) ? picture.data : null;

    return {
      pageId,
      pageName,
      pageAccessToken,
      tasks: value.tasks.map((task) => task.trim()).filter(Boolean),
      avatarUrl: pictureData ? readOptionalString(pictureData.url) : null,
    };
  }

  private readNextCursor(
    paging: unknown,
    expectedPath: string,
    seenCursors: Set<string>,
  ): string | null {
    if (paging === undefined || paging === null) return null;
    if (!isRecord(paging)) throw this.invalidResponse();

    const next = paging.next;
    if (next === undefined || next === null) return null;
    if (typeof next !== 'string') throw this.invalidResponse();

    let parsed: URL;
    try {
      parsed = new URL(next);
    } catch {
      throw this.invalidResponse();
    }

    if (
      parsed.origin !== META_ORGANIC_GRAPH_ORIGIN ||
      !META_GRAPH_VERSION_PREFIX.test(parsed.pathname) ||
      this.withoutVersion(parsed.pathname) !==
        this.withoutVersion(expectedPath) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw this.invalidResponse();
    }

    const after = parsed.searchParams.get('after')?.trim();
    if (!after || seenCursors.has(after)) throw this.invalidResponse();
    seenCursors.add(after);
    return after;
  }

  private withoutVersion(path: string): string {
    return path.replace(META_GRAPH_VERSION_PREFIX, '/');
  }

  private responseError(status: number, data: unknown): MetaOrganicGraphError {
    const error = isRecord(data) && isRecord(data.error) ? data.error : null;
    const metaCode = readFiniteNumber((error as MetaErrorPayload | null)?.code);
    const metaSubcode = readFiniteNumber(
      (error as MetaErrorPayload | null)?.error_subcode,
    );
    const classification = classifyFailure(status, metaCode, metaSubcode);

    return new MetaOrganicGraphError({
      ...classification,
      httpStatus: status,
      metaCode,
      metaSubcode,
    });
  }

  private invalidResponse(): MetaOrganicGraphError {
    return new MetaOrganicGraphError({
      kind: 'permanent',
      code: 'meta_invalid_response',
    });
  }

  private requestTimeoutSignal(): AbortSignal | undefined {
    return typeof AbortSignal !== 'undefined' &&
      typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(META_ORGANIC_GRAPH_TIMEOUT_MS)
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

function classifyFailure(
  status: number,
  metaCode: number | null,
  metaSubcode: number | null,
): { kind: MetaOrganicGraphErrorKind; code: MetaOrganicGraphErrorCode } {
  if (
    metaSubcode === 492 ||
    (metaCode !== null && META_PERMISSION_CODES.has(metaCode))
  ) {
    return { kind: 'permission_denied', code: 'meta_permission_denied' };
  }
  if (metaCode !== null && META_CREDENTIAL_CODES.has(metaCode)) {
    return { kind: 'credential_invalid', code: 'meta_credential_invalid' };
  }
  if (
    status === 429 ||
    (metaCode !== null &&
      (META_RATE_LIMIT_CODES.has(metaCode) ||
        (metaCode >= 80_000 && metaCode <= 80_004)))
  ) {
    return { kind: 'rate_limited', code: 'meta_rate_limited' };
  }
  if (status >= 500 || metaCode === 1 || metaCode === 2) {
    return { kind: 'transient', code: 'meta_service_unavailable' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'permission_denied', code: 'meta_permission_denied' };
  }
  return { kind: 'permanent', code: 'meta_request_rejected' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new MetaOrganicGraphError({
      kind: 'permanent',
      code: 'meta_invalid_response',
    });
  }
  return value.trim() || null;
}

function readFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
