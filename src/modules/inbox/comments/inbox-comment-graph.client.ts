import { Injectable, Logger } from '@nestjs/common';
import type { InboxChannelEntity } from '../entities/inbox-channel.entity';
import type {
  MetaCommentContentKind,
  MetaCommentSurface,
  NormalizedMetaComment,
} from '../channels/meta/adapters/meta-comment.normalizer';

const FACEBOOK_GRAPH = 'https://graph.facebook.com';
const INSTAGRAM_GRAPH = 'https://graph.instagram.com';
const MAX_PAGES = 5;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,180}$/;

/**
 * How the Lyra reaches Meta for one Inbox channel. The LeadFlow app's token
 * (D-IX-12): a Page token for Messenger and for Instagram connected through
 * Facebook Login, the Instagram user token for Instagram Login.
 */
export type InboxCommentChannelAccess = {
  channel: InboxChannelEntity;
  surface: MetaCommentSurface;
  origin: string;
  accessToken: string;
  /** Page id (Facebook) or Instagram user id: whose posts are read. */
  accountId: string;
  /** The id `/{id}/messages` is posted to for a private reply. */
  messagingSenderId: string;
};

export type InboxCommentGraphErrorCode =
  | 'meta_comment_permission_denied'
  | 'meta_comment_not_found'
  | 'meta_comment_private_reply_unavailable'
  | 'meta_comment_rate_limited'
  | 'meta_comment_request_failed';

/** A Graph failure with a safe, enumerated code; the provider text is never kept. */
export class InboxCommentGraphError extends Error {
  constructor(
    readonly code: InboxCommentGraphErrorCode,
    readonly status: number | null,
  ) {
    super(code);
  }
}

export type InboxCommentGraphContent = {
  externalContentId: string;
  contentKind: MetaCommentContentKind;
  permalink: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  isPublished: boolean | null;
  providerCreatedAt: Date | null;
};

type GraphRecord = Record<string, unknown>;

/**
 * Graph calls for post/ad comments (IX3, §3.4). Only this class talks to Meta
 * for comments: the service decides *whether* to act; this decides *how*.
 */
@Injectable()
export class InboxCommentGraphClient {
  private readonly logger = new Logger(InboxCommentGraphClient.name);

  private get version() {
    return process.env.META_GRAPH_API_VERSION ?? 'v24.0';
  }

  /** Builds the access for a channel; null when the channel cannot carry comments. */
  static accessFor(
    channel: InboxChannelEntity,
    accessToken: string,
  ): InboxCommentChannelAccess | null {
    if (channel.type === 'facebook_messenger') {
      const pageId =
        channel.externalPageId?.trim() || channel.externalAccountId?.trim();
      if (!pageId || !ID_PATTERN.test(pageId)) return null;
      return {
        channel,
        surface: 'facebook',
        origin: FACEBOOK_GRAPH,
        accessToken,
        accountId: pageId,
        messagingSenderId: pageId,
      };
    }
    if (channel.type === 'instagram') {
      const facebookLogin =
        channel.metadata?.authorizationMethod === 'facebook_login';
      const igUserId = channel.externalAccountId?.trim();
      const sender = facebookLogin ? channel.externalPageId?.trim() : igUserId;
      if (
        !igUserId ||
        !sender ||
        !ID_PATTERN.test(igUserId) ||
        !ID_PATTERN.test(sender)
      )
        return null;
      return {
        channel,
        surface: 'instagram',
        origin: facebookLogin ? FACEBOOK_GRAPH : INSTAGRAM_GRAPH,
        accessToken,
        accountId: igUserId,
        messagingSenderId: sender,
      };
    }
    return null;
  }

  async replyPublic(
    access: InboxCommentChannelAccess,
    targetCommentId: string,
    text: string,
  ): Promise<{ id: string }> {
    const edge = access.surface === 'instagram' ? 'replies' : 'comments';
    const data = await this.call(
      access,
      'POST',
      `${this.id(targetCommentId)}/${edge}`,
      { message: text },
    );
    const id = typeof data.id === 'string' ? data.id : null;
    if (!id || !ID_PATTERN.test(id)) {
      throw new InboxCommentGraphError('meta_comment_request_failed', null);
    }
    return { id };
  }

  /** Private reply (1 per comment, 7 days): opens the Direct/Messenger thread. */
  async replyPrivate(
    access: InboxCommentChannelAccess,
    commentId: string,
    text: string,
  ): Promise<{ messageId: string | null; recipientId: string | null }> {
    const data = await this.call(
      access,
      'POST',
      `${this.id(access.messagingSenderId)}/messages`,
      {
        recipient: { comment_id: this.id(commentId) },
        message: { text },
      },
    );
    return {
      messageId: typeof data.message_id === 'string' ? data.message_id : null,
      recipientId:
        typeof data.recipient_id === 'string' ? data.recipient_id : null,
    };
  }

  async setHidden(
    access: InboxCommentChannelAccess,
    commentId: string,
    hidden: boolean,
  ): Promise<void> {
    await this.call(
      access,
      'POST',
      this.id(commentId),
      access.surface === 'instagram' ? { hide: hidden } : { is_hidden: hidden },
    );
  }

  async remove(
    access: InboxCommentChannelAccess,
    commentId: string,
  ): Promise<void> {
    await this.call(access, 'DELETE', this.id(commentId));
  }

  async readContent(
    access: InboxCommentChannelAccess,
    contentId: string,
  ): Promise<InboxCommentGraphContent> {
    if (access.surface === 'instagram') {
      const data = await this.call(access, 'GET', this.id(contentId), null, {
        fields:
          'id,permalink,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp',
      });
      const productType = upper(data.media_product_type);
      const mediaType = upper(data.media_type);
      return {
        externalContentId: contentId,
        contentKind:
          productType === 'REELS'
            ? 'reel'
            : productType === 'STORY'
              ? 'story'
              : productType === 'AD'
                ? 'ad'
                : 'post',
        permalink: httpsUrl(data.permalink),
        caption: text(data.caption, 2200),
        // A video has a thumbnail; an image only has its (expiring) media URL.
        // Either is refreshed after 24h and dropped after 5 days unrefreshed.
        thumbnailUrl:
          httpsUrl(data.thumbnail_url) ??
          (mediaType === 'IMAGE' || mediaType === 'CAROUSEL_ALBUM'
            ? httpsUrl(data.media_url)
            : null),
        isPublished: null,
        providerCreatedAt: time(data.timestamp),
      };
    }
    const data = await this.call(access, 'GET', this.id(contentId), null, {
      fields: 'id,permalink_url,message,full_picture,created_time,is_published',
    });
    const isPublished =
      typeof data.is_published === 'boolean' ? data.is_published : null;
    return {
      externalContentId: contentId,
      contentKind: isPublished === false ? 'ad' : 'post',
      permalink: httpsUrl(data.permalink_url),
      caption: text(data.message, 2200),
      thumbnailUrl: httpsUrl(data.full_picture),
      isPublished,
      providerCreatedAt: time(data.created_time),
    };
  }

  /** Posts/media of the account since `since`, newest first, bounded. */
  async listRecentContentIds(
    access: InboxCommentChannelAccess,
    since: Date,
    maxItems: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    const instagram = access.surface === 'instagram';
    const params: Record<string, string> = instagram
      ? { fields: 'id,timestamp', limit: '25' }
      : {
          fields: 'id,created_time',
          limit: '25',
          since: String(Math.floor(since.getTime() / 1000)),
        };
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES && ids.length < maxItems; page += 1) {
      const data = await this.call(
        access,
        'GET',
        `${this.id(access.accountId)}/${instagram ? 'media' : 'feed'}`,
        null,
        after ? { ...params, after } : params,
      );
      const rows = Array.isArray(data.data) ? (data.data as unknown[]) : [];
      let reachedOld = false;
      for (const row of rows) {
        const item = record(row);
        const id = typeof item?.id === 'string' ? item.id : null;
        const createdAt = time(item?.timestamp ?? item?.created_time);
        if (createdAt && createdAt < since) {
          reachedOld = true;
          continue;
        }
        if (id && ID_PATTERN.test(id)) ids.push(id);
        if (ids.length >= maxItems) break;
      }
      after = cursorAfter(data);
      if (reachedOld || !after) break;
    }
    return ids;
  }

  /** Comments (and their replies) on one content, normalized like the webhook's. */
  async listComments(
    access: InboxCommentChannelAccess,
    contentId: string,
    maxItems: number,
  ): Promise<NormalizedMetaComment[]> {
    const instagram = access.surface === 'instagram';
    const params: Record<string, string> = instagram
      ? {
          fields:
            'id,text,timestamp,username,from,replies{id,text,timestamp,username,from}',
          limit: '50',
        }
      : {
          filter: 'stream',
          fields: 'id,message,created_time,from{id,name},parent{id}',
          limit: '100',
        };
    const comments: NormalizedMetaComment[] = [];
    let after: string | null = null;
    for (
      let page = 0;
      page < MAX_PAGES && comments.length < maxItems;
      page += 1
    ) {
      const data = await this.call(
        access,
        'GET',
        `${this.id(contentId)}/comments`,
        null,
        after ? { ...params, after } : params,
      );
      const rows = Array.isArray(data.data) ? (data.data as unknown[]) : [];
      for (const row of rows) {
        const item = record(row);
        if (!item) continue;
        const parent = this.fromGraphComment(access, contentId, item, null);
        if (parent) comments.push(parent);
        const replies = record(item.replies);
        const replyRows = Array.isArray(replies?.data)
          ? (replies.data as unknown[])
          : [];
        for (const replyRow of replyRows) {
          const reply = record(replyRow);
          const normalized =
            reply && parent
              ? this.fromGraphComment(
                  access,
                  contentId,
                  reply,
                  parent.externalCommentId,
                )
              : null;
          if (normalized) comments.push(normalized);
        }
      }
      after = cursorAfter(data);
      if (!after) break;
    }
    return comments.slice(0, maxItems);
  }

  private fromGraphComment(
    access: InboxCommentChannelAccess,
    contentId: string,
    item: GraphRecord,
    parentId: string | null,
  ): NormalizedMetaComment | null {
    const id = typeof item.id === 'string' ? item.id : null;
    if (!id || !ID_PATTERN.test(id)) return null;
    const from = record(item.from);
    const authorId = typeof from?.id === 'string' ? from.id : null;
    const fbParent = record(item.parent);
    const createdAt = time(item.timestamp ?? item.created_time);
    return {
      surface: access.surface,
      accountExternalId: access.accountId,
      lifecycle: 'created',
      externalCommentId: id,
      externalParentId:
        parentId ??
        (typeof fbParent?.id === 'string' && ID_PATTERN.test(fbParent.id)
          ? fbParent.id
          : null),
      externalContentId: contentId,
      contentKind: 'unknown',
      adExternalId: null,
      adTitle: null,
      authorExternalId: authorId && ID_PATTERN.test(authorId) ? authorId : null,
      authorUsername: text(from?.username ?? item.username, 240),
      authorName: text(from?.name, 240),
      fromOwnAccount: authorId === access.accountId,
      text: text(item.text ?? item.message, 4000),
      providerCreatedAt: createdAt,
      occurredAt: createdAt ?? new Date(),
      metadata: { source: 'reconcile' },
    };
  }

  private id(value: string): string {
    if (!ID_PATTERN.test(value)) {
      throw new InboxCommentGraphError('meta_comment_request_failed', null);
    }
    return encodeURIComponent(value);
  }

  private async call(
    access: InboxCommentChannelAccess,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown> | null,
    query?: Record<string, string>,
  ): Promise<GraphRecord> {
    const url = new URL(`${access.origin}/${this.version}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new InboxCommentGraphError('meta_comment_request_failed', null);
    }
    const payload: unknown = await response.json().catch(() => ({}));
    const data = record(payload) ?? {};
    const error = record(data.error);
    if (response.ok && !error) return data;
    const code = typeof error?.code === 'number' ? error.code : null;
    const subcode =
      typeof error?.error_subcode === 'number' ? error.error_subcode : null;
    const safeCode = classify(code, subcode, path);
    // Ids and the numeric Graph code only; never the token or provider text.
    this.logger.warn({
      operation: `comment_${method.toLowerCase()}`,
      channelId: access.channel.id,
      status: response.status,
      code,
      subcode,
      safeCode,
    });
    throw new InboxCommentGraphError(safeCode, response.status);
  }
}

function classify(
  code: number | null,
  subcode: number | null,
  path: string,
): InboxCommentGraphErrorCode {
  if (code === 4 || code === 17 || code === 32 || code === 613)
    return 'meta_comment_rate_limited';
  if (path.endsWith('/messages') && (code === 10900 || code === 551))
    return 'meta_comment_private_reply_unavailable';
  if (
    code === 10 ||
    code === 190 ||
    (code !== null && code >= 200 && code < 300)
  )
    return 'meta_comment_permission_denied';
  if (code === 100 && subcode === 33) return 'meta_comment_not_found';
  return 'meta_comment_request_failed';
}

function record(value: unknown): GraphRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as GraphRecord)
    : null;
}

function upper(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function time(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed =
    typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function cursorAfter(data: GraphRecord): string | null {
  const after = record(record(data.paging)?.cursors)?.after;
  return typeof after === 'string' && after.length <= 500 ? after : null;
}
