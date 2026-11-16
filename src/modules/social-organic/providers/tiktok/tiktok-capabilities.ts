import type { PublisherCapabilities } from '../provider-capabilities';

export const TIKTOK_PROVIDER = 'tiktok';
export const TIKTOK_ACCOUNT_ASSET_TYPE = 'tiktok_account';

/** Scopes of the TikTok for Developers app (§10 U3). Closed list. */
export const SOCIAL_TIKTOK_ORGANIC_SCOPES = [
  'user.info.basic',
  'user.info.stats',
  'video.publish',
  'video.list',
] as const;

/** Scope the analytics sync needs (`video/list`); checked by the resolver. */
export const TIKTOK_ANALYTICS_SCOPE = 'video.list';

/**
 * Conservative ceiling. DOCUMENTED 2026-11-16 (Media Transfer Guide): at most
 * 1000 chunks of 5–64 MB. The per-file byte limit is not stated there, so this
 * is Lyra's own cap, not a provider figure.
 */
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * TikTok Direct Post (`video`). DOCUMENTED 2026-11-16:
 * https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 * The maximum duration is per creator (`creator_info`), so it is not declared
 * here. No `remove`: the Content Posting API has no delete.
 */
export const TIKTOK_ACCOUNT_CAPABILITIES: PublisherCapabilities = {
  provider: TIKTOK_PROVIDER,
  assetType: TIKTOK_ACCOUNT_ASSET_TYPE,
  placements: ['video'],
  media: {
    video: {
      acceptedMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      maxBytes: MAX_VIDEO_BYTES,
      maxItemsPerPost: 1,
    },
  },
  supportsScheduling: true,
  supportsCaption: true,
  supportsFirstComment: false,
  supportsHashtags: true,
  requiresReconciliation: true,
  supportsRemoval: false,
};
