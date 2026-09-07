import type { PublisherCapabilities } from '../provider-capabilities';

/**
 * Static Meta (Facebook Page + Instagram Professional) capability
 * declaration — `MA2`, restructured per placement in `MA2.1`.
 *
 * Source discipline (blueprint §17 method note): every constraint here is
 * either
 *   - `DOCUMENTED`: read from developers.facebook.com on 2026-09-07 (see the
 *     citations in blueprint §17.1/§17.2, one row per fact) — **not** proven
 *     against our own App, since App Review/Advanced Access have not been
 *     granted yet;
 *   - or a placement this MVP deliberately does not declare because the
 *     fetched docs did not carry enough of the fact set to encode it safely
 *     (see the per-placement comments below) — left out of `placements`
 *     entirely rather than guessed at.
 *
 * No value here has been validated against a real publish call. `MA3` (still
 * `BLOCKED` on `EXT-META-1`) must re-verify against Meta's live behaviour —
 * and any adapter built on this declaration inherits M1's fail-closed
 * validation, so an over-permissive cell here fails safe at
 * schedule/execution time rather than silently publishing malformed media.
 *
 * `MA2.1` scope note: this only restructures *how* the same MA2-researched
 * facts are encoded (one `media` block per placement instead of one per
 * asset type). It does not add new research beyond what MA2 already found —
 * a placement stays out of `placements` below if MA2's research didn't
 * produce a full, citable media-shape for it, even where blueprint §17
 * documents *some* facts about that placement (e.g. Facebook Page non-Reels
 * feed video: endpoint and scope are documented, but codec/size/duration are
 * not, so `facebook_page` feed remains image-only here).
 */

/**
 * Facebook Page (`facebook_page`).
 *
 * Declared placements (MVP): `feed` (image only), `story`, `reel`.
 *
 * Not declared:
 *   - Feed video (non-Reels): endpoint is documented (`graph-video` +
 *     Resumable Upload API, `pages_manage_posts`), but codec/max-size/
 *     duration/resolution are not — the fetched guide defers to the
 *     Resumable Upload API reference page, which was not retrieved. Rather
 *     than reuse Reels' or Stories' numbers for a different endpoint family,
 *     feed stays image-only until that page is fetched.
 *   - Carousel: no `attached_media`-style parameter found on the fetched
 *     `/feed` edge reference — concluded unsupported by absence, not an
 *     explicit statement. Blueprint §17.1 flags this as needing one more
 *     targeted check before being relied on.
 */
const FACEBOOK_PAGE_PLACEMENTS = ['feed', 'story', 'reel'] as const;

export const META_FACEBOOK_PAGE_CAPABILITIES: PublisherCapabilities = {
  provider: 'meta',
  assetType: 'facebook_page',
  placements: FACEBOOK_PAGE_PLACEMENTS,
  media: {
    /**
     * `POST /{page-id}/photos` — `url` or multipart, scope
     * `pages_manage_posts`. Formats jpeg/bmp/png/gif/tiff; max 4 MB. No
     * min/max resolution or aspect-ratio constraint stated on the fetched
     * page. [Graph API — Page/photos]
     * (https://developers.facebook.com/docs/graph-api/reference/page/photos/)
     * Text-only posts (`POST /{page-id}/feed`, `message`) are also `feed`
     * but carry no media — they hit `validate()`/no-media path, not this
     * block.
     */
    feed: {
      acceptedMimeTypes: [
        'image/jpeg',
        'image/bmp',
        'image/png',
        'image/gif',
        'image/tiff',
      ],
      maxBytes: 4 * 1024 * 1024,
    },
    /**
     * `POST /{page-id}/photo_stories` / `video_stories`, scope
     * `pages_manage_posts` (+ `pages_read_engagement`, `pages_show_list`).
     * Photo: formats .jpeg/.bmp/.png/.gif/.tiff, max 10 MB (PNG
     * recommended ≤1 MB); no aspect ratio stated. Video: .mp4
     * recommended, H.264/H.265 (VP9/AV1 also supported), 9:16
     * (1080×1920 recommended, 540×960 minimum — resolution not
     * separately encoded), duration documented as "3 to 90 seconds" in
     * the spec table but the same page separately states "A video story
     * can not exceed 60 seconds" — an unresolved inconsistency in Meta's
     * own docs, not resolved here by guessing; `maxDurationSeconds`
     * below uses the **stricter** 60s figure so this declaration can
     * never accept something Meta's page itself flags as possibly
     * rejected. No video byte-size cap was found on this page. Both
     * media kinds share one `media.story` block (`PublisherCapabilities`
     * has no sub-kind split), so the block below uses photo's smaller
     * `maxBytes` (10 MB) as the safe shared cap even though an actual
     * video upload may be larger — a real video-only cap was not found
     * to declare separately. `aspectRatios` is deliberately left
     * undeclared (imposes no constraint, per M1's own semantics for an
     * empty/absent list): 9:16 is confirmed only for video, and photo
     * stories state no aspect ratio at all — declaring 9:16 here would
     * incorrectly reject a valid photo story of a different ratio.
     * [Page Stories API]
     * (https://developers.facebook.com/docs/page-stories-api/)
     */
    story: {
      acceptedMimeTypes: [
        'image/jpeg',
        'image/bmp',
        'image/png',
        'image/gif',
        'image/tiff',
        'video/mp4',
      ],
      maxBytes: 10 * 1024 * 1024,
      maxDurationSeconds: 60,
    },
    /**
     * `POST /{page-id}/video_reels`, 3-phase upload. Container MP4
     * recommended; codec H.264 (H.265/VP9/AV1 "also supported" — MP4/H.264
     * declared here as the safe common case). Aspect 9:16 (1080×1920
     * recommended, 540×960 minimum — resolution not separately encoded,
     * `PublisherMediaCapabilities` has no resolution field). Duration
     * 3–90s. Scope `pages_manage_posts` (+ `pages_show_list`,
     * `pages_read_engagement`). [Video API — Reels publishing]
     * (https://developers.facebook.com/docs/video-api/guides/reels-publishing/)
     * The documented 30-Reels/24h cap is a rate limit, not a media-shape
     * constraint — not encoded in `media`.
     */
    reel: {
      acceptedMimeTypes: ['video/mp4'],
      maxBytes: 300 * 1024 * 1024,
      minDurationSeconds: 3,
      maxDurationSeconds: 90,
      aspectRatios: ['9:16'],
    },
  },
  supportsScheduling: true,
  supportsCaption: true,
  supportsFirstComment: false,
  supportsHashtags: false,
  requiresReconciliation: false,
  supportsRemoval: true,
};

/**
 * Instagram Professional (`instagram_professional`).
 *
 * Declared placements (MVP): `feed` (image only), `story`, `reel`,
 * `carousel`.
 *
 * Not declared:
 *   - Feed video: the ig-user/media reference documents `media_type=REELS`
 *     for video, not a separate feed-video type — Meta's current model
 *     folds "video in feed" into Reels. `feed` here stays image-only to
 *     match that, consistent with blueprint §17.2's "Video / Reels" row
 *     being one combined entry, not two.
 *   - Carousel item-level video: the Content Publishing guide documents
 *     carousels as up to 10 images/videos/mixed, cropped to the first
 *     item's ratio, but does not give per-item-type size/duration bounds
 *     distinct from the single-item flows. `carousel` below reuses `feed`'s
 *     (image) bounds only — a video carousel item is out of MVP scope here,
 *     not silently accepted with guessed limits.
 */
const INSTAGRAM_PROFESSIONAL_PLACEMENTS = [
  'feed',
  'story',
  'reel',
  'carousel',
] as const;

export const META_INSTAGRAM_PROFESSIONAL_CAPABILITIES: PublisherCapabilities = {
  provider: 'meta',
  assetType: 'instagram_professional',
  placements: INSTAGRAM_PROFESSIONAL_PLACEMENTS,
  media: {
    /**
     * Container flow `POST /{ig-user-id}/media` → `/media_publish`.
     * **JPEG only** — "Extended JPEG formats such as MPO and JPS are not
     * supported." Aspect 4:5 to 1.91:1 (encoded as three representative
     * discrete ratios — M1 only matches literal `"W:H"` strings with
     * tolerance, it cannot encode a continuous range). Max 8 MB.
     * [Content Publishing guide]
     * (https://developers.facebook.com/docs/instagram-platform/content-publishing)
     * · [ig-user/media reference]
     * (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)
     */
    feed: {
      acceptedMimeTypes: ['image/jpeg'],
      maxBytes: 8 * 1024 * 1024,
      aspectRatios: ['4:5', '1:1', '1.91:1'],
    },
    /**
     * `media_type=STORIES`. Image: 8 MB max, 9:16 recommended (not an
     * enforced bound per the fetched reference, so not encoded as the
     * only `aspectRatios` entry — left undeclared here rather than
     * asserting an unconfirmed hard limit). Video: aspect 0.1:1–10:1,
     * 100 MB max. [ig-user/media reference]
     * (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)
     */
    story: {
      acceptedMimeTypes: ['image/jpeg', 'video/mp4'],
      maxBytes: 100 * 1024 * 1024,
    },
    /**
     * Same container flow, `media_type=REELS`. Aspect 0.01:1–10:1 per
     * the field reference (9:16 is Meta's stated *recommendation*, not
     * an enforced bound — so, like feed, only a representative subset is
     * encoded rather than the full documented range: `matchesAnyAspectRatio`
     * cannot express "any ratio from 0.01:1 to 10:1", and declaring no
     * `aspectRatios` at all would assert an unbounded range that was
     * never actually confirmed as unconstrained end-to-end). Max 300 MB.
     * Codec/duration specifics for IG Reels were **not found** in the
     * fetched pages — not encoded, not guessed. Do not conflate with the
     * Facebook Page Reels (Video API) spec above, a different
     * product/endpoint. [ig-user/media reference]
     * (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)
     */
    reel: {
      acceptedMimeTypes: ['video/mp4'],
      maxBytes: 300 * 1024 * 1024,
      aspectRatios: ['9:16', '1:1', '4:5'],
    },
    /**
     * `media_type=CAROUSEL`, max 10 items. All items cropped to the
     * first item's aspect ratio (default 1:1). Item-level size/type
     * bounds distinct from single-item flows are not documented — this
     * MVP declares carousel as image-only, reusing `feed`'s image
     * bounds, and leaves carousel video out of scope (see file-level
     * comment) rather than guessing a per-item video limit.
     * [Content Publishing guide]
     * (https://developers.facebook.com/docs/instagram-platform/content-publishing)
     */
    carousel: {
      acceptedMimeTypes: ['image/jpeg'],
      maxBytes: 8 * 1024 * 1024,
      aspectRatios: ['4:5', '1:1', '1.91:1'],
      maxItemsPerPost: 10,
    },
  },
  supportsScheduling: false,
  supportsCaption: true,
  supportsFirstComment: false,
  supportsHashtags: false,
  requiresReconciliation: false,
  supportsRemoval: false,
};

/**
 * Looks up the static declaration for a Meta `assetType`. Distinct from
 * `SocialPublisherAdapter.capabilities()` (an instance method `MA3` will
 * implement) so this data can be imported and snapshot-tested on its own,
 * without constructing an adapter.
 *
 * Throws rather than returning `undefined` for an unknown `assetType`: a
 * caller reaching this with anything other than `facebook_page` or
 * `instagram_professional` has a bug, not a data gap — MA1 only discovers
 * those two asset types (`meta-organic-asset-discovery.service.ts`).
 */
export function getMetaCapabilities(assetType: string): PublisherCapabilities {
  switch (assetType) {
    case 'facebook_page':
      return META_FACEBOOK_PAGE_CAPABILITIES;
    case 'instagram_professional':
      return META_INSTAGRAM_PROFESSIONAL_CAPABILITIES;
    default:
      throw new Error(`Unknown Meta organic asset type: ${assetType}`);
  }
}
