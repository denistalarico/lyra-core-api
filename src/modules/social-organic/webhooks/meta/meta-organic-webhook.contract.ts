import { META_ORGANIC_GRAPH_API_VERSION } from '../../providers/meta/meta-organic-oauth.support';

/**
 * What Meta's **current official documentation** says about the four organic
 * webhook fields W1.2 handles — recorded as code so the parsers below can be
 * checked against it, and so a future reader can see what was verified rather
 * than what was remembered.
 *
 * Sources consulted 2026-09-08 (Graph API v26.0 documentation, applied against
 * this app's configured `META_ORGANIC_GRAPH_API_VERSION`):
 *
 * - Webhooks Reference: Page — `/docs/graph-api/webhooks/reference/page/`
 * - Webhooks for Pages —
 *   `/docs/graph-api/webhooks/getting-started/webhooks-for-pages/`
 * - Webhooks Reference: Instagram —
 *   `/docs/graph-api/webhooks/reference/instagram/`
 * - Webhooks for Instagram —
 *   `/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/`
 *
 * **The single most important documented fact** is that `page/feed` is not a
 * comment feed: `item` is an enum of ~25 values (`post`, `comment`, `photo`,
 * `video`, `status`, `share`, `reaction`, `like`, …) and `verb` an enum of
 * ~12 (`add`, `edit`, `edited`, `update`, `remove`, `delete`, `hide`, `block`,
 * …). Treating every `feed` change as a comment — the obvious wrong shortcut —
 * would misclassify most of the traffic a busy Page produces.
 */
export const META_ORGANIC_WEBHOOK_GRAPH_VERSION =
  META_ORGANIC_GRAPH_API_VERSION;

/**
 * `object` values this task subscribes to. `object` is the envelope's top-level
 * discriminator; every other value (`user`, `permissions`, `whatsapp_business_account`, …)
 * is out of scope and must settle `unhandled`, not fail.
 */
export const META_ORGANIC_WEBHOOK_OBJECT_TYPES = ['page', 'instagram'] as const;

/**
 * The exact `field` values W1.2 subscribes to and handles. Messaging fields
 * (`messages`, `messaging_postbacks`, `message_reactions`, `messaging_referrals`,
 * `messaging_handovers`, …) are deliberately absent: they belong to the
 * Messaging app and the LeadFlow/Inbox surface, never to Social Organic.
 */
export const META_ORGANIC_WEBHOOK_HANDLED_FIELDS = {
  page: ['feed', 'mention'],
  instagram: ['comments', 'mentions'],
} as const;

/**
 * Documented `item` values of a `page/feed` change value.
 *
 * Verbatim from the Page reference's `item` enum. Kept complete rather than
 * trimmed to the ones handled, because "documented but not handled" and
 * "undocumented" are different outcomes: the first is a known feed subtype this
 * version chooses not to model, the second is a payload shape nobody has seen.
 */
export const META_PAGE_FEED_ITEMS = [
  'album',
  'address',
  'comment',
  'connection',
  'coupon',
  'event',
  'experience',
  'group',
  'group_message',
  'interest',
  'link',
  'mention',
  'milestone',
  'note',
  'page',
  'picture',
  'platform-story',
  'photo',
  'photo-album',
  'post',
  'profile',
  'question',
  'rating',
  'reaction',
  'relationship-status',
  'share',
  'status',
  'story',
  'timeline cover',
  'tag',
  'video',
] as const;

/**
 * Documented `verb` values of a `page/feed` change value.
 *
 * Meta documents both `edit` and `edited`, and both `remove` and `delete`; the
 * normalizer maps that redundancy onto one internal lifecycle rather than
 * picking a favourite and silently dropping the other spelling.
 */
export const META_PAGE_FEED_VERBS = [
  'add',
  'block',
  'edit',
  'edited',
  'delete',
  'follow',
  'hide',
  'mute',
  'remove',
  'unblock',
  'unhide',
  'update',
] as const;

export type MetaPageFeedItem = (typeof META_PAGE_FEED_ITEMS)[number];
export type MetaPageFeedVerb = (typeof META_PAGE_FEED_VERBS)[number];

/**
 * Facts the parsers depend on, each traceable to a documentation statement.
 * The companion `meta-organic-webhook.documentation.spec.ts` asserts the
 * parsers behave consistently with every entry here, so this is a contract and
 * not a comment.
 */
export const META_ORGANIC_WEBHOOK_DOCUMENTED_FACTS = [
  {
    id: 'envelope-shape',
    statement:
      'Every notification is { object, entry: [{ id, time, changes: [{ field, value }] }] }; ' +
      'entry is an array because Meta batches, and changes is an array per entry.',
    source: 'docs/graph-api/webhooks/getting-started/webhooks-for-pages',
  },
  {
    id: 'page-entry-id',
    statement: 'For object=page, entry[].id is the Page id.',
    source: 'docs/graph-api/webhooks/getting-started/webhooks-for-pages',
  },
  {
    id: 'instagram-entry-id',
    statement:
      'For object=instagram, entry[].id is the Instagram professional account id ' +
      '("ID of your app user\'s Instagram professional account").',
    source: 'docs/graph-api/webhooks/getting-started/webhooks-for-instagram',
  },
  {
    id: 'entry-time',
    statement:
      'entry[].time is a UNIX timestamp in seconds recording when the notification was sent.',
    source: 'docs/graph-api/webhooks/getting-started/webhooks-for-pages',
  },
  {
    id: 'page-feed-item-enum',
    statement:
      'page/feed value.item is an enum spanning post, comment, photo, video, status, ' +
      'share, reaction and ~18 more values — feed is not a comment-only field.',
    source: 'docs/graph-api/webhooks/reference/page',
  },
  {
    id: 'page-feed-verb-enum',
    statement:
      'page/feed value.verb is an enum: add, block, edit, edited, delete, follow, hide, ' +
      'mute, remove, unblock, unhide, update.',
    source: 'docs/graph-api/webhooks/reference/page',
  },
  {
    id: 'page-feed-ids',
    statement:
      'page/feed value carries post_id, comment_id, parent_id, from {id, name}, message, ' +
      'created_time, is_hidden and permalink_url among others; none is documented as always present.',
    source: 'docs/graph-api/webhooks/reference/page',
  },
  {
    id: 'page-feed-example',
    statement:
      'The documented example of a user publishing on a Page is ' +
      '{ item: "post", verb: "add", post_id, from: {id, name}, created_time, message, is_hidden }.',
    source: 'docs/graph-api/webhooks/getting-started/webhooks-for-pages',
  },
  {
    id: 'page-mention-value',
    statement:
      'page/mention value carries post_id, comment_id, item, verb, message, created_time, ' +
      'post/sender identity and message_tags; from {id, name} is documented as Workplace-only, ' +
      'so a mention actor may be absent on a consumer Page.',
    source: 'docs/graph-api/webhooks/reference/page',
  },
  {
    id: 'instagram-comments-value',
    statement:
      'instagram/comments value is { id, text, from: { id, username }, ' +
      'media: { id, media_product_type }, parent_id? } — parent_id present only for replies.',
    source: 'docs/graph-api/webhooks/reference/instagram',
  },
  {
    id: 'instagram-comments-no-delete',
    statement:
      'The Instagram reference documents no verb/operation field on comments and no ' +
      'deletion or edit notification. Delete/update semantics must NOT be inferred.',
    source: 'docs/graph-api/webhooks/reference/instagram',
  },
  {
    id: 'instagram-mentions-value',
    statement:
      'instagram/mentions value is { media_id, comment_id? }: media_id is the media ' +
      'containing the mention, comment_id the comment containing it.',
    source: 'docs/graph-api/webhooks/reference/instagram',
  },
  {
    id: 'instagram-mentions-caption-vs-comment',
    statement:
      'Meta documents caption mentions and comment mentions as different workflows ' +
      '(identify media ids vs comment ids) but does NOT document a discriminator field. ' +
      'Presence of comment_id is treated as an observation, not as documented semantics.',
    source: 'docs/instagram-platform/.../mentions',
  },
  {
    id: 'no-delivery-id',
    statement:
      'Meta publishes no stable per-delivery or per-change id and instructs servers to ' +
      'deduplicate themselves; retries continue for up to 36 hours.',
    source: 'docs/graph-api/webhooks/getting-started',
  },
] as const;
