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
};

export type TiktokBusinessPublishStatus = {
  status: string | null;
  postIds: string[];
  reason: string | null;
};

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
        post_info: {
          caption: input.post.caption,
          is_brand_organic: input.post.isBrandOrganic,
          is_branded_content: input.post.isBrandedContent,
          is_ai_generated: input.post.isAiGenerated,
          disable_comment: input.post.disableComment,
          disable_duet: input.post.disableDuet,
          disable_stitch: input.post.disableStitch,
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
