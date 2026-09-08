import type {
  SocialOrganicInteractionStatus,
  SocialOrganicInteractionSurface,
  SocialOrganicInteractionType,
} from '../entities/social-organic-interaction.entity';
import {
  type MetaWebhookChange,
  readExternalId,
  readUnixSeconds,
} from './meta-organic-webhook.parser';

/**
 * Provider-owned normalizers for the four subscribed fields.
 *
 * Every function here is **pure**: payload in, normalized interaction or safe
 * failure out. No repository, no Graph call, no logger. That is what makes the
 * documented edge cases (§17, §18) testable as data rather than as integration
 * scenarios, and it is what keeps §15's "inbound only" a property of the code
 * instead of a promise in a comment.
 */

/** Safe, enumerated reasons a change produced no interaction. */
export type MetaOrganicHandlerErrorCode =
  | 'malformed_payload'
  | 'missing_external_id'
  | 'unsupported_feed_subtype';

export type NormalizedOrganicInteraction = {
  surface: SocialOrganicInteractionSurface;
  interactionType: SocialOrganicInteractionType;
  status: SocialOrganicInteractionStatus;
  externalInteractionId: string;
  externalParentId: string | null;
  externalContentId: string | null;
  actorExternalId: string | null;
  actorDisplayName: string | null;
  text: string | null;
  providerCreatedAt: Date | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

export type MetaOrganicHandlerResult =
  | { outcome: 'normalized'; interaction: NormalizedOrganicInteraction }
  | { outcome: 'ignored'; safeErrorCode: MetaOrganicHandlerErrorCode };

export type MetaOrganicHandler = (
  change: MetaWebhookChange,
) => MetaOrganicHandlerResult;

/** Longest text persisted on a domain row; the receipt keeps the original. */
export const MAX_INTERACTION_TEXT_LENGTH = 4000;
const MAX_DISPLAY_NAME_LENGTH = 240;

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_INTERACTION_TEXT_LENGTH) : null;
}

function readDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_DISPLAY_NAME_LENGTH) : null;
}

function ignored(
  safeErrorCode: MetaOrganicHandlerErrorCode,
): MetaOrganicHandlerResult {
  return { outcome: 'ignored', safeErrorCode };
}

/**
 * Meta documents both `edit`/`edited` and `remove`/`delete`. Mapping the pairs
 * onto one internal lifecycle is the point of having an internal vocabulary at
 * all — a caller must never have to know which spelling arrived.
 *
 * `add` is creation. `hide`/`unhide`/`block`/`mute`/`follow` are documented
 * verbs this version does not model as lifecycle: they are moderation and
 * relationship signals, and inventing a `comment_hidden` state nobody consumes
 * would be modelling ahead of a requirement. They land as `page_feed_other`
 * with the verb preserved in metadata.
 */
type FeedLifecycle = 'created' | 'updated' | 'removed' | 'other';

function readFeedLifecycle(verb: unknown): FeedLifecycle {
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
    default:
      return 'other';
  }
}

/**
 * `item` says *what* changed. This is the distinction §4 insists on: a `feed`
 * change is not automatically a comment, and `post` vs `comment` is the only
 * split the documentation supports without extrapolation. Every other
 * documented item (`photo`, `video`, `status`, `share`, `reaction`, …) is a
 * real feed event that this version records as `page_feed_other` rather than
 * forcing into a shape it does not have.
 */
type FeedSubject = 'post' | 'comment' | 'other';

function readFeedSubject(item: unknown): FeedSubject {
  const normalized = typeof item === 'string' ? item.trim().toLowerCase() : '';
  if (normalized === 'post') return 'post';
  if (normalized === 'comment') return 'comment';
  return 'other';
}

const FEED_TYPE_BY_SUBJECT: Record<
  Exclude<FeedSubject, 'other'>,
  Record<Exclude<FeedLifecycle, 'other'>, SocialOrganicInteractionType>
> = {
  post: {
    created: 'post_created',
    updated: 'post_updated',
    removed: 'post_removed',
  },
  comment: {
    created: 'comment_created',
    updated: 'comment_updated',
    removed: 'comment_removed',
  },
};

/**
 * `page` / `feed`.
 *
 * Neither `item` nor `verb` is documented as always present (§17), so both are
 * read defensively and their absence degrades to `page_feed_other` — a
 * recorded, classified event — instead of throwing or guessing.
 *
 * The id chosen as `external_interaction_id` is the id *of the thing that
 * changed*: `comment_id` for a comment, `post_id` for a post. Using `post_id`
 * for a comment would collapse every comment on a post into one row.
 */
export function handlePageFeed(
  change: MetaWebhookChange,
): MetaOrganicHandlerResult {
  const value = change.value;
  if (!value) return ignored('malformed_payload');

  const subject = readFeedSubject(value.item);
  const lifecycle = readFeedLifecycle(value.verb);

  const postId = readExternalId(value.post_id);
  const commentId = readExternalId(value.comment_id);
  const parentId = readExternalId(value.parent_id);
  const providerCreatedAt = readUnixSeconds(value.created_time);
  const from = value.from as { id?: unknown; name?: unknown } | undefined;

  const metadata: Record<string, unknown> = {
    field: 'feed',
    // The provider's own vocabulary, kept verbatim and bounded: it is how an
    // operator tells which documented subtype produced a `page_feed_other`.
    item: typeof value.item === 'string' ? value.item.slice(0, 64) : null,
    verb: typeof value.verb === 'string' ? value.verb.slice(0, 64) : null,
  };

  const interactionType: SocialOrganicInteractionType =
    subject === 'other' || lifecycle === 'other'
      ? 'page_feed_other'
      : FEED_TYPE_BY_SUBJECT[subject][lifecycle];

  // For a comment the comment id identifies the change; for anything else the
  // post id does. `page_feed_other` accepts either, because a reaction change
  // carries a post id and a hidden-comment change carries a comment id.
  const externalInteractionId =
    interactionType === 'page_feed_other'
      ? (commentId ?? postId)
      : subject === 'comment'
        ? commentId
        : postId;

  if (!externalInteractionId) return ignored('missing_external_id');

  const removed =
    interactionType === 'post_removed' || interactionType === 'comment_removed';

  return {
    outcome: 'normalized',
    interaction: {
      surface: 'page_feed',
      interactionType,
      status: removed ? 'removed' : 'active',
      externalInteractionId,
      // A comment's parent is `parent_id` when Meta sends one (a reply), and
      // otherwise the post it sits on.
      externalParentId: subject === 'comment' ? (parentId ?? postId) : parentId,
      externalContentId: postId,
      actorExternalId: readExternalId(from?.id),
      actorDisplayName: readDisplayName(from?.name),
      text: readText(value.message),
      providerCreatedAt,
      occurredAt: providerCreatedAt ?? change.entryTime ?? new Date(),
      metadata,
    },
  };
}

/**
 * `page` / `mention`.
 *
 * A mention is always a creation: Meta documents no mention lifecycle, so
 * inventing `mention_removed` from a `verb` this field is not documented to
 * send would be exactly the extrapolation §5 forbids. `verb` is still recorded
 * in metadata when present, so the evidence is kept without acting on it.
 *
 * `from` is documented as **Workplace-only**, which is why a missing actor here
 * is normal rather than a malformed payload. §5's "actor only if permitted" is
 * satisfied by taking what the payload gives and never calling Graph for more —
 * that enrichment is the documented follow-up, not this task.
 */
export function handlePageMention(
  change: MetaWebhookChange,
): MetaOrganicHandlerResult {
  const value = change.value;
  if (!value) return ignored('malformed_payload');

  const postId = readExternalId(value.post_id);
  const commentId = readExternalId(value.comment_id);
  // A mention in a comment is identified by that comment; a mention in a post
  // by the post.
  const externalInteractionId = commentId ?? postId;
  if (!externalInteractionId) return ignored('missing_external_id');

  const providerCreatedAt = readUnixSeconds(value.created_time);
  const from = value.from as { id?: unknown; name?: unknown } | undefined;

  return {
    outcome: 'normalized',
    interaction: {
      surface: 'page_mention',
      interactionType: 'mention_created',
      status: 'active',
      externalInteractionId,
      externalParentId: commentId
        ? (readExternalId(value.parent_id) ?? postId)
        : null,
      externalContentId: postId,
      actorExternalId: readExternalId(from?.id),
      actorDisplayName: readDisplayName(from?.name),
      text: readText(value.message),
      providerCreatedAt,
      occurredAt: providerCreatedAt ?? change.entryTime ?? new Date(),
      metadata: {
        field: 'mention',
        item: typeof value.item === 'string' ? value.item.slice(0, 64) : null,
        verb: typeof value.verb === 'string' ? value.verb.slice(0, 64) : null,
        // Which surface the mention sat on, derived only from which id arrived.
        mentionTarget: commentId ? 'comment' : 'post',
      },
    },
  };
}

/**
 * `instagram` / `comments`.
 *
 * The documented value is `{ id, text, from: { id, username }, media: { id,
 * media_product_type }, parent_id? }`. Note what is **not** there: no `verb`,
 * no operation, and no documented deletion or edit notification.
 *
 * So this handler emits `comment_created` and nothing else. §6 says not to
 * invent deletion semantics, and the honest reading of the reference is that
 * Instagram does not tell us about deletes on this field. If Meta later
 * documents one, it arrives as a new `interaction_type` here — the schema
 * already has `comment_removed` because the Page feed genuinely does document
 * removals.
 */
export function handleInstagramComments(
  change: MetaWebhookChange,
): MetaOrganicHandlerResult {
  const value = change.value;
  if (!value) return ignored('malformed_payload');

  const commentId = readExternalId(value.id);
  if (!commentId) return ignored('missing_external_id');

  const from = value.from as { id?: unknown; username?: unknown } | undefined;
  const media = value.media as
    | { id?: unknown; media_product_type?: unknown }
    | undefined;
  // IG comments carry no `created_time`; the entry's notification time is the
  // only time available, and it is close enough to be useful for ordering.
  const providerCreatedAt = readUnixSeconds(value.created_time);

  return {
    outcome: 'normalized',
    interaction: {
      surface: 'instagram_comments',
      interactionType: 'comment_created',
      status: 'active',
      externalInteractionId: commentId,
      externalParentId: readExternalId(value.parent_id),
      externalContentId: readExternalId(media?.id),
      actorExternalId: readExternalId(from?.id),
      actorDisplayName: readDisplayName(from?.username),
      text: readText(value.text),
      providerCreatedAt,
      occurredAt: providerCreatedAt ?? change.entryTime ?? new Date(),
      metadata: {
        field: 'comments',
        mediaProductType:
          typeof media?.media_product_type === 'string'
            ? media.media_product_type.slice(0, 64)
            : null,
      },
    },
  };
}

/**
 * `instagram` / `mentions`.
 *
 * The documented value is only `{ media_id, comment_id? }` — **no text, no
 * actor, no timestamp**. That is the whole payload, and it is why this handler
 * looks thinner than the others rather than being incomplete: §16 prefers
 * payload-first, so the comment body and the mentioning user are deliberately
 * left unfetched and recorded as a follow-up.
 *
 * §7 warns against assuming parity with Page mention, and the payloads bear
 * that out: they share no field names at all. The one distinction Meta's
 * workflow docs draw — a mention in a caption versus in a comment — has **no
 * documented discriminator**, so `mentionTarget` below is labelled as an
 * observation of which id arrived, not as a documented semantic.
 */
export function handleInstagramMentions(
  change: MetaWebhookChange,
): MetaOrganicHandlerResult {
  const value = change.value;
  if (!value) return ignored('malformed_payload');

  const mediaId = readExternalId(value.media_id);
  const commentId = readExternalId(value.comment_id);
  const externalInteractionId = commentId ?? mediaId;
  if (!externalInteractionId) return ignored('missing_external_id');

  return {
    outcome: 'normalized',
    interaction: {
      surface: 'instagram_mentions',
      interactionType: 'mention_created',
      status: 'active',
      externalInteractionId,
      externalParentId: null,
      externalContentId: mediaId,
      actorExternalId: null,
      actorDisplayName: null,
      text: null,
      providerCreatedAt: null,
      occurredAt: change.entryTime ?? new Date(),
      metadata: {
        field: 'mentions',
        // Observed, not documented: Meta publishes no discriminator field, so
        // this records which id was present and claims nothing more.
        mentionTarget: commentId ? 'comment' : 'media',
      },
    },
  };
}

/**
 * The registry §12 asks for: `object:field` → handler, and nothing else
 * recognized.
 *
 * A registry rather than a switch because "which events does this system
 * handle?" then has one answer that both the worker and the tests read, instead
 * of a control-flow shape that has to be traced. Everything absent from this
 * map settles `unhandled` / `no_handler_registered` — including every
 * `messaging*` field, which is absent here on purpose and asserted absent by
 * the boundary spec.
 */
export const META_ORGANIC_WEBHOOK_HANDLERS: Readonly<
  Record<string, MetaOrganicHandler>
> = Object.freeze({
  'page:feed': handlePageFeed,
  'page:mention': handlePageMention,
  'instagram:comments': handleInstagramComments,
  'instagram:mentions': handleInstagramMentions,
});

/** Handler key for one change, or null when nothing handles it. */
export function resolveHandlerKey(
  objectType: string,
  field: string | null,
): string | null {
  if (!field) return null;
  const key = `${objectType}:${field}`;
  return key in META_ORGANIC_WEBHOOK_HANDLERS ? key : null;
}
