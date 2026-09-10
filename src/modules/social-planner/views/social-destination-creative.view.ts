import {
  toMediaAssetView,
  type MediaAssetEntity,
  type MediaAssetView,
} from '../../../common/media-assets';
import type { SocialDestinationCreativeEntity } from '../entities';

/**
 * The authorized projection of a destination creative (Planner E5).
 *
 * Two things deliberately do not cross this boundary:
 *
 *   - the scope triple, for the reason `MediaAssetView` already states: the
 *     caller knows its own scope, and echoing internal ids back is how
 *     cross-context leaks have started here before;
 *   - anything derived from `storagePath`. The media is described by reusing
 *     `toMediaAssetView` rather than by re-listing fields, so this view can
 *     never drift into exposing a bucket key that the shared view was written
 *     to withhold. The frontend renders a preview through the authenticated
 *     `GET /social/publishing/media/:id/content` endpoint, using `media.id`.
 *
 * `organicAssetId` DOES cross it, because the frontend must be able to show
 * which connected account a creative was validated against — a destination
 * with two connected Instagram accounts is otherwise ambiguous on screen. It
 * is an internal Lyra uuid, not a provider identifier, and it is worthless
 * without a scoped query behind the same permission.
 */
export type SocialDestinationCreativeView = {
  id: string;
  destinationId: string;
  contentItemId: string;
  organicAssetId: string;
  role: string;
  sortOrder: number;
  source: string;
  media: MediaAssetView | null;
  createdAt: string;
  updatedAt: string;
};

export function toSocialDestinationCreativeView(
  creative: SocialDestinationCreativeEntity,
  mediaAsset: MediaAssetEntity | null,
): SocialDestinationCreativeView {
  return {
    id: creative.id,
    destinationId: creative.destinationId,
    contentItemId: creative.contentItemId,
    organicAssetId: creative.organicAssetId,
    role: creative.role,
    sortOrder: creative.sortOrder,
    source: creative.source,
    /**
     * `null` when the media row could not be read in this scope. That is a
     * fail-closed answer, not a "no creative" one: the link still exists, and
     * the caller sees a creative it cannot render rather than being told the
     * destination is empty and silently overwriting it.
     */
    media: mediaAsset ? toMediaAssetView(mediaAsset) : null,
    createdAt: creative.createdAt.toISOString(),
    updatedAt: creative.updatedAt.toISOString(),
  };
}
