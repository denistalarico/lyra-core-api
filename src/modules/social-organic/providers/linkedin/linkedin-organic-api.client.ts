import { Injectable } from '@nestjs/common';
import type { SocialPublicationFailureReason } from '../../publication/entities/social-publication.entity';
import { LinkedInCallBudget } from './linkedin-call-budget';
import {
  LINKEDIN_TOKEN_URL,
  readLinkedInApiVersion,
  type LinkedInOrganicLoginConfig,
} from './linkedin-organic-oauth.support';

const API = 'https://api.linkedin.com/rest';
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const SOURCE_TIMEOUT_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
/** ACL pages read during discovery (100 per page). */
const MAX_ACL_PAGES = 3;

/** Only HTTP status and the provider code survive; never a body or URN. */
export class LinkedInOrganicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`linkedin_${status}_${code ?? 'unknown'}`);
    this.name = 'LinkedInOrganicApiError';
  }
}

/** Local faults (source mismatch, foreign upload URL, bad response). */
export class LinkedInUploadFault extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'LinkedInUploadFault';
  }
}

export type LinkedInOrganicTokenGrant = {
  accessToken: string;
  expiresIn: number | null;
  refreshToken: string | null;
  scopes: string[];
};

export type LinkedInOrganization = {
  id: string;
  name: string | null;
  vanityName: string | null;
};

export type LinkedInShareStats = {
  impressions: number | null;
  uniqueImpressions: number | null;
  clicks: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagement: number | null;
};

export type LinkedInDailyShareStats = {
  day: string;
  stats: LinkedInShareStats;
};
export type LinkedInDailyFollowerGain = {
  day: string;
  organic: number | null;
  paid: number | null;
};

export type LinkedInPostSummary = {
  urn: string;
  commentary: string | null;
  lifecycleState: string | null;
  publishedAt: number | null;
  createdAt: number | null;
};

export type LinkedInVideoUploadInstruction = {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
};

/** Maps a LinkedIn failure to the closed `failure_reason` vocabulary. */
export function linkedInFailure(error: unknown): {
  reason: SocialPublicationFailureReason;
  code: string;
} {
  if (error instanceof LinkedInUploadFault) {
    return { reason: 'media_rejected', code: error.code };
  }
  if (!(error instanceof LinkedInOrganicApiError)) {
    return { reason: 'provider_unavailable', code: 'linkedin_network_error' };
  }
  const { status, code: providerCode } = error;
  const code = `linkedin_${providerCode ?? status}`;
  if (providerCode === 'daily_budget_exhausted' || status === 429) {
    return { reason: 'rate_limited', code };
  }
  if (status === 401) return { reason: 'credential_expired', code };
  if (status === 403) return { reason: 'permission_lost', code };
  if (status === 413 || status === 415)
    return { reason: 'media_rejected', code };
  if (
    providerCode === 'MEDIA_ASSET_PROCESSING_FAILED' ||
    providerCode === 'EXPIRED_UPLOAD_URL'
  ) {
    return { reason: 'media_rejected', code };
  }
  if (status === 409 || status >= 500) {
    return { reason: 'provider_unavailable', code };
  }
  return { reason: 'payload_invalid', code };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function organizationUrn(organizationId: string): string {
  return `urn:li:organization:${organizationId}`;
}

function readShareStats(raw: unknown): LinkedInShareStats {
  const stats = (raw ?? {}) as Record<string, unknown>;
  return {
    impressions: num(stats.impressionCount),
    // The time-bound sample spells it `uniqueImpressionsCounts`.
    uniqueImpressions:
      num(stats.uniqueImpressionsCount) ?? num(stats.uniqueImpressionsCounts),
    clicks: num(stats.clickCount),
    likes: num(stats.likeCount),
    comments: num(stats.commentCount),
    shares: num(stats.shareCount),
    engagement: num(stats.engagement),
  };
}

/**
 * Community Management API (li-lms, version from `LINKEDIN_API_VERSION`).
 * DOCUMENTED 2026-11-16 on Microsoft Learn: posts-api, images-api,
 * videos-api, organization-access-control-by-role, organization-lookup-api,
 * share-statistics, follower-statistics, programmatic-refresh-tokens.
 * Every REST call spends one unit of the Development budget.
 */
@Injectable()
export class LinkedInOrganicApiClient {
  constructor(private readonly budget: LinkedInCallBudget) {}

  // ── OAuth (www.linkedin.com, not part of the CMA budget) ───────────────
  exchangeCode(input: {
    loginConfig: LinkedInOrganicLoginConfig;
    code: string;
    redirectUri: string;
  }): Promise<LinkedInOrganicTokenGrant> {
    return this.token({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.loginConfig.clientId,
      client_secret: input.loginConfig.clientSecret,
      redirect_uri: input.redirectUri,
    });
  }

  refresh(input: {
    loginConfig: LinkedInOrganicLoginConfig;
    refreshToken: string;
  }): Promise<LinkedInOrganicTokenGrant> {
    return this.token({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.loginConfig.clientId,
      client_secret: input.loginConfig.clientSecret,
    });
  }

  // ── Organizations ───────────────────────────────────────────────────────
  /** Ids of the pages where the member is an APPROVED ADMINISTRATOR. */
  async administeredOrganizationIds(accessToken: string): Promise<string[]> {
    const ids = new Set<string>();
    for (let page = 0; page < MAX_ACL_PAGES; page += 1) {
      const body = await this.get(
        accessToken,
        'organizationAcls',
        `q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100&start=${page * 100}`,
      );
      const elements = Array.isArray(body.elements) ? body.elements : [];
      for (const element of elements as Array<Record<string, unknown>>) {
        // The samples show both `organization` and `organizationTarget`.
        const urn =
          text(element.organization) ?? text(element.organizationTarget);
        const id = /^urn:li:organization:(\d+)$/.exec(urn ?? '')?.[1];
        if (id && element.state === 'APPROVED') ids.add(id);
      }
      if (elements.length < 100) break;
    }
    return [...ids];
  }

  /** Single GET: BATCH_GET is not available on the Development tier. */
  async organization(
    accessToken: string,
    organizationId: string,
  ): Promise<LinkedInOrganization> {
    const body = await this.get(
      accessToken,
      `organizations/${encodeURIComponent(organizationId)}`,
      '',
    );
    return {
      id: organizationId,
      name: text(body.localizedName),
      vanityName: text(body.vanityName),
    };
  }

  // ── Media ───────────────────────────────────────────────────────────────
  async initializeImageUpload(
    accessToken: string,
    ownerUrn: string,
  ): Promise<{ uploadUrl: string; image: string }> {
    const body = await this.post(
      accessToken,
      'images?action=initializeUpload',
      {
        initializeUploadRequest: { owner: ownerUrn },
      },
    );
    const value = (body.value ?? {}) as Record<string, unknown>;
    const uploadUrl = text(value.uploadUrl);
    const image = text(value.image);
    if (!uploadUrl || !image || !isLinkedInUploadUrl(uploadUrl)) {
      throw new LinkedInUploadFault('linkedin_upload_session_invalid');
    }
    return { uploadUrl, image };
  }

  /** The image PUT requires the OAuth token (unlike the video parts). */
  async uploadImage(input: {
    accessToken: string;
    uploadUrl: string;
    sourceUrl: string;
    totalBytes: number;
    mimeType: string;
  }): Promise<void> {
    const data = await readWhole(input.sourceUrl, input.totalBytes);
    const response = await this.send(input.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': input.mimeType,
      },
      body: data as unknown as BodyInit,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw await toApiError(response);
  }

  async imageStatus(
    accessToken: string,
    imageUrn: string,
  ): Promise<string | null> {
    const body = await this.get(
      accessToken,
      `images/${encodeURIComponent(imageUrn)}`,
      '',
    );
    return text(body.status);
  }

  async initializeVideoUpload(
    accessToken: string,
    input: { ownerUrn: string; fileSizeBytes: number },
  ): Promise<{
    video: string;
    uploadToken: string;
    instructions: LinkedInVideoUploadInstruction[];
  }> {
    const body = await this.post(
      accessToken,
      'videos?action=initializeUpload',
      {
        initializeUploadRequest: {
          owner: input.ownerUrn,
          fileSizeBytes: input.fileSizeBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
    );
    const value = (body.value ?? {}) as Record<string, unknown>;
    const video = text(value.video);
    // The samples answer `"uploadToken": ""`; an empty token is valid.
    const uploadToken =
      typeof value.uploadToken === 'string' ? value.uploadToken : null;
    const instructions = (
      Array.isArray(value.uploadInstructions) ? value.uploadInstructions : []
    )
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        uploadUrl: text(entry.uploadUrl) ?? '',
        firstByte: num(entry.firstByte) ?? -1,
        lastByte: num(entry.lastByte) ?? -1,
      }))
      .sort((a, b) => a.firstByte - b.firstByte);
    const contiguous = instructions.every(
      (part, index) =>
        isLinkedInUploadUrl(part.uploadUrl) &&
        part.lastByte >= part.firstByte &&
        part.firstByte ===
          (index === 0 ? 0 : instructions[index - 1].lastByte + 1),
    );
    if (
      !video ||
      uploadToken === null ||
      instructions.length === 0 ||
      !contiguous ||
      instructions[instructions.length - 1].lastByte !== input.fileSizeBytes - 1
    ) {
      throw new LinkedInUploadFault('linkedin_upload_session_invalid');
    }
    return { video, uploadToken, instructions };
  }

  /** Streams the source into the parts in order; returns the ETags. */
  async uploadVideoParts(input: {
    instructions: LinkedInVideoUploadInstruction[];
    sourceUrl: string;
    totalBytes: number;
  }): Promise<string[]> {
    const source = await openSource(input.sourceUrl, input.totalBytes);
    const reader = source.getReader();
    const etags: string[] = [];
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let index = 0;
    let received = 0;

    const drain = async () => {
      while (index < input.instructions.length) {
        const part = input.instructions[index];
        const size = part.lastByte - part.firstByte + 1;
        if (pendingBytes < size) return;
        const chunk = take(pending, size);
        pending = chunk.rest;
        pendingBytes -= size;
        etags.push(await this.putVideoPart(part.uploadUrl, chunk.data));
        index += 1;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      received += value.byteLength;
      if (received > input.totalBytes) {
        throw new LinkedInUploadFault('media_source_size_mismatch');
      }
      pending.push(value);
      pendingBytes += value.byteLength;
      await drain();
    }
    await drain();
    if (index !== input.instructions.length || pendingBytes !== 0) {
      throw new LinkedInUploadFault('media_source_size_mismatch');
    }
    return etags;
  }

  async finalizeVideoUpload(
    accessToken: string,
    input: { video: string; uploadToken: string; etags: string[] },
  ): Promise<void> {
    await this.post(accessToken, 'videos?action=finalizeUpload', {
      finalizeUploadRequest: {
        video: input.video,
        uploadToken: input.uploadToken,
        uploadedPartIds: input.etags,
      },
    });
  }

  // ── Posts ───────────────────────────────────────────────────────────────
  /** 201 with the post URN in `x-restli-id` (DOCUMENTED). */
  async createPost(
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await this.rest(accessToken, 'posts', '', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const urn = response.headers.get('x-restli-id');
    if (!urn || !/^urn:li:(share|ugcPost):\S+$/.test(urn)) {
      throw new LinkedInUploadFault('linkedin_invalid_response');
    }
    return urn;
  }

  async postLifecycle(
    accessToken: string,
    postUrn: string,
  ): Promise<string | null> {
    const body = await this.get(
      accessToken,
      `posts/${encodeURIComponent(postUrn)}`,
      'viewContext=AUTHOR',
    );
    return text(body.lifecycleState);
  }

  /** Newest posts of the page (`q=author`, max 100 per page). */
  async organizationPosts(
    accessToken: string,
    organizationId: string,
    count: number,
  ): Promise<LinkedInPostSummary[]> {
    const body = await this.get(
      accessToken,
      'posts',
      `q=author&author=${encodeURIComponent(organizationUrn(organizationId))}&count=${count}&sortBy=CREATED`,
    );
    return (Array.isArray(body.elements) ? body.elements : [])
      .map((entry) => entry as Record<string, unknown>)
      .filter((entry) => typeof entry.id === 'string')
      .map((entry) => ({
        urn: String(entry.id),
        commentary: text(entry.commentary),
        lifecycleState: text(entry.lifecycleState),
        publishedAt: num(entry.publishedAt),
        createdAt: num(entry.createdAt),
      }));
  }

  // ── Statistics (UTC days, rolling 12 months) ────────────────────────────
  async dailyShareStatistics(
    accessToken: string,
    organizationId: string,
    range: { fromDay: string; toDay: string },
  ): Promise<LinkedInDailyShareStats[]> {
    const body = await this.get(
      accessToken,
      'organizationalEntityShareStatistics',
      `q=organizationalEntity&organizationalEntity=${encodeURIComponent(organizationUrn(organizationId))}&timeIntervals=${timeIntervals(range)}`,
    );
    return (Array.isArray(body.elements) ? body.elements : [])
      .map((entry) => entry as Record<string, unknown>)
      .flatMap((entry) => {
        const start = num((entry.timeRange as Record<string, unknown>)?.start);
        return start === null
          ? []
          : [
              {
                day: utcDay(start),
                stats: readShareStats(entry.totalShareStatistics),
              },
            ];
      });
  }

  async dailyFollowerGains(
    accessToken: string,
    organizationId: string,
    range: { fromDay: string; toDay: string },
  ): Promise<LinkedInDailyFollowerGain[]> {
    const body = await this.get(
      accessToken,
      'organizationalEntityFollowerStatistics',
      `q=organizationalEntity&organizationalEntity=${encodeURIComponent(organizationUrn(organizationId))}&timeIntervals=${timeIntervals(range)}`,
    );
    return (Array.isArray(body.elements) ? body.elements : [])
      .map((entry) => entry as Record<string, unknown>)
      .flatMap((entry) => {
        const start = num((entry.timeRange as Record<string, unknown>)?.start);
        const gains = (entry.followerGains ?? {}) as Record<string, unknown>;
        return start === null
          ? []
          : [
              {
                day: utcDay(start),
                organic: num(gains.organicFollowerGain),
                paid: num(gains.paidFollowerGain),
              },
            ];
      });
  }

  async followerCount(
    accessToken: string,
    organizationId: string,
  ): Promise<number | null> {
    const body = await this.get(
      accessToken,
      `networkSizes/${encodeURIComponent(organizationUrn(organizationId))}`,
      'edgeType=COMPANY_FOLLOWED_BY_MEMBER',
    );
    return num(body.firstDegreeSize);
  }

  /**
   * Lifetime statistics per post (time-bound is not supported per post).
   * Posts with no activity are omitted by LinkedIn: absent means zero.
   */
  async postStatistics(
    accessToken: string,
    organizationId: string,
    postUrns: string[],
  ): Promise<{ stats: Map<string, LinkedInShareStats>; apiCalls: number }> {
    const stats = new Map<string, LinkedInShareStats>();
    const groups = [
      {
        param: 'shares',
        key: 'share',
        urns: postUrns.filter((u) => u.startsWith('urn:li:share:')),
      },
      {
        param: 'ugcPosts',
        key: 'ugcPost',
        urns: postUrns.filter((u) => u.startsWith('urn:li:ugcPost:')),
      },
    ];
    let apiCalls = 0;
    for (const group of groups) {
      if (group.urns.length === 0) continue;
      const list = `List(${group.urns.map(encodeURIComponent).join(',')})`;
      const body = await this.get(
        accessToken,
        'organizationalEntityShareStatistics',
        `q=organizationalEntity&organizationalEntity=${encodeURIComponent(organizationUrn(organizationId))}&${group.param}=${list}`,
      );
      apiCalls += 1;
      for (const entry of (Array.isArray(body.elements)
        ? body.elements
        : []) as Array<Record<string, unknown>>) {
        const urn = text(entry[group.key]);
        if (urn) stats.set(urn, readShareStats(entry.totalShareStatistics));
      }
    }
    return { stats, apiCalls };
  }

  // ── plumbing ────────────────────────────────────────────────────────────
  private async token(
    form: Record<string, string>,
  ): Promise<LinkedInOrganicTokenGrant> {
    const response = await this.send(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
    });
    if (!response.ok) throw await toOAuthError(response);
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const accessToken = text(body?.access_token);
    if (!accessToken)
      throw new LinkedInOrganicApiError(502, 'invalid_response');
    const seconds = num(body?.expires_in);
    return {
      accessToken,
      expiresIn: seconds && seconds > 0 ? seconds : null,
      refreshToken: text(body?.refresh_token),
      // Space-delimited (DOCUMENTED).
      scopes: (text(body?.scope) ?? '').split(/[\s,]+/).filter(Boolean),
    };
  }

  private async get(
    accessToken: string,
    path: string,
    query: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.rest(accessToken, path, query, {
      method: 'GET',
    });
    return ((await response.json().catch(() => null)) ?? {}) as Record<
      string,
      unknown
    >;
  }

  private async post(
    accessToken: string,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.rest(accessToken, path, '', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return ((await response.json().catch(() => null)) ?? {}) as Record<
      string,
      unknown
    >;
  }

  private async rest(
    accessToken: string,
    path: string,
    query: string,
    init: { method: string; body?: string },
  ): Promise<Response> {
    const version = readLinkedInApiVersion();
    if (!version) throw new LinkedInOrganicApiError(400, 'not_configured');
    if (!this.budget.tryConsume()) {
      throw new LinkedInOrganicApiError(429, 'daily_budget_exhausted');
    }
    const response = await this.send(
      `${API}/${path}${query ? `${path.includes('?') ? '&' : '?'}${query}` : ''}`,
      {
        method: init.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Linkedin-Version': version,
          'X-Restli-Protocol-Version': '2.0.0',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      },
    );
    if (!response.ok) throw await toApiError(response);
    return response;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...init,
      });
    } catch {
      throw new LinkedInOrganicApiError(503, 'network');
    }
  }

  /** Video parts carry no OAuth token (DOCUMENTED); the ETag is the part id. */
  private async putVideoPart(
    uploadUrl: string,
    chunk: Uint8Array,
  ): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk as unknown as BodyInit,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
      } catch {
        if (attempt >= 2) throw new LinkedInOrganicApiError(503, 'network');
        continue;
      }
      if (response.ok) {
        const etag = response.headers.get('etag');
        if (!etag)
          throw new LinkedInUploadFault('linkedin_upload_etag_missing');
        return etag;
      }
      if (response.status >= 500 && attempt < 2) continue;
      throw await toApiError(response);
    }
  }
}

function timeIntervals(range: { fromDay: string; toDay: string }): string {
  const start = Date.parse(`${range.fromDay}T00:00:00Z`);
  // `end` is exclusive.
  const end = Date.parse(`${range.toDay}T00:00:00Z`) + DAY_MS;
  return `(timeRange:(start:${start},end:${end}),timeGranularityType:DAY)`;
}

async function toApiError(
  response: Response,
): Promise<LinkedInOrganicApiError> {
  let code: string | null = null;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    code =
      text(body.code) ??
      (typeof body.serviceErrorCode === 'number'
        ? String(body.serviceErrorCode)
        : null);
  } catch {
    code = null;
  }
  return new LinkedInOrganicApiError(response.status, code);
}

/**
 * OAuth errors: `error` + `error_description`. A dead refresh token is
 * `invalid_request` with "…invalid, expired or revoked" (DOCUMENTED), which
 * is told apart from a missing-parameter `invalid_request` (our bug).
 */
async function toOAuthError(
  response: Response,
): Promise<LinkedInOrganicApiError> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const error = text(body.error);
    const description = text(body.error_description) ?? '';
    if (/invalid, expired or revoked/i.test(description)) {
      return new LinkedInOrganicApiError(response.status, 'grant_revoked');
    }
    return new LinkedInOrganicApiError(response.status, error);
  } catch {
    return new LinkedInOrganicApiError(response.status, null);
  }
}

async function openSource(
  sourceUrl: string,
  totalBytes: number,
): Promise<ReadableStream<Uint8Array>> {
  let source: Response;
  try {
    source = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
  } catch {
    throw new LinkedInUploadFault('media_source_unreachable');
  }
  if (!source.ok || !source.body) {
    throw new LinkedInUploadFault('media_source_unreachable');
  }
  const declared = Number(source.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 0 && declared !== totalBytes) {
    throw new LinkedInUploadFault('media_source_size_mismatch');
  }
  return source.body;
}

async function readWhole(
  sourceUrl: string,
  totalBytes: number,
): Promise<Uint8Array> {
  const reader = (await openSource(sourceUrl, totalBytes)).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    size += value.byteLength;
    if (size > totalBytes)
      throw new LinkedInUploadFault('media_source_size_mismatch');
    parts.push(value);
  }
  if (size !== totalBytes)
    throw new LinkedInUploadFault('media_source_size_mismatch');
  return take(parts, size).data;
}

/** Upload URLs must stay on LinkedIn; they are never followed elsewhere. */
function isLinkedInUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'www.linkedin.com' ||
        url.hostname.endsWith('.linkedin.com'))
    );
  } catch {
    return false;
  }
}

function take(parts: Uint8Array[], size: number) {
  const data = new Uint8Array(size);
  let offset = 0;
  const rest: Uint8Array[] = [];
  for (const part of parts) {
    if (offset >= size) {
      rest.push(part);
      continue;
    }
    const room = size - offset;
    if (part.byteLength <= room) {
      data.set(part, offset);
      offset += part.byteLength;
    } else {
      data.set(part.subarray(0, room), offset);
      offset += room;
      rest.push(part.subarray(room));
    }
  }
  return { data, rest };
}
