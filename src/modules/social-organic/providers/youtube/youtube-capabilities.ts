import type { PublisherCapabilities } from '../provider-capabilities';

export const YOUTUBE_PROVIDER = 'youtube';
export const YOUTUBE_CHANNEL_ASSET_TYPE = 'youtube_channel';

/** `videos.insert`: `video/*` up to 256 GB (D-I6). */
const MAX_VIDEO_BYTES = 256 * 1024 * 1024 * 1024;

/**
 * YouTube channel (`youtube_channel`). DOCUMENTED 2026-11-15:
 * https://developers.google.com/youtube/v3/docs/videos/insert
 *
 * There is no Short endpoint: a vertical video of up to 180 s is classified as
 * a Short by YouTube, so `short` only tightens the media rules. No `remove`:
 * `videos.delete` needs the `youtube` scope, which is not requested.
 */
export const YOUTUBE_CHANNEL_CAPABILITIES: PublisherCapabilities = {
  provider: YOUTUBE_PROVIDER,
  assetType: YOUTUBE_CHANNEL_ASSET_TYPE,
  placements: ['video', 'short'],
  media: {
    video: {
      acceptedMimeTypes: ['video/mp4', 'video/quicktime'],
      maxBytes: MAX_VIDEO_BYTES,
      maxItemsPerPost: 1,
    },
    short: {
      acceptedMimeTypes: ['video/mp4', 'video/quicktime'],
      maxBytes: MAX_VIDEO_BYTES,
      maxDurationSeconds: 180,
      aspectRatios: ['9:16'],
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
