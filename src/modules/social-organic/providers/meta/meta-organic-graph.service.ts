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

export type MetaOrganicPublishedObject = {
  id: string;
};

export type MetaOrganicVideoUpload = {
  videoId: string;
  uploadUrl: URL;
};

export type MetaOrganicInstagramContainerStatus =
  | 'EXPIRED'
  | 'ERROR'
  | 'FINISHED'
  | 'IN_PROGRESS'
  | 'PUBLISHED';

export type MetaOrganicFacebookVideoStatus =
  | 'ERROR'
  | 'PROCESSING'
  | 'PUBLISHED';

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

  /**
   * Lowest-privilege, lowest-cost reachability read for `MA4` health checks:
   * one field, no side effect. Works for both a Page and an IG Business
   * Account, since both are plain Graph nodes. Returns the confirmed id so a
   * caller can also prove the token still resolves to the *same* asset.
   */
  async getObjectId(input: {
    objectId: string;
    accessToken: string;
  }): Promise<string> {
    const url = this.graphUrl(encodeURIComponent(input.objectId));
    url.searchParams.set('fields', 'id');

    const data = await this.requestJson(
      url,
      this.authorized(input.accessToken),
    );
    if (!isRecord(data)) throw this.invalidResponse();

    const id = readRequiredString(data.id);
    if (!id) throw this.invalidResponse();

    return id;
  }

  /** Current follower stock. Historical values are never synthesized from it. */
  async getProfileFollowersCount(input: {
    objectId: string;
    accessToken: string;
  }): Promise<unknown> {
    const url = this.graphUrl(encodeURIComponent(input.objectId));
    url.searchParams.set('fields', 'followers_count');
    const data = await this.requestJson(
      url,
      this.authorized(input.accessToken),
    );
    if (!isRecord(data) || !Object.hasOwn(data, 'followers_count')) {
      throw this.invalidResponse();
    }
    return data.followers_count;
  }

  /**
   * Provider-owned Insights GET. Metric names come from A2's documented
   * allow-list; this method validates their shape and centralizes version,
   * timeout, auth header and safe error normalization.
   */
  async getOrganicInsights(input: {
    objectId: string;
    accessToken: string;
    metrics: readonly string[];
    /**
     * `'lifetime'` is a post/media-level cumulative snapshot read (A2 §1):
     * Meta's lifetime post/media insights calls take no `since`/`until`/
     * `metric_type`/`breakdown`, so callers omit those fields themselves —
     * this method's existing "only append if present" behavior already
     * handles that without a structural change.
     */
    period?: 'day' | 'lifetime';
    since?: number;
    until?: number;
    metricType?: 'total_value';
    breakdown?: 'media_product_type' | 'follow_type' | 'is_from_ads';
  }): Promise<{ data: unknown[]; apiCalls: 1 }> {
    if (
      input.metrics.length === 0 ||
      input.metrics.some((metric) => !/^[a-z][a-z0-9_]*$/.test(metric))
    ) {
      throw this.invalidResponse();
    }

    const url = this.graphUrl(`${encodeURIComponent(input.objectId)}/insights`);
    url.searchParams.set('metric', input.metrics.join(','));
    if (input.period) url.searchParams.set('period', input.period);
    if (input.since !== undefined) {
      url.searchParams.set('since', String(input.since));
    }
    if (input.until !== undefined) {
      url.searchParams.set('until', String(input.until));
    }
    if (input.metricType) {
      url.searchParams.set('metric_type', input.metricType);
    }
    if (input.breakdown) {
      url.searchParams.set('breakdown', input.breakdown);
    }

    const response = await this.requestJson(
      url,
      this.authorized(input.accessToken),
    );
    if (!isRecord(response) || !Array.isArray(response.data)) {
      throw this.invalidResponse();
    }
    return { data: response.data, apiCalls: 1 };
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

  async uploadFacebookPhoto(input: {
    pageId: string;
    pageAccessToken: string;
    sourceUrl: string;
  }): Promise<MetaOrganicPublishedObject> {
    return this.readPublishedObject(
      await this.requestForm(
        this.graphUrl(`${encodeURIComponent(input.pageId)}/photos`),
        input.pageAccessToken,
        { url: input.sourceUrl, published: 'false' },
      ),
    );
  }

  async publishFacebookFeed(input: {
    pageId: string;
    pageAccessToken: string;
    message: string | null;
    photoId?: string;
    photoIds?: readonly string[];
  }): Promise<MetaOrganicPublishedObject> {
    const fields: Record<string, string> = {};
    if (input.message) fields.message = input.message;
    const photoIds = input.photoIds?.length ? input.photoIds : input.photoId ? [input.photoId] : [];
    photoIds.forEach((photoId, index) => {
      fields[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photoId });
    });

    return this.readPublishedObject(
      await this.requestForm(
        this.graphUrl(`${encodeURIComponent(input.pageId)}/feed`),
        input.pageAccessToken,
        fields,
      ),
    );
  }

  async publishFacebookPhotoStory(input: {
    pageId: string;
    pageAccessToken: string;
    photoId: string;
  }): Promise<MetaOrganicPublishedObject> {
    return this.readPublishedObject(
      await this.requestForm(
        this.graphUrl(`${encodeURIComponent(input.pageId)}/photo_stories`),
        input.pageAccessToken,
        { photo_id: input.photoId },
      ),
      ['post_id'],
    );
  }

  async startFacebookVideoUpload(input: {
    pageId: string;
    pageAccessToken: string;
    edge: 'video_reels' | 'video_stories';
  }): Promise<MetaOrganicVideoUpload> {
    const data = await this.requestForm(
      this.graphUrl(
        `${encodeURIComponent(input.pageId)}/${encodeURIComponent(input.edge)}`,
      ),
      input.pageAccessToken,
      { upload_phase: 'start' },
    );
    if (!isRecord(data)) throw this.invalidResponse();

    const videoId = readRequiredString(data.video_id);
    const uploadUrlValue = readRequiredString(data.upload_url);
    if (!videoId || !uploadUrlValue) throw this.invalidResponse();

    const uploadUrl = this.requireMetaUploadUrl(uploadUrlValue);
    return { videoId, uploadUrl };
  }

  async uploadFacebookVideoByUrl(input: {
    uploadUrl: URL;
    pageAccessToken: string;
    sourceUrl: string;
  }): Promise<void> {
    const uploadUrl = this.requireMetaUploadUrl(input.uploadUrl.toString());
    const data = await this.requestJson(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${input.pageAccessToken}`,
        file_url: input.sourceUrl,
      },
    });

    if (
      !isRecord(data) ||
      (data.success !== true &&
        typeof data.h !== 'string' &&
        !isRecord(data.status))
    ) {
      throw this.invalidResponse();
    }
  }

  async finishFacebookVideoUpload(input: {
    pageId: string;
    pageAccessToken: string;
    edge: 'video_reels' | 'video_stories';
    videoId: string;
    description?: string | null;
  }): Promise<MetaOrganicPublishedObject> {
    const fields: Record<string, string> = {
      upload_phase: 'finish',
      video_id: input.videoId,
      video_state: 'PUBLISHED',
    };
    if (input.description) fields.description = input.description;

    const data = await this.requestForm(
      this.graphUrl(
        `${encodeURIComponent(input.pageId)}/${encodeURIComponent(input.edge)}`,
      ),
      input.pageAccessToken,
      fields,
    );
    if (!isRecord(data) || data.success !== true) {
      throw this.invalidResponse();
    }

    return {
      id:
        readRequiredString(data.post_id) ??
        readRequiredString(data.video_id) ??
        input.videoId,
    };
  }

  async getFacebookVideoStatus(input: {
    videoId: string;
    pageAccessToken: string;
  }): Promise<MetaOrganicFacebookVideoStatus> {
    const url = this.graphUrl(encodeURIComponent(input.videoId));
    url.searchParams.set('fields', 'status');
    const data = await this.requestJson(
      url,
      this.authorized(input.pageAccessToken),
    );
    if (!isRecord(data) || !isRecord(data.status)) {
      throw this.invalidResponse();
    }

    const status = data.status;
    const publishingStatus = readNestedStatus(status.publishing_phase);
    const values = [
      readStatus(status.video_status),
      readNestedStatus(status.uploading_phase),
      readNestedStatus(status.processing_phase),
      publishingStatus,
      readNestedPublishStatus(status.publishing_phase),
    ].filter((value): value is string => value !== null);

    if (values.some((value) => value === 'ERROR' || value === 'FAILED')) {
      return 'ERROR';
    }
    if (
      values.includes('PUBLISHED') ||
      (publishingStatus === 'COMPLETE' && !values.includes('IN_PROGRESS'))
    ) {
      return 'PUBLISHED';
    }
    return 'PROCESSING';
  }

  async createInstagramContainer(input: {
    accountId: string;
    pageAccessToken: string;
    sourceUrl: string;
    mediaKind: 'image' | 'video';
    placement: 'feed' | 'reel' | 'story';
    caption: string | null;
    carouselItem?: boolean;
  }): Promise<MetaOrganicPublishedObject> {
    const fields: Record<string, string> = {};
    fields[input.mediaKind === 'video' ? 'video_url' : 'image_url'] =
      input.sourceUrl;
    if (input.caption) fields.caption = input.caption;
    if (input.carouselItem) fields.is_carousel_item = 'true';
    if (input.placement === 'reel') {
      fields.media_type = 'REELS';
      fields.share_to_feed = 'true';
    } else if (input.placement === 'story') {
      fields.media_type = 'STORIES';
    }

    return this.readPublishedObject(
      await this.requestForm(
        this.graphUrl(`${encodeURIComponent(input.accountId)}/media`),
        input.pageAccessToken,
        fields,
      ),
    );
  }

  async createInstagramCarouselContainer(input: {
    accountId: string;
    pageAccessToken: string;
    childContainerIds: readonly string[];
    caption: string | null;
  }): Promise<MetaOrganicPublishedObject> {
    const fields: Record<string, string> = {
      media_type: 'CAROUSEL',
      children: input.childContainerIds.join(','),
    };
    if (input.caption) fields.caption = input.caption;
    return this.readPublishedObject(await this.requestForm(
      this.graphUrl(`${encodeURIComponent(input.accountId)}/media`),
      input.pageAccessToken,
      fields,
    ));
  }

  async getInstagramContainerStatus(input: {
    containerId: string;
    pageAccessToken: string;
  }): Promise<MetaOrganicInstagramContainerStatus> {
    const url = this.graphUrl(encodeURIComponent(input.containerId));
    url.searchParams.set('fields', 'status_code');
    const data = await this.requestJson(
      url,
      this.authorized(input.pageAccessToken),
    );
    if (!isRecord(data)) throw this.invalidResponse();

    const status = readRequiredString(data.status_code);
    if (
      status !== 'EXPIRED' &&
      status !== 'ERROR' &&
      status !== 'FINISHED' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PUBLISHED'
    ) {
      throw this.invalidResponse();
    }
    return status;
  }

  async publishInstagramContainer(input: {
    accountId: string;
    pageAccessToken: string;
    containerId: string;
  }): Promise<MetaOrganicPublishedObject> {
    return this.readPublishedObject(
      await this.requestForm(
        this.graphUrl(`${encodeURIComponent(input.accountId)}/media_publish`),
        input.pageAccessToken,
        { creation_id: input.containerId },
      ),
    );
  }

  async deletePublishedObject(input: {
    objectId: string;
    accessToken: string;
  }): Promise<void> {
    const data = await this.requestJson(
      this.graphUrl(encodeURIComponent(input.objectId)),
      this.authorized(input.accessToken, 'DELETE'),
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

  private requestForm(
    url: URL,
    accessToken: string,
    fields: Record<string, string>,
  ): Promise<unknown> {
    return this.requestJson(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
    });
  }

  private readPublishedObject(
    data: unknown,
    preferredFields: readonly string[] = ['id'],
  ): MetaOrganicPublishedObject {
    if (!isRecord(data)) throw this.invalidResponse();

    for (const field of preferredFields) {
      const id = readRequiredString(data[field]);
      if (id) return { id };
    }
    throw this.invalidResponse();
  }

  private requireMetaUploadUrl(value: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw this.invalidResponse();
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'rupload.facebook.com' ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw this.invalidResponse();
    }
    return parsed;
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

function readStatus(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function readNestedStatus(value: unknown): string | null {
  return isRecord(value) ? readStatus(value.status) : null;
}

function readNestedPublishStatus(value: unknown): string | null {
  return isRecord(value) ? readStatus(value.publish_status) : null;
}
