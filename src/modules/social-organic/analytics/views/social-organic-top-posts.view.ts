import type { SocialOrganicPostMetricDailyEntity } from '../entities/social-organic-post-metric-daily.entity';

/**
 * One post in a ranking, as the dashboard's table renders it.
 *
 * Every counter here is a **lifetime total** — cumulative since the post was
 * published, read from `/{ig-media-id}/insights`. That is why the row carries
 * `observedAt` rather than a period: the numbers answer "how has this post done
 * in total, as of this observation", not "how did it do inside the selected
 * window". Two rows may therefore have been observed on different days, and
 * none of these values may be summed across posts to make a total.
 *
 * `thumbnailUrl` is deliberately absent. Meta signs image URLs with a ~5 day
 * expiry, so one serialised into this view would be stale by the time a report
 * was re-opened; the client asks `posts/thumbnail` for the picture, keyed by
 * `externalPublicationId`, and that endpoint resolves it fresh.
 */
export type SocialOrganicTopPostView = {
  /** The provider's own id — what `posts/thumbnail` is keyed by. */
  externalPublicationId: string;
  /** Lyra's publication row, when Lyra published it. */
  publicationId: string | null;
  assetId: string;
  /** Stable public URL, unlike the image. Null for older rows. */
  permalink: string | null;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  publishedAt: string | null;
  /** When the lifetime counters below were read. */
  observedAt: string | null;
  reach: string | null;
  impressions: string | null;
  likes: string | null;
  comments: string | null;
  saves: string | null;
  shares: string | null;
  totalInteractions: string | null;
  profileVisits: string | null;
  follows: string | null;
  /**
   * Reactions by type — Facebook only, null on every Instagram row.
   *
   * Instagram has one reaction and it is already `likes`. These stay null
   * there rather than being filled with zeros, so the table can tell "this
   * surface has no reactions" from "nobody reacted".
   */
  reactionsTotal: string | null;
  reactionsLike: string | null;
  reactionsLove: string | null;
  reactionsWow: string | null;
  reactionsHaha: string | null;
  reactionsSorry: string | null;
  reactionsAnger: string | null;
  /**
   * `post_media_view` split by `is_from_ads` — Facebook only.
   *
   * These two do partition the total, unlike Instagram's de-duplicated surface
   * slices: a view was served by an ad or it was not.
   */
  viewsOrganic: string | null;
  viewsPaid: string | null;
};

export type SocialOrganicTopPostsView = {
  items: SocialOrganicTopPostView[];
  total: number;
};

/** The metrics a ranking may be ordered by. All lifetime, all comparable. */
export const SOCIAL_ORGANIC_TOP_POST_SORTS = [
  'reach',
  'impressions',
  'likes',
  'comments',
  'saves',
  'shares',
  'totalInteractions',
  'profileVisits',
  'follows',
  // Facebook only. Sorting an Instagram ranking by it puts every row in a tie,
  // which the comparator resolves by publish date — an empty column cannot
  // order anything, and refusing the sort outright would mean the table's own
  // header could produce a request the endpoint rejects.
  'reactionsTotal',
  'publishedAt',
] as const;

export type SocialOrganicTopPostSort =
  (typeof SOCIAL_ORGANIC_TOP_POST_SORTS)[number];

/**
 * The surfaces a ranking can be narrowed to.
 *
 * A *surface*, not a media type: a reel and a feed video are both
 * `media_type=VIDEO` and behave nothing alike — one plays in a vertical feed of
 * its own, the other sits in the timeline — while a feed post may be an image,
 * a video or a carousel and is one kind of thing to the operator asking "how
 * did my posts do". The question the dashboard asks is about the surface, so
 * that is what this filters.
 *
 * ## Instagram only, and not by choice
 *
 * `media_product_type` is an Instagram field. The Facebook Page reader asks
 * `/{page}/posts` for `id,created_time,full_picture,permalink_url,message`
 * because the Graph API offers nothing like it there — a Page post has no
 * surface to report. So a Facebook asset's rows carry null here and match no
 * surface, which means a surface-filtered ranking of one is empty rather than
 * wrong. Ranking without a surface still returns them, and that is the honest
 * shape of it: the split exists where the provider distinguishes the surfaces
 * and does not exist where it does not.
 */
export const SOCIAL_ORGANIC_POST_SURFACES = ['feed', 'reel', 'story'] as const;

export type SocialOrganicPostSurface =
  (typeof SOCIAL_ORGANIC_POST_SURFACES)[number];

/**
 * The `media_product_type` spellings each surface answers to.
 *
 * Meta is not consistent here and the inconsistency is documented, not
 * incidental: `/{ig-user}/media` returns `FEED`, `REELS` and `STORY`, while the
 * insights breakdown on the same account returns `POST`, `CAROUSEL_CONTAINER`,
 * `REEL` and `STORY` for what are the same three surfaces — the normalizer
 * already accepts both sets when it reads a breakdown. A filter that matched a
 * single literal would therefore be right for whichever endpoint happened to
 * have written the row and silently empty for the other, which is the worst
 * kind of wrong: a table that says "no reels this period" about an account full
 * of them.
 *
 * Compared case-insensitively at the query, so a provider that lowercases one
 * day does not empty the table.
 */
const SURFACE_SPELLINGS: Record<SocialOrganicPostSurface, readonly string[]> = {
  feed: ['FEED', 'POST', 'CAROUSEL_CONTAINER'],
  reel: ['REEL', 'REELS'],
  story: ['STORY', 'STORIES'],
};

export function socialOrganicSurfaceSpellings(
  surface: SocialOrganicPostSurface,
): readonly string[] {
  return SURFACE_SPELLINGS[surface];
}

export function isSocialOrganicPostSurface(
  value: unknown,
): value is SocialOrganicPostSurface {
  return (
    typeof value === 'string' &&
    (SOCIAL_ORGANIC_POST_SURFACES as readonly string[]).includes(value)
  );
}

export function toSocialOrganicTopPostView(
  fact: SocialOrganicPostMetricDailyEntity,
): SocialOrganicTopPostView {
  return {
    externalPublicationId: fact.externalPublicationId,
    publicationId: fact.publicationId,
    assetId: fact.assetId,
    permalink: fact.permalink,
    caption: fact.caption,
    mediaType: fact.mediaType,
    mediaProductType: fact.mediaProductType,
    publishedAt: fact.publishedAt?.toISOString() ?? null,
    // The instant the six newer counters were read. The four older
    // `*_lifetime` columns carry their own timestamps, from when they were
    // added by separate reads; this is the one that describes this row.
    observedAt: fact.lifetimeObservedAt?.toISOString() ?? null,
    reach: fact.reachLifetime,
    impressions: fact.impressionsLifetime,
    likes: fact.likesLifetime,
    comments: fact.commentsLifetime,
    saves: fact.savesLifetime,
    shares: fact.sharesLifetime,
    totalInteractions: fact.totalInteractionsLifetime,
    profileVisits: fact.profileVisitsLifetime,
    follows: fact.followsLifetime,
    reactionsTotal: fact.reactionsTotal,
    reactionsLike: fact.reactionsLike,
    reactionsLove: fact.reactionsLove,
    reactionsWow: fact.reactionsWow,
    reactionsHaha: fact.reactionsHaha,
    reactionsSorry: fact.reactionsSorry,
    reactionsAnger: fact.reactionsAnger,
    viewsOrganic: fact.viewsOrganicLifetime,
    viewsPaid: fact.viewsPaidLifetime,
  };
}
