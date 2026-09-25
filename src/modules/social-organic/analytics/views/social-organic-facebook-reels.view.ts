import type { SocialOrganicFacebookReelEntity } from '../entities/social-organic-facebook-reel.entity';

/**
 * One Facebook reel in a ranking.
 *
 * Every counter is a lifetime total, read from `/{reel}/video_insights` at
 * `observedAt`. None may be summed across reels except the additive ones —
 * plays, replays, watch time, reactions, comments and shares. `uniqueViewers`
 * is an audience and is not additive: two reels seen by 100 accounts each were
 * not seen by 200, and Meta offers no de-duplicated union.
 *
 * `retentionGraph` is the curve Meta reports, one entry per second, each the
 * share of viewers still watching. It is passed through in Meta's own shape
 * rather than resampled: the chart draws what is there, and a reel shorter than
 * another simply has fewer points.
 */
export type SocialOrganicFacebookReelView = {
  externalPublicationId: string;
  assetId: string;
  publishedAt: string | null;
  description: string | null;
  /**
   * An absolute URL, built here from the path Meta stores.
   *
   * The provider answers `/reel/885635650762805/` on this edge — a path, not a
   * URL. It is stored exactly as given and absolutized at the boundary, so the
   * column keeps the provider's own value while the client gets something it
   * can open.
   */
  permalink: string | null;
  /** A signed CDN URL that may already have expired. See the entity. */
  thumbnailUrl: string | null;
  lengthSeconds: string | null;
  plays: string | null;
  blueReelsPlays: string | null;
  replays: string | null;
  uniqueViewers: string | null;
  totalWatchTimeMs: string | null;
  avgWatchTimeMs: string | null;
  reactionsTotal: string | null;
  reactionsLike: string | null;
  reactionsLove: string | null;
  reactionsWow: string | null;
  reactionsHaha: string | null;
  reactionsSorry: string | null;
  reactionsAnger: string | null;
  comments: string | null;
  shares: string | null;
  newFollowers: string | null;
  retentionGraph: Record<string, number> | null;
  observedAt: string | null;
};

export type SocialOrganicFacebookReelsView = {
  items: SocialOrganicFacebookReelView[];
  total: number;
};

/** The counters a reel ranking may be ordered by. */
export const SOCIAL_ORGANIC_FACEBOOK_REEL_SORTS = [
  'plays',
  'uniqueViewers',
  'totalWatchTimeMs',
  'avgWatchTimeMs',
  'reactionsTotal',
  'comments',
  'shares',
  'publishedAt',
] as const;

export type SocialOrganicFacebookReelSort =
  (typeof SOCIAL_ORGANIC_FACEBOOK_REEL_SORTS)[number];

export function isSocialOrganicFacebookReelSort(
  value: unknown,
): value is SocialOrganicFacebookReelSort {
  return (
    typeof value === 'string' &&
    (SOCIAL_ORGANIC_FACEBOOK_REEL_SORTS as readonly string[]).includes(value)
  );
}

/** Meta's own host for the paths this edge returns. */
const FACEBOOK_WEB_ORIGIN = 'https://www.facebook.com';

export function toSocialOrganicFacebookReelView(
  reel: SocialOrganicFacebookReelEntity,
): SocialOrganicFacebookReelView {
  return {
    externalPublicationId: reel.externalPublicationId,
    assetId: reel.assetId,
    publishedAt: reel.publishedAt?.toISOString() ?? null,
    description: reel.description,
    permalink: absolutePermalink(reel.permalink),
    thumbnailUrl: reel.thumbnailUrl,
    lengthSeconds: reel.lengthSeconds,
    plays: reel.plays,
    blueReelsPlays: reel.blueReelsPlays,
    replays: reel.replays,
    uniqueViewers: reel.uniqueViewers,
    totalWatchTimeMs: reel.totalWatchTimeMs,
    avgWatchTimeMs: reel.avgWatchTimeMs,
    reactionsTotal: reel.reactionsTotal,
    reactionsLike: reel.reactionsLike,
    reactionsLove: reel.reactionsLove,
    reactionsWow: reel.reactionsWow,
    reactionsHaha: reel.reactionsHaha,
    reactionsSorry: reel.reactionsSorry,
    reactionsAnger: reel.reactionsAnger,
    comments: reel.comments,
    shares: reel.shares,
    newFollowers: reel.newFollowers,
    retentionGraph: reel.retentionGraph,
    observedAt: reel.observedAt?.toISOString() ?? null,
  };
}

/**
 * A stored permalink as something a browser can open.
 *
 * Only a leading-slash path is joined to Meta's host. A value that is already
 * absolute is passed through untouched, and anything else is dropped rather
 * than guessed at — a link built from a value this function did not recognise
 * would look like a working link and land nowhere.
 */
function absolutePermalink(permalink: string | null): string | null {
  if (!permalink) return null;
  if (permalink.startsWith('http://') || permalink.startsWith('https://')) {
    return permalink;
  }
  if (permalink.startsWith('/')) return `${FACEBOOK_WEB_ORIGIN}${permalink}`;
  return null;
}
