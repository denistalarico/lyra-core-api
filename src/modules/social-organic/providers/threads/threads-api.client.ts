import { Injectable } from '@nestjs/common';
import type { SocialPublicationFailureReason } from '../../publication/entities/social-publication.entity';
import type { ThreadsAppConfig } from './threads-oauth.support';

/** DOCUMENTED 2026-11-23: every example uses this host and `v1.0`. */
export const THREADS_GRAPH_HOST = 'https://graph.threads.com';
const API = `${THREADS_GRAPH_HOST}/v1.0`;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Graph-style failure. Only the HTTP status and Meta's numeric code survive;
 * never a body, a message or a token.
 */
export class ThreadsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
  ) {
    super(`threads_${status}_${code ?? 'unknown'}`);
    this.name = 'ThreadsApiError';
  }
}

export type ThreadsTokenGrant = {
  accessToken: string;
  /** Seconds; null when the response carries none (short-lived = 1 h). */
  expiresIn: number | null;
};

export type ThreadsProfile = {
  id: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
};

export type ThreadsContainerStatus = {
  status: string | null;
  errorMessage: string | null;
};

export type ThreadsContainerInput = {
  userId: string;
  accessToken: string;
  mediaType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  text?: string | null;
  imageUrl?: string;
  videoUrl?: string;
  isCarouselItem?: boolean;
  children?: readonly string[];
};

/** One window of `/{user}/threads_insights`. */
export type ThreadsUserInsights = {
  /** `views` time series, raw `end_time` → value. */
  viewsSeries: Array<{ endTime: string; value: number }>;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  /** Sum of `link_total_values`. */
  clicks: number | null;
};

export type ThreadsPost = {
  id: string;
  mediaType: string | null;
  permalink: string | null;
  text: string | null;
  timestamp: string | null;
};

export type ThreadsPostInsights = {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  shares: number | null;
};

export const THREADS_USER_INSIGHT_METRICS = [
  'views',
  'likes',
  'replies',
  'reposts',
  'quotes',
  'clicks',
] as const;

export const THREADS_POST_INSIGHT_METRICS = [
  'views',
  'likes',
  'replies',
  'reposts',
  'quotes',
  'shares',
] as const;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const identifier = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : text(value);
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function toGrant(data: Record<string, unknown>): ThreadsTokenGrant {
  const accessToken = text(data.access_token);
  if (!accessToken) throw new ThreadsApiError(200, null);
  return { accessToken, expiresIn: count(data.expires_in) };
}

/** `data[]` of an insights answer, by metric name. */
function metricsByName(payload: Record<string, unknown>) {
  const byName = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(payload.data)) return byName;
  for (const entry of payload.data as unknown[]) {
    const metric = record(entry);
    const name = text(metric.name);
    if (name) byName.set(name, metric);
  }
  return byName;
}

/** `total_value.value`, or the single lifetime `values[0].value`. */
function totalOf(metric: Record<string, unknown> | undefined): number | null {
  if (!metric) return null;
  const total = count(record(metric.total_value).value);
  if (total !== null) return total;
  if (Array.isArray(metric.values) && metric.values.length > 0) {
    let sum: number | null = null;
    for (const entry of metric.values as unknown[]) {
      const value = count(record(entry).value);
      if (value !== null) sum = (sum ?? 0) + value;
    }
    return sum;
  }
  return null;
}

/** Maps a Threads Graph failure to the closed `failure_reason` vocabulary. */
export function threadsFailure(error: unknown): {
  reason: SocialPublicationFailureReason;
  code: string;
} {
  if (!(error instanceof ThreadsApiError)) {
    return { reason: 'provider_unavailable', code: 'threads_network_error' };
  }
  const code = `threads_${error.code ?? error.status}`;
  switch (error.code) {
    // Graph conventions: 190 token invalid/expired; 10/200–299 permission.
    case 190:
      return { reason: 'credential_expired', code };
    case 10:
    case 200:
      return { reason: 'permission_lost', code };
    case 4:
    case 17:
    case 32:
    case 613:
      return { reason: 'rate_limited', code };
    case 100:
      return { reason: 'payload_invalid', code };
    default:
      break;
  }
  if (error.status === 401) return { reason: 'credential_expired', code };
  if (error.status === 403) return { reason: 'permission_lost', code };
  if (error.status === 429) return { reason: 'rate_limited', code };
  if (error.status === 0 || error.status >= 500) {
    return { reason: 'provider_unavailable', code };
  }
  return { reason: 'unknown', code };
}

/**
 * Threads API (graph.threads.com), DOCUMENTED 2026-11-23: OAuth code and
 * long-lived token exchange/refresh, profile, container publishing and
 * insights. The access token travels as the `access_token` parameter, as in
 * every documented example; URLs are never logged.
 */
@Injectable()
export class ThreadsApiClient {
  /** `POST /oauth/access_token`: short-lived (1 h) token for the code. */
  async exchangeCode(input: {
    app: ThreadsAppConfig;
    code: string;
    redirectUri: string;
  }): Promise<ThreadsTokenGrant> {
    return toGrant(
      await this.send(new URL(`${THREADS_GRAPH_HOST}/oauth/access_token`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: input.app.appId,
          client_secret: input.app.secret,
          grant_type: 'authorization_code',
          redirect_uri: input.redirectUri,
          code: input.code,
        }),
      }),
    );
  }

  /** `th_exchange_token`: 60-day token for a valid short-lived one. */
  async exchangeLongLived(input: {
    app: ThreadsAppConfig;
    accessToken: string;
  }): Promise<ThreadsTokenGrant> {
    const url = new URL(`${THREADS_GRAPH_HOST}/access_token`);
    url.searchParams.set('grant_type', 'th_exchange_token');
    url.searchParams.set('client_secret', input.app.secret);
    url.searchParams.set('access_token', input.accessToken);
    return toGrant(await this.send(url, { method: 'GET' }));
  }

  /** `th_refresh_token`: the long-lived token must be ≥ 24 h old and valid. */
  async refresh(accessToken: string): Promise<ThreadsTokenGrant> {
    const url = new URL(`${THREADS_GRAPH_HOST}/refresh_access_token`);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', accessToken);
    return toGrant(await this.send(url, { method: 'GET' }));
  }

  async profile(accessToken: string): Promise<ThreadsProfile> {
    const data = await this.get('/me', accessToken, {
      fields: 'id,username,name,threads_profile_picture_url',
    });
    const id = identifier(data.id);
    if (!id) throw new ThreadsApiError(200, null);
    return {
      id,
      username: text(data.username),
      name: text(data.name),
      profilePictureUrl: text(data.threads_profile_picture_url),
    };
  }

  async createContainer(input: ThreadsContainerInput): Promise<string> {
    const params: Record<string, string> = { media_type: input.mediaType };
    if (input.text) params.text = input.text;
    if (input.imageUrl) params.image_url = input.imageUrl;
    if (input.videoUrl) params.video_url = input.videoUrl;
    if (input.isCarouselItem) params.is_carousel_item = 'true';
    if (input.children?.length) params.children = input.children.join(',');
    return this.requireId(
      await this.post(`/${input.userId}/threads`, input.accessToken, params),
    );
  }

  async containerStatus(input: {
    containerId: string;
    accessToken: string;
  }): Promise<ThreadsContainerStatus> {
    const data = await this.get(`/${input.containerId}`, input.accessToken, {
      fields: 'status,error_message',
    });
    return {
      status: text(data.status),
      errorMessage: text(data.error_message),
    };
  }

  async publishContainer(input: {
    userId: string;
    accessToken: string;
    containerId: string;
  }): Promise<string> {
    return this.requireId(
      await this.post(`/${input.userId}/threads_publish`, input.accessToken, {
        creation_id: input.containerId,
      }),
    );
  }

  async permalink(input: {
    mediaId: string;
    accessToken: string;
  }): Promise<string | null> {
    const data = await this.get(`/${input.mediaId}`, input.accessToken, {
      fields: 'permalink',
    });
    return text(data.permalink);
  }

  /**
   * `views` answers a daily series; likes/replies/reposts/quotes one total
   * for the window; clicks one total per link (DOCUMENTED).
   */
  async userInsights(input: {
    userId: string;
    accessToken: string;
    since: number;
    until: number;
  }): Promise<ThreadsUserInsights> {
    const payload = await this.get(
      `/${input.userId}/threads_insights`,
      input.accessToken,
      {
        metric: THREADS_USER_INSIGHT_METRICS.join(','),
        since: String(input.since),
        until: String(input.until),
      },
    );
    const metrics = metricsByName(payload);
    const viewsSeries: ThreadsUserInsights['viewsSeries'] = [];
    const views = metrics.get('views');
    if (views && Array.isArray(views.values)) {
      for (const entry of views.values as unknown[]) {
        const row = record(entry);
        const endTime = text(row.end_time);
        const value = count(row.value);
        if (endTime && value !== null) viewsSeries.push({ endTime, value });
      }
    }
    let clicks: number | null = null;
    const clickMetric = metrics.get('clicks');
    if (clickMetric && Array.isArray(clickMetric.link_total_values)) {
      for (const entry of clickMetric.link_total_values as unknown[]) {
        const value = count(record(entry).value);
        if (value !== null) clicks = (clicks ?? 0) + value;
      }
    } else {
      clicks = totalOf(clickMetric);
    }
    return {
      viewsSeries,
      likes: totalOf(metrics.get('likes')),
      replies: totalOf(metrics.get('replies')),
      reposts: totalOf(metrics.get('reposts')),
      quotes: totalOf(metrics.get('quotes')),
      clicks,
    };
  }

  /** `followers_count` takes no `since`/`until`: today's stock. */
  async followersCount(input: {
    userId: string;
    accessToken: string;
  }): Promise<number | null> {
    const payload = await this.get(
      `/${input.userId}/threads_insights`,
      input.accessToken,
      { metric: 'followers_count' },
    );
    return totalOf(metricsByName(payload).get('followers_count'));
  }

  /** Newest first, cursor-paginated. */
  async listPosts(input: {
    userId: string;
    accessToken: string;
    since: number;
    limit: number;
    after?: string;
  }): Promise<{ posts: ThreadsPost[]; after: string | null }> {
    const payload = await this.get(
      `/${input.userId}/threads`,
      input.accessToken,
      {
        fields: 'id,media_type,permalink,text,timestamp',
        since: String(input.since),
        limit: String(input.limit),
        ...(input.after ? { after: input.after } : {}),
      },
    );
    const posts: ThreadsPost[] = [];
    if (Array.isArray(payload.data)) {
      for (const entry of payload.data as unknown[]) {
        const row = record(entry);
        const id = identifier(row.id);
        if (!id) continue;
        posts.push({
          id,
          mediaType: text(row.media_type),
          permalink: text(row.permalink),
          text: typeof row.text === 'string' ? row.text : null,
          timestamp: text(row.timestamp),
        });
      }
    }
    const paging = record(payload.paging);
    const after = text(record(paging.cursors).after);
    return { posts, after: text(paging.next) ? after : null };
  }

  /** Lifetime counters of one post. A repost facade answers an empty list. */
  async postInsights(input: {
    mediaId: string;
    accessToken: string;
  }): Promise<ThreadsPostInsights> {
    const payload = await this.get(
      `/${input.mediaId}/insights`,
      input.accessToken,
      { metric: THREADS_POST_INSIGHT_METRICS.join(',') },
    );
    const metrics = metricsByName(payload);
    return {
      views: totalOf(metrics.get('views')),
      likes: totalOf(metrics.get('likes')),
      replies: totalOf(metrics.get('replies')),
      reposts: totalOf(metrics.get('reposts')),
      quotes: totalOf(metrics.get('quotes')),
      shares: totalOf(metrics.get('shares')),
    };
  }

  private requireId(data: Record<string, unknown>): string {
    const id = identifier(data.id);
    if (!id) throw new ThreadsApiError(200, null);
    return id;
  }

  private get(
    path: string,
    accessToken: string,
    query: Record<string, string>,
  ) {
    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('access_token', accessToken);
    return this.send(url, { method: 'GET' });
  }

  private post(
    path: string,
    accessToken: string,
    params: Record<string, string>,
  ) {
    return this.send(new URL(`${API}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, access_token: accessToken }),
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
      throw new ThreadsApiError(0, null);
    }
    const payload = record(await response.json().catch(() => null));
    const error = record(payload.error);
    if (!response.ok || Object.keys(error).length > 0) {
      throw new ThreadsApiError(
        response.status,
        typeof error.code === 'number' ? error.code : null,
      );
    }
    return payload;
  }
}
