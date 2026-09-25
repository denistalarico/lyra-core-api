/**
 * One story in the "Stories em destaque" panel.
 *
 * ## Why this is not a row of the posts table
 *
 * A post ranking is a table: many rows, each narrow, ordered by one column. The
 * story panel is the opposite shape — a handful of stories, each shown as its
 * creative beside a dozen figures — because that is what the numbers support. A
 * story has retention counters (how the viewer left it) that no other surface
 * has, and it has no caption, no permalink worth showing and usually no reach
 * worth ranking deeply. Five stories with everything beats fifty with three
 * columns.
 *
 * ## `mediaUrl` is best-effort and will often be null
 *
 * Meta signs media URLs with a ~5 day expiry while the story itself is gone
 * after one day. The URL stored at capture works for a report opened soon
 * after and is dead for one opened later, and there is nothing to re-resolve it
 * from — unlike a feed post, whose thumbnail can always be asked for again. A
 * renderer must treat the absence as ordinary rather than as an error.
 */
export type SocialOrganicTopStoryView = {
  externalPublicationId: string;
  assetId: string;
  publishedAt: string | null;
  mediaType: string | null;
  permalink: string | null;
  /** Expires; see the type docblock. Null is the ordinary late case. */
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  /** Lifetime counters as of `observedAt`. Reach is never summed across rows. */
  views: string | null;
  reach: string | null;
  totalInteractions: string | null;
  profileVisits: string | null;
  replies: string | null;
  shares: string | null;
  /**
   * Retention, from `navigation` broken down by `story_navigation_action_type`.
   *
   * Expected to be null on accounts whose stories were captured before Meta's
   * support for this breakdown could be verified — it could not be measured
   * against the production account, which has never had a story live while one
   * was being observed.
   */
  navForward: string | null;
  navNextStory: string | null;
  navBack: string | null;
  navExit: string | null;
  /** When the counters above were read, not when the story was posted. */
  observedAt: string | null;
};

export type SocialOrganicTopStoriesView = {
  items: SocialOrganicTopStoryView[];
  total: number;
};

/**
 * The metrics a story ranking may be ordered by.
 *
 * Deliberately shorter than the posts table's list: a story's `profileVisits`
 * and `follows` are usually zero, and offering them as sort keys would invite
 * ordering fifty rows by a column of zeros.
 */
export const SOCIAL_ORGANIC_TOP_STORY_SORTS = [
  'views',
  'reach',
  'totalInteractions',
  'replies',
  'shares',
  'publishedAt',
] as const;

export type SocialOrganicTopStorySort =
  (typeof SOCIAL_ORGANIC_TOP_STORY_SORTS)[number];

export function isSocialOrganicTopStorySort(
  value: unknown,
): value is SocialOrganicTopStorySort {
  return (
    typeof value === 'string' &&
    (SOCIAL_ORGANIC_TOP_STORY_SORTS as readonly string[]).includes(value)
  );
}
