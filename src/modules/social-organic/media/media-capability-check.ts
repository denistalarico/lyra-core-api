import type { ValidationResult } from '../providers/social-publisher.adapter';
import type { PublisherCapabilities } from '../providers/provider-capabilities';
import type { ResolvedMediaAsset } from '../../../common/media-assets';
import { validateMediaAgainstCapabilities } from './media-validation';

/**
 * Bridges a resolved `MediaAsset` (M3.1A persisted row) into `M1`'s
 * `validateMediaAgainstCapabilities`. Shared by the create/retry schedule-time
 * check (`P3.1`) and the execution-time check
 * (`SocialPublicationExecutorService`) so the metadata-shape mapping and the
 * "incomplete metadata fails closed" rule exist in exactly one place.
 *
 * Reuses the persisted `MediaAsset` metadata as-is (M3.1B's decision) — never
 * re-extracts (M2) or guesses a default for a missing field.
 */
export function checkMediaAssetCapability(
  resolvedMedia: ResolvedMediaAsset,
  capabilities: PublisherCapabilities,
  placement: string,
): ValidationResult {
  if (resolvedMedia.width === null && resolvedMedia.height === null) {
    // No usable dimensions and no image/video track parsed for this asset:
    // capability validation cannot be trusted to a guess.
    return {
      valid: false,
      issues: [{ field: 'metadata', reason: 'media_metadata_incomplete' }],
    };
  }

  const byteSize = Number(resolvedMedia.byteSize);
  const durationSeconds =
    resolvedMedia.durationMs === null
      ? null
      : Number(resolvedMedia.durationMs) / 1000;

  return validateMediaAgainstCapabilities(
    {
      mimeType: resolvedMedia.mimeType,
      bytes: Number.isFinite(byteSize) ? byteSize : Number.MAX_SAFE_INTEGER,
      kind: resolvedMedia.durationMs === null ? 'image' : 'video',
      width: resolvedMedia.width ?? 0,
      height: resolvedMedia.height ?? 0,
      durationSeconds,
      codec: resolvedMedia.codec ?? '',
      aspectRatio:
        resolvedMedia.width && resolvedMedia.height
          ? resolvedMedia.width / resolvedMedia.height
          : 0,
    },
    capabilities,
    placement,
  );
}
