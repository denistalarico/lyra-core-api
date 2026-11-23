import { Injectable } from '@nestjs/common';
import type { SocialPublicationFailureReason } from '../../publication/entities/social-publication.entity';
import type { TiktokBusinessAppConfig } from './tiktok-business-oauth.support';

const API = 'https://business-api.tiktok.com/open_api/v1.3';
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Business API answers HTTP 200 with `code != 0` on failure. Only the HTTP
 * status and that numeric code survive; never a body or a token.
 */
export class TiktokBusinessApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
  ) {
    super(`tiktok_business_${status}_${code ?? 'unknown'}`);
    this.name = 'TiktokBusinessApiError';
  }
}

export type TiktokBusinessTokenGrant = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
  openId: string | null;
};

export type TiktokBusinessProfile = {
  username: string | null;
  displayName: string | null;
  profileImage: string | null;
  followersCount: number | null;
};

export type TiktokBusinessVideoSettings = {
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

export type TiktokBusinessPostInfo = {
  caption: string;
  isBrandOrganic: boolean;
  isBrandedContent: boolean;
  isAiGenerated: boolean;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** Verified-domain image URL; wins over `thumbnailOffsetMs` (DOCUMENTED). */
  customThumbnailUrl?: string | null;
  /** Frame of the video used as cover (ms). */
  thumbnailOffsetMs?: number | null;
};

export type TiktokBusinessPublishStatus = {
  status: string | null;
  postIds: string[];
  reason: string | null;
};

/** One UTC day of `/business/get/` `metrics[]` (T + 24–48 h, DOCUMENTED). */
export type TiktokBusinessAccountDay = {
  date: string;
  videoViews: number | null;
  uniqueVideoViews: number | null;
  profileViews: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followersCount: number | null;
  newFollowers: number | null;
  lostFollowers: number | null;
  netFollowers: number | null;
  engagedAudience: number | null;
  bioLinkClicks: number | null;
};

export type TiktokBusinessAccountInsights = {
  /** Real-time stock (`followers_count` at the top level). */
  followersCount: number | null;
  days: TiktokBusinessAccountDay[];
};

/** `/business/video/list/` counters are lifetime totals (DOCUMENTED). */
export type TiktokBusinessVideo = {
  itemId: string;
  mediaType: string | null;
  createTime: number | null;
  shareUrl: string | null;
  caption: string | null;
  videoViews: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  favorites: number | null;
  reach: number | null;
  newFollowers: number | null;
  totalTimeWatched: number | null;
  averageTimeWatched: number | null;
  fullVideoWatchedRate: number | null;
};

/** Daily fields of `/business/get/`; all `user.insights` (DOCUMENTED). */
export const TIKTOK_BUSINESS_ACCOUNT_FIELDS = [
  'followers_count',
  'video_views',
  'unique_video_views',
  'profile_views',
  'likes',
  'comments',
  'shares',
  'daily_total_followers',
  'daily_new_followers',
  'daily_lost_followers',
  'engaged_audience',
  'bio_link_clicks',
] as const;

/** `video.list` + `video.insights` fields of `/business/video/list/`. */
export const TIKTOK_BUSINESS_VIDEO_FIELDS = [
  'item_id',
  'media_type',
  'create_time',
  'share_url',
  'caption',
  'video_views',
  'likes',
  'comments',
  'shares',
  'favorites',
  'reach',
  'new_followers',
  'total_time_watched',
  'average_time_watched',
  'full_video_watched_rate',
] as const;

/** `max_count` ceiling of `/business/video/list/` (DOCUMENTED). */
export const TIKTOK_BUSINESS_VIDEO_PAGE_SIZE = 20;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function toGrant(data: Record<string, unknown>): TiktokBusinessTokenGrant {
  const accessToken = text(data.access_token);
  if (!accessToken) throw new TiktokBusinessApiError(200, null);
  return {
    accessToken,
    refreshToken: text(data.refresh_token),
    expiresIn: count(data.expires_in),
    scopes: (text(data.scope) ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
    openId: text(data.open_id),
  };
}

/** Maps a Business API failure to the closed `failure_reason` vocabulary. */
export function tiktokBusinessFailure(error: unknown): {
  reason: SocialPublicationFailureReason;
  code: string;
} {
  if (!(error instanceof TiktokBusinessApiError)) {
    return {
      reason: 'provider_unavailable',
      code: 'tiktok_business_network_error',
    };
  }
  const code = `tiktok_business_${error.code ?? error.status}`;
  switch (error.code) {
    // DOCUMENTED (Appendix — Return Codes): token expired/invalid/empty.
    case 40102:
    case 40104:
    case 40105:
      return { reason: 'credential_expired', code };
    case 40001:
    case 40125:
      return { reason: 'permission_lost', code };
    case 40016:
    case 40100:
    case 40133:
      return { reason: 'rate_limited', code };
    case 40000:
    case 40002:
      return { reason: 'payload_invalid', code };
    case 40902:
    case 40905:
    case 40906:
    case 40907:
    case 40910:
      return { reason: 'media_rejected', code };
    default:
      break;
  }
  if (error.status === 401) return { reason: 'credential_expired', code };
  if (error.status === 429) return { reason: 'rate_limited', code };
  if (error.status >= 500) return { reason: 'provider_unavailable', code };
  return { reason: 'unknown', code };
}

/**
 * TikTok API for Business — Accounts API (v1.3), DOCUMENTED 2026-11-17:
 * account holder token (`/tt_user/oauth2/*`), token inspector, profile,
 * post settings, video publish and publish status.
 */
@Injectable()
export class TiktokBusinessApiClient {
  async exchangeCode(input: {
    app: TiktokBusinessAppConfig;
    code: string;
    redirectUri: string;
  }): Promise<TiktokBusinessTokenGrant> {
    return toGrant(
      await this.post('/tt_user/oauth2/token/', {
        client_id: input.app.appId,
        client_secret: input.app.secret,
        grant_type: 'authorization_code',
        auth_code: input.code,
        redirect_uri: input.redirectUri,
      }),
    );
  }

  async refresh(input: {
    app: TiktokBusinessAppConfig;
    refreshToken: string;
  }): Promise<TiktokBusinessTokenGrant> {
    return toGrant(
      await this.post('/tt_user/oauth2/refresh_token/', {
        client_id: input.app.appId,
        client_secret: input.app.secret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      }),
    );
  }

  async revoke(input: {
    app: TiktokBusinessAppConfig;
    accessToken: string;
  }): Promise<void> {
    await this.post('/tt_user/oauth2/revoke/', {
      client_id: input.app.appId,
      client_secret: input.app.secret,
      access_token: input.accessToken,
    });
  }

  /** `creator_id` is the `business_id` every Accounts API call needs. */
  async tokenInfo(input: {
    app: TiktokBusinessAppConfig;
    accessToken: string;
  }): Promise<{ businessId: string; scopes: string[] }> {
    const data = await this.post('/tt_user/token_info/get/', {
      app_id: input.app.appId,
      access_token: input.accessToken,
    });
    const businessId = text(data.creator_id);
    if (!businessId) throw new TiktokBusinessApiError(200, null);
    return {
      businessId,
      scopes: (text(data.scope) ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    };
  }

  async profile(input: {
    accessToken: string;
    businessId: string;
  }): Promise<TiktokBusinessProfile> {
    const data = await this.get('/business/get/', input.accessToken, {
      business_id: input.businessId,
      fields: JSON.stringify([
        'username',
        'display_name',
        'profile_image',
        'followers_count',
      ]),
    });
    return {
      username: text(data.username),
      displayName: text(data.display_name),
      profileImage: text(data.profile_image),
      followersCount: count(data.followers_count),
    };
  }

  /** Daily account metrics, UTC days, at most 60 days back (DOCUMENTED). */
  async accountInsights(input: {
    accessToken: string;
    businessId: string;
    startDate: string;
    endDate: string;
  }): Promise<TiktokBusinessAccountInsights> {
    const data = await this.get('/business/get/', input.accessToken, {
      business_id: input.businessId,
      start_date: input.startDate,
      end_date: input.endDate,
      fields: JSON.stringify(TIKTOK_BUSINESS_ACCOUNT_FIELDS),
    });
    const days = (Array.isArray(data.metrics) ? data.metrics : [])
      .map(record)
      .flatMap((entry): TiktokBusinessAccountDay[] => {
        const date = text(entry.date);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
        return [
          {
            date,
            videoViews: count(entry.video_views),
            uniqueVideoViews: count(entry.unique_video_views),
            profileViews: count(entry.profile_views),
            likes: count(entry.likes),
            comments: count(entry.comments),
            shares: count(entry.shares),
            followersCount: count(entry.followers_count),
            newFollowers: count(entry.daily_new_followers),
            lostFollowers: count(entry.daily_lost_followers),
            netFollowers: count(entry.daily_total_followers),
            engagedAudience: count(entry.engaged_audience),
            bioLinkClicks: count(entry.bio_link_clicks),
          },
        ];
      });
    return { followersCount: count(data.followers_count), days };
  }

  /** One page of public posts, newest first; `cursor` is epoch ms. */
  async listVideos(input: {
    accessToken: string;
    businessId: string;
    cursor?: number;
  }): Promise<{
    videos: TiktokBusinessVideo[];
    cursor: number | null;
    hasMore: boolean;
  }> {
    const data = await this.get('/business/video/list/', input.accessToken, {
      business_id: input.businessId,
      fields: JSON.stringify(TIKTOK_BUSINESS_VIDEO_FIELDS),
      max_count: String(TIKTOK_BUSINESS_VIDEO_PAGE_SIZE),
      ...(input.cursor === undefined ? {} : { cursor: String(input.cursor) }),
    });
    const videos = (Array.isArray(data.videos) ? data.videos : [])
      .map(record)
      .flatMap((entry): TiktokBusinessVideo[] => {
        const itemId = text(entry.item_id);
        if (!itemId) return [];
        const created = Number(entry.create_time);
        return [
          {
            itemId,
            mediaType: text(entry.media_type),
            createTime:
              Number.isFinite(created) && created > 0 ? created : null,
            shareUrl: text(entry.share_url),
            caption: typeof entry.caption === 'string' ? entry.caption : null,
            videoViews: count(entry.video_views),
            likes: count(entry.likes),
            comments: count(entry.comments),
            shares: count(entry.shares),
            favorites: count(entry.favorites),
            reach: count(entry.reach),
            newFollowers: count(entry.new_followers),
            totalTimeWatched: count(entry.total_time_watched),
            averageTimeWatched: count(entry.average_time_watched),
            fullVideoWatchedRate: count(entry.full_video_watched_rate),
          },
        ];
      });
    return {
      videos,
      cursor: count(data.cursor),
      hasMore: data.has_more === true,
    };
  }

  async videoSettings(input: {
    accessToken: string;
    businessId: string;
  }): Promise<TiktokBusinessVideoSettings> {
    const data = await this.get(
      '/business/video/settings/',
      input.accessToken,
      {
        business_id: input.businessId,
      },
    );
    return {
      privacyLevelOptions: Array.isArray(data.privacy_level_options)
        ? data.privacy_level_options.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
      commentDisabled: data.comment_disabled === true,
      duetDisabled: data.duet_disabled === true,
      stitchDisabled: data.stitch_disabled === true,
      maxVideoPostDurationSec: count(data.max_video_post_duration_sec),
    };
  }

  /** Returns the `share_id` that `publishStatus` follows. */
  async publishVideo(input: {
    accessToken: string;
    businessId: string;
    videoUrl: string;
    post: TiktokBusinessPostInfo;
  }): Promise<string> {
    const data = await this.post(
      '/business/video/publish/',
      {
        business_id: input.businessId,
        video_url: input.videoUrl,
        ...(input.post.customThumbnailUrl
          ? { custom_thumbnail_url: input.post.customThumbnailUrl }
          : {}),
        post_info: {
          caption: input.post.caption,
          is_brand_organic: input.post.isBrandOrganic,
          is_branded_content: input.post.isBrandedContent,
          is_ai_generated: input.post.isAiGenerated,
          disable_comment: input.post.disableComment,
          disable_duet: input.post.disableDuet,
          disable_stitch: input.post.disableStitch,
          ...(!input.post.customThumbnailUrl &&
          input.post.thumbnailOffsetMs != null
            ? { thumbnail_offset: input.post.thumbnailOffsetMs }
            : {}),
        },
      },
      input.accessToken,
    );
    const shareId = text(data.share_id);
    if (!shareId) throw new TiktokBusinessApiError(200, null);
    return shareId;
  }

  async publishStatus(input: {
    accessToken: string;
    businessId: string;
    publishId: string;
  }): Promise<TiktokBusinessPublishStatus> {
    const data = await this.get(
      '/business/publish/status/',
      input.accessToken,
      {
        business_id: input.businessId,
        publish_id: input.publishId,
      },
    );
    return {
      status: text(data.status),
      postIds: Array.isArray(data.post_ids)
        ? data.post_ids.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
      reason: text(data.reason),
    };
  }

  private async get(
    path: string,
    accessToken: string,
    query: Record<string, string>,
  ) {
    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return this.send(url, {
      method: 'GET',
      headers: { 'Access-Token': accessToken },
    });
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    accessToken?: string,
  ) {
    return this.send(new URL(`${API}${path}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'Access-Token': accessToken } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  private async send(url: URL, init: RequestInit) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new TiktokBusinessApiError(0, null);
    }
    const payload = record(await response.json().catch(() => null));
    const code = typeof payload.code === 'number' ? payload.code : null;
    if (!response.ok || code !== 0) {
      throw new TiktokBusinessApiError(response.status, code);
    }
    return record(payload.data);
  }
}
