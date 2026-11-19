import { Injectable } from '@nestjs/common';
import type { SocialPublicationFailureReason } from '../../publication/entities/social-publication.entity';
import type { TiktokLoginConfig } from './tiktok-oauth.support';

const API = 'https://open.tiktokapis.com/v2';
const REQUEST_TIMEOUT_MS = 60_000;
const CHUNK_TIMEOUT_MS = 5 * 60_000;
const SOURCE_TIMEOUT_MS = 30 * 60_000;
const MIB = 1024 * 1024;
/** DOCUMENTED 2026-11-16 (media transfer guide): 5–64 MB per chunk, ≤ 1000. */
export const TIKTOK_SINGLE_CHUNK_MAX_BYTES = 64 * MIB;
export const TIKTOK_CHUNK_BYTES = 32 * MIB;

/** Only HTTP status and the provider error code survive; never a body. */
export class TiktokApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`tiktok_${status}_${code ?? 'unknown'}`);
    this.name = 'TiktokApiError';
  }
}

/** Local faults (source mismatch, bad upload URL). */
export class TiktokUploadFault extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'TiktokUploadFault';
  }
}

export type TiktokTokenGrant = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
  openId: string | null;
};

export type TiktokUserInfo = {
  openId: string;
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  followingCount: number | null;
  likesCount: number | null;
  videoCount: number | null;
};

export type TiktokCreatorInfo = {
  username: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

export type TiktokPostInfo = {
  title: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** Frame of the video used as cover (ms); TikTok takes no cover image. */
  coverTimestampMs?: number | null;
};

export type TiktokPublishStatus = {
  status: string | null;
  failReason: string | null;
  publicPostIds: string[];
};

export type TiktokVideo = {
  id: string;
  title: string | null;
  createTime: number | null;
  shareUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
};

export const TIKTOK_VIDEO_FIELDS =
  'id,title,create_time,share_url,view_count,like_count,comment_count,share_count';

/** Plan of a `FILE_UPLOAD`: whole file up to 64 MB, else 32 MB + remainder. */
export function planTiktokChunks(videoSize: number): {
  chunkSize: number;
  totalChunkCount: number;
} {
  if (videoSize <= TIKTOK_SINGLE_CHUNK_MAX_BYTES) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  return {
    chunkSize: TIKTOK_CHUNK_BYTES,
    totalChunkCount: Math.floor(videoSize / TIKTOK_CHUNK_BYTES),
  };
}

/** Maps a TikTok error to the closed `failure_reason` vocabulary. */
export function tiktokFailure(error: unknown): {
  reason: SocialPublicationFailureReason;
  code: string;
} {
  if (error instanceof TiktokUploadFault) {
    return { reason: 'media_rejected', code: error.code };
  }
  if (!(error instanceof TiktokApiError)) {
    return { reason: 'provider_unavailable', code: 'tiktok_network_error' };
  }
  const { status, code: providerCode } = error;
  const code = `tiktok_${providerCode ?? status}`;
  switch (providerCode) {
    case 'access_token_invalid':
      return { reason: 'credential_expired', code };
    case 'scope_not_authorized':
    case 'spam_risk_user_banned_from_posting':
    case 'unaudited_client_can_only_post_to_private_accounts':
      return { reason: 'permission_lost', code };
    case 'spam_risk_too_many_posts':
    case 'reached_active_user_cap':
    case 'rate_limit_exceeded':
      return { reason: 'rate_limited', code };
    case 'privacy_level_option_mismatch':
    case 'url_ownership_unverified':
    case 'invalid_param':
      return { reason: 'payload_invalid', code };
    default:
      break;
  }
  if (status === 401) return { reason: 'credential_expired', code };
  if (status === 429) return { reason: 'rate_limited', code };
  if (status === 403) return { reason: 'permission_lost', code };
  if (status >= 500) return { reason: 'provider_unavailable', code };
  return { reason: 'payload_invalid', code };
}

type Envelope<T> = {
  data?: T;
  error?: { code?: unknown };
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

@Injectable()
export class TiktokApiClient {
  // ── OAuth (DOCUMENTED 2026-11-16: oauth-get/refresh/revoke pages) ────────
  exchangeCode(input: {
    loginConfig: TiktokLoginConfig;
    code: string;
    redirectUri: string;
  }): Promise<TiktokTokenGrant> {
    return this.token({
      client_key: input.loginConfig.clientKey,
      client_secret: input.loginConfig.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    });
  }

  refresh(input: {
    loginConfig: TiktokLoginConfig;
    refreshToken: string;
  }): Promise<TiktokTokenGrant> {
    return this.token({
      client_key: input.loginConfig.clientKey,
      client_secret: input.loginConfig.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    });
  }

  async revoke(input: {
    loginConfig: TiktokLoginConfig;
    token: string;
  }): Promise<void> {
    const response = await this.send(`${API}/oauth/revoke/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: input.loginConfig.clientKey,
        client_secret: input.loginConfig.clientSecret,
        token: input.token,
      }),
    });
    if (!response.ok) throw await toApiError(response);
  }

  // ── Display API ─────────────────────────────────────────────────────────
  async userInfo(accessToken: string): Promise<TiktokUserInfo> {
    const query = new URLSearchParams({
      fields:
        'open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count',
    });
    const body = await this.json<{ user?: Record<string, unknown> }>(
      `${API}/user/info/?${query}`,
      { method: 'GET', headers: bearer(accessToken) },
    );
    const user = body?.user;
    const openId = text(user?.open_id);
    if (!user || !openId) throw new TiktokApiError(502, 'invalid_response');
    return {
      openId,
      displayName: text(user.display_name),
      avatarUrl: text(user.avatar_url),
      followerCount: num(user.follower_count),
      followingCount: num(user.following_count),
      likesCount: num(user.likes_count),
      videoCount: num(user.video_count),
    };
  }

  /** One page of `video/list` (max 20). `cursor` is a ms timestamp. */
  async listVideos(input: { accessToken: string; cursor?: number }): Promise<{
    videos: TiktokVideo[];
    cursor: number | null;
    hasMore: boolean;
  }> {
    const body = await this.json<{
      videos?: Array<Record<string, unknown>>;
      cursor?: unknown;
      has_more?: unknown;
    }>(`${API}/video/list/?fields=${TIKTOK_VIDEO_FIELDS}`, {
      method: 'POST',
      headers: {
        ...bearer(input.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max_count: 20,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      }),
    });
    const videos: TiktokVideo[] = [];
    for (const item of body?.videos ?? []) {
      const id = text(item.id);
      if (!id) continue;
      videos.push({
        id,
        title: text(item.title),
        createTime: num(item.create_time),
        shareUrl: text(item.share_url),
        viewCount: num(item.view_count),
        likeCount: num(item.like_count),
        commentCount: num(item.comment_count),
        shareCount: num(item.share_count),
      });
    }
    return {
      videos,
      cursor: num(body?.cursor),
      hasMore: body?.has_more === true,
    };
  }

  // ── Content Posting API (DOCUMENTED 2026-11-16) ─────────────────────────
  async creatorInfo(accessToken: string): Promise<TiktokCreatorInfo> {
    const data = await this.json<Record<string, unknown>>(
      `${API}/post/publish/creator_info/query/`,
      {
        method: 'POST',
        headers: {
          ...bearer(accessToken),
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    );
    const options = Array.isArray(data?.privacy_level_options)
      ? data.privacy_level_options.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [];
    if (!data || options.length === 0) {
      throw new TiktokApiError(502, 'invalid_response');
    }
    return {
      username: text(data.creator_username),
      nickname: text(data.creator_nickname),
      avatarUrl: text(data.creator_avatar_url),
      privacyLevelOptions: options,
      commentDisabled: data.comment_disabled === true,
      duetDisabled: data.duet_disabled === true,
      stitchDisabled: data.stitch_disabled === true,
      maxVideoPostDurationSec: num(data.max_video_post_duration_sec),
    };
  }

  /** `FILE_UPLOAD` init. The returned `uploadUrl` must stay on TikTok. */
  async initDirectPost(input: {
    accessToken: string;
    post: TiktokPostInfo;
    videoSize: number;
  }): Promise<{ publishId: string; uploadUrl: string }> {
    const plan = planTiktokChunks(input.videoSize);
    const data = await this.json<{
      publish_id?: unknown;
      upload_url?: unknown;
    }>(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        ...bearer(input.accessToken),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: input.post.title,
          privacy_level: input.post.privacyLevel,
          disable_comment: input.post.disableComment,
          disable_duet: input.post.disableDuet,
          disable_stitch: input.post.disableStitch,
          ...(input.post.coverTimestampMs != null
            ? { video_cover_timestamp_ms: input.post.coverTimestampMs }
            : {}),
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: input.videoSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      }),
    });
    const publishId = text(data?.publish_id);
    const uploadUrl = text(data?.upload_url);
    if (!publishId || !uploadUrl || !isTiktokUploadUrl(uploadUrl)) {
      throw new TiktokUploadFault('tiktok_upload_session_invalid');
    }
    return { publishId, uploadUrl };
  }

  /** Streams the source into the upload URL, sequentially, chunk by chunk. */
  async uploadFromSource(input: {
    uploadUrl: string;
    sourceUrl: string;
    totalBytes: number;
    mimeType: string;
  }): Promise<void> {
    let source: Response;
    try {
      source = await fetch(input.sourceUrl, {
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
    } catch {
      throw new TiktokUploadFault('media_source_unreachable');
    }
    if (!source.ok || !source.body) {
      throw new TiktokUploadFault('media_source_unreachable');
    }
    const declared = Number(source.headers.get('content-length'));
    if (
      Number.isFinite(declared) &&
      declared > 0 &&
      declared !== input.totalBytes
    ) {
      throw new TiktokUploadFault('media_source_size_mismatch');
    }

    const plan = planTiktokChunks(input.totalBytes);
    const sizeOf = (index: number) =>
      index === plan.totalChunkCount - 1
        ? input.totalBytes - plan.chunkSize * (plan.totalChunkCount - 1)
        : plan.chunkSize;

    const reader = source.body.getReader();
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let sent = 0;
    let index = 0;

    const drain = async (final: boolean) => {
      while (index < plan.totalChunkCount && pendingBytes >= sizeOf(index)) {
        const size = sizeOf(index);
        // Not the last chunk: do not wait for more than this chunk needs.
        const chunk = take(pending, size);
        pending = chunk.rest;
        pendingBytes -= size;
        await this.putChunk({
          uploadUrl: input.uploadUrl,
          mimeType: input.mimeType,
          totalBytes: input.totalBytes,
          chunk: chunk.data,
          start: sent,
          last: index === plan.totalChunkCount - 1,
        });
        sent += size;
        index += 1;
      }
      if (final && (pendingBytes > 0 || index !== plan.totalChunkCount)) {
        throw new TiktokUploadFault('media_source_size_mismatch');
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      pending.push(value);
      pendingBytes += value.byteLength;
      if (sent + pendingBytes > input.totalBytes) {
        throw new TiktokUploadFault('media_source_size_mismatch');
      }
      await drain(false);
    }
    await drain(true);
  }

  async publishStatus(input: {
    accessToken: string;
    publishId: string;
  }): Promise<TiktokPublishStatus> {
    const data = await this.json<Record<string, unknown>>(
      `${API}/post/publish/status/fetch/`,
      {
        method: 'POST',
        headers: {
          ...bearer(input.accessToken),
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: input.publishId }),
      },
    );
    // The documented field name is spelled `publicaly_available_post_id`.
    const ids = Array.isArray(data?.publicaly_available_post_id)
      ? data.publicaly_available_post_id
          .filter((id) => typeof id === 'number' || typeof id === 'string')
          .map(String)
      : [];
    return {
      status: text(data?.status),
      failReason: text(data?.fail_reason),
      publicPostIds: ids,
    };
  }

  // ── plumbing ────────────────────────────────────────────────────────────
  private async token(form: Record<string, string>): Promise<TiktokTokenGrant> {
    const response = await this.send(`${API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const accessToken = text(body?.access_token);
    if (!accessToken) throw new TiktokApiError(502, 'invalid_response');
    return {
      accessToken,
      refreshToken: text(body?.refresh_token),
      expiresIn: num(body?.expires_in),
      scopes: (text(body?.scope) ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
      openId: text(body?.open_id),
    };
  }

  /** Unwraps `{data, error}`; TikTok may answer 200 with a non-"ok" code. */
  private async json<T>(
    url: string,
    init: RequestInit,
  ): Promise<T | undefined> {
    const response = await this.send(url, init);
    if (!response.ok) throw await toApiError(response);
    const body = (await response
      .json()
      .catch(() => null)) as Envelope<T> | null;
    const code = body?.error?.code;
    if (typeof code === 'string' && code !== 'ok') {
      throw new TiktokApiError(response.status, code);
    }
    return body?.data;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new TiktokApiError(503, 'network');
    }
  }

  private async putChunk(input: {
    uploadUrl: string;
    mimeType: string;
    totalBytes: number;
    chunk: Uint8Array;
    start: number;
    last: boolean;
  }): Promise<void> {
    const end = input.start + input.chunk.byteLength - 1;
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await fetch(input.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': input.mimeType,
            'Content-Length': String(input.chunk.byteLength),
            'Content-Range': `bytes ${input.start}-${end}/${input.totalBytes}`,
          },
          body: input.chunk as unknown as BodyInit,
          signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
        });
      } catch {
        if (attempt >= 2) throw new TiktokApiError(503, 'network');
        continue;
      }
      // 206: more chunks expected; 201: complete (DOCUMENTED).
      if (response.status === (input.last ? 201 : 206)) return;
      if (response.status >= 500 && attempt < 2) continue;
      if (response.status === 416) {
        throw new TiktokUploadFault('tiktok_upload_range_mismatch');
      }
      throw await toApiError(response);
    }
  }
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function toApiError(response: Response): Promise<TiktokApiError> {
  let code: string | null = null;
  try {
    const body = (await response.json()) as {
      error?: unknown;
    };
    // OAuth errors: `error` is a string; API errors: `error.code`.
    if (typeof body.error === 'string') code = body.error;
    else if (
      body.error &&
      typeof (body.error as { code?: unknown }).code === 'string'
    ) {
      code = (body.error as { code: string }).code;
    }
  } catch {
    code = null;
  }
  return new TiktokApiError(response.status, code);
}

/** The upload URL is TikTok's; it is never followed to another host. */
function isTiktokUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname.endsWith('.tiktokapis.com') ||
        url.hostname.endsWith('.tiktokcdn.com') ||
        url.hostname.endsWith('.tiktok.com'))
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
