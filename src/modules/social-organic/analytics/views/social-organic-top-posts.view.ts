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
  'publishedAt',
] as const;

export type SocialOrganicTopPostSort =
  (typeof SOCIAL_ORGANIC_TOP_POST_SORTS)[number];

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
  };
}
