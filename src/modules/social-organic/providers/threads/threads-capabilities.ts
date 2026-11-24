import type { PublisherCapabilities } from '../provider-capabilities';

/**
 * Threads profiles authorized through the Threads use case of the Meta app.
 * A distinct provider key, like Instagram Login next to Facebook Login: the
 * use case has its own app ID/secret and its tokens only work on
 * `graph.threads.com`.
 */
export const THREADS_PROVIDER = 'threads';
export const THREADS_ACCOUNT_ASSET_TYPE = 'threads_account';

/** DOCUMENTED 2026-11-23 (Get access tokens and permissions). */
export const SOCIAL_THREADS_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_insights',
] as const;

/** DOCUMENTED: text posts are limited to 500 characters (emoji = UTF-8 bytes). */
export const THREADS_TEXT_MAX_LENGTH = 500;
/** DOCUMENTED: a carousel holds 2–20 items. */
export const THREADS_CAROUSEL_MAX_ITEMS = 20;
/** DOCUMENTED: images JPEG/PNG up to 8 MB; videos MOV/MP4 up to 1 GB, 5 min. */
export const THREADS_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const THREADS_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;

const EMOJI_CODE_POINT =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200D|\uFE0F|\u20E3/u;

/**
 * How Threads counts a post's text: one per character, except emoji (and
 * their joiners/variation selectors), which count as their UTF-8 byte length.
 * The web Planner mirrors this rule in `plannerChannelRules.ts`.
 */
export function threadsTextLength(text: string): number {
  let length = 0;
  for (const char of text) {
    length += EMOJI_CODE_POINT.test(char) ? Buffer.byteLength(char, 'utf8') : 1;
  }
  return length;
}

/**
 * `POST /{user}/threads` → `/threads_publish`: text, one image/video or a
 * carousel, all in the `feed` placement. Scheduling is Lyra's queue. No
 * removal (the adapter has no `remove`).
 */
export const THREADS_ACCOUNT_CAPABILITIES: PublisherCapabilities = {
  provider: THREADS_PROVIDER,
  assetType: THREADS_ACCOUNT_ASSET_TYPE,
  placements: ['feed'],
  media: {
    feed: {
      acceptedMimeTypes: [
        'image/jpeg',
        'image/png',
        'video/mp4',
        'video/quicktime',
      ],
      // The single block carries the video ceiling; the 8 MB image ceiling is
      // checked by the adapter before the container is created.
      maxBytes: THREADS_VIDEO_MAX_BYTES,
      maxDurationSeconds: 300,
      maxItemsPerPost: THREADS_CAROUSEL_MAX_ITEMS,
    },
  },
  supportsScheduling: true,
  supportsCaption: true,
  supportsFirstComment: false,
  supportsHashtags: false,
  requiresReconciliation: true,
  supportsRemoval: false,
};
