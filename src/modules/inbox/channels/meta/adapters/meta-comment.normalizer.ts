/**
 * IX3 — pure normalizers for the comment changes the LeadFlow Meta app
 * receives on the Inbox webhook (`entry[].changes[]`).
 *
 * Payload in, normalized comment or a safe reason out: no repository, no Graph
 * call, no logger. Modelled on the Social organic handlers
 * (`social-organic/webhooks/meta/meta-organic-webhook.handlers.ts`) but not
 * imported from them — the two products keep separate apps and code paths
 * (D-IX-12) — and with AI-06 corrected: the Facebook Login variant of the
 * Instagram `comments` payload carries `value.comment_id`, the Instagram Login
 * variant `value.id`, and both are read.
 */

export type MetaCommentSurface = 'instagram' | 'facebook';

export type MetaCommentContentKind =
  | 'post'
  | 'reel'
  | 'story'
  | 'live'
  | 'ad'
  | 'unknown';

/**
 * What happened to the comment. Instagram documents creation only; the Page
 * feed also documents edits, removals and moderation verbs.
 */
export type MetaCommentLifecycle =
  | 'created'
  | 'updated'
  | 'removed'
  | 'hidden'
  | 'unhidden';

export type MetaCommentIgnoredReason =
  | 'malformed_payload'
  | 'missing_external_id'
  | 'unsupported_field'
  | 'unsupported_feed_item'
  | 'unsupported_feed_verb';

export type NormalizedMetaComment = {
  surface: MetaCommentSurface;
  /** `entry.id`: the Page id (feed) or the Instagram account id (comments). */
  accountExternalId: string;
  lifecycle: MetaCommentLifecycle;
  externalCommentId: string;
  /** The comment this one answers; null for a top-level comment. */
  externalParentId: string | null;
  /** The post / media the comment sits on. */
  externalContentId: string | null;
  contentKind: MetaCommentContentKind;
  adExternalId: string | null;
  adTitle: string | null;
  authorExternalId: string | null;
  authorUsername: string | null;
  authorName: string | null;
  /** True when the account itself wrote it (our replies coming back). */
  fromOwnAccount: boolean;
  text: string | null;
  providerCreatedAt: Date | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

export type MetaCommentNormalizeResult =
  | { outcome: 'normalized'; comment: NormalizedMetaComment }
  | { outcome: 'ignored'; reason: MetaCommentIgnoredReason };

export type MetaCommentChange = {
  object: 'page' | 'instagram';
  accountExternalId: string | null;
  entryTime: Date | null;
  field: string | null;
  value: Record<string, unknown> | null;
};

/** Longest comment text persisted; Meta caps comments well below this. */
export const MAX_COMMENT_TEXT_LENGTH = 4000;
const MAX_NAME_LENGTH = 240;
const MAX_ID_LENGTH = 180;

/** Fields of `entry[].changes[]` the Inbox treats as comments. */
export const META_COMMENT_FIELDS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    page: ['feed'],
    instagram: ['comments', 'live_comments'],
  });

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readId(value: unknown): string | null {
  const raw =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  return raw && raw.length <= MAX_ID_LENGTH && /^[A-Za-z0-9_.:-]+$/.test(raw)
    ? raw
    : null;
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Meta sends unix seconds on the feed and, sometimes, ISO strings. */
function readTime(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Splits a webhook body into the comment changes it carries. Messaging events
 * (`entry[].messaging`) are not touched here; the controller keeps that path.
 */
export function extractMetaCommentChanges(
  payload: unknown,
): MetaCommentChange[] {
  const body = record(payload);
  const object = body?.object;
  if (object !== 'page' && object !== 'instagram') return [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const changes: MetaCommentChange[] = [];
  for (const rawEntry of entries) {
    const entry = record(rawEntry);
    const list = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const rawChange of list) {
      const change = record(rawChange);
      changes.push({
        object,
        accountExternalId: readId(entry?.id),
        entryTime: readTime(entry?.time),
        field: typeof change?.field === 'string' ? change.field : null,
        value: record(change?.value),
      });
    }
  }
  return changes;
}

/** True when a change is one this module handles at all (field-level). */
export function isMetaCommentField(change: MetaCommentChange): boolean {
  return Boolean(
    change.field && META_COMMENT_FIELDS[change.object]?.includes(change.field),
  );
}

export function normalizeMetaCommentChange(
  change: MetaCommentChange,
): MetaCommentNormalizeResult {
  if (!isMetaCommentField(change)) {
    return { outcome: 'ignored', reason: 'unsupported_field' };
  }
  if (!change.value || !change.accountExternalId) {
    return { outcome: 'ignored', reason: 'malformed_payload' };
  }
  return change.object === 'instagram'
    ? normalizeInstagramComment(change)
    : normalizePageFeedComment(change);
}

/**
 * Instagram `comments` / `live_comments`.
 *
 * `media.ad_id` / `media.ad_title` arrive on comments made on an ad (Facebook
 * Login variant), together with `original_media_id`; that is what identifies an
 * ad without any ads permission. Instagram documents no edit or delete on this
 * field, so the lifecycle is always `created`.
 */
function normalizeInstagramComment(
  change: MetaCommentChange,
): MetaCommentNormalizeResult {
  const value = change.value!;
  const externalCommentId = readId(value.comment_id) ?? readId(value.id);
  if (!externalCommentId) {
    return { outcome: 'ignored', reason: 'missing_external_id' };
  }
  const from = record(value.from);
  const media = record(value.media);
  const authorExternalId = readId(from?.id);
  const adExternalId = readId(media?.ad_id);
  const productType =
    typeof media?.media_product_type === 'string'
      ? media.media_product_type.trim().toUpperCase()
      : null;
  const contentKind: MetaCommentContentKind =
    change.field === 'live_comments'
      ? 'live'
      : adExternalId || productType === 'AD'
        ? 'ad'
        : productType === 'REELS'
          ? 'reel'
          : productType === 'STORY'
            ? 'story'
            : productType === 'FEED'
              ? 'post'
              : 'unknown';
  const providerCreatedAt = readTime(value.created_time ?? value.timestamp);
  return {
    outcome: 'normalized',
    comment: {
      surface: 'instagram',
      accountExternalId: change.accountExternalId!,
      lifecycle: 'created',
      externalCommentId,
      externalParentId: readId(value.parent_id),
      externalContentId: readId(media?.id),
      contentKind,
      adExternalId,
      adTitle: readText(media?.ad_title, MAX_NAME_LENGTH),
      authorExternalId,
      authorUsername: readText(from?.username, MAX_NAME_LENGTH),
      authorName: null,
      fromOwnAccount: authorExternalId === change.accountExternalId,
      text: readText(value.text, MAX_COMMENT_TEXT_LENGTH),
      providerCreatedAt,
      occurredAt: providerCreatedAt ?? change.entryTime ?? new Date(),
      metadata: {
        field: change.field,
        mediaProductType: productType ? productType.slice(0, 32) : null,
        originalMediaId: readId(media?.original_media_id),
      },
    },
  };
}

function readFeedLifecycle(verb: unknown): MetaCommentLifecycle | null {
  switch (typeof verb === 'string' ? verb.trim().toLowerCase() : '') {
    case 'add':
      return 'created';
    case 'edit':
    case 'edited':
    case 'update':
      return 'updated';
    case 'remove':
    case 'delete':
      return 'removed';
    case 'hide':
      return 'hidden';
    case 'unhide':
      return 'unhidden';
    default:
      return null;
  }
}

/**
 * Page `feed` with `item: 'comment'`. Everything else on the feed (posts,
 * reactions, shares…) is ignored with a safe reason.
 *
 * A top-level Facebook comment carries `parent_id` equal to the `post_id`; only
 * a parent that is not the post is a real parent comment.
 */
function normalizePageFeedComment(
  change: MetaCommentChange,
): MetaCommentNormalizeResult {
  const value = change.value!;
  const item = typeof value.item === 'string' ? value.item.toLowerCase() : '';
  if (item !== 'comment') {
    return { outcome: 'ignored', reason: 'unsupported_feed_item' };
  }
  const lifecycle = readFeedLifecycle(value.verb);
  if (!lifecycle) {
    return { outcome: 'ignored', reason: 'unsupported_feed_verb' };
  }
  const externalCommentId = readId(value.comment_id);
  if (!externalCommentId) {
    return { outcome: 'ignored', reason: 'missing_external_id' };
  }
  const postId = readId(value.post_id);
  const parentId = readId(value.parent_id);
  const from = record(value.from);
  const post = record(value.post);
  const authorExternalId = readId(from?.id);
  const providerCreatedAt = readTime(value.created_time);
  const isPublished =
    typeof post?.is_published === 'boolean' ? post.is_published : null;
  return {
    outcome: 'normalized',
    comment: {
      surface: 'facebook',
      accountExternalId: change.accountExternalId!,
      lifecycle,
      externalCommentId,
      externalParentId: parentId && parentId !== postId ? parentId : null,
      externalContentId: postId,
      // An unpublished page post is how an ad reaches the feed ("Post
      // patrocinado"); the content cache confirms it from Graph.
      contentKind: isPublished === false ? 'ad' : 'post',
      adExternalId: null,
      adTitle: null,
      authorExternalId,
      authorUsername: null,
      authorName: readText(from?.name, MAX_NAME_LENGTH),
      fromOwnAccount: authorExternalId === change.accountExternalId,
      text: readText(value.message, MAX_COMMENT_TEXT_LENGTH),
      providerCreatedAt,
      occurredAt: providerCreatedAt ?? change.entryTime ?? new Date(),
      metadata: {
        field: 'feed',
        verb: typeof value.verb === 'string' ? value.verb.slice(0, 32) : null,
        postIsPublished: isPublished,
        postPermalink:
          typeof post?.permalink_url === 'string' &&
          /^https:\/\/(www\.)?facebook\.com\//.test(post.permalink_url)
            ? post.permalink_url.slice(0, 500)
            : null,
      },
    },
  };
}
