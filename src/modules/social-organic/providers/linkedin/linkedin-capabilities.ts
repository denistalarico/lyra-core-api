import type { PublisherCapabilities } from '../provider-capabilities';

export const LINKEDIN_PROVIDER = 'linkedin';
export const LINKEDIN_ORGANIZATION_ASSET_TYPE = 'linkedin_organization';

/**
 * Community Management API scopes of the "Lyra Social Pages" app (§10 U5).
 * DOCUMENTED 2026-11-16 (li-lms-2026-10): `w_organization_social` posts,
 * `r_organization_social` lists the page's posts, `rw_organization_admin`
 * serves ACLs, organization lookup and the share/follower statistics.
 */
export const SOCIAL_LINKEDIN_ORGANIC_SCOPES = [
  'w_organization_social',
  'r_organization_social',
  'rw_organization_admin',
] as const;

/** Scope the analytics sync needs; checked by the credential resolver. */
export const LINKEDIN_ANALYTICS_SCOPE = 'rw_organization_admin';

/** Videos API: 75 KB to 500 MB, 3 s to 30 min, MP4 (DOCUMENTED). */
const VIDEO_MIN_BYTES = 75 * 1024;
const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
/**
 * Images API documents a pixel limit (< 36,152,320) and JPG/GIF/PNG, but no
 * byte limit; this is Lyra's own cap.
 */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * LinkedIn Page (`linkedin_organization`). DOCUMENTED 2026-11-16:
 * https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 * `feed` is text or one image; `video` is one MP4. Multi-image, documents and
 * articles are out of the MVP. No `remove` (not requested).
 */
export const LINKEDIN_ORGANIZATION_CAPABILITIES: PublisherCapabilities = {
  provider: LINKEDIN_PROVIDER,
  assetType: LINKEDIN_ORGANIZATION_ASSET_TYPE,
  placements: ['feed', 'video'],
  media: {
    feed: {
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      maxBytes: IMAGE_MAX_BYTES,
      maxItemsPerPost: 1,
    },
    video: {
      acceptedMimeTypes: ['video/mp4'],
      maxBytes: VIDEO_MAX_BYTES,
      minDurationSeconds: 3,
      maxDurationSeconds: 30 * 60,
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

export const LINKEDIN_VIDEO_MIN_BYTES = VIDEO_MIN_BYTES;
